// Compiled only by the discovery smoke check, never by the release build.
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import { handleDestination, type DestinationRequest } from './src/tui/recorder-destination.ts'
import { composeOverview } from './src/discovery/overview.ts'
import { observe } from './src/discovery/provider.ts'
import { runTui } from './src/tui/run.ts'
import { defaultPageLoaders } from './src/tui/pages.ts'
import { defaultProbes } from './src/monitor/probes.ts'
import type { Sample } from './src/sample.ts'
import { insertSample, openDb } from './src/store/db.ts'
import { loadConfig, saveConfig, updateProbes } from './src/store/config.ts'
import { summarizeTree } from './src/monitor/workload.ts'
import { changeRecorder, type RecorderChange } from './src/tui/recorder.ts'
import { loadReport, type RecorderHealth } from './src/tui/store.ts'

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
    nvidia_devices: [{ uuid: 'GPU-00000000-0000-0000-0000-000000000001', driver_version: 'fixture',
      utilization_percent: 0, vram_used_bytes: 0, vram_total_bytes: 8 * 2 ** 30 }],
  },
  processes: Array.from({ length: rows }, (_, i) => ({
    pid: 200 + i, ppid: i === 0 ? 1 : i === 2 || i === 3 ? 201 : 200,
    name: i === 0 ? 'fixture-worker' : i === 1 ? '界-fixture' : `fixture-child-${i}`,
    status: 'Running', user: 'fixture', command: 'fixture command',
    cpu_usage: Math.max(0, 100 - i * 3), memory_bytes: Math.max(0, 450 - i * 10) * 2 ** 20,
    runtime_secs: 600, disk_read_bytes: 0, disk_write_bytes: 0,
  })),
}

if (process.env.ST_VISUAL_HISTORY === '1') {
  if (!process.env.XDG_CONFIG_HOME) throw new Error('visual fixture requires a disposable XDG_CONFIG_HOME')
  sample.probes = updateProbes(['cpu'], false).probes
  saveConfig({ ...loadConfig(), groups: [{ name: 'fixture group', patterns: ['fixture-worker'] }] })
  const db = openDb()
  const now = Date.now()
  for (const hours of [4, 1, 0]) {
    insertSample(db, new Date(now - hours * 3_600_000).toISOString(), {
      ...sample.system,
      ...(hours === 0 ? { psi_io_some_avg10: 12 } : {}),
      network_interfaces: hours === 0 ? [{ name: 'fixture-eth', rx_bytes_per_s: 0 }]
        : hours === 1 ? [{ name: 'older-link', tx_bytes_per_s: 7 }] : [],
      disk_devices: hours === 1 ? [] : [{
        name: 'fixture-disk', read_bytes_per_s: hours ? 100 : 0, write_bytes_per_s: 50,
        read_iops: 2, write_iops: 1,
      }],
    }, hours === 0 ? sample.processes.slice(0, 1) : [], { processLimit: 1, retentionDays: 30 })
  }
  db.close()
}

