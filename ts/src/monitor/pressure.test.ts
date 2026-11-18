import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseMemoryPressureLevel } from './darwin.ts'
import { optionalSystemStats, snapshot } from './index.ts'
import { parseOomKills, parsePsiSomeAvg10 } from './linux.ts'
import { collectFlags, defaultProbes } from './probes.ts'
import type { PlatformSample } from './types.ts'

test('parses only a safe nonnegative oom_kill count from vmstat', () => {
  expect(parseOomKills('pgpgin 1024\noom_kill 0\n')).toBe(0)
  expect(parseOomKills('oom_kill\t123\npgpgout 2048')).toBe(123)
  for (const text of ['', 'not_oom_kill 3', 'oom_kill -1', 'oom_kill 1.5', 'oom_kill 1 extra',
    'oom_kill 9007199254740992', 'oom_kill\n1']) {
    expect(parseOomKills(text)).toBeUndefined()
  }
})

test.skipIf(process.platform !== 'linux')('reads the live Linux counter and omits it with pressure off', async () => {
  const readCount = () => Number(/^oom_kill\s+(\d+)$/m.exec(readFileSync('/proc/vmstat', 'utf8'))?.[1])
  const before = readCount()
  const flags = collectFlags(defaultProbes())
  const on = await snapshot(0, { ...flags, pressure: true })
  const after = readCount()
  if (Number.isFinite(before) && Number.isFinite(after)) {
    expect(on.system.linux_oom_kills).toBeGreaterThanOrEqual(before)
    expect(on.system.linux_oom_kills).toBeLessThanOrEqual(after)
    expect(on.linuxBootId).toBe(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim())
  } else {
    expect(on.system).not.toHaveProperty('linux_oom_kills')
  }
  const off = await snapshot(0, { ...flags, pressure: false })
  expect(off.system).not.toHaveProperty('linux_oom_kills')
  expect(off).not.toHaveProperty('linuxBootId')
})

describe('parsePsiSomeAvg10', () => {
  test('reads some avg10 and ignores the full line', () => {
    const text = `some avg10=12.50 avg60=3.00 avg300=1.00 total=9
full avg10=99.00 avg60=1.00 avg300=0.00 total=1
`
    expect(parsePsiSomeAvg10(text)).toBe(12.5)
  })

  test('a measured zero is zero, not absent', () => {
    expect(parsePsiSomeAvg10('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n')).toBe(0)
  })

  test('cpu file with only some, and garbage', () => {
    expect(parsePsiSomeAvg10('some avg10=1.25 avg60=0.00 avg300=0.00 total=4\n')).toBe(1.25)
    expect(parsePsiSomeAvg10('')).toBeNull()
    expect(parsePsiSomeAvg10('full avg10=4.00 avg60=0.00 avg300=0.00 total=1\n')).toBeNull()
  })
})

describe('parseMemoryPressureLevel', () => {
  test('userspace notes, not the internal 0-4 enum', () => {
    expect(parseMemoryPressureLevel('1\n')).toBe('normal')
    expect(parseMemoryPressureLevel('2')).toBe('warning')
    expect(parseMemoryPressureLevel('4')).toBe('critical')
  })

  test('internal enum values and junk are omitted', () => {
    expect(parseMemoryPressureLevel('0')).toBeNull()
    expect(parseMemoryPressureLevel('3')).toBeNull()
    expect(parseMemoryPressureLevel('nope')).toBeNull()
  })
})

describe('optionalSystemStats pressure', () => {
  const base: PlatformSample = {
    cpuBrand: 'c',
    coreCount: 1,
    memoryTotal: 1,
    memoryUsed: 1,
    memoryFree: 0,
    netRxTotal: 0,
    netTxTotal: 0,
    diskTotal: 1,
    diskUsed: 0,
    diskFree: 1,
    uptimeSecs: 1,
    loadAvg: [0, 0, 0],
    hostname: 'h',
    osVersion: 'o',
    kernelVersion: 'k',
    procs: [],
  }

  test('keeps a zero PSI reading and rounds to two decimals', () => {
    expect(
      optionalSystemStats({
        ...base,
        psiCpuSomeAvg10: 0,
        psiIoSomeAvg10: 1.256,
        memoryPressureLevel: 'normal',
      }),
    ).toEqual({
      psi_cpu_some_avg10: 0,
      psi_io_some_avg10: 1.26,
      memory_pressure_level: 'normal',
    })
  })

  test('OOM zero is independent of PSI and excludes boot metadata', () => {
    const stats = optionalSystemStats({ ...base, linuxOomKills: 0, linuxBootId: 'internal' })
    expect(stats).toEqual({ linux_oom_kills: 0 })
  })
})
