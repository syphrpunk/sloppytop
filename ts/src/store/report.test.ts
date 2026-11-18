import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { insertSample, openDb } from './db.ts'
import {
  compareReportWindows, reportAnomalies, reportGroups, reportHourly, reportLeaks,
  reportTopConsumers, reportWindow, reportWorkloadHistory,
} from './report.ts'
import { LEAK_DEFAULTS } from './footprint.ts'
import { diagnosticReport } from './diagnostics.ts'

const baseSystem: SystemStats = {
  cpu_brand: 'test',
  cpu_usage_per_core: [10, 10, 10, 10],
  cpu_usage_total: 30,
  core_count: 4,
  memory_total: 16_000,
  memory_used: 8_000,
  memory_free: 8_000,
  uptime_secs: 100,
  load_avg: [1, 1, 1],
  network_rx_bytes: 0,
  network_tx_bytes: 0,
  disk_total_bytes: 100,
  disk_used_bytes: 50,
  disk_free_bytes: 50,
  hostname: 'test',
  os_version: 'test',
  kernel_version: 'test',
  process_count: 10,
}

const proc = (name: string, cpu: number, mem = 100): ProcessInfo => ({
  pid: 1,
  ppid: 0,
  name,
  cpu_usage: cpu,
  memory_bytes: mem,
  status: 'Running',
  user: 'dk',
  command: name,
  runtime_secs: 10,
  disk_read_bytes: 0,
  disk_write_bytes: 0,
})

const record = (
  db: Database,
  at: string,
  overrides: Partial<SystemStats> = {},
  procs: ProcessInfo[] = [],
  boot?: string,
) =>
  insertSample(db, at, { ...baseSystem, ...overrides }, procs, {
    processLimit: 30,
    retentionDays: 365,
  }, boot)

