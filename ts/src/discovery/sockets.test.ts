import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { discoverSockets, parseDarwinSockets, parseSsSockets, socketRates } from './sockets.ts'

test('bind scope, shared owners and UDP are explicit', () => {
  const tcp = parseSsSockets(`LISTEN 0 10 0.0.0.0:90 0.0.0.0:* users:(("x",pid=12,fd=4),("x",pid=45,fd=4))
LISTEN 0 10 127.0.0.1:91 0.0.0.0:*
LISTEN 0 10 192.0.2.3:92 0.0.0.0:*`, 'tcp', 4).rows
  expect(tcp.map((x) => [x.scope, x.owner_visibility, x.pids])).toEqual([
    ['wildcard', 'reported', [12, 45]], ['loopback', 'unknown', []], ['specific', 'unknown', []],
  ])
  expect(parseSsSockets('UNCONN 0 0 [::]:90 [::]:*', 'udp', 6).rows[0]).toMatchObject({
    family: 6, protocol: 'udp', scope: 'wildcard', state: 'unconn',
  })
  expect(parseDarwinSockets('Proto Recv-Q Send-Q process:pid\ntcp6 0 0 ::1.5050 *.* LISTEN 0 0 0 0 hidden:0 00000 0 101', 'tcp').rows[0])
    .toMatchObject({ family: 6, state: 'listen', owner_visibility: 'unknown' })
})

test('counter gaps are independent and a reused PID cannot join a new socket', () => {
  const sample = (cookie: string, pid: number, rx: number, tx: number) => parseSsSockets(
    `ESTAB 0 0 127.0.0.1:9 127.0.0.1:10 users:(("fixture",pid=${pid},fd=5)) sk:${cookie}\n\tbytes_sent:${tx} bytes_received:${rx}`, 'tcp', 4,
  ).rows
  const a = sample('5a', 42, 10, 10)
  expect(socketRates(a, sample('5a', 42, 10, 4), 1)[0]).toMatchObject({ rx_bytes_per_s: 0 })
  expect(socketRates(a, sample('5a', 42, 10, 4), 1)[0]).not.toHaveProperty('tx_bytes_per_s')
  expect(socketRates(a, sample('5b', 42, 50, 50), 1)[0]).not.toHaveProperty('rx_bytes_per_s')
  expect(socketRates(a, [], 1)).toEqual([])
})

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('observes a locally bound test socket where the provider exists', async () => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('no fixture endpoint')
    const items = discoverSockets()
    if (items.every((p) => p.status === 'unavailable' && p.issues.includes('missing'))) return
    expect(items.flatMap((p) => p.rows).some((row) => row.port === address.port && row.scope === 'loopback')).toBe(true)
  } finally {
    server.close()
  }
})
