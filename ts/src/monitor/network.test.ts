import { expect, test } from 'bun:test'
import { Monitor } from './index.ts'
import { interfaceRates, networkRate, parseNetstatBytes, parseProcNetDev, type NetworkCounters } from './network.ts'
import type { PlatformSample } from './types.ts'

const counters = (rx: number | undefined, tx: number): NetworkCounters => new Map([['eth0', { rx, tx }]])

test('uses elapsed sample time, drops reset or unavailable directions and primes again', () => {
  let now = 100
  let network: NetworkCounters | undefined = counters(400, 100)
  const base: PlatformSample = {
    cpuBrand: 'fixture', coreCount: 1, memoryTotal: 0, memoryUsed: 0, memoryFree: 0,
    diskTotal: 0, diskUsed: 0, diskFree: 0, uptimeSecs: 0, loadAvg: [0, 0, 0],
    hostname: 'fixture', osVersion: '', kernelVersion: '', procs: [],
  }
  const monitor = new Monitor({
    collect: () => ({ ...base, ...(network ? { network } : {}) }),
    detail: () => { throw new Error('not used') },
  }, () => now)
  const rates = () => {
    monitor.refresh()
    const { network_rx_bytes: rx, network_tx_bytes: tx } = monitor.stats()
    return [rx, tx]
  }
  expect(rates()).toEqual([undefined, undefined])
  now += 250
  network = counters(500, 100)
  expect(rates()).toEqual([400, 0])
  expect(rates()).toEqual([undefined, undefined])
  now += 500
  network = counters(12, 200)
  expect(rates()).toEqual([undefined, 200])
  now += 500
  network = counters(undefined, 225)
  expect(rates()).toEqual([undefined, 50])
  now += 1000
  network = counters(15, 225)
  expect(rates()).toEqual([undefined, 0])
  now += 1000
  network = undefined
  expect(rates()).toEqual([undefined, undefined])
  now += 1000
  network = counters(25, 300)
  expect(rates()).toEqual([undefined, undefined])
  now += 1000
  network = counters(30, 300)
  expect(rates()).toEqual([5, 0])
})

test('does not hide an interface reset behind growth on another interface', () => {
  const prev = new Map([['a', { rx: 100 }], ['b', { rx: 200 }]])
  const reset = new Map([['a', { rx: 50 }], ['b', { rx: 300 }]])
  expect(networkRate(prev, reset, 'rx', 1)).toBeUndefined()
  expect(networkRate(prev, new Map([['a', { rx: 250 }], ['c', { rx: 300 }]]), 'rx', 1)).toBeUndefined()
})

test('parses kernel interface counters without turning absent values into zero', () => {
  const linux = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes
    lo: 100 0 0 0 0 0 0 0 100
  eth0: 0 0 0 0 0 0 0 0 200
  eth1: - 0 0 0 0 0 0 0
`
  expect([...parseProcNetDev(linux)!]).toEqual([
    ['eth0', { rx: 0, tx: 200 }], ['eth1', { rx: undefined, tx: undefined }],
  ])
  expect(parseProcNetDev('')).toBeUndefined()
  const mac = `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 0 0 100 0 0 100 0
en0 1500 <Link#2> 00:01:02:03:04:05 1 0 170 2 0 400 0
en0 1500 192.0.2 192.0.2.1 1 - 170 2 - 400 -
utun0* 1500 <Link#3> 0 0 0 1 0 0 0
`
  expect([...parseNetstatBytes(mac)!]).toEqual([
    ['<Link#2>:en0', { name: 'en0', rx: 170, tx: 400 }], ['<Link#3>:utun0', { name: 'utun0', rx: 0, tx: 0 }],
  ])
  expect(parseNetstatBytes('')).toBeUndefined()
})

test('interface validity is independent while the host aggregate stays strict', () => {
  const before = new Map([['a', { rx: 1, tx: 2 }], ['b', { rx: 2, tx: 2 }], ['old', { rx: 8, tx: 8 }]])
  const after = new Map([['a', { rx: 0, tx: 2 }], ['b', { rx: 12, tx: 3 }], ['new', { rx: 8, tx: 8 }]])
  expect(interfaceRates(undefined, before, 1)?.every((row) => Object.keys(row).length === 1)).toBe(true)
  expect(interfaceRates(before, after, 1)).toEqual([
    { name: 'a', tx_bytes_per_s: 0 },
    { name: 'b', rx_bytes_per_s: 10, tx_bytes_per_s: 1 },
    { name: 'new' },
  ])
  expect(networkRate(before, after, 'rx', 1)).toBeUndefined()
  expect(networkRate(before, after, 'tx', 1)).toBeUndefined()
})
