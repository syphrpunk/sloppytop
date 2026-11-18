import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateProbes } from '../store/config.ts'
import { openDb } from '../store/db.ts'
import { recordSample } from '../store/record.ts'
import type { SystemStats } from '../monitor/types.ts'
import { changeRecorder, recorderMatches } from './recorder.ts'
import { readService } from './store.ts'

test('install commits to the resolved DB before scheduling; readback retains the sample after a partial failure', async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const root = mkdtempSync(join(tmpdir(), 'settings-write-'))
  process.env.XDG_CONFIG_HOME = root
  const system: SystemStats = { cpu_brand: 'fixture', cpu_usage_per_core: [0], cpu_usage_total: 0, core_count: 1,
    memory_total: 100, memory_used: 0, memory_free: 100, uptime_secs: 60, load_avg: [0, 0, 0], network_rx_bytes: 0,
    network_tx_bytes: 0, disk_total_bytes: 100, disk_used_bytes: 0, disk_free_bytes: 100, hostname: 'fixture',
    os_version: 'fixture', kernel_version: 'fixture', process_count: 0 }
  try {
    mkdirSync(join(root, 'neohtop'))
    openDb(join(root, 'neohtop', 'neohtop.db')).close()
    const steps: string[] = []
    const read = () => readService(() => ({ scheduler: 'launchd', installed: false, loaded: false, files: [],
      scheduler_state: 'inactive', recorder_state: 'idle' }))
    const deps = { platform: 'darwin', record: () => recordSample(async () => {
      steps.push('sample'); return { system, processes: [] }
    }), install: (seconds: number) => { steps.push(`install:${seconds}`); throw Error('write denied') },
    uninstall: () => { steps.push('uninstall') } }
    const message = await changeRecorder({ kind: 'enable', seconds: 120 }, deps)
    expect(message).toContain(`Sample 1 stored at ${join(root, 'neohtop', 'neohtop.db')}`)
    expect(message).toContain('Scheduler install failed: write denied')
    expect(steps).toEqual(['sample', 'install:120'])
    const actual = read()
    expect(actual.last_successful_sample_at).toBeDefined()
    expect(actual.service?.scheduler_state).toBe('inactive')
    updateProbes(['cpu'], false) // including config changes while confirmation was open
    expect(await changeRecorder({ kind: 'cadence', seconds: 180 }, deps)).toContain('scheduler not changed: record needs these probes enabled: cpu')
    expect(steps).toEqual(['sample', 'install:120'])
    expect(await changeRecorder({ kind: 'disable' }, deps)).toContain('Requested recorder removal')
    expect(steps).toEqual(['sample', 'install:120', 'uninstall'])
    expect(read().last_successful_sample_at).toBe(actual.last_successful_sample_at)
    updateProbes(['cpu'], true)
    rmSync(actual.databasePath)
    mkdirSync(actual.databasePath) // the insert destination is no longer a file
    expect(await changeRecorder({ kind: 'enable', seconds: 60 }, deps)).toContain('Record failed; scheduler not changed')
    expect(read().insertError).toBeDefined()
    expect(steps).toEqual(['sample', 'install:120', 'uninstall', 'sample'])
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('defensive guards precede both writes; a failed insert never installs', async () => {
  const calls: string[] = []
  const deps = { platform: 'linux', record: async () => { calls.push('record'); throw Error('database is read-only') },
    install: () => { calls.push('install') }, uninstall: () => { calls.push('uninstall'); throw Error('removal denied') } }
  for (const kind of ['disable', 'enable'] as const) {
    expect(await changeRecorder({ kind, seconds: 120 }, { ...deps, platform: 'win32' })).toContain('unsupported')
  }
  for (const seconds of [0, 59, 60.1, NaN, Infinity]) expect(await changeRecorder({ kind: 'enable', seconds }, deps)).toContain('Invalid interval')
  expect(calls).toEqual([])
  expect(await changeRecorder({ kind: 'enable', seconds: 60 }, deps)).toContain('scheduler not changed: database is read-only')
  expect(await changeRecorder({ kind: 'disable' }, deps)).toContain('removal failed: removal denied')
  expect(calls).toEqual(['record', 'uninstall'])
})

test('readback must confirm the requested state and effective interval, not just a successful scheduler call', () => {
  const service = { scheduler: 'systemd', installed: true, loaded: true, recorder_state: 'idle', scheduler_state: 'armed' } as const
  const change = { kind: 'cadence', seconds: 3660 } as const
  for (const cadence of ['1h 1min', '3660s']) expect(recorderMatches(change, { ...service, cadence })).toBe(true)
  for (const cadence of ['1h', undefined, 'unknown']) expect(recorderMatches(change, { ...service, cadence })).toBe(false)
  expect(recorderMatches({ kind: 'disable' }, service)).toBe(false)
  expect(recorderMatches({ kind: 'disable' }, { ...service, installed: false, scheduler_state: 'unknown' })).toBe(false)
})
