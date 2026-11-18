// Aggregate reporting over the metrics store — replaces the ad-hoc sqlite3
// queries used during analysis sessions. Pure SQL + small TS post-passes;
// all shapes stay snake_case like the rest of the CLI output.

import type { Database } from 'bun:sqlite'
import { availableParallelism } from 'node:os'
import { compileFilter } from '../filter/index.ts'
import type { ProcessGroup } from './config.ts'
import { parseInterfaceRates } from './db.ts'
import { detectLeak, LEAK_DEFAULTS, scoreGroup, type SeriesPoint } from './footprint.ts'

export interface ReportWindow {
  hours: number
  from: string
  to: string
  samples: number
}

export interface HourlyRow {
  hour: string
  samples: number
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
  process_count_avg: number
}

export interface TopConsumer {
  name: string
  appearances: number
  cpu_avg: number
  cpu_max: number
  memory_avg_bytes: number
  memory_max_bytes: number
  users: string
}

export interface LeakFlag {
  name: string
  /** The store records RSS, not a physical footprint. */
  metric: 'rss'
  slope_bytes_per_s: number
  r_squared: number
  duration_secs: number
  total_growth_bytes: number
  samples: number
  evidence: {
    from: string
    to: string
    first_rss_bytes: number
    last_rss_bytes: number
    recent_slope_bytes_per_s: number
    thresholds: typeof LEAK_DEFAULTS
  }
}

export interface GroupMemberReport {
  name: string
  cpu_avg: number
  memory_avg_bytes: number
  score: number
  share: number
}

export interface GroupReport {
  name: string
  metric: 'rss'
  score: number
  members: GroupMemberReport[]
}

export interface Anomaly {
  at: string
  type: 'io_pressure' | 'cpu_saturation' | 'memory_pressure' | 'kernel_oom_kill'
  detail: string
  cpu_usage_total: number
  load_1: number
  memory_used_pct: number
  evidence: {
    metric: string
    observed: number | string
    operator: '<' | '>' | '>=' | 'in'
    threshold: number | readonly string[]
  }[]
  previous_sample_at?: string
}

interface SampleRow {
  at: string
  cpu_usage_total: number
  cpu_usage_per_core: string
  memory_used: number
  memory_total: number
  load_1: number
  psi_io_some_avg10: number | null
  psi_memory_some_avg10: number | null
  memory_pressure_level: string | null
  linux_oom_kills: number | null
  linux_boot_id: string | null
}

/**
 * PSI `some` avg10 is the percent of the last 10 seconds in which at least
 * one task was stalled. 10% is the anomaly line; below that we stay quiet.
 */
const PSI_SOME_AVG10_ANOMALY = 10
const IO_PROXY_LOAD_PER_CORE = 2
const IO_PROXY_CPU_CEILING = 60
const CPU_SATURATION = 90
const MEMORY_USED_THRESHOLD = 92
const MEMORY_PRESSURE_LEVELS = ['warning', 'critical']

const round1 = (n: number) => Math.round(n * 10) / 10

