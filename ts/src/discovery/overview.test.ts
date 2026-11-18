import { expect, test } from 'bun:test'
import { composeOverview } from './overview.ts'
import { observe } from './provider.ts'
import { shareableOverview } from './redact.ts'
import { compareSnapshots, parseSnapshot } from './snapshot.ts'

const at = new Date('2026-01-01T01:00:00Z')
const item = <T>(source: string, rows: T[]) => observe(source, { text: '' }, () => ({ rows }), 'linux', at)
const fixture = () => composeOverview(
  [item('private-host', [{ name: 'vpn1', addresses: [{ address: 'fe80::4242%vpn1', family: 6 as const }] }])],
  [observe('private.domain.example', { issue: 'denied' }, () => ({ rows: [] as never[] }), 'linux', at)],
  [item('cache', [{ interface: 'vpn1', family: 6 as const, address: 'fe80::4242%vpn1', state: 'stale', mac: '00:42:42:42:42:42' }])],
  [item('socket', [{ protocol: 'tcp' as const, family: 4 as const, address: '192.0.2.42', port: 3277,
    scope: 'specific' as const, state: 'listen', pids: [448889], owner_visibility: 'reported' as const }])], 'private-host', at,
)

test('overview keeps partial provider isolated and redaction excludes all raw identifiers', () => {
  const data = fixture()
  expect(data.counts.cached_by_interface).toEqual([{ name: 'vpn1', count: 1 }])
  expect(data.counts.tcp_listeners).toBe(1)
  expect(data.routes[0]?.issues).toEqual(['denied'])
  const safe = JSON.stringify(shareableOverview(data))
  for (const secret of ['private-host', 'private.domain.example', '192.0.2.42', '00:42:42:42:42:42', '448889', 'fe80::4242%vpn1', 'vpn1']) {
    expect(safe).not.toContain(secret)
  }
})

test('snapshot diff is deterministic and suppresses incomparable or partial changes', () => {
  const a = fixture()
  const b = fixture()
  const compare = () => compareSnapshots(parseSnapshot(a), parseSnapshot(b))
  const peers = b.neighbors[0]!.rows
  peers.push({ ...peers[0]!, address: 'fe80::1234%vpn1' })
  peers[0]!.state = 'expired'
  b.interfaces[0]!.rows[0]!.name = 'vpn2'
  const result = compare()
  expect(result.sections.find(({ section }) => section === 'neighbors')!.changed).toHaveLength(1)
  expect(result.sections.find(({ section }) => section === 'interfaces')!.removed).toHaveLength(1)
  expect(compareSnapshots(parseSnapshot(a), parseSnapshot(a)).sections.every((g) => !g.changed.length && !g.removed.length && !g.added.length)).toBe(true)
  peers.reverse()
  expect(compare()).toEqual(result)
  b.neighbors[0]!.status = 'partial'
  expect(compare().sections.find(({ section }) => section === 'neighbors')!.coverage).toBe('partial')
  b.scope = 'different'
  expect(compare().sections.every((section) => !section.removed.length)).toBe(true)
})
