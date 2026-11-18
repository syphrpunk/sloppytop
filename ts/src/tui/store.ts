// History, report, probe log, one-shot record, and the metrics listener.
// The table tick does not call these. Tests pass probes and samples in;
// the defaults below open the real store and are only for the screen.

import { statSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { disabledRecordProbes, type ProbeSet } from '../monitor/probes.ts'
import type { FanReading, ProcessInfo, SystemStats, TemperatureReading } from '../monitor/types.ts'
import { takeSample, type RecordableSample } from '../sample.ts'
import { diskHistory } from '../view/disk-history.ts'
import { historyCoverage } from '../view/history-coverage.ts'
import { dbPath, loadConfig } from '../store/config.ts'
import { diagnosticReport } from '../store/diagnostics.ts'
import { insertSample, openDb, queryHistory, queryTopProcesses, type HistoryRow } from '../store/db.ts'
import { metricsResponse } from '../store/metrics.ts'
import { readProbeLog } from '../store/probe-log.ts'
import {
  compareReportWindows,
  reportAnomalies,
  reportGroups,
  reportHourly,
  reportLeaks,
  reportTopConsumers,
  reportWindow,
  reportWorkloadHistory,
} from '../store/report.ts'
import { sampleFreshness, status, type StatusResult } from '../store/service.ts'
import type {
  HistorySeries,
  HistoryView,
  ReportAnomalyLine,
  ReportGroupLine,
  ReportHourLine,
  ReportLeakLine,
  ReportTopLine,
  ReportView,
} from './state.ts'

export const EMPTY_WINDOW =
  "no samples in the last 24h — run 'record' once or 'service install' for hourly recording"

const HISTORY_HOURS = 24
const HISTORY_LIMIT = 120
const CLIP = 48
const HIDDEN_LOG_KEYS = new Set(['cwd', 'environ', 'command', 'local', 'remote'])

export interface RecordDeps {
  sample: () => Promise<RecordableSample>
  insert: (system: SystemStats, processes: ProcessInfo[], linuxBootId?: string) => { sampleId: number; processesStored: number }
}

export interface ReportInput {
  hourly: ReportHourLine[]
  top: ReportTopLine[]
  anomalies: ReportAnomalyLine[]
  leaks: ReportLeakLine[]
  groups: ReportGroupLine[]
}

interface MetricsServer {
  port: number
  stop: (closeActiveConnections?: boolean) => void
}

type MetricsServe = (options: {
  hostname: string
  port: number
  fetch: (request: Request) => Response | Promise<Response>
}) => MetricsServer

/** Refuse before sampling. takeSample reloads config, and a missing record column is NOT NULL. */
export async function attemptRecord(
  probes: ProbeSet,
  deps: RecordDeps,
): Promise<{ recorded: boolean; message: string }> {
  const blocked = disabledRecordProbes(probes)
  if (blocked.length > 0) {
    return {
      recorded: false,
      message: `PROBE_DISABLED  record needs these probes enabled: ${blocked.join(', ')}`,
    }
  }
  const { system, processes, linuxBootId } = await deps.sample()
  const result = deps.insert(system, processes, linuxBootId)
  return { recorded: true, message: `recorded sample ${result.sampleId}  ${result.processesStored} processes` }
}

type HistoryInput = Pick<HistoryRow, 'at' | 'cpu_usage_total' | 'memory_used' | 'load_1'> &
  Partial<Omit<HistoryRow, 'at' | 'cpu_usage_total' | 'memory_used' | 'load_1'>>

const TEMP_CAP = 8
const FAN_CAP = 4

function measured(rows: HistoryInput[], read: (row: HistoryInput) => number | undefined): HistorySeries['values'] {
  return rows.map((row) => {
    const value = read(row)
    return value !== undefined && Number.isFinite(value) ? value : null
  })
}

function addSeries(out: HistorySeries[], label: string, values: HistorySeries['values'], max?: number): void {
  if (values.every((value) => value === null)) return
  out.push(max === undefined ? { label, values } : { label, values, max })
}

function newest<T>(rows: HistoryInput[], read: (row: HistoryInput) => T[] | undefined): T[] {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    const list = row ? read(row) : undefined
    if (list && list.length > 0) return list
  }
  return []
}