describe('report', () => {
  let db: Database
  beforeEach(() => {
    db = openDb(':memory:')
  })
  afterEach(() => db.close())

  test('reportWindow is null with no samples in range', () => {
    expect(reportWindow(db, '2026-01-01T00:00:00Z')).toBeNull()
  })

  test('diagnostic JSON contains findings without leaking local identifiers', () => {
    const since = '2026-08-17T00:00:00.000Z'
    const at = '2026-08-17T01:00:00.000Z'
    record(db, at, {
      hostname: 'private-host-sentinel',
      cpu_usage_total: 99,
      network_interfaces: [{ name: 'private-interface-sentinel', rx_bytes_per_s: 7 }],
    }, [{ ...proc('private-process-sentinel', 30), command: 'private-command-sentinel' }], 'private-boot-sentinel')
    const artifact = diagnosticReport(db, since, {
      scheduler: 'launchd', installed: true, loaded: true, files: ['/private/path-sentinel'],
      recorder_state: 'idle', scheduler_state: 'armed', last_run: { outcome: 'failed', exit_code: 7 },
    })
    const json = JSON.stringify(artifact)
    for (const value of ['private-', '/private/', 'command', 'environment', 'network_interfaces']) {
      expect(json).not.toContain(value)
    }
    expect(artifact).toMatchObject({
      redacted: true, coverage: { from: since, samples: 1 },
      recorder: { last_successful_sample_at: at, last_run: { outcome: 'failed', exit_code: 7 } },
      findings: { anomalies: { cpu_saturation: 1 }, rss_growth_flags: 0 },
    })
  })

  test('compares half-open windows, labels coverage and does not invent empty-window deltas', () => {
    const now = Date.parse('2026-08-17T12:30:00.000Z')
    const at = (hour: number, minute = 30) => new Date(Date.UTC(2026, 7, 17, hour, minute)).toISOString()
    expect(compareReportWindows(db, 2, now)).toMatchObject({ coverage: 'insufficient' })
    expect(compareReportWindows(db, 2, now).sampled_delta).toBeUndefined()
    record(db, at(8), { cpu_usage_total: 20 })
    record(db, at(9), { cpu_usage_total: 20 })
    record(db, at(9), { cpu_usage_total: 20 })
    record(db, at(10), { cpu_usage_total: 0 })
    record(db, at(11), { cpu_usage_total: 0 })
    record(db, at(12), { cpu_usage_total: 99 })
    record(db, at(12, 31), { cpu_usage_total: 99 })
    expect(compareReportWindows(db, 2, now)).toMatchObject({
      coverage: 'unequal', previous: { samples: 3, observed_slots: 2 },
      current: { samples: 2, observed_slots: 2, hourly_slots: 2 },
      sampled_delta: { cpu_avg_percentage_points: -20, memory_used_avg_bytes: 0, load1_avg: 0 },
    })
    db.run('DELETE FROM system_samples WHERE id = (SELECT MAX(id) FROM system_samples WHERE at = ?)', [at(9)])
    expect(compareReportWindows(db, 2, now).coverage).toBe('comparable')
    expect(compareReportWindows(db, 3, now).coverage).toBe('unequal')
    db.run('DELETE FROM system_samples WHERE at IN (?, ?)', [at(8), at(10)])
    expect(compareReportWindows(db, 2, now).coverage).toBe('equally_sparse')
  })

  test('reports only increases with an adjacent confirmed same-boot baseline', () => {
    const at = (n: number) => `2026-08-17T00:${String(n).padStart(2, '0')}:00.000Z`
    const counts = [5, 5, 7, undefined, 20, 25, 0, 1, 4, 6, 7]
    const boots = ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', undefined, 'b', 'b']
    counts.forEach((count, i) => record(db, at(i), count === undefined ? {} : { linux_oom_kills: count }, [], boots[i]))
    const kills = (since: string) => reportAnomalies(db, since)
      .filter((entry) => entry.type === 'kernel_oom_kill')
      .map(({ at, detail }) => [at, detail])
    expect(kills(at(0))).toEqual([
      [at(2), '2 Linux kernel OOM kills since the previous sample'],
      [at(7), '1 Linux kernel OOM kill since the previous sample'],
      [at(10), '1 Linux kernel OOM kill since the previous sample'],
    ])
    expect(kills(at(10))).toEqual([])
    expect(reportAnomalies(db, at(0))[0]).toMatchObject({
      type: 'kernel_oom_kill', previous_sample_at: at(1),
      evidence: [{ metric: 'linux_oom_kills', observed: 7, operator: '>', threshold: 5 }],
    })
    expect(reportAnomalies(db, at(0)).some((entry) => entry.type === 'memory_pressure')).toBe(false)
  })

  test('hourly buckets aggregate avg and peak per hour', () => {
    record(db, '2026-08-17T10:05:00.000Z', { cpu_usage_total: 20 })
    record(db, '2026-08-17T10:35:00.000Z', { cpu_usage_total: 40 })
    record(db, '2026-08-17T11:05:00.000Z', { cpu_usage_total: 60 })
    const hourly = reportHourly(db, '2026-08-17T00:00:00Z')
    expect(hourly).toHaveLength(2)
    expect(hourly[0]).toMatchObject({
      hour: '2026-08-17T10:00Z',
      samples: 2,
      cpu_avg: 30,
      cpu_peak: 40,
    })
    expect(hourly[1]).toMatchObject({ hour: '2026-08-17T11:00Z', samples: 1, cpu_avg: 60 })
  })

  test('top consumers rank by avg cpu weighted by appearances', () => {
    record(db, '2026-08-17T10:00:00.000Z', {}, [proc('chrome', 60), proc('idle-thing', 90)])
    record(db, '2026-08-17T11:00:00.000Z', {}, [proc('chrome', 40)])
    const top = reportTopConsumers(db, '2026-08-17T00:00:00Z', 10)
    // chrome: avg 50 × 2 appearances = 100 > idle-thing: 90 × 1
    expect(top[0]).toMatchObject({ name: 'chrome', appearances: 2, cpu_avg: 50, cpu_max: 60 })
    expect(top[1]).toMatchObject({ name: 'idle-thing', appearances: 1 })
  })

  test('io_pressure flags high load at moderate CPU', () => {
    // 4 cores, load 12, cpu 45% — the 2026-08-17 shape
    record(db, '2026-08-17T03:16:00.000Z', { load_avg: [12, 5, 3], cpu_usage_total: 45 })
    record(db, '2026-08-17T04:00:00.000Z') // healthy
    const anomalies = reportAnomalies(db, '2026-08-17T00:00:00Z')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({
      type: 'io_pressure', load_1: 12, evidence: [
        { metric: 'load_1', observed: 12, operator: '>', threshold: 8 },
        { metric: 'cpu_usage_total', observed: 45, operator: '<', threshold: 60 },
      ],
    })
  })

  test('cpu_saturation and memory_pressure flag independently', () => {
    record(db, '2026-08-17T05:00:00.000Z', {
      cpu_usage_total: 95,
      memory_used: 15_000,
      memory_free: 1_000,
    })
    expect(reportAnomalies(db, '2026-08-17T00:00:00Z')).toMatchObject([
      { type: 'cpu_saturation', evidence: [{ observed: 95, operator: '>', threshold: 90 }] },
      { type: 'memory_pressure', evidence: [{ observed: 93.75, operator: '>', threshold: 92 }] },
    ])
  })

  test('a normal macOS pressure level replaces the 92% guess', () => {
    record(db, '2026-08-17T06:00:00.000Z', {
      memory_used: 15_500,
      memory_pressure_level: 'normal',
    })
    expect(reportAnomalies(db, '2026-08-17T00:00:00Z')).toHaveLength(0)
  })

  test('warning and critical levels flag even when usage looks fine', () => {
    record(db, '2026-08-17T06:00:00.000Z', { memory_pressure_level: 'warning' })
    record(db, '2026-08-17T07:00:00.000Z', { memory_pressure_level: 'critical' })
    const rows = reportAnomalies(db, '2026-08-17T00:00:00Z')
    expect(rows.map((a) => a.detail)).toEqual(['memory pressure warning', 'memory pressure critical'])
    expect(rows.map((a) => a.evidence[0])).toMatchObject([
      { observed: 'warning', operator: 'in', threshold: ['warning', 'critical'] },
      { observed: 'critical', operator: 'in', threshold: ['warning', 'critical'] },
    ])
  })

  test('PSI replaces the load proxy and the memory-percent guess', () => {
    record(db, '2026-08-17T06:00:00.000Z', {
      load_avg: [12, 5, 3],
      cpu_usage_total: 45,
      psi_io_some_avg10: 0,
      psi_memory_some_avg10: 0,
      memory_used: 15_500,
    })
    record(db, '2026-08-17T07:00:00.000Z', {
      load_avg: [0.2, 0.2, 0.2],
      cpu_usage_total: 10,
      psi_io_some_avg10: 22.5,
      psi_memory_some_avg10: 11,
      memory_used: 4_000,
    })
    const anomalies = reportAnomalies(db, '2026-08-17T00:00:00Z')
    expect(anomalies.map((a) => a.type)).toEqual(['io_pressure', 'memory_pressure'])
    expect(anomalies[0]!.detail).toBe('I/O stall some avg10 22.5%')
    expect(anomalies[1]!.detail).toBe('memory stall some avg10 11%')
    expect(anomalies.map((a) => a.evidence[0])).toMatchObject([
      { metric: 'psi_io_some_avg10', observed: 22.5, operator: '>=', threshold: 10 },
      { metric: 'psi_memory_some_avg10', observed: 11, operator: '>=', threshold: 10 },
    ])
  })

  test('reportLeaks flags a named RSS climb and ignores a flat name', () => {
    const step = LEAK_DEFAULTS.minimumSlope * 3600
    for (let i = 0; i < 12; i++) {
      const at = new Date(Date.UTC(2026, 7, 17, i, 0, 0)).toISOString()
      record(db, at, {}, [
        proc('climber', 1, 100 * 1024 * 1024 + i * step),
        proc('flat', 1, 50 * 1024 * 1024),
      ])
    }
    const leaks = reportLeaks(db, '2026-08-16T00:00:00.000Z')
    expect(leaks.map((leak) => leak.name)).toEqual(['climber'])
    expect(leaks[0]).toMatchObject({ metric: 'rss', samples: 12 })
    expect(leaks[0]!.slope_bytes_per_s).toBeCloseTo(LEAK_DEFAULTS.minimumSlope, 0)
    expect(leaks[0]!.evidence).toMatchObject({
      from: '2026-08-17T00:00:00.000Z', to: '2026-08-17T11:00:00.000Z',
      first_rss_bytes: 100 * 1024 * 1024, last_rss_bytes: 100 * 1024 * 1024 + 11 * step,
      thresholds: LEAK_DEFAULTS,
    })
    expect(leaks[0]!.evidence.recent_slope_bytes_per_s).toBeCloseTo(LEAK_DEFAULTS.minimumSlope)
  })

  test('reportGroups scores matching names against the machine', () => {
    record(db, '2026-08-17T00:00:00.000Z', {}, [
      proc('chrome', 100, 8_000),
      proc('other', 100, 8_000),
    ])
    const groups = reportGroups(db, '2026-08-16T00:00:00.000Z', [
      { name: 'browsers', patterns: ['chrome'] },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('browsers')
    expect(groups[0]!.metric).toBe('rss')
    expect(groups[0]!.members.map((member) => member.name)).toEqual(['chrome'])
    // 4 cores, 16000 byte RAM, 100% of one core, half of RAM
    // cpu share 0.25, memory share 0.5 → score 37.5
    expect(groups[0]!.score).toBe(37.5)
    expect(groups[0]!.members[0]!.share).toBe(1)
  })

  test('workload history aggregates recorded rows and marks truncated and entirely missing process lists', () => {
    const start = '2026-08-16T00:00:00.000Z'
    const secret = 'private-command-sentinel'
    const group = { name: 'builds', patterns: ['worker', secret] }
    record(db, '2026-08-17T00:00:00.000Z', { process_count: 2 }, [
      proc('worker', 40, 10), { ...proc('child', 30, 20), pid: 2, command: secret },
    ])
    record(db, '2026-08-17T01:00:00.000Z', { process_count: 31 }, Array.from({ length: 31 }, (_, i) => ({
      ...proc(i === 30 ? 'worker' : 'other', i === 30 ? 0 : 1), pid: i + 1,
    })))
    record(db, '2026-08-17T02:00:00.000Z', { process_count: 1 })
    const rows = reportWorkloadHistory(db, start, [group])
    expect(rows).toMatchObject([
      { coverage: 'complete', stored_processes: 2, groups: [{ name: 'builds', cpu_pct: 70, rss_bytes: 30, matched_processes: 2 }] },
      { coverage: 'incomplete', stored_processes: 30, sampled_processes: 31, groups: [{ cpu_pct: 0, rss_bytes: 0, matched_processes: 0 }] },
      { coverage: 'incomplete', stored_processes: 0, sampled_processes: 1 },
    ])
    expect(JSON.stringify(rows)).not.toContain(secret)
    expect(reportWorkloadHistory(db, start, [])).toEqual([])
  })
})
