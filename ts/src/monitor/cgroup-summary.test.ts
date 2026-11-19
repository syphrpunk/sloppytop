import { expect, test } from 'bun:test'
import { summarizeCgroup } from './cgroup-summary.ts'

function fixture(change?: (files: Map<string, string>) => void) {
  const proc = '/proc/12'
  const group = '/mounted root/child'
  const files = new Map([
    [`${proc}/stat`, `12 (private) S ${Array(18).fill('0').join(' ')} 99`],
    [`${proc}/cgroup`, '0::/nested/child\n'],
    ['/proc/self/mountinfo', '40 20 0:30 /nested /mounted\\040root rw - cgroup2 none rw'],
    [`${group}/cpu.stat`, 'usage_usec 9000000000000000000\nuser_usec 0\n'],
    [`${group}/memory.current`, '4000\n'],
    [`${group}/grandchild/memory.current`, '3000\n'],
  ])
  let now = 10
  return {
    read: (path: string) => files.get(path),
    identity: (path: string) => path === group ? files.get('id') ?? 'initial' : undefined,
    now: () => now,
    wait: async () => {
      now += 100
      files.set(`${group}/cpu.stat`, 'usage_usec 9000000000000150000\n')
      change?.(files)
    },
  }
}

test.skipIf(process.platform === 'win32')('uses hierarchical counters once, including full precision of the baseline', async () => {
  expect(await summarizeCgroup(12, 100, fixture())).toEqual({
    pid: 12, cgroup: '/nested/child', scope: 'cgroup_and_descendants',
    cpu_percent_of_one_core: 150, charged_memory_bytes: 4000,
  })
})

test.skipIf(process.platform === 'win32')('omits unavailable controllers without losing a separately measured zero', async () => {
  const report = await summarizeCgroup(12, 100, fixture((files) => {
    files.delete('/mounted root/child/cpu.stat')
    files.set('/mounted root/child/memory.current', '0')
  }))
  expect(report).toEqual({ pid: 12, cgroup: '/nested/child', scope: 'cgroup_and_descendants', charged_memory_bytes: 0 })
})

test('rejects moved processes, reused PIDs and recreated groups', async () => {
  for (const change of [
    (files: Map<string, string>) => files.set('/proc/12/cgroup', '0::/nested/other\n'),
    (files: Map<string, string>) => files.set('/proc/12/stat', files.get('/proc/12/stat')!.replace(/99$/, '100')),
    (files: Map<string, string>) => files.set('id', 'recreated'),
  ]) {
    expect(await summarizeCgroup(12, 100, fixture(change))).toBeUndefined()
  }
})
