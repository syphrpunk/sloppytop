import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RECORD_PROBES } from '../monitor/probes.ts'
import { configPath, loadConfig, updateProbes, updateRecordGroup } from '../store/config.ts'
import { OPTIONAL_RECORD_GROUPS } from '../store/record-policy.ts'
import { openRecordGroups, recordGroupLines, reduceRecordGroups, saveRecordGroupChange } from './record-groups.ts'

function withTempConfig(check: () => void) {
  const previous = process.env.XDG_CONFIG_HOME
  const root = mkdtempSync(join(tmpdir(), 'record-groups-'))
  process.env.XDG_CONFIG_HOME = root
  try {
    check()
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
}

test('arrows and j/k clamp and keep the cursor visible; required rows and navigation never write', () => withTempConfig(() => {
  const config = loadConfig()
  let view = openRecordGroups(config.record.optionalGroups)
  expect(reduceRecordGroups(view, 'up').view.index).toBe(0)
  for (const group of RECORD_PROBES) {
    expect(recordGroupLines(view, config.probes, 1).slice(1)).toEqual([`> ${group} (required, read-only)`])
    expect(reduceRecordGroups(view, 'space')).toEqual({ view })
    view = reduceRecordGroups(view, 'down').view
  }
  for (const group of OPTIONAL_RECORD_GROUPS) {
    expect(recordGroupLines(view, config.probes, 1).slice(1)).toEqual([`> [x] ${group} (optional)`])
    expect(reduceRecordGroups(view, 'space')).toEqual({ view, change: { group, enabled: false } })
    view = reduceRecordGroups(view, 'j').view
  }
  expect(reduceRecordGroups(view, 'down').view.index).toBe(view.index)
  expect(reduceRecordGroups(view, 'k').view.index).toBe(view.index - 1)
  for (const key of ['return', 'enter', 'escape', 'esc', 'q', 'm']) {
    expect(reduceRecordGroups(view, key)).toEqual({ view })
  }
  expect(existsSync(configPath())).toBe(false)
}))

test('Space persists only the selected storage preference, even when collection is off', () => withTempConfig(() => {
  const config = updateProbes(['cpu', 'processes'], false)
  let view = openRecordGroups(config.record.optionalGroups)
  expect(recordGroupLines(view, config.probes, 1)[1]).toContain('probe off: recording blocked')
  for (const _ of RECORD_PROBES) view = reduceRecordGroups(view, 'j').view
  expect(recordGroupLines(view, config.probes, 1)[1]).toContain('[x] processes (optional) · probe off: not collected')

  // Another preference changes after Settings opened. The save must not replace it with a stale copy.
  const before = updateRecordGroup('swap', false)
  for (const enabled of [false, true]) {
    const { change } = reduceRecordGroups(view, 'space')
    expect(change).toEqual({ group: 'processes', enabled })
    view = saveRecordGroupChange(view, change!)
    expect(view.error).toBeUndefined()
    expect(loadConfig()).toEqual({ ...before, record: { ...before.record, optionalGroups: { ...before.record.optionalGroups, processes: enabled } } })
    const reopened = openRecordGroups(loadConfig().record.optionalGroups)
    expect(view.optionalGroups).toEqual(reopened.optionalGroups)
  }
}))

test('a failed write leaves the chosen value and cursor intact; Space retries', () => withTempConfig(() => {
  const config = loadConfig()
  let view = openRecordGroups(config.record.optionalGroups)
  for (const _ of RECORD_PROBES) view = reduceRecordGroups(view, 'down').view
  const toggle = () => reduceRecordGroups(view, 'space').change!
  mkdirSync(configPath(), { recursive: true }) // deterministic write failure even as root
  const failed = saveRecordGroupChange(view, toggle())
  expect(failed.index).toBe(view.index)
  expect(failed.optionalGroups).toEqual(view.optionalGroups)
  expect(recordGroupLines(failed, config.probes, 1)).toEqual([
    'Could not save processes. Check config write access.', '> [x] processes (optional)',
  ])
  rmSync(configPath(), { recursive: true })
  view = failed
  const retried = saveRecordGroupChange(view, toggle())
  expect(recordGroupLines(retried, config.probes, 1)).toEqual([
    'Recording groups · SQLite only (when measured)', '> [ ] processes (optional)',
  ])
  expect(loadConfig().record.optionalGroups.processes).toBe(false)
}))