/** Equal adjacent windows; coverage counts occupied elapsed-hour slots, not promised recorder runs. */
export function compareReportWindows(db: Database, hours: number, now = Date.now()) {
  const span = Math.round(hours * 3_600_000)
  const slots = Math.ceil(span / 3_600_000)
  function summarize(start: number, end: number) {
    const from = new Date(start).toISOString()
    const to = new Date(end).toISOString()
    const row = db.query(`
      SELECT COUNT(*) AS samples,
             COUNT(DISTINCT CAST((unixepoch(at, 'subsec') * 1000 - ?) / 3600000 AS INTEGER)) AS observed_slots,
             MIN(at) AS first_sample_at, MAX(at) AS last_sample_at,
             AVG(cpu_usage_total) AS cpu_avg_pct,
             AVG(memory_used) AS memory_used_avg_bytes,
             AVG(load_1) AS load1_avg
      FROM system_samples WHERE at >= ? AND at < ?
    `).get(start, from, to) as {
      samples: number; observed_slots: number; first_sample_at: string | null; last_sample_at: string | null
      cpu_avg_pct: number | null; memory_used_avg_bytes: number | null; load1_avg: number | null
    }
    return { from, to_exclusive: to, hourly_slots: slots, ...row }
  }
  const current = summarize(now - span, now)
  const previous = summarize(now - 2 * span, now - span)
  const coverage = !current.samples || !previous.samples ? 'insufficient'
    : current.samples !== previous.samples || current.observed_slots !== previous.observed_slots ? 'unequal'
    : current.observed_slots < slots ? 'equally_sparse' : 'comparable'
  const delta = current.cpu_avg_pct != null && previous.cpu_avg_pct != null &&
    current.memory_used_avg_bytes != null && previous.memory_used_avg_bytes != null &&
    current.load1_avg != null && previous.load1_avg != null
    ? {
        cpu_avg_percentage_points: round1(current.cpu_avg_pct - previous.cpu_avg_pct),
        memory_used_avg_bytes: Math.round(current.memory_used_avg_bytes - previous.memory_used_avg_bytes),
        load1_avg: round1(current.load1_avg - previous.load1_avg),
      }
    : undefined
  return {
    current, previous, coverage,
    ...(delta ? { sampled_delta: delta } : {}),
    ...(coverage !== 'comparable'
      ? { warning: 'Coverage is incomplete or unequal; sampled differences do not establish improvement or deterioration.' }
      : {}),
  }
}

export function reportWindow(db: Database, sinceIso: string): ReportWindow | null {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM system_samples WHERE at >= ?',
    )
    .get(sinceIso) as { n: number; first: string | null; last: string | null }
  if (row.n === 0 || !row.first || !row.last) return null
  return { hours: 0, from: row.first, to: row.last, samples: row.n }
}

/** Keep observations separate: a reused interface name is not a durable identity. */
export function reportInterfaceHistory(db: Database, sinceIso: string) {
  const rows = db.query(`
    SELECT id, at, network_interfaces FROM system_samples WHERE at >= ? ORDER BY at, id
  `).iterate(sinceIso) as Iterable<{ id: number; at: string; network_interfaces: string | null }>
  return Array.from(rows, ({ id, at, network_interfaces }) => {
    const interfaces = parseInterfaceRates(network_interfaces)
    return { sample_id: id, at, ...(interfaces ? { interfaces } : {}) }
  })
}

