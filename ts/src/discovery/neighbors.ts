import { addressFamily, jsonRows, linuxIp, validInterface } from './interfaces.ts'
import { localCommand, observe, type Parsed } from './provider.ts'

export interface Neighbor {
  address: string
  family: 4 | 6
  interface: string
  state: string
  mac?: string
}
const mac = (value: unknown): value is string => typeof value === 'string' && /^([\da-f]{1,2}:){5}[\da-f]{1,2}$/i.test(value)
const scoped = (ip: string, iface: string) => /^fe[89ab][0-9a-f]:/i.test(ip) && !ip.includes('%') ? `${ip}%${iface}` : ip

function dedupe(rows: Neighbor[]): Neighbor[] {
  return [...new Map(rows.map((row) => [JSON.stringify([row.interface, row.address, row.state, row.mac]), row])).values()]
}

export function parseIpNeighbors(text: string): Parsed<Neighbor> {
  const rows: Neighbor[] = []
  let malformed = false
  for (const row of jsonRows(text)) {
    const family = addressFamily(row.dst)
    if (!family || typeof row.dst !== 'string' || !validInterface(row.dev)) { malformed = true; continue }
    const state = Array.isArray(row.state) ? row.state[0] : row.state
    rows.push({ address: scoped(row.dst, row.dev), family, interface: row.dev,
      state: typeof state === 'string' && /^[a-z_]+$/i.test(state) ? state.toLowerCase() : 'unknown',
      ...(mac(row.lladdr) ? { mac: row.lladdr } : {}),
    })
  }
  return { rows: dedupe(rows), ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function parseDarwinNeighbors(text: string, family: 4 | 6): Parsed<Neighbor> {
  const rows: Neighbor[] = []
  let malformed = false
  for (const line of text.trim().split('\n')) {
    if (!line.trim() || (family === 6 && /^Neighbor\s+Linklayer/.test(line))) continue
    const fields = family === 4 ? /\(([^)]+)\) at (\S+) on (\S+)/.exec(line)?.slice(1) : line.trim().split(/\s+/)
    const [ip, hw, iface, expiry, code] = fields ?? []
    if (!ip || addressFamily(ip) !== family || !validInterface(iface)) { malformed = true; continue }
    const ndp = { R: 'reachable', S: 'stale', D: 'delay', P: 'probe', I: 'incomplete', N: 'no_state', W: 'wait_delete' }
    rows.push({ address: scoped(ip, iface), family, interface: iface,
      state: expiry === 'expired' ? 'expired' : hw === '(incomplete)' ? 'incomplete'
        : family === 4 ? 'cached' : ndp[code as keyof typeof ndp] ?? 'unknown',
      ...(mac(hw) ? { mac: hw } : {}),
    })
  }
  return { rows: dedupe(rows), ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function discoverNeighbors(platform = process.platform) {
  if (platform === 'linux') return [observe('ip neighbors', linuxIp(['-j', 'neigh', 'show']), parseIpNeighbors, platform)]
  return ([4, 6] as const).map((family) => {
    const path = family === 4 ? '/usr/sbin/arp' : '/usr/sbin/ndp'
    return observe(family === 4 ? 'ARP cache' : 'NDP cache', platform === 'darwin'
      ? localCommand(path, ['-an']) : { issue: 'unsupported' }, (text) => parseDarwinNeighbors(text, family), platform)
  })
}
