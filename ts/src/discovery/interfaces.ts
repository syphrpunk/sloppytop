import { isIP } from 'node:net'
import { interfaceRates, parseNetstatBytes, parseProcNetDev } from '../monitor/network.ts'
import { localCommand, observe, readLocal, type Input, type Issue, type Parsed } from './provider.ts'

export interface Address {
  address: string
  family: 4 | 6
  prefix?: number
}
export interface Interface {
  name: string
  addresses: Address[]
  loopback?: boolean
  admin_up?: boolean
  link_state?: string
  rx_bytes_per_s?: number
  tx_bytes_per_s?: number
}

export function linuxIp(args: string[]): Input {
  for (const bin of ['/usr/sbin/ip', '/sbin/ip', '/usr/bin/ip', '/bin/ip', '/run/current-system/sw/bin/ip']) {
    const result = localCommand(bin, args)
    if (!('issue' in result) || result.issue !== 'missing') return result
  }
  return { issue: 'missing' }
}

export const validInterface = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:@-]{1,64}$/.test(value)
export function addressFamily(value: unknown): 0 | 4 | 6 {
  if (typeof value !== 'string') return 0
  const base = value.split('%')[0]!
  const family = isIP(base)
  return family === 4 || family === 6 ? family : 0
}
export function jsonRows(text: string): Record<string, unknown>[] {
  const rows = JSON.parse(text)
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw Error()
  return rows
}

export function parseIpInterfaces(text: string): Parsed<Interface> {
  const rows: Interface[] = []
  const issues = new Set<Issue>()
  for (const row of jsonRows(text)) {
    if (!validInterface(row.ifname)) { issues.add('malformed'); continue }
    const flags = Array.isArray(row.flags) ? row.flags : undefined
    const addresses: Address[] = []
    for (const addr of Array.isArray(row.addr_info) ? row.addr_info : []) {
      if (!addr || (addr.family !== 'inet' && addr.family !== 'inet6')) continue
      const family = addressFamily(addr.local)
      if (!family) { issues.add('malformed'); continue }
      const scoped = family === 6 && addr.scope === 'link' && !addr.local.includes('%') ? `${addr.local}%${row.ifname}` : addr.local
      addresses.push({ address: scoped, family, ...(Number.isInteger(addr.prefixlen) ? { prefix: addr.prefixlen } : {}) })
    }
    rows.push({
      name: row.ifname, addresses,
      ...(flags ? { loopback: flags.includes('LOOPBACK'), admin_up: flags.includes('UP') } : {}),
      ...(typeof row.operstate === 'string' && /^[A-Z_]+$/.test(row.operstate) ? { link_state: row.operstate.toLowerCase() } : {}),
    })
  }
  return { rows, issues: [...issues] }
}

export function parseIfconfig(text: string): Parsed<Interface> {
  const rows: Interface[] = []
  let current: Interface | undefined
  let malformed = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (!/^\s/.test(line)) {
      const m = /^(\S+): flags=[\da-f]+(?:<([^>]+)>)?/i.exec(line)
      current = undefined
      if (!m || !validInterface(m[1])) { malformed = true; continue }
      const flags = m[2]?.split(',') ?? []
      current = { name: m[1], addresses: [], loopback: flags.includes('LOOPBACK'), admin_up: flags.includes('UP') }
      rows.push(current)
    } else if (current) {
      const [key, value, prefixKey, prefixVal] = line.trim().split(/\s+/)
      if (key === 'status' || key === 'status:') {
        if (value === 'active' || value === 'inactive') current.link_state = value
      }
      if (key !== 'inet' && key !== 'inet6') continue
      const family = addressFamily(value)
      if (!value || !family) { malformed = true; continue }
      let prefix: number | undefined
      if (prefixKey === 'prefixlen' && /^\d+$/.test(prefixVal ?? '')) prefix = Number(prefixVal)
      if (prefixKey === 'netmask' && /^0x[\da-f]+$/i.test(prefixVal ?? '')) {
        const bits = Number(prefixVal).toString(2).padStart(32, '0')
        if (/^1*0*$/.test(bits)) prefix = bits.replace(/0/g, '').length
      }
      current.addresses.push({ address: value, family, ...(prefix !== undefined && prefix <= (family === 4 ? 32 : 128) ? { prefix } : {}) })
    }
  }
  return { rows, ...(malformed ? { issues: ['malformed'] } : {}) }
}

export async function discoverInterfaces(platform = process.platform) {
  const linux = platform === 'linux'
  const supported = linux || platform === 'darwin'
  const source = linux ? 'ip address' : 'ifconfig'
  const sample = () => {
    const raw = linux ? readLocal('/proc/net/dev') : localCommand('/usr/sbin/netstat', ['-ibn'])
    if ('text' in raw && !raw.clipped) return (linux ? parseProcNetDev : parseNetstatBytes)(raw.text)
  }
  const input = supported
    ? linux ? linuxIp(['-j', 'address', 'show']) : localCommand('/sbin/ifconfig', ['-a'])
    : { issue: 'unsupported' } as const
  if ('issue' in input) return observe(source, input, () => ({ rows: [] as Interface[] }), platform)
  const before = sample()
  const started = performance.now()
  if (before?.size) await Bun.sleep(150)
  const after = before?.size ? sample() : undefined
  const elapsed = (performance.now() - started) / 1000
  const rates = new Map(interfaceRates(before, after, elapsed)?.map(({ name, ...rate }) => [name, rate]))
  return observe(source, input, (text) => {
    const parsed = (linux ? parseIpInterfaces : parseIfconfig)(text)
    return { ...parsed, rows: parsed.rows.map((row) => ({ ...row, ...rates.get(row.name) })) }
  }, platform)
}
