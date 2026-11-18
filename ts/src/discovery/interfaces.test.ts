import { expect, test } from 'bun:test'
import { parseIfconfig, parseIpInterfaces } from './interfaces.ts'

test('Linux preserves dual stack scope, multiple addresses and unknown attributes', () => {
  const text = JSON.stringify([
    { ifname: 'eth0', flags: ['UP'], operstate: 'UP', addr_info: [
      { family: 'inet', local: '192.0.2.1', prefixlen: 24 },
      { family: 'inet', local: '192.0.2.2', prefixlen: 24 },
      { family: 'inet6', local: 'fe80::1', prefixlen: 64, scope: 'link' },
    ] },
    { ifname: 'eth1' },
  ])
  expect(parseIpInterfaces(text).rows).toEqual([
    { name: 'eth0', admin_up: true, loopback: false, link_state: 'up', addresses: [
      { family: 4, address: '192.0.2.1', prefix: 24 }, { family: 4, address: '192.0.2.2', prefix: 24 },
      { family: 6, address: 'fe80::1%eth0', prefix: 64 },
    ] },
    { name: 'eth1', addresses: [] },
  ])
  expect(parseIpInterfaces('[]').rows).toEqual([])
})

test('macOS includes loopback, preserves scoped addresses and accepts addressless links', () => {
  expect(parseIfconfig(`lo0: flags=8049<UP,LOOPBACK,RUNNING>
\tinet 127.0.0.1 netmask 0xff000000
\tinet6 fe80::1%lo0 prefixlen 64
gif0: flags=8010<POINTOPOINT>
\tstatus: inactive`).rows).toEqual([
    { name: 'lo0', admin_up: true, loopback: true, addresses: [
      { family: 4, address: '127.0.0.1', prefix: 8 }, { family: 6, address: 'fe80::1%lo0', prefix: 64 },
    ] },
    { name: 'gif0', admin_up: false, loopback: false, link_state: 'inactive', addresses: [] },
  ])
})
