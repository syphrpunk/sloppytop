// Compiled only by the discovery smoke check, never by the release build.
import { composeOverview } from './src/discovery/overview.ts'
import { observe } from './src/discovery/provider.ts'
import { runTui } from './src/tui/run.ts'
import { defaultPageLoaders } from './src/tui/pages.ts'
import { defaultProbes } from './src/monitor/probes.ts'
import type { Sample } from './src/sample.ts'
import { insertSample, openDb } from './src/store/db.ts'

const rows = Number(process.env.ST_FIXTURE_ROWS ?? 24)
if (!Number.isInteger(rows) || rows < 1 || rows > 5_000) throw new Error('fixture rows must be 1–5000')

const sample: Sample = {
  probes: defaultProbes(),
  system: {
    cpu_brand: 'Fixture CPU', cpu_usage_total: 32, core_count: 4, cpu_usage_per_core: [9, 58, 21, 40],
    memory_total: 16 * 2 ** 30, memory_used: 7 * 2 ** 30, memory_free: 9 * 2 ** 30,
    uptime_secs: 6000, load_avg: [1.2, .9, .5],
    disk_total_bytes: 500 * 2 ** 30, disk_used_bytes: 180 * 2 ** 30, disk_free_bytes: 320 * 2 ** 30,
    hostname: 'fixture', os_version: 'test OS', kernel_version: '1', process_count: rows,
    network_rx_bytes: 18_000, network_tx_bytes: 6_000,
    electrical_sensors: [{ channel: 'hwmon0/in0', name: 'fixture rail', unit: 'volts', value: 0 }],
    powercap_packages: [{ zone: 'package-0', name: 'fixture package', watts: 0 }],
    network_interfaces: [{ name: 'eth0', rx_bytes_per_s: 0 }],
  },
  processes: Array.from({ length: rows }, (_, i) => ({
    pid: 200 + i, ppid: i ? 200 : 1, name: i === 0 ? 'fixture-worker' : `fixture-child-${i}`,
    status: 'Running', user: 'fixture', command: 'fixture command',
    cpu_usage: Math.max(0, 100 - i * 3), memory_bytes: Math.max(0, 450 - i * 10) * 2 ** 20,
    runtime_secs: 600, disk_read_bytes: 0, disk_write_bytes: 0,
  })),
}

if (process.env.ST_VISUAL_HISTORY === '1') {
  const db = openDb()
  const now = Date.now()
  for (const hours of [4, 1, 0]) {
    insertSample(db, new Date(now - hours * 3_600_000).toISOString(), {
      ...sample.system,
      disk_devices: hours === 1 ? [] : [{
        name: 'fixture-disk', read_bytes_per_s: hours ? 100 : 0, write_bytes_per_s: 50,
        read_iops: 2, write_iops: 1,
      }],
    }, [], { processLimit: 0, retentionDays: 30 })
  }
  db.close()
}

const loaders = {
  ...defaultPageLoaders(),
  processDetail: async () => ({}),
  summarizeCgroup: async (pid: number) => ({ pid, cgroup: '/fixture', scope: 'cgroup_and_descendants', charged_memory_bytes: 0 }),
  hardwareInventory: () => ({
    collected_at: '2026-11-18T04:00:00Z', chip: 'Fixture CPU', displays: [],
    battery: { health: 'Normal', maximum_capacity_percent: 92, cycle_count: 0,
      design_capacity_mah: 5000, raw_maximum_capacity_mah: 4600 },
  }),
  diskTopology: () => [
    { name: 'disk0', kind: 'disk' as const },
    { name: 'disk0s1', kind: 'partition' as const, parent: 'disk0' },
  ],
}

await runTui(loaders, async () => {
  const time = new Date('2026-11-18T04:00:00Z')
  const denied = observe('ip address', { issue: 'denied' }, () => ({ rows: [] as never[] }), 'linux', time)
  const cache = observe('ARP cache', { text: '' }, () => ({
    rows: Array.from({ length: 20 }, (_, i) => ({
      interface: 'eth0', family: 6 as const, address: `fe80::${(i + 1).toString(16)}%eth0`, state: 'stale',
    })),
    issues: ['visibility'],
  }), 'linux', time)
  return composeOverview([denied], [], [cache], [], 'fixture', time)
}, async ({ paused }) => paused ? undefined : sample, async section => {
  const time = new Date('2026-11-18T04:00:00Z')
  return section === 'connections'
    ? { section, providers: [observe('ss tcp6', { text: '' }, () => ({ rows: [{
      protocol: 'tcp' as const, family: 6 as const, address: '::1', port: 8080, scope: 'loopback' as const,
      state: 'established', owner_visibility: 'reported' as const, pids: [200], rx_bytes_per_s: 0,
    }] }), 'linux', time)] }
    : { section, providers: [observe('resolv.conf', { text: '' }, () => ({ rows: [{
      scope: 'system' as const, servers: ['192.0.2.53'], search: ['fixture.test'],
    }] }), 'linux', time)] }
})
