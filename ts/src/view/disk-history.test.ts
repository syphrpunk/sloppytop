import { expect, test } from 'bun:test'
import { diskHistoryCharts } from './disk-history.ts'

const disk = (name: string, read: number, latency?: number) => ({
  name, read_bytes_per_s: read, write_bytes_per_s: 0, read_iops: 1, write_iops: 0,
  ...(latency === undefined ? {} : { read_latency_ms: latency }),
})

test('uses a shared scale and preserves aligned gaps, idle zero, and missing latency', () => {
  const charts = diskHistoryCharts([
    { disk_devices: [disk('a', 100, 4), disk('b', 50)] },
    { disk_devices: [disk('b', 0)] },
    { disk_devices: [disk('a', 50, 0), disk('b', 50)] },
  ])
  expect(charts).toEqual([
    { name: 'a', read_bytes_per_s: '⣿⠂⣤', write_bytes_per_s: '⠀⠂⠀', read_iops: '⣿⠂⣿',
      write_iops: '⠀⠂⠀', read_latency_ms: '⣿⠂⠀' },
    { name: 'b', read_bytes_per_s: '⣤⠀⣤', write_bytes_per_s: '⠀⠀⠀', read_iops: '⣿⣿⣿', write_iops: '⠀⠀⠀' },
  ])
})

test('ranks by observed peak throughput, breaks ties by name, and bounds output', () => {
  const charts = diskHistoryCharts([
    { disk_devices: [disk('e', 10), disk('c', 10), disk('b', 10), disk('a', 100), disk('d', 10)] },
    {},
  ])
  expect(charts.map((row) => row.name)).toEqual(['a', 'b', 'c', 'd'])
  expect(charts[0]?.read_bytes_per_s).toBe('⣿⠂')
  expect(diskHistoryCharts([{}, { disk_devices: [] }])).toEqual([])
})
