import type { DiskDevice } from '../monitor/types.ts'
import { sparkline, type SparklinePoint } from './sparkline.ts'

const DEVICE_LIMIT = 4
const METRICS = [
  ['read_bytes_per_s', 'write_bytes_per_s'],
  ['read_iops', 'write_iops'],
  ['read_latency_ms', 'write_latency_ms'],
] as const
type Metric = (typeof METRICS)[number][number]
type DeviceCharts = { name: string } & Partial<Record<Metric, string>>

function reading(value: number | undefined): SparklinePoint {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Compare recorded devices oldest first, with a common ceiling per unit. */
export function diskHistoryCharts(rows: readonly { disk_devices?: DiskDevice[] }[]): DeviceCharts[] {
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
  const devices = selected.map(([name]) => indexed.map((row) => row.get(name)))
  const result: DeviceCharts[] = selected.map(([name]) => ({ name }))
  for (const pair of METRICS) {
    let max = 0
    const series = devices.map((samples) => pair.map((key) => samples.map((disk) => {
      const value = reading(disk?.[key])
      if (value !== null) max = Math.max(max, value)
      return value
    })))
    for (const [deviceIndex, chart] of result.entries()) {
      for (const [metricIndex, key] of pair.entries()) {
        const values = series[deviceIndex]?.[metricIndex]
        if (values?.some((v) => v !== null)) chart[key] = sparkline(values, { max })
      }
    }
  }
  return result.filter((chart) => METRICS.some((pair) => pair.some((key) => chart[key] !== undefined)))
}