function readingValue(list: TemperatureReading[] | undefined, name: string, field: 'celsius' | 'headroom_celsius'): number | undefined {
  const reading = list?.find((item) => item.name === name)
  const value = reading?.[field]
  return value !== undefined && Number.isFinite(value) ? value : undefined
}

export function historyView(
  rows: HistoryInput[],
  findings: ReturnType<typeof reportAnomalies> = [],
  readProcesses?: (id: number) => ReturnType<typeof queryTopProcesses>,
): HistoryView {
  if (rows.length === 0) {
    return { status: 'empty', message: EMPTY_WINDOW, cpu: [], memory: [], load: [], series: [], diskMetrics: [], notes: [], recent: [] }
  }
  const chrono = [...rows].reverse()
  const series: HistorySeries[] = []
  addSeries(series, 'cpu W', measured(chrono, (row) => row.cpu_power_watts))
  addSeries(series, 'gpu W', measured(chrono, (row) => row.gpu_power_watts))
  addSeries(series, 'ane W', measured(chrono, (row) => row.ane_power_watts))
  addSeries(series, 'dram W', measured(chrono, (row) => row.dram_power_watts))
  addSeries(series, 'batt', measured(chrono, (row) => row.battery_charge_percent), 100)
  // Despite the column names, the recorder already stores bytes per second.
  addSeries(series, 'rx/s', measured(chrono, (row) => row.network_rx_bytes))
  addSeries(series, 'tx/s', measured(chrono, (row) => row.network_tx_bytes))
  addSeries(series, 'swap', measured(chrono, (row) => row.swap_used_bytes))
  addSeries(series, 'psi c', measured(chrono, (row) => row.psi_cpu_some_avg10))
  addSeries(series, 'psi io', measured(chrono, (row) => row.psi_io_some_avg10))
  addSeries(series, 'psi m', measured(chrono, (row) => row.psi_memory_some_avg10))
  addSeries(series, 'wired', measured(chrono, (row) => row.memory_wired_bytes))
  addSeries(series, 'comp', measured(chrono, (row) => row.memory_compressed_bytes))
  addSeries(series, 'app', measured(chrono, (row) => row.memory_app_bytes))
  addSeries(series, 'cache', measured(chrono, (row) => row.memory_cached_bytes))
  addSeries(series, 'pg in', measured(chrono, (row) => row.pageins_per_s))
  addSeries(series, 'pg out', measured(chrono, (row) => row.pageouts_per_s))
  addSeries(series, 'cmp', measured(chrono, (row) => row.compressions_per_s))
  addSeries(series, 'dec', measured(chrono, (row) => row.decompressions_per_s))
  addSeries(series, 'procs', measured(chrono, (row) => row.process_count))
  const notes: string[] = []
  const thermal = [...chrono].reverse().find((row) => row.thermal_state)?.thermal_state
  if (thermal === 'nominal' || thermal === 'fair' || thermal === 'serious' || thermal === 'critical') {
    notes.push(`thermal  ${thermal}`)
  }
  const pressure = [...chrono].reverse().find((row) => row.memory_pressure_level)?.memory_pressure_level
  if (pressure === 'normal' || pressure === 'warning' || pressure === 'critical') {
    notes.push(`pressure  ${pressure}`)
  }
  for (const reading of newest(chrono, (row) => row.temperatures).slice(0, TEMP_CAP)) {
    if (reading.name.trim() === '') continue
    addSeries(series, reading.name, measured(chrono, (row) => readingValue(row.temperatures, reading.name, 'celsius')))
    addSeries(
      series,
      `${reading.name} headroom`,
      measured(chrono, (row) => readingValue(row.temperatures, reading.name, 'headroom_celsius')),
    )
  }
  for (const fan of newest(chrono, (row) => row.fans).slice(0, FAN_CAP)) {
    if (fan.name.trim() === '') continue
    addSeries(
      series,
      fan.name,
      measured(chrono, (row) => {
        const match = row.fans?.find((item: FanReading) => item.name === fan.name)
        return match && Number.isFinite(match.rpm) ? match.rpm : undefined
      }),
    )
  }
  const timeline = historyCoverage(chrono)
  return {
    status: 'ready',
    timeline,
    message: '',
    cpu: chrono.map((row) => row.cpu_usage_total),
    memory: chrono.map((row) => row.memory_used),
    load: chrono.map((row) => row.load_1),
    series,
    diskMetrics: diskHistory(chrono).metrics,
    notes,
    recent: rows.slice(0, 5).map((row) => ({
      at: row.at.slice(11, 19),
      timestamp: row.at,
      bootChange: row.boot_changed_since_previous,
      gapSeconds: timeline.coverage.unobserved_intervals.find((gap) => gap.before === row.at)?.seconds,
      interfaces: row.network_interfaces,
      anomalies: findings.filter((finding) => finding.at === row.at),
      processes: row.id === undefined ? undefined : readProcesses?.(row.id).map(({ command: _, ...process }) => process),
      cpu: row.cpu_usage_total,
      memory: row.memory_used,
      load: row.load_1,
    })),
  }
}

