import { expect, test } from 'bun:test'
import { discoverDns, parseResolved, parseResolvConf, parseScutilDns } from './dns.ts'

test('preserves stub and split DNS settings without looking anything up', () => {
  expect(parseResolvConf('nameserver 127.0.0.53\nnameserver 127.0.0.53\nsearch lab.example').rows)
    .toEqual([{ scope: 'system', search: ['lab.example'], servers: ['127.0.0.53'] }])
  expect(parseScutilDns('DNS configuration\nresolver #1\n domain : example.test\n if_index : 13 (utun2)\n nameserver[0] : 192.0.2.1').rows[0])
    .toMatchObject({ scope: 'domain', domain: 'example.test', interface: 'utun2' })
  expect(parseResolved('Link 4 (tun0): ~office.example ~office.example', 'search').rows[0]?.search).toEqual(['~office.example'])
  expect(discoverDns('win32')[0]?.issues).toEqual(['unsupported'])
})
