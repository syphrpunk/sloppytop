import { spawn } from 'node:child_process'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

test('history renders age and an unobserved interval as a distinct cell', () => {
  const row = (hoursAgo: number) => ({
    at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    cpu_usage_total: 0, memory_used: 0, load_1: 0,
  })
  const page = historyView([row(1), row(4)])
  const frame = compose(screen({ overlay: 'history', historyPage: page }), {
    processes: [], system: {}, history: emptyHistory(),
  })
  expect(frame.text).toContain('latest 60m ago')
  expect(frame.text).toContain('⠀╌⠀')
  expect(frame.text).toContain('╌ unobserved time')
})
import { defaultProbes } from '../monitor/probes.ts'
import type { SystemStats } from '../monitor/types.ts'
import { DEFAULT_TUI } from '../store/config.ts'
import { reportSampleAnomalies } from '../store/report.ts'
import { openDb, insertSample, queryHistory, queryTopProcesses } from '../store/db.ts'
import { compose, emptyHistory } from './frame.ts'
import { EMPTY_WINDOW, attemptRecord, bindMetricsListener, historyView, logView, readReport, readService, reportView } from './store.ts'
import { initialState, reduce, wantsQuit, type KeyPress, type ScreenState } from './state.ts'

function key(name: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { name, ctrl: false, shift: false, ...extra }
}

