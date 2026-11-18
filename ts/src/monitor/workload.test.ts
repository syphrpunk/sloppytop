import { expect, test } from 'bun:test'
import { summarizeTree } from './workload.ts'
import { Monitor } from './index.ts'
import type { PlatformSample, RawProc } from './types.ts'

test('summarizes only reachable members once and excludes private fields', () => {
  const root = { pid: 1, ppid: 3, cpu: 130, rss: 100, command: 'PRIVATE-ARG', env: 'PRIVATE-VALUE' }
  const members = [root, { pid: 2, ppid: 1, cpu: 0, rss: 0 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 0, cpu: 75, rss: 500 }]
  const report = summarizeTree(members, 1)
  expect(report).toEqual({
    root_pid: 1, membership: 'visible_process_tree_only', membership_verified_complete: false, visible_processes: 3,
    cpu: { measured_processes: 2, incomplete: true, percent_of_one_core: 130 },
    memory: { measured_processes: 2, incomplete: true, summed_rss_bytes: 100 },
  })
  expect(JSON.stringify(report)).not.toContain('PRIVATE')
  expect(summarizeTree(members, 8)).toBeUndefined()
  expect(summarizeTree(members, 3)?.cpu.measured_processes).toBe(2)
  expect(summarizeTree([{ pid: 1, ppid: 0 }], 1)?.cpu).toEqual({ measured_processes: 0, incomplete: true })
})

test('workload refuses lifetime fallback, PID reuse, and reset CPU counters', () => {
  const proc = (pid: number, startIdentity: number, cpuTicks: number): RawProc => ({
    pid, ppid: pid === 1 ? 0 : 1, name: 'fixture', command: 'PRIVATE', user: '', status: '',
    memoryBytes: 1024, runtimeSecs: 2, cpuTicks, startIdentity,
  })
  let now = 1000
  let procs = [proc(1, 1, 20), proc(2, 2, 4), proc(3, 3, 6)]
  const collect = (): PlatformSample => ({
    cpuBrand: '', coreCount: 1, memoryTotal: 0, memoryUsed: 0, memoryFree: 0, diskTotal: 0, diskUsed: 0,
    diskFree: 0, uptimeSecs: 0, loadAvg: [0, 0, 0], hostname: '', osVersion: '', kernelVersion: '', procs,
  })
  const mon = new Monitor({ collect, detail: () => { throw new Error('not used') } }, () => now)
  mon.refresh()
  expect(mon.workload(1)?.cpu.measured_processes).toBe(0)
  expect(mon.processes()[0]?.cpu_usage).toBeGreaterThan(0)
  now += 1000
  procs = [proc(1, 1, 20), proc(2, 4, 6), proc(3, 3, 2)]
  mon.refresh()
  expect(mon.workload(1)?.cpu).toEqual({ measured_processes: 1, incomplete: true, percent_of_one_core: 0 })
})