export function reportHourly(db: Database, sinceIso: string): HourlyRow[] {
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00Z', at) AS hour,
              COUNT(*) AS samples,
              AVG(cpu_usage_total) AS cpu_avg,
              MAX(cpu_usage_total) AS cpu_peak,
              AVG(memory_used) AS memory_used_avg,
              MAX(memory_used) AS memory_used_peak,
              AVG(load_1) AS load1_avg,
              MAX(load_1) AS load1_peak,
              AVG(process_count) AS process_count_avg
       FROM system_samples WHERE at >= ?
       GROUP BY hour ORDER BY hour`,
    )
    .all(sinceIso) as HourlyRow[]
  return rows.map((r) => ({
    ...r,
    cpu_avg: round1(r.cpu_avg),
    cpu_peak: round1(r.cpu_peak),
    memory_used_avg: Math.round(r.memory_used_avg),
    load1_avg: round1(r.load1_avg),
    load1_peak: round1(r.load1_peak),
    process_count_avg: Math.round(r.process_count_avg),
  }))
}

export function reportTopConsumers(db: Database, sinceIso: string, limit: number): TopConsumer[] {
  const rows = db
    .prepare(
      `SELECT p.name,
              COUNT(*) AS appearances,
              AVG(p.cpu_usage) AS cpu_avg,
              MAX(p.cpu_usage) AS cpu_max,
              AVG(p.memory_bytes) AS memory_avg_bytes,
              MAX(p.memory_bytes) AS memory_max_bytes,
              GROUP_CONCAT(DISTINCT p.user) AS users
       FROM process_samples p
       JOIN system_samples s ON s.id = p.sample_id
       WHERE s.at >= ?
       GROUP BY p.name
       ORDER BY AVG(p.cpu_usage) * COUNT(*) DESC
       LIMIT ?`,
    )
    .all(sinceIso, limit) as TopConsumer[]
  return rows.map((r) => ({
    ...r,
    cpu_avg: round1(r.cpu_avg),
    cpu_max: round1(r.cpu_max),
    memory_avg_bytes: Math.round(r.memory_avg_bytes),
  }))
}

/**
 * Flag samples that look unhealthy:
 * - io_pressure: Linux PSI io `some` avg10 when that reading exists;
 *   otherwise load1 far above core count while CPU is only moderate
 *   (the 2026-08-17 43.2 spike)
 * - cpu_saturation: total CPU above 90%. CPU PSI is stored but not flagged;
 *   saturation and stall are different questions.
 * - memory_pressure: macOS pressure level when present (warning or critical),
 *   else Linux PSI memory `some` avg10, else memory used above 92%
 */
interface NameSample {
  name: string
  at: string
  memory_bytes: number
}

/** Names whose RSS climbed in a straight line across the window. */
export function reportLeaks(db: Database, sinceIso: string): LeakFlag[] {
  const rows = db
    .prepare(
      `SELECT p.name, s.at, SUM(p.memory_bytes) AS memory_bytes
       FROM process_samples p
       JOIN system_samples s ON s.id = p.sample_id
       WHERE s.at >= ?
       GROUP BY p.name, s.id
       ORDER BY p.name, s.at`,
    )
    .all(sinceIso) as NameSample[]

  const byName = new Map<string, SeriesPoint[]>()
  for (const row of rows) {
    const series = byName.get(row.name) ?? []
    series.push({ at: Date.parse(row.at), bytes: row.memory_bytes })
    byName.set(row.name, series)
  }

  const leaks: LeakFlag[] = []
  for (const [name, series] of byName) {
    const found = detectLeak(series)
    if (!found) continue
    leaks.push({
      name,
      metric: 'rss',
      slope_bytes_per_s: Math.round(found.slopeBytesPerSecond),
      r_squared: Math.round(found.rSquared * 1000) / 1000,
      duration_secs: Math.round(found.durationSecs),
      total_growth_bytes: found.totalGrowthBytes,
      samples: found.samples,
      evidence: {
        from: new Date(found.first.at).toISOString(),
        to: new Date(found.last.at).toISOString(),
        first_rss_bytes: found.first.bytes,
        last_rss_bytes: found.last.bytes,
        recent_slope_bytes_per_s: found.recentSlopeBytesPerSecond,
        thresholds: LEAK_DEFAULTS,
      },
    })
  }
  leaks.sort((a, b) => b.slope_bytes_per_s - a.slope_bytes_per_s || a.name.localeCompare(b.name))
  return leaks
}

interface GroupRow {
  name: string
  command: string
  sample_id: number
  memory_total: number
  cpu_usage_per_core: string
  cpu_usage: number
  memory_bytes: number
}

function groupMatches(group: ProcessGroup) {
  const matchers = group.patterns.map((pattern) => compileFilter(pattern))
  return (name: string, command: string) => matchers.some((re) => re.test(name) || re.test(command))
}

/** Per-sample reports over stored rows only. A zero in a partial sample is not proof of absence. */
export function reportWorkloadHistory(db: Database, sinceIso: string, groups: ProcessGroup[]) {
  if (!groups.length) return []
  const samples = db.query(`
    SELECT s.id, s.at, s.process_count, p.name, p.command, p.cpu_usage, p.memory_bytes
    FROM system_samples s LEFT JOIN process_samples p ON p.sample_id = s.id
    WHERE s.at >= ? ORDER BY s.at, s.id
  `).iterate(sinceIso) as Iterable<{
    id: number; at: string; process_count: number; name: string | null; command: string
    cpu_usage: number; memory_bytes: number
  }>
  const matchers = groups.map(groupMatches)
  const output: {
    sample_id: number; at: string; stored_processes: number; sampled_processes: number
    coverage: 'complete' | 'incomplete'
    groups: { name: string; cpu_pct: number; rss_bytes: number; matched_processes: number }[]
  }[] = []
  for (const row of samples) {
    let entry = output.at(-1)
    if (entry?.sample_id !== row.id) {
      entry = {
        sample_id: row.id, at: row.at, stored_processes: 0, sampled_processes: row.process_count,
        coverage: row.process_count === 0 ? 'complete' : 'incomplete',
        groups: groups.map(({ name }) => ({ name, cpu_pct: 0, rss_bytes: 0, matched_processes: 0 })),
      }
      output.push(entry)
    }
    if (row.name == null) continue
    entry.stored_processes++
    entry.coverage = entry.stored_processes === entry.sampled_processes ? 'complete' : 'incomplete'
    for (const [i, matches] of matchers.entries()) {
      if (!matches(row.name, row.command)) continue
      const total = entry.groups[i]!
      total.cpu_pct += row.cpu_usage
      total.rss_bytes += row.memory_bytes
      total.matched_processes++
    }
  }
  return output
}

/** Latest-sample device size, and average CPU/RSS of names matching each configured group. */
export function reportGroups(db: Database, sinceIso: string, groups: ProcessGroup[]): GroupReport[] {
  if (groups.length === 0) return []
  const rows = db
    .prepare(
      `SELECT p.name, p.command, s.id AS sample_id, s.memory_total, s.cpu_usage_per_core,
              p.cpu_usage, p.memory_bytes
       FROM process_samples p
       JOIN system_samples s ON s.id = p.sample_id
       WHERE s.at >= ?
       ORDER BY s.at`,
    )
    .all(sinceIso) as GroupRow[]
  if (rows.length === 0) return []

  const latest = rows[rows.length - 1]!
  let cores = 0
  try {
    cores = (JSON.parse(latest.cpu_usage_per_core) as unknown[]).length
  } catch {
    cores = 0
  }
  const device = { cores, totalBytes: latest.memory_total }

  return groups.map((group) => {
    const matches = groupMatches(group)
    const totals = new Map<string, { cpu: number; memory: number; samples: Set<number> }>()
    for (const row of rows) {
      if (!matches(row.name, row.command)) continue
      const acc = totals.get(row.name) ?? { cpu: 0, memory: 0, samples: new Set<number>() }
      acc.cpu += row.cpu_usage
      acc.memory += row.memory_bytes
      acc.samples.add(row.sample_id)
      totals.set(row.name, acc)
    }
    const members = [...totals.entries()].map(([name, acc]) => ({
      name,
      cpuPercent: acc.cpu / acc.samples.size,
      memoryBytes: acc.memory / acc.samples.size,
    }))
    const scored = scoreGroup(members, device)
    return {
      name: group.name,
      metric: 'rss' as const,
      score: Math.round(scored.score * 10) / 10,
      members: scored.members.map((member) => ({
        name: member.name,
        cpu_avg: Math.round(member.cpuPercent * 10) / 10,
        memory_avg_bytes: Math.round(member.memoryBytes),
        score: Math.round(member.score * 10) / 10,
        share: Math.round(member.share * 1000) / 1000,
      })),
    }
  })
}

export function reportAnomalies(db: Database, sinceIso: string): Anomaly[] {
  const rows = db
    .prepare(
      `SELECT at, cpu_usage_total, cpu_usage_per_core, memory_used, memory_total, load_1,
              psi_io_some_avg10, psi_memory_some_avg10, memory_pressure_level,
              linux_oom_kills, linux_boot_id
       FROM system_samples WHERE at >= ? ORDER BY at, id`,
    )
    .all(sinceIso) as SampleRow[]

  const anomalies: Anomaly[] = []
  for (const [i, r] of rows.entries()) {
    let cores = 0
    try {
      cores = (JSON.parse(r.cpu_usage_per_core) as unknown[]).length
    } catch {
      // fall through to host fallback
    }
    if (cores === 0) cores = availableParallelism()
    const memPct = r.memory_total > 0 ? (r.memory_used / r.memory_total) * 100 : 0
    const base = {
      at: r.at,
      cpu_usage_total: round1(r.cpu_usage_total),
      load_1: round1(r.load_1),
      memory_used_pct: round1(memPct),
    }
    // Use adjacent observations within the window; never bridge a missing reading or a reboot.
    const previous = rows[i - 1]
    if (
      previous && previous.at < r.at && r.linux_boot_id &&
      r.linux_boot_id === previous.linux_boot_id &&
      r.linux_oom_kills != null && previous.linux_oom_kills != null &&
      r.linux_oom_kills > previous.linux_oom_kills
    ) {
      const count = r.linux_oom_kills - previous.linux_oom_kills
      anomalies.push({
        ...base,
        type: 'kernel_oom_kill',
        detail: `${count} Linux kernel OOM ${count === 1 ? 'kill' : 'kills'} since the previous sample`,
        evidence: [{ metric: 'linux_oom_kills', observed: r.linux_oom_kills, operator: '>', threshold: previous.linux_oom_kills }],
        previous_sample_at: previous.at,
      })
    }
    if (r.psi_io_some_avg10 != null) {
      if (r.psi_io_some_avg10 >= PSI_SOME_AVG10_ANOMALY) {
        anomalies.push({
          ...base,
          type: 'io_pressure',
          detail: `I/O stall some avg10 ${round1(r.psi_io_some_avg10)}%`,
          evidence: [{ metric: 'psi_io_some_avg10', observed: r.psi_io_some_avg10, operator: '>=', threshold: PSI_SOME_AVG10_ANOMALY }],
        })
      }
    } else if (r.load_1 > cores * IO_PROXY_LOAD_PER_CORE && r.cpu_usage_total < IO_PROXY_CPU_CEILING) {
      anomalies.push({
        ...base,
        type: 'io_pressure',
        detail: `load1 ${round1(r.load_1)} is ${round1(r.load_1 / cores)}x core count (${cores}) at ${round1(r.cpu_usage_total)}% CPU — possible I/O pressure (proxy)`,
        evidence: [
          { metric: 'load_1', observed: r.load_1, operator: '>', threshold: cores * IO_PROXY_LOAD_PER_CORE },
          { metric: 'cpu_usage_total', observed: r.cpu_usage_total, operator: '<', threshold: IO_PROXY_CPU_CEILING },
        ],
      })
    }
    if (r.cpu_usage_total > CPU_SATURATION) {
      anomalies.push({
        ...base,
        type: 'cpu_saturation',
        detail: `total CPU ${round1(r.cpu_usage_total)}%`,
        evidence: [{ metric: 'cpu_usage_total', observed: r.cpu_usage_total, operator: '>', threshold: CPU_SATURATION }],
      })
    }
    const level = r.memory_pressure_level
    if (level != null) {
      if (MEMORY_PRESSURE_LEVELS.includes(level)) {
        anomalies.push({
          ...base,
          type: 'memory_pressure',
          detail: `memory pressure ${level}`,
          evidence: [{ metric: 'memory_pressure_level', observed: level, operator: 'in', threshold: MEMORY_PRESSURE_LEVELS }],
        })
      }
    } else if (r.psi_memory_some_avg10 != null) {
      if (r.psi_memory_some_avg10 >= PSI_SOME_AVG10_ANOMALY) {
        anomalies.push({
          ...base,
          type: 'memory_pressure',
          detail: `memory stall some avg10 ${round1(r.psi_memory_some_avg10)}%`,
          evidence: [{ metric: 'psi_memory_some_avg10', observed: r.psi_memory_some_avg10, operator: '>=', threshold: PSI_SOME_AVG10_ANOMALY }],
        })
      }
    } else if (memPct > MEMORY_USED_THRESHOLD) {
      anomalies.push({
        ...base,
        type: 'memory_pressure',
        detail: `memory ${round1(memPct)}% used (${r.memory_used} of ${r.memory_total} bytes)`,
        evidence: [{ metric: 'memory_used_pct', observed: memPct, operator: '>', threshold: MEMORY_USED_THRESHOLD }],
      })
    }
  }
  return anomalies
}
