import { expect, test } from 'bun:test'
import { parseIpRoutes, parseNetstatRoutes } from './routes.ts'

test('retains competing defaults and on-link routes without inventing gateways', () => {
  const rows = parseIpRoutes(JSON.stringify([
    { dst: 'default', table: 70, nexthops: [{ dev: 'eth0', gateway: '192.0.2.1' }, { dev: 'eth1', gateway: '192.0.2.2' }] },
    { dst: '198.51.100.0/24', dev: 'tun0' },
  ]), 4).rows
  expect(rows.map((row) => [row.default, row.interface, row.gateway])).toEqual([
    [true, 'eth0', '192.0.2.1'], [true, 'eth1', '192.0.2.2'], [false, 'tun0', undefined],
  ])
  expect(parseIpRoutes('[]', 4).rows).toEqual([])
  const darwin = parseNetstatRoutes('Destination Gateway Flags Netif Expire\ndefault fe80::1%en0 UG en0\n::1 ::1 UH lo0', 6)
  expect(darwin.rows.map((row) => row.gateway)).toEqual(['fe80::1%en0', undefined])
})
