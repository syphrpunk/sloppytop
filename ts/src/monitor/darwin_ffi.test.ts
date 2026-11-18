import { describe, expect, test } from 'bun:test'
import { parseEnviron, readIdleWakeups, readPhysFootprint } from './darwin_ffi.ts'

describe('readPhysFootprint', () => {
  test('reads the uint64 at offset 72, including a measured zero', () => {
    const buf = new ArrayBuffer(160)
    const view = new DataView(buf)
    view.setBigUint64(72, 4096n, true)
    view.setBigUint64(144, 99n, true)
    expect(readPhysFootprint(view)).toBe(4096)
    view.setBigUint64(72, 0n, true)
    expect(readPhysFootprint(view)).toBe(0)
  })

  test('a short buffer or an unsafe integer is omitted', () => {
    expect(readPhysFootprint(new DataView(new ArrayBuffer(72)))).toBeUndefined()
    const buf = new ArrayBuffer(160)
    const view = new DataView(buf)
    view.setBigUint64(72, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    expect(readPhysFootprint(view)).toBeUndefined()
  })
})

describe('readIdleWakeups', () => {
  test('reads the uint64 at offset 32, including a measured zero', () => {
    const buf = new ArrayBuffer(160)
    const view = new DataView(buf)
    view.setBigUint64(32, 7n, true)
    expect(readIdleWakeups(view)).toBe(7)
    view.setBigUint64(32, 0n, true)
    expect(readIdleWakeups(view)).toBe(0)
  })

  test('a short buffer or an unsafe integer is omitted', () => {
    expect(readIdleWakeups(new DataView(new ArrayBuffer(32)))).toBeUndefined()
    const view = new DataView(new ArrayBuffer(40))
    view.setBigUint64(32, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)
    expect(readIdleWakeups(view)).toBeUndefined()
  })
})

// A synthetic KERN_PROCARGS2 layout, not a process lookup.
test('names skip executable padding and all argv, even arguments with equals', () => {
  const text = new TextEncoder().encode('/fixture\0\0\0fixture\0--arg=\0FIXTURE_NAME=\0\0')
  const data = new Uint8Array(4 + text.length)
  new DataView(data.buffer).setInt32(0, 2, true)
  data.set(text, 4)
  expect(parseEnviron(data, 'names')).toEqual(['FIXTURE_NAME'])
  expect(parseEnviron(data.subarray(0, 5), 'names')).toBeUndefined()
})
