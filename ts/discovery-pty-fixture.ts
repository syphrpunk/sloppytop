// Compiled only by the discovery smoke check, never by the release build.
import { composeOverview } from './src/discovery/overview.ts'
import { observe } from './src/discovery/provider.ts'
import { runTui } from './src/tui/run.ts'
import { defaultProbes } from './src/monitor/probes.ts'
import type { Sample } from './src/sample.ts'

const sample: Sample = {
  probes: defaultProbes(),
  system: {
    cpu_brand: 'Fixture CPU', cpu_usage_total: 32, core_count: 4, cpu_usage_per_core: [9, 58, 21, 40],
    memory_total: 16 * 2 ** 30, memory_used: 7 * 2 ** 30, memory_free: 9 * 2 ** 30,
    uptime_secs: 6000, load_avg: [1.2, .9, .5],
    disk_total_bytes: 500 * 2 ** 30, disk_used_bytes: 180 * 2 ** 30, disk_free_bytes: 320 * 2 ** 30,
    hostname: 'fixture', os_version: 'test OS', kernel_version: '1', process_count: 24,
    network_rx_bytes: 18_000, network_tx_bytes: 6_000,
  },
  processes: Array.from({ length: 24 }, (_, i) => ({
    pid: 200 + i, ppid: i ? 200 : 1, name: i === 0 ? 'fixture-worker' : `fixture-child-${i}`,
    status: 'Running', user: 'fixture', command: 'fixture command',
    cpu_usage: 100 - i * 3, memory_bytes: (450 - i * 10) * 2 ** 20,
    runtime_secs: 600, disk_read_bytes: 0, disk_write_bytes: 0,
  })),
}

await runTui(undefined, async () => {
  const time = new Date('2026-11-18T04:00:00Z')
  const denied = observe('ip address', { issue: 'denied' }, () => ({ rows: [] as never[] }), 'linux', time)
  const cache = observe('ARP cache', { text: '' }, () => ({
    rows: [{ interface: 'eth0', family: 6 as const, address: 'fe80::1%eth0', state: 'stale' }],
    issues: ['visibility'],
  }), 'linux', time)
  return composeOverview([denied], [], [cache], [], 'fixture', time)
}, async ({ paused }) => paused ? undefined : sample)