const loaders = {
  ...defaultPageLoaders(),
  processDetail: async (_pid: number, mode: 'names' | 'none') => mode === 'names' ? { envNames: ['FIXTURE_MODE'] } : {},
  openFiles: () => [{ fd: '1', name: 'fixture-output' }],
  sampleNet: async () => [{ proto: 'tcp', local: '127.0.0.1:8080', remote: '127.0.0.1:1234',
    pid: 200, name: 'fixture-worker', rx_bytes_per_s: 0, tx_bytes_per_s: 0 }],
  listeningSockets: () => [{ protocol: 'tcp', port: 8080, pid: 200, name: 'fixture-worker' }],
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

// Both halves are synthetic: visual input can never dispatch a real service change.
const fixtureHealth: RecorderHealth = {
  service: { scheduler: 'systemd', installed: true, loaded: true, scheduler_state: 'armed', recorder_state: 'idle',
    cadence: '30min', last_run: { outcome: 'failed', exit_code: 7 } },
  databasePath: '/fixture/neohtop/neohtop.db', last_successful_sample_at: '2026-11-18T04:00:00.000Z',
  sample_age_seconds: 0,
}
const fixtureRecorder = {
  read: () => structuredClone(fixtureHealth),
  destination: (request: DestinationRequest) => {
    // Unlike the synthetic scheduler, test the actual destination transaction, in the fixture tree only.
    const root = process.env.XDG_CONFIG_HOME
    if (process.env.ST_VISUAL_HISTORY !== '1' || !root || !realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
      throw new Error('Destination fixture requires a private temporary XDG_CONFIG_HOME')
    }
    if (request.kind === 'preview' && request.path && !request.path.startsWith(root + sep)) {
      throw new Error('Use an absolute path inside the fixture directory')
    }
    const result = handleDestination(request)
    if (result.kind === 'verified') {
      fixtureHealth.databasePath = result.location.path
      fixtureHealth.last_successful_sample_at = result.freshness.last_successful_sample_at
      fixtureHealth.sample_age_seconds = result.freshness.sample_age_seconds
    }
    return result
  },
  change: (change: RecorderChange) => changeRecorder(change, {
    platform: 'linux',
    record: async () => {
      fixtureHealth.last_successful_sample_at = '2026-11-18T05:00:00.000Z'
      return { sample_id: 4, db_path: fixtureHealth.databasePath }
    },
    install: seconds => {
      // The 120s scene exercises a partial failure with the prior 90s cadence still armed.
      if (seconds === 120) throw Error('fixture write denied')
      fixtureHealth.service = { scheduler: 'systemd', installed: true, loaded: true,
        scheduler_state: 'armed', recorder_state: 'idle', cadence: `${seconds}s` }
    },
    uninstall: () => {
      fixtureHealth.service = { scheduler: 'systemd', installed: false, loaded: false,
        scheduler_state: 'inactive', recorder_state: 'idle' }
    },
  }),
}

let visualSamplePresented = false

await runTui(loaders, async () => {
  if (process.env.ST_FIXTURE_DISCOVERY_DELAY === '350') await Bun.sleep(350)
  const time = new Date('2026-11-18T04:00:00Z')
  const denied = observe('ip address', { issue: 'denied' }, () => ({ rows: [] as never[] }), 'linux', time)
  const cache = observe('ARP cache', { text: '' }, () => ({
    rows: Array.from({ length: 20 }, (_, i) => ({
      interface: 'eth0', family: 6 as const, address: `fe80::${(i + 1).toString(16)}%eth0`, state: 'stale',
    })),
    issues: ['visibility'],
  }), 'linux', time)
  return composeOverview([denied], [], [cache], [], 'fixture', time)
}, async ({ paused }) => {
  if (paused || (process.env.ST_VISUAL_HISTORY === '1' && visualSamplePresented)) return undefined
  visualSamplePresented = true
  return sample
}, async section => {
  const time = new Date('2026-11-18T04:00:00Z')
  return section === 'connections'
    ? { section, providers: [observe('ss tcp6', { text: '' }, () => ({ rows: [{
      protocol: 'tcp' as const, family: 6 as const, address: '::1', port: 8080, scope: 'loopback' as const,
      state: 'established', owner_visibility: 'reported' as const, pids: [200], rx_bytes_per_s: 0,
    }] }), 'linux', time)] }
    : { section, providers: [observe('resolv.conf', { text: '' }, () => ({ rows: [{
      scope: 'system' as const, servers: ['192.0.2.53'], search: ['fixture.test'],
    }] }), 'linux', time)] }
}, fixtureRecorder, pid => summarizeTree([{ pid: 200, ppid: 1, cpu: 0, rss: 0 }, { pid: 201, ppid: 200, rss: 0 }], pid), loadReport)
