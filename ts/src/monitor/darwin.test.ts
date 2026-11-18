import { describe, expect, test } from 'bun:test'
import { batchSysctl, parseEtime } from './darwin.ts'

describe('parseEtime', () => {
  test('mm:ss', () => {
    expect(parseEtime('04:20')).toBe(260)
  })

  test('hh:mm:ss', () => {
    expect(parseEtime('01:02:03')).toBe(3723)
  })

  test('dd-hh:mm:ss', () => {
    expect(parseEtime('2-01:00:30')).toBe(2 * 86_400 + 3_600 + 30)
  })

  test('garbage returns 0', () => {
    expect(parseEtime('-')).toBe(0)
  })
})

describe('batchSysctl', () => {
  test('matches named fields, not positions; preserves measured zero and embedded colons', () => {
    const calls: string[][] = []
    const read = batchSysctl(['a', 'absent', 'b'], (_cmd, args) => {
      calls.push(args)
      if (args[0] === '-i') return 'b: clock 12:34:56\na: 0\n'
      throw new Error('unavailable')
    })
    expect(read('a')).toBe('0')
    expect(read('b')).toBe('clock 12:34:56')
    expect(() => read('absent')).toThrow('unavailable')
    expect(calls).toEqual([['-i', 'a', 'absent', 'b'], ['-n', 'absent']])
  })

  test('falls back to individual reads if the batch fails', () => {
    const read = batchSysctl(['a'], (_cmd, args) => {
      if (args[0] === '-i') throw new Error('batch failed')
      expect(args).toEqual(['-n', 'a'])
      return '123\n'
    })
    expect(read('a')).toBe('123')
  })
})