function screen(over: Partial<ScreenState> = {}): ScreenState {
  return {
    ...initialState(
      { columns: [...DEFAULT_TUI.columns], theme: 'mocha', refreshMs: 1000, pins: [] },
      { width: 80, height: 24 },
    ),
    waiting: false,
    ...over,
  }
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

const storedSystem = {
  cpu_usage_total: 0, core_count: 1, cpu_usage_per_core: [0], memory_used: 0, memory_total: 1024 ** 3,
  load_avg: [0, 0, 0], process_count: 2, disk_total_bytes: 0, disk_used_bytes: 0, disk_free_bytes: 0,
  memory_free: 1024 ** 3, network_rx_bytes: 0, network_tx_bytes: 0,
  hostname: 'fixture', os_version: 'fixture', kernel_version: 'fixture', uptime_secs: 0, cpu_brand: 'fixture',
} satisfies SystemStats

test('report renders sampled deltas, workload coverage, and full stored RSS evidence', () => {
  using db = openDb(':memory:')
  const now = Date.parse('2026-11-18T12:00:00Z')
  const insert = (offset: number, cpu: number, rss: number) => insertSample(
    db, new Date(now - offset).toISOString(), { ...storedSystem, cpu_usage_total: cpu },
    [{ pid: 7, ppid: 1, name: 'growth-fixture', cpu_usage: 0, memory_bytes: rss, disk_read_bytes: 0,
      disk_write_bytes: 0, runtime_secs: 0, user: '', command: 'not shown', status: 'Running' }],
    { processLimit: 1, retentionDays: 36500 },
  )
  insert(25 * 3_600_000, 10, 32 * 2 ** 20)
  for (let i = 0; i < 12; i++) insert((12 - i) * 300_000, 0, (32 + 8 * i) * 2 ** 20)
  const state = { ...screen({ height: 40 }), overlay: 'report' as const,
    reportPage: readReport(db, [{ name: 'test group', patterns: ['growth-fixture'] }], now) }
  const render = (current: ScreenState) => compose(current, { processes: [], system: {}, history: emptyHistory() }).text
  const compare = render(reduce(state, key('c'), []).state)
  expect(compare).toContain('CPU -10 pp')
  expect(compare).toContain('coverage  unequal')
  const workloads = render(reduce(state, key('w'), []).state)
  expect(workloads).toContain('incomplete  1/2 stored')
  expect(workloads).toContain('CPU 0.0%')
  expect(workloads).not.toContain('not shown')
  const leak = render(reduce(state, key('l'), []).state)
  expect(leak).toContain('growth-fixture')
  expect(leak).toContain('12 points')
  expect(leak).toContain('recent slope')
  expect(leak).toContain('minimumRelativeGrowth: 0.05')
})

describe('record gate', () => {
  test('cpu off refuses before the sample and the insert', async () => {
    const probes = defaultProbes()
    probes.cpu = false
    let sampled = false
    let inserted = false
    const result = await attemptRecord(probes, {
      sample: async () => {
        sampled = true
        return { system: { cpu_usage_total: 1 } as SystemStats, processes: [] }
      },
      insert: () => {
        inserted = true
        return { sampleId: 4, processesStored: 1 }
      },
    })
    expect(result.recorded).toBe(false)
    expect(result.message).toBe('PROBE_DISABLED  record needs these probes enabled: cpu')
    expect(sampled).toBe(false)
    expect(inserted).toBe(false)

    const frame = compose(screen({ overlay: 'record', recordPage: { message: result.message } }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('PROBE_DISABLED')
    expect(frame.text).toContain('record needs these probes enabled: cpu')
  })

  test('a clear gate records the sample id', async () => {
    let sampled = false
    const result = await attemptRecord(defaultProbes(), {
      sample: async () => {
        sampled = true
        return { system: { cpu_usage_total: 1 } as SystemStats, processes: [] }
      },
      insert: () => ({ sampleId: 4, processesStored: 2 }),
    })
    expect(sampled).toBe(true)
    expect(result.recorded).toBe(true)
    expect(result.message).toContain('recorded sample 4')
    expect(result.message).toContain('2 processes')
  })
})

describe('history and report pages', () => {
  test.each([[56, 12], [112, 30]])('inspect drills into one stored sample and returns at %ix%i', (width, height) => {
    using db = openDb(':memory:')
    const at = new Date().toISOString()
    const options = { processLimit: 1, retentionDays: 30 }
    // Same instant, different rows: timestamps alone cannot identify this evidence.
    const flagged = insertSample(db, at, { ...storedSystem, psi_io_some_avg10: 17,
      network_interfaces: [{ name: 'selected-link', tx_bytes_per_s: 0 }] },
      [{ name: 'selected-worker', pid: 42, ppid: 1, cpu_usage: 0, memory_bytes: 0,
        command: 'SECRET-ARG', user: '', status: 'Running', runtime_secs: 0, disk_read_bytes: 0, disk_write_bytes: 0 }], options)
    insertSample(db, at, storedSystem, [], options)
    const rows = queryHistory(db, at, 5).sort((a, b) => b.id - a.id)
    expect(rows[1]!.id).toBe(flagged.sampleId)
    const view = historyView(rows, reportSampleAnomalies(db, at), id => queryTopProcesses(db, id))
    let state = screen({ overlay: 'history', historyPage: view, width, height })
    const draw = () => compose(state, { system: {}, processes: [], history: emptyHistory() })
    const press = (name: string) => { state = reduce(state, key(name), []).state }
    press('i')
    press('enter')
    expect(draw().text).toContain('sample evidence 1/2')
    expect(draw().text).toContain('No flags, interface readings or stored process rows')
    expect(draw().text).not.toMatch(/selected-|io_pressure/)
    press('esc')
    press('left')
    const selected = draw().text
    expect(selected).toContain('history sample 2/2')
    expect(selected).toContain('Enter evidence')
    expect(selected).not.toContain('selected-worker')
    press('return')
    expect(draw().text).toContain('sample evidence 2/2')
    expect(draw().text).toContain('Esc back to sample')
    expect(draw().text).toContain(at)
    let evidence = draw().text
    const max = draw().layout.overlayScrollMax ?? 0
    if (height === 12) expect(max).toBeGreaterThan(0)
    state = { ...state, overlayScrollMax: max }
    for (let i = 0; i < max; i++) {
      press('down')
      evidence += '\n' + draw().text
    }
    expect(evidence).toContain('psi_io_some_avg10 17 >= 10')
    expect(evidence).toContain('selected-link  rx —  tx 0 B/s')
    expect(evidence).toContain('selected-worker')
    expect(evidence).not.toContain('SECRET-ARG')
    press('right') // Don't change the selection under the drill-down.
    press('escape')
    expect(draw().text).toBe(selected)
    press('i')
    expect(draw().text).toContain('i inspect')
  })

  test('disk comparison has aligned charts and lets short screens switch metrics', () => {
    const base = { cpu_usage_total: 1, memory_used: 1, load_1: 0 }
    const disk = (name: string, read: number, latency?: number) => ({
      name, read_bytes_per_s: read, write_bytes_per_s: 0, read_iops: 1, write_iops: 0,
      ...(latency === undefined ? {} : { read_latency_ms: latency }),
    })
    const view = historyView([
      { ...base, at: '2026-10-23T00:00:02Z', disk_devices: [disk('disk-alpha', 5, 2), disk('disk-beta', 0)] },
      { ...base, at: '2026-10-23T00:00:01Z', disk_devices: [disk('disk-alpha', 10)] },
    ])
    const input = { processes: [], system: {}, history: emptyHistory() }
    let state = screen({ overlay: 'history', historyPage: view, width: 52, height: 12 })
    expect(compose(state, input).text).toContain('d disks')
    state = reduce(state, key('d'), []).state
    const throughput = compose(state, input).text
    expect(throughput).toContain('read B/s')
    expect(throughput).toMatch(/1 disk-alpha +⠤*⣿⣤/)
    expect(throughput).toMatch(/2 disk-beta +⠤*⠂⠀/)
    expect(throughput).toContain('q close')
    state = reduce(state, key('left'), []).state
    const latency = compose(state, input).text
    expect(latency).toContain('read avg ms')
    expect(latency).toMatch(/2 disk-beta +⠤*⠂⠂/)
    expect(reduce(state, key('right'), []).state.historyDiskIndex).toBe(0)
    expect(reduce(state, key('d'), []).state.historyDiskIndex).toBeNull()
    expect(reduce(state, key('escape'), []).state.overlay).toBe('none')
  })

  test('legacy history offers no disk hint and the disk tab explains missing data', () => {
    const view = historyView([{ at: '2026-10-23T00:00:01Z', cpu_usage_total: 1, memory_used: 1, load_1: 0 }])
    const state = screen({ overlay: 'history', historyPage: view })
    const input = { processes: [], system: {}, history: emptyHistory() }
    expect(compose(state, input).text).not.toContain('d disks')
    const disk = reduce(state, key('d'), []).state
    expect(compose(disk, input).text).toContain('no recorded device readings')
    expect(reduce(disk, key('right'), []).state).toBe(disk)
  })

  test('an empty store draws the empty window and no sparkline', () => {
    const view = historyView([])
    expect(view.status).toBe('empty')
    expect(view.message).toBe(EMPTY_WINDOW)
    expect(view.cpu).toEqual([])
    expect(view.memory).toEqual([])
    expect(view.load).toEqual([])
    const frame = compose(screen({ overlay: 'history', historyPage: view }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text.split('\n').map((line) => line.replace(/^│|│$/g, '').trim()).join(' ')).toContain(EMPTY_WINDOW)
    expect(frame.text.split('\n').some((line) => line.startsWith('cpu'))).toBe(false)
    expect(frame.text.split('\n').some((line) => line.startsWith('CPU'))).toBe(false)
  })

  test('charts run oldest first and the recent list stays newest first', () => {
    const view = historyView([
      { at: '2026-10-23T00:00:02.000Z', cpu_usage_total: 2, memory_used: 20, load_1: 0.2 },
      { at: '2026-10-23T00:00:01.000Z', cpu_usage_total: 1, memory_used: 10, load_1: 0.1 },
    ])
    expect(view.cpu).toEqual([1, 2])
    expect(view.memory).toEqual([10, 20])
    expect(view.load).toEqual([0.1, 0.2])
    expect(view.recent[0]).toMatchObject({
      at: '00:00:02', timestamp: '2026-10-23T00:00:02.000Z', cpu: 2, memory: 20, load: 0.2,
    })
    expect(view.series).toEqual([])
    expect(view.notes).toEqual([])
  })

  test('stored power, battery, rates, and sensors stay separate readings', () => {
    const view = historyView([
      {
        at: '2026-10-23T00:00:02.000Z',
        cpu_usage_total: 2,
        memory_used: 20,
        load_1: 0.2,
        cpu_power_watts: 0,
        gpu_power_watts: 0.4,
        ane_power_watts: 0,
        dram_power_watts: 1.5,
        battery_charge_percent: 80,
        network_rx_bytes: 3000,
        network_tx_bytes: 5000,
        swap_used_bytes: 0,
        thermal_state: 'nominal',
        memory_pressure_level: 'normal',
        temperatures: [
          { name: 'pkg', celsius: 70, critical_celsius: 100, headroom_celsius: 30 },
          { name: 'nvme', celsius: 45 },
        ],
        fans: [{ name: 'fan1', rpm: 0 }],
      },
      {
        at: '2026-10-23T00:00:01.000Z',
        cpu_usage_total: 1,
        memory_used: 10,
        load_1: 0.1,
        cpu_power_watts: 7.5,
        gpu_power_watts: 0.4,
        network_rx_bytes: 1000,
        network_tx_bytes: 4000,
        temperatures: [{ name: 'pkg', celsius: 60, headroom_celsius: 40 }],
      },
    ])
    const labeled = (label: string) => view.series.find((series) => series.label === label)
    expect(labeled('cpu W')?.values).toEqual([7.5, 0])
    expect(labeled('gpu W')?.values).toEqual([0.4, 0.4])
    expect(labeled('ane W')?.values).toEqual([null, 0])
    expect(labeled('dram W')?.values).toEqual([null, 1.5])
    expect(labeled('batt')?.values).toEqual([null, 80])
    expect(labeled('batt')?.max).toBe(100)
    expect(labeled('rx/s')?.values).toEqual([1000, 3000])
    expect(labeled('tx/s')?.values).toEqual([4000, 5000])
    expect(view.series.some((series) => series.label === 'system W')).toBe(false)
    expect(labeled('swap')?.values).toEqual([null, 0])
    expect(labeled('pkg')?.values).toEqual([60, 70])
    expect(labeled('pkg headroom')?.values).toEqual([40, 30])
    expect(labeled('nvme')?.values).toEqual([null, 45])
    expect(view.series.some((series) => series.label === 'nvme headroom')).toBe(false)
    expect(labeled('fan1')?.values).toEqual([null, 0])
    expect(view.notes).toEqual(['thermal  nominal', 'pressure  normal'])

    const frame = compose(screen({ overlay: 'history', historyPage: view, width: 100, height: 48 }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('cpu W')
    expect(frame.text).toContain('thermal  nominal')
    expect(frame.text).toContain('pressure  normal')
    expect(frame.text).toContain('pkg headroom')
    expect(frame.text).not.toContain('nvme headroom')
    expect(frame.text).toContain('q close')
    expect(frame.text).not.toContain('system W')
  })

  test('steady and declining rates stay as recorded and a short page keeps close', () => {
    const view = historyView([
      {
        at: '2026-10-23T00:00:03.000Z',
        cpu_usage_total: 1,
        memory_used: 1,
        load_1: 0,
        network_rx_bytes: 100,
        network_tx_bytes: 50,
      },
      {
        at: '2026-10-23T00:00:02.000Z',
        cpu_usage_total: 1,
        memory_used: 1,
        load_1: 0,
        network_rx_bytes: 3100,
        network_tx_bytes: 50,
      },
      {
        at: '2026-10-23T00:00:01.000Z',
        cpu_usage_total: 1,
        memory_used: 1,
        load_1: 0,
        network_rx_bytes: 1100,
        network_tx_bytes: 50,
      },
    ])
    expect(view.series.find((series) => series.label === 'rx/s')?.values).toEqual([1100, 3100, 100])
    expect(view.series.find((series) => series.label === 'tx/s')?.values).toEqual([50, 50, 50])
    const frame = compose(screen({ overlay: 'history', historyPage: view, width: 80, height: 12 }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toContain('q close')
    expect(frame.text).toContain('↑/↓ scroll')
    const scrolled = reduce({ ...screen({ overlay: 'history', historyPage: view, width: 80, height: 12 }),
      overlayScrollMax: frame.layout.overlayScrollMax }, key('down'), []).state
    expect(scrolled.overlayScroll).toBe(1)
  })

  test('one recorded rate is chartable and zero is still a measurement', () => {
    const view = historyView([
      { at: '2026-10-23T00:00:01Z', cpu_usage_total: 1, memory_used: 1, load_1: 0, network_rx_bytes: 0 },
    ])
    expect(view.series).toEqual([{ label: 'rx/s', values: [0] }])
  })

  test('optional charts preserve interior and trailing gaps in the rendered frame', () => {
    const common = { cpu_usage_total: 1, memory_used: 1, load_1: 0 }
    const view = historyView([
      { ...common, at: '2026-10-23T00:03:00Z' },
      { ...common, at: '2026-10-23T00:02:00Z', cpu_power_watts: 4 },
      { ...common, at: '2026-10-23T00:01:00Z', cpu_power_watts: NaN },
      { ...common, at: '2026-10-23T00:00:00Z', cpu_power_watts: 0 },
    ])
    expect(view.series).toEqual([{ label: 'cpu W', values: [0, null, 4, null] }])
    const frame = compose(screen({ overlay: 'history', historyPage: view }), {
      processes: [],
      system: {},
      history: emptyHistory(),
    })
    expect(frame.text).toMatch(/cpu W +⠤*⠀⠂⣿⠂/)
  })

  test('an empty report uses the same empty window', () => {
    const view = reportView(null)
    expect(view.status).toBe('empty')
    expect(view.message).toBe(EMPTY_WINDOW)
    expect(view.cpu).toEqual([])
    expect(view.summary).toBeNull()
  })

  test('the summary is the sample-weighted average and peak', () => {
    const view = reportView({
      hourly: [
        {
          hour: '2026-10-23T01:00Z',
          samples: 1,
          cpu_avg: 10,
          cpu_peak: 10,
          memory_used_avg: 100,
          memory_used_peak: 100,
          load1_avg: 1,
          load1_peak: 1,
        },
        {
          hour: '2026-10-23T02:00Z',
          samples: 3,
          cpu_avg: 20,
          cpu_peak: 40,
          memory_used_avg: 200,
          memory_used_peak: 500,
          load1_avg: 2,
          load1_peak: 4,
        },
      ],
      top: [],
      anomalies: [],
      leaks: [],
      groups: [],
    })
    expect(view.summary).toEqual({
      cpu_avg: 17.5,
      cpu_peak: 40,
      memory_used_avg: 175,
      memory_used_peak: 500,
      load1_avg: 1.8,
      load1_peak: 4,
      anomaly_count: 0,
    })
    expect(view.cpu).toEqual([10, 20])
  })
})

describe('probe log and settings', () => {
  test('a probe line drops cwd and keeps hostname and array length', () => {
    const view = logView([
      {
        probe: 'proc',
        pid: 9,
        cwd: '/tmp/sloppytop-secret-cwd',
        environ: ['SLOPPY_SECRET=hunter2'],
        command: 'secret-command',
        local: '203.0.113.10:9999',
        remote: '203.0.113.11:1',
        children: [1, 2],
        hostname: 'box',
      },
    ])
    const line = view.lines.join('\n')
    expect(line).not.toContain('/tmp/sloppytop-secret-cwd')
    expect(line).not.toContain('cwd')
    expect(line).not.toContain('hunter2')
    expect(line).not.toContain('secret-command')
    expect(line).not.toContain('203.0.113.10')
    expect(line).toContain('hostname box')
    expect(line).toContain('children 2')
  })

  const inactive = () => ({ scheduler: 'launchd' as const, installed: false, loaded: false, files: [],
    scheduler_state: 'inactive' as const, recorder_state: 'unknown' as const })
  const input = { processes: [], system: {}, history: emptyHistory() }
  const press = (s: ScreenState, name: string) => reduce(s, key(name), []).state
  function settings(health: ReturnType<typeof readService>, overrides: Partial<ScreenState> = {}) {
    const s = press(screen(overrides), 'm')
    return { ...s, settingsPage: { ...s.settingsPage!, recorder: { status: 'ready' as const, health } } }
  }

  test('inspecting a missing or legacy destination does not create or migrate it', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'recorder-settings-'))
    const before = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = tmp
    try {
      const missing = readService(inactive)
      expect(missing.databasePath).toBe(join(tmp, 'sloppytop', 'sloppytop.db'))
      expect(missing.insertError).toBeUndefined()
      expect(existsSync(join(tmp, 'sloppytop'))).toBe(false)
      mkdirSync(join(tmp, 'neohtop'))
      const path = join(tmp, 'neohtop', 'neohtop.db')
      const db = new Database(path)
      db.run("CREATE TABLE system_samples(at TEXT); INSERT INTO system_samples VALUES ('2026-11-18T12:00:00Z')")
      db.close()
      const bytes = readFileSync(path)
      const legacy = readService(() => { throw new Error('scheduler unsupported') })
      expect(legacy.databasePath).toBe(path)
      expect(legacy.last_successful_sample_at).toBe('2026-11-18T12:00:00Z')
      expect(readFileSync(path)).toEqual(bytes)
      const details = compose(press(settings(legacy), 'enter'), input).text
      expect(details).toContain('Recorder: unknown · cadence unknown')
      expect(details).toContain('scheduler unsupported')
      expect(details).toContain('latest insert  2026-11-18T12:00:00Z')
    } finally {
      if (before === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = before
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('a failed history read leaves the scheduler and destination visible', () => {
    const health = readService(inactive, () => { throw new Error('read denied') }, 0, '/fixture/db')
    const details = compose(press(settings(health), 'enter'), input).text
    for (const token of ['Recorder: off · cadence unknown', 'not installed', 'last run  unknown', 'latest insert  unavailable',
      'database error: read denied', 'database  /fixture/db', 'e enable']) expect(details).toContain(token)
  })

  test('compact status, read-only evidence and probe disclosure retain keyboard focus across resize', () => {
    const last = '2026-11-18T04:00:00.000Z'
    const path = '/fixture/long-directory-name-for-wrapped-paths/neohtop/neohtop.db'
    const health = readService(() => ({ ...inactive(), installed: true, loaded: true, scheduler_state: 'armed',
      cadence: '90s', recorder_state: 'idle', last_run: { outcome: 'failed', exit_code: 7 },
    }), () => last, Date.parse(last), path)
    const menu = settings(health, { width: 56, height: 12, selectedPid: 42, probes: { ...defaultProbes(), cpu: false } })
    const overview = compose(menu, input).text
    expect(overview).toContain('Recorder: on · cadence 90s · last run failed')
    expect(overview).toContain('> Recorder details')
    expect(overview).not.toContain('[ ] cpu')
    const opened = reduce(menu, key('space'), [])
    expect(opened.effect).toBeUndefined()
    expect(reduce(opened.state, key('space'), []).effect).toBeUndefined()
    expect(reduce(opened.state, key('m'), []).effect).toBeUndefined()
    let detail = opened.state
    let frame = compose(detail, input)
    expect(frame.text).toContain('last run  failed (exit 7)')
    expect(frame.text).toContain('latest insert  ' + last)
    expect(frame.text).toContain('sample age  0 s (any insert)')
    for (let i = 0; i < (frame.layout.overlayScrollMax ?? 0); i++) {
      detail = press({ ...detail, overlayScrollMax: frame.layout.overlayScrollMax }, 'down')
    }
    frame = compose(detail, input)
    expect(frame.text).toContain('neohtop.db')
    expect(frame.text).toContain('required probes off: cpu')
    const probes = press(press(press(detail, 'esc'), 'down'), 'return')
    expect(compose(probes, input).text).toContain('> [ ] cpu (required for recording)')
    let selected = probes
    for (let i = 0; i < 6; i++) selected = press(selected, 'down')
    for (const [width, height] of [[36, 7], [112, 30]] as const) {
      selected = { ...selected, width, height }
      expect(compose(selected, input).text).toContain('> [x] power (optional')
    }
    const back = press(selected, 'esc')
    expect(compose(back, input).text).toContain('> Global probe switches')
    expect(compose(press(back, 'enter'), input).text).toContain('> [x] power')
    expect(press(back, 'q').selectedPid).toBe(42)
    expect(press(back, 'q').overlay).toBe('none')
  })

  test('recorder actions require explicit confirmation; invalid drafts and cancel never dispatch', () => {
    const off = press(settings(readService(inactive, () => undefined)), 'enter')
    const enable = press(off, 'e')
    expect(compose(enable, input).text).toContain('minimum 60): 3600')
    const review = reduce(enable, key('enter'), [])
    expect(review.effect).toBeUndefined()
    expect(compose(review.state, input).text).toContain('Store one sample now, then schedule every 3600s.')
    for (const cancel of ['esc', 'n', 'q']) {
      const result = reduce(review.state, key(cancel), [])
      expect(result.effect).toBeUndefined()
      expect(reduce(result.state, key('y'), []).effect).toBeUndefined()
    }
    const applied = reduce(review.state, key('y'), [])
    expect(applied.effect).toEqual({ changeRecorder: { kind: 'enable', seconds: 3600 } })
    for (const duplicate of ['y', 'enter', 'esc', 'q']) expect(reduce(applied.state, key(duplicate), [])).toEqual({ state: applied.state })
    const armed = readService(() => ({ ...inactive(), installed: true, loaded: true, scheduler_state: 'armed' }), () => undefined)
    const on = press(settings(armed), 'enter')
    const editor = press(on, 'c')
    for (const invalid of ['', '59', '-60', '60.5', '600s', '9007199254740992']) {
      const result = reduce([...invalid].reduce(press, editor), key('return'), [])
      expect(result.effect).toBeUndefined()
      expect(compose(result.state, input).text).toContain('Enter whole seconds')
      expect(press(result.state, 'esc').settingsPage?.recorderEdit).toBeUndefined()
    }
    const resumed = { ...press(editor, '6'), width: 36, height: 9 }
    const confirm = press(press(resumed, '0'), 'return')
    expect(reduce(confirm, key('y'), []).effect).toEqual({ changeRecorder: { kind: 'cadence', seconds: 60 } })
    const blocked = press(settings(armed, { probes: { ...defaultProbes(), network: false } }), 'enter')
    expect(compose(press(blocked, 'c'), input).text).toContain('Cannot record: required probes off: network')
    expect(reduce(press(blocked, 'd'), key('y'), []).effect).toEqual({ changeRecorder: { kind: 'disable' } })
    const unsupported = press(settings(readService(() => { throw Error('unsupported platform') }, () => undefined)), 'enter')
    for (const shortcut of ['e', 'd', 'c', 'y']) expect(reduce(unsupported, key(shortcut), [])).toEqual({ state: unsupported })
  })

  test('store keys open pages, and q on a page does not quit', () => {
    const help = compose(screen({ overlay: 'help' }), { processes: [], system: {}, history: emptyHistory() })
    expect(help.text).toContain('a  record')
    expect(help.text).toContain('v  history')
    expect(help.text).toContain('m  settings')

    const recorded = reduce(screen(), key('a'), [])
    expect(recorded.state.overlay).toBe('record')
    expect(recorded.state.recordPage?.message).toBe('recording…')
    expect(recorded.effect?.record).toBe(true)
    expect(wantsQuit(recorded.state, key('q'))).toBe(false)
    expect(reduce(recorded.state, key('q'), []).state.overlay).toBe('none')

    const history = reduce(screen(), key('v'), [])
    expect(history.state.overlay).toBe('history')
    expect(history.state.historyPage?.status).toBe('loading')
    expect(history.effect?.openHistory).toBe(true)

    const settings = reduce(screen(), key('m'), [])
    expect(settings.effect?.openSettings).toBe(true)
    const toggled = reduce(press(press(settings.state, 'down'), 'enter'), key('space'), [])
    expect(toggled.state.paused).toBe(false)
    expect(toggled.state.settingsPage?.probes.cpu).toBe(false)
    expect(toggled.effect?.toggleProbe).toEqual({ name: 'cpu', enabled: false })
    const listener = reduce(settings.state, key('m'), [])
    expect(listener.effect?.toggleMetrics).toBe(true)
    expect(listener.state.settingsPage?.metricsMessage).toBe('starting…')
    expect(listener.state.paused).toBe(false)
  })
})

describe('metrics listener', () => {
  test('a thrown bind is a message', () => {
    const bound = bindMetricsListener(
      { host: '127.0.0.1', port: 9, sample: async () => ({}) },
      () => {
        throw new Error('address in use')
      },
    )
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.message).toContain('address in use')
  })

  test('a temp config serves OpenMetrics and leaves the real config untouched', async () => {
    const real = [
      join(homedir(), '.config', 'sloppytop', 'config.json'),
      join(homedir(), '.config', 'neohtop', 'config.json'),
    ]
    const before = real.map(mtime)
    const temp = mkdtempSync(join(tmpdir(), 'sloppytop-metrics-'))
    const script = fileURLToPath(new URL('./metrics-listen-check.ts', import.meta.url))
    const cwd = fileURLToPath(new URL('../..', import.meta.url))
    const child = spawn(process.execPath, [script], {
      cwd,
      env: { ...process.env, XDG_CONFIG_HOME: temp },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status) => resolve(status ?? 1))
    })
    try {
      if (code !== 0) throw new Error(`metrics check ${code}\n${stderr}\n${stdout}`)
      const payload = JSON.parse(stdout.trim()) as { config: string; status: number; type: string; body: string; other: number }
      expect(payload.config.startsWith(temp)).toBe(true)
      expect(payload.status).toBe(200)
      expect(payload.type).toBe('application/openmetrics-text; version=1.0.0; charset=utf-8')
      expect(payload.body).toContain('# EOF')
      expect(payload.body).toContain('sloppytop_cpu_usage_percent')
      expect(payload.other).toBe(404)
      expect(real.map(mtime)).toEqual(before)
    } finally {
      if (child.exitCode === null) child.kill()
      rmSync(temp, { recursive: true, force: true })
    }
  }, 15_000)
})