/** Sample-weighted avg and peak, same rounding as the report command. */
export function reportView(parts: ReportInput | null): ReportView {
  const empty: ReportView = {
    status: 'empty',
    message: EMPTY_WINDOW,
    summary: null,
    cpu: [],
    memory: [],
    load: [],
    hourly: [],
    top: [],
    anomalies: [],
    leaks: [],
    groups: [],
  }
  if (!parts) return empty
  const n = parts.hourly.reduce((sum, hour) => sum + hour.samples, 0)
  if (parts.hourly.length === 0 || n === 0) return empty
  const hourly = parts.hourly
  const weighted = (read: (hour: ReportHourLine) => number) =>
    Math.round((hourly.reduce((sum, hour) => sum + read(hour) * hour.samples, 0) / n) * 10) / 10
  return {
    status: 'ready',
    message: '',
    summary: {
      cpu_avg: weighted((hour) => hour.cpu_avg),
      cpu_peak: Math.max(...hourly.map((hour) => hour.cpu_peak)),
      memory_used_avg: Math.round(hourly.reduce((sum, hour) => sum + hour.memory_used_avg * hour.samples, 0) / n),
      memory_used_peak: Math.max(...hourly.map((hour) => hour.memory_used_peak)),
      load1_avg: weighted((hour) => hour.load1_avg),
      load1_peak: Math.max(...hourly.map((hour) => hour.load1_peak)),
      anomaly_count: parts.anomalies.length,
    },
    cpu: hourly.map((hour) => hour.cpu_avg),
    memory: hourly.map((hour) => hour.memory_used_avg),
    load: hourly.map((hour) => hour.load1_avg),
    hourly,
    top: parts.top.slice(0, 5),
    anomalies: parts.anomalies.slice(0, 3),
    leaks: parts.leaks.slice(0, 3),
    groups: parts.groups.slice(0, 3),
  }
}

