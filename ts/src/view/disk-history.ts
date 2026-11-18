import type { DiskDevice } from '../monitor/types.ts'
import { sparkline, type SparklinePoint } from './sparkline.ts'

const DEVICE_LIMIT = 4
const METRICS = [
  [{ key: 'read_bytes_per_s', title: 'read B/s' }, { key: 'write_bytes_per_s', title: 'write B/s' }],
  [{ key: 'read_iops', title: 'read IOPS' }, { key: 'write_iops', title: 'write IOPS' }],
  [{ key: 'read_latency_ms', title: 'read avg ms' }, { key: 'write_latency_ms', title: 'write avg ms' }],
] as const
type Metric = (typeof METRICS)[number][number]['key']
type DeviceCharts = { name: string } & Partial<Record<Metric, string>>

export interface DiskHistoryMetric {
  key: Metric
  title: string
  max: number
  series: { name: string; values: SparklinePoint[] }[]
}

function reading(value: number | undefined): SparklinePoint {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Compare recorded devices oldest first, with a common ceiling per unit. */
export function diskHistory(rows: readonly { disk_devices?: DiskDevice[] }[]): {
  names: string[]
  metrics: DiskHistoryMetric[]
} {
  const peaks = new Map<string, number>()
  const indexed = rows.map(({ disk_devices }) => {
    const devices = new Map<string, DiskDevice>()
    for (const disk of disk_devices ?? []) {
      if (typeof disk?.name !== 'string' || !disk.name.trim() || devices.has(disk.name)) continue
      devices.set(disk.name, disk)
      const peak = (reading(disk.read_bytes_per_s) ?? 0) + (reading(disk.write_bytes_per_s) ?? 0)
      peaks.set(disk.name, Math.max(peaks.get(disk.name) ?? 0, peak))
    }
    return devices
  })
  const selected = [...peaks]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, DEVICE_LIMIT)
  const names = selected.map(([name]) => name)
  const metrics: DiskHistoryMetric[] = []
  for (const pair of METRICS) {
    let max = 0
    const views = pair.map(({ key, title }) => ({
      key, title,
      series: names.map((name) => ({
        name,
        values: indexed.map((row) => {
          const value = reading(row.get(name)?.[key])
          if (value !== null) max = Math.max(max, value)
          return value
        }),
      })),
    }))
    for (const view of views) {
      if (view.series.some(({ values }) => values.some((v) => v !== null))) metrics.push({ ...view, max })
    }
  }
  return { names, metrics }
}

export function diskHistoryCharts(rows: readonly { disk_devices?: DiskDevice[] }[]): DeviceCharts[] {
  const { names, metrics } = diskHistory(rows)
  const byName = new Map<string, DeviceCharts>(names.map((name) => [name, { name }]))
  for (const { key, max, series } of metrics) {
    for (const { name, values } of series) {
      const chart = byName.get(name)
      if (chart && values.some((v) => v !== null)) chart[key] = sparkline(values, { max })
    }
  }
  return [...byName.values()].filter((chart) => Object.keys(chart).length > 1)
}
