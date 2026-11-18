import { expect, test } from 'bun:test'
import { parseDarwinNeighbors, parseIpNeighbors } from './neighbors.ts'

test('cache state and scoped identity survive; duplicates are not counted twice', () => {
  const row = { dst: 'fe80::1', dev: 'eth0', state: ['STALE'], lladdr: '00:11:22:33:44:55' }
  const rows = parseIpNeighbors(JSON.stringify([row, row, { ...row, dev: 'eth1', state: ['FAILED'], lladdr: undefined }])).rows
  expect(rows.map(({ address, state, mac }) => [address, state, mac])).toEqual([
    ['fe80::1%eth0', 'stale', '00:11:22:33:44:55'], ['fe80::1%eth1', 'failed', undefined],
  ])
  expect(parseDarwinNeighbors('Neighbor Linklayer Address Netif Expire St\nfe80::1 (incomplete) en0 expired N', 6).rows[0]?.state).toBe('expired')
  expect(parseDarwinNeighbors('', 4).rows).toEqual([])
})