/** Primitives and array lengths only. Path and address keys are dropped, not clipped. */
export function logView(entries: readonly unknown[]): { lines: string[] } {
  const lines: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const parts: string[] = []
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (HIDDEN_LOG_KEYS.has(key) || value == null) continue
      if (typeof value === 'string') parts.push(`${key} ${clipLog(value)}`)
      else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key} ${String(value)}`)
      else if (Array.isArray(value)) parts.push(`${key} ${value.length}`)
    }
    if (parts.length > 0) lines.push(parts.join('  '))
  }
  return { lines }
}

/** Unlike openDb(), inspecting Settings must not create or migrate the destination. */
function latestInsert(path: string): string | undefined {
  if (!statSync(path, { throwIfNoEntry: false })) return
  const db = new Database(path, { readonly: true })
  try {
    return db.query<{ at: string }, []>('SELECT at FROM system_samples ORDER BY at DESC LIMIT 1').get()?.at
  } finally {
    db.close()
  }
}

export interface RecorderHealth {
  databasePath: string
  service?: Omit<StatusResult, 'files'>
  schedulerError?: string
  insertError?: string
  last_successful_sample_at?: string
  sample_age_seconds?: number
}

export function readService(
  load: () => StatusResult = status,
  last: (path: string) => string | undefined = latestInsert,
  now = Date.now(),
  path = dbPath(),
): RecorderHealth {
  const health: RecorderHealth = { databasePath: path }
  try {
    const { files: _, ...service } = load()
    health.service = service
  } catch (err) {
    health.schedulerError = err instanceof Error ? err.message : 'scheduler unavailable'
  }
  try {
    Object.assign(health, sampleFreshness(last(path), now))
  } catch (err) {
    health.insertError = err instanceof Error ? err.message : 'database unavailable'
  }
  return health
}

export function bindMetricsListener(
  opts: { host: string; port: number; sample: () => Promise<Partial<SystemStats>> },
  serve: MetricsServe = Bun.serve as unknown as MetricsServe,
): { ok: true; port: number; stop: () => void } | { ok: false; message: string } {
  try {
    const server = serve({
      hostname: opts.host,
      port: opts.port,
      fetch: (request) => metricsResponse(request, opts.sample),
    })
    return {
      ok: true,
      port: server.port,
      stop: () => {
        server.stop(true)
      },
    }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'metrics bind failed'
    return { ok: false, message }
  }
}

export async function recordWithStore(): Promise<{ recorded: boolean; message: string }> {
  const config = loadConfig()
  return attemptRecord(config.probes, {
    sample: () => takeSample(loadConfig().record.sampleMs),
    insert: (system, processes, linuxBootId) => {
      const record = loadConfig().record
      const db = openDb()
      try {
        const result = insertSample(db, new Date().toISOString(), system, processes, record, linuxBootId)
        return { sampleId: result.sampleId, processesStored: result.processesStored }
      } finally {
        db.close()
      }
    },
  })
}

export function loadHistory(): HistoryView {
  return withDb((db) => {
    const since = new Date(Date.now() - HISTORY_HOURS * 3_600_000).toISOString()
    const rows = queryHistory(db, since, HISTORY_LIMIT)
    return historyView(rows, rows.length ? reportAnomalies(db, rows.at(-1)!.at) : [], id => queryTopProcesses(db, id))
  })
}

export function loadReport(): ReportView {
  return withDb(db => readReport(db))
}

export function loadDiagnostic() {
  const since = new Date(Date.now() - HISTORY_HOURS * 3_600_000).toISOString()
  const scheduler = process.platform === 'darwin' || process.platform === 'linux' ? status() : undefined
  return withDb(db => diagnosticReport(db, since, scheduler))
}

export function readReport(db: Database, configuredGroups = loadConfig().groups, now = Date.now()): ReportView {
  const since = new Date(now - HISTORY_HOURS * 3_600_000).toISOString()
  const leaks = reportLeaks(db, since)
  const evidence = {
    comparison: compareReportWindows(db, HISTORY_HOURS, now),
    workloads: reportWorkloadHistory(db, since, configuredGroups),
    groupCount: configuredGroups.length,
    leaks,
  }
  if (!reportWindow(db, since)) return { ...reportView(null), evidence }
  const hourly = reportHourly(db, since)
  const top = reportTopConsumers(db, since, 5).map((row) => ({
    name: row.name,
    cpu_avg: row.cpu_avg,
    memory_avg_bytes: row.memory_avg_bytes,
  }))
  const anomalies = reportAnomalies(db, since).map((row) => ({ at: row.at, type: row.type, detail: row.detail }))
  const groups = reportGroups(db, since, configuredGroups).map((row) => ({ name: row.name, score: row.score }))
  return { ...reportView({ hourly, top, anomalies, leaks, groups }), evidence }
}

export function loadLog(): { lines: string[] } {
  return logView(readProbeLog({ limit: 50 }))
}

function withDb<T>(read: (db: Database) => T): T {
  const db = openDb()
  try {
    return read(db)
  } finally {
    db.close()
  }
}

function clipLog(value: string): string {
  const flat = value.replace(/\s+/g, ' ')
  const chars = [...flat]
  if (chars.length <= CLIP) return chars.join('')
  return `${chars.slice(0, CLIP - 1).join('')}…`
}
