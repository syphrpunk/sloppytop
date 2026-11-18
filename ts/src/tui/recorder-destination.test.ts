import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TUI } from '../store/config.ts'
import { openDb } from '../store/db.ts'
import { compose, emptyHistory } from './frame.ts'
import type { DestinationReply, DestinationRequest } from './recorder-destination.ts'
import type { WorkerReply } from './sample-worker.ts'
import { initialState, reduce, setDestinationDraft, type KeyPress, type ScreenState } from './state.ts'

function key(state: ScreenState, name: string, extra?: Partial<KeyPress>) {
  return reduce(state, { name, ctrl: false, shift: false, ...extra }, [])
}
function details(): ScreenState {
  const state = key(initialState({ ...DEFAULT_TUI, pins: [] }, { width: 100, height: 24 }), 'm').state
  return key({ ...state, settingsPage: { ...state.settingsPage!, recorder: {
    status: 'ready', health: { databasePath: '/fixture/neohtop.db', schedulerError: 'not checked' },
  } } }, 'enter').state
}
function render(state: ScreenState) {
  return compose(state, { processes: [], system: {}, history: emptyHistory() }).text
}

test('path entry treats q, punctuation, case and spaces as text; rejects unsafe paste atomically', () => {
  let edit = key(details(), 'p').state
  expect(render(edit)).toContain('Recorder destination path')
  expect(render(edit)).not.toContain('q close')
  for (const name of '/q') edit = key(edit, name).state
  edit = key(edit, 'b', { shift: true, text: 'B' }).state
  edit = key(edit, 'space').state
  edit = key(edit, 'slash', { text: '/' }).state
  expect(edit.settingsPage!.recorderEdit).toEqual({ step: 'path', draft: '/qB /' })
  const draft = '/qB /界.sqlite3'
  edit = setDestinationDraft(edit, draft).state
  for (const bad of ['\n', '\x1b', '\u202e', 'x'.repeat(4097)]) {
    edit = setDestinationDraft(edit, draft + bad).state
    expect(render(edit)).toContain('Input rejected')
    expect(edit.settingsPage!.recorderEdit).toEqual({ step: 'path', draft })
  }
  expect(key(edit, 'enter').effect).toEqual({ destination: { kind: 'preview', path: draft } })
  expect(key(key(edit, 'esc').state, 'y').effect).toBeUndefined()
  expect(key(details(), 'r').effect).toEqual({ destination: { kind: 'preview', path: null } })
})

test('preview renders both histories and permissions, requires explicit y; cancel/duplicates cannot change anything', () => {
  const page = details()
  const current = { path: '/fixture/neohtop.db', samples: 2, exists: true, writable: false,
    first: '2026-11-01', last: '2026-11-03' }
  const target = { path: '/fixture/target.db', samples: 1, exists: true, writable: true,
    first: '2026-10-01', last: '2026-10-01' }
  function review(writable: boolean): ScreenState {
    return { ...page, settingsPage: { ...page.settingsPage!, recorderEdit: { step: 'destinationReview', reset: false,
      review: { kind: 'review', id: 'ticket', preview: { current, target: { ...target, writable } } } } } }
  }
  const state = review(true)
  for (const marker of [current.path, target.path, '2 samples', '1 sample', 'not writable', current.first, current.last,
    target.first, 'History stays in place.', 'n/Esc cancel']) expect(render(state)).toContain(marker)
  for (const cancel of ['q', 'n', 'esc']) {
    const result = key(state, cancel)
    expect(result.effect).toBeUndefined()
    expect(key(result.state, 'y').effect).toBeUndefined()
  }
  for (const noop of ['enter', 'space', 'p', 'r', 'e', 'd', 'c']) expect(key(state, noop).effect).toBeUndefined()
  expect(key(state, 'y', { ctrl: true }).effect).toBeUndefined()
  expect(key(review(false), 'y').effect).toBeUndefined()
  const result = key(state, 'y')
  expect(result.effect).toEqual({ destination: { kind: 'confirm', id: 'ticket' } })
  expect(key(result.state, 'y').effect).toBeUndefined()
})

test('collector revalidates the original preview and reads back switched and legacy paths; changes only config', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'destination-worker-')))
  const old = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = root
  const worker = new Worker(new URL('./sample-worker.ts', import.meta.url).href, { env: { HOME: root, XDG_CONFIG_HOME: root, PATH: '' } })
  const request = (input: DestinationRequest) => new Promise<DestinationReply>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${input.kind} timed out`)), 2500)
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      clearTimeout(timer)
      if ('destination' in data) resolve(data.destination)
      else reject(new Error('error' in data ? data.error : 'unexpected worker reply'))
    }
    worker.onerror = ev => reject(Error(ev.message))
    worker.postMessage({ kind: 'destination', input })
  })
  async function preview(path: string | null) {
    const reply = await request({ kind: 'preview', path })
    if (reply.kind !== 'review') throw Error('expected review')
    return reply
  }
  try {
    const legacyDir = join(root, 'neohtop')
    mkdirSync(legacyDir)
    const legacy = join(legacyDir, 'neohtop.db'), config = join(legacyDir, 'config.json'), target = join(root, 'new DB.sqlite3')
    openDb(legacy).close()
    const bytes = readFileSync(legacy)
    const original = '{"record":{"future":7}}'
    writeFileSync(config, original)
    const stale = await preview(target)
    expect(stale.preview.current.path).toBe(legacy)
    expect(stale.preview.target).toMatchObject({ path: target, exists: false, samples: 0 })
    expect(readFileSync(config, 'utf8')).toBe(original)
    writeFileSync(target, 'intervening unrelated file')
    const staleError = await request({ kind: 'confirm', id: stale.id }).catch(err => err.message)
    expect(staleError).toMatch(/database|destination/i)
    expect(readFileSync(target, 'utf8')).toBe('intervening unrelated file')
    expect(readFileSync(config, 'utf8')).toBe(original)
    expect(readFileSync(legacy)).toEqual(bytes)
    rmSync(target)
    const ready = await preview(target)
    expect(await request({ kind: 'confirm', id: ready.id })).toMatchObject({ kind: 'verified', location: { path: target, exists: false } })
    const replayError = await request({ kind: 'confirm', id: ready.id }).catch(err => err.message)
    expect(replayError).toContain('expired')
    expect(JSON.parse(readFileSync(config, 'utf8')).record).toEqual({ future: 7, databasePath: target })
    expect(existsSync(target)).toBe(false)
    const reset = await preview(null)
    expect(reset.preview.target.path).toBe(legacy)
    expect(await request({ kind: 'confirm', id: reset.id })).toMatchObject({ kind: 'verified', location: { path: legacy } })
    expect(JSON.parse(readFileSync(config, 'utf8')).record).toEqual({ future: 7 })
    expect(readFileSync(legacy)).toEqual(bytes)
  } finally {
    worker.terminate()
    if (old === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = old
    rmSync(root, { recursive: true, force: true })
  }
})
