import { addressFamily, linuxNetworkTool, validInterface } from './interfaces.ts'
import { localCommand, observe, readLocal, type Parsed } from './provider.ts'

interface Resolver {
  scope: 'system' | 'interface' | 'domain'
  interface?: string
  domain?: string
  servers: string[]
  search: string[]
}
const unique = (x: string[]) => [...new Set(x)]
const domain = (x: string) => /^~?[a-z0-9_.-]{1,253}$/i.test(x)

export function parseResolvConf(text: string): Parsed<Resolver> {
  const servers: string[] = []
  const search: string[] = []
  let malformed = false
  for (const line of text.split('\n')) {
    const [key, ...values] = line.split(/[#;]/)[0]!.trim().split(/\s+/)
    if (key === 'nameserver') {
      if (addressFamily(values[0])) servers.push(values[0]!)
      else malformed = true
    } else if (key === 'search' || key === 'domain') {
      search.splice(0, search.length, ...values.filter(domain))
    }
  }
  return { rows: servers.length || search.length ? [{ scope: 'system', servers: unique(servers), search: unique(search) }] : [],
    ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function parseScutilDns(text: string): Parsed<Resolver> {
  const rows: Resolver[] = []
  let current: Resolver | undefined
  for (const line of text.split('\n')) {
    if (/^resolver #\d+/.test(line)) {
      current = { scope: 'system', servers: [], search: [] }
      rows.push(current)
      continue
    }
    if (!current) continue
    const m = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(line)
    if (!m) continue
    const [, key, value] = m
    if (!value) continue
    if (key?.startsWith('nameserver[') && addressFamily(value)) current.servers.push(value)
    if (key?.startsWith('search domain[') && domain(value)) current.search.push(value)
    if (key === 'domain' && domain(value)) { current.domain = value; current.scope = 'domain' }
    if (key === 'if_index') {
      const iface = /\(([^)]+)\)$/.exec(value)?.[1]
      if (validInterface(iface)) { current.interface = iface; if (!current.domain) current.scope = 'interface' }
    }
  }
  const filtered = rows.filter((r) => r.servers.length || r.search.length || r.domain)
    .map((r) => ({ ...r, servers: unique(r.servers), search: unique(r.search) }))
  return { rows: [...new Map(filtered.map((r) => [JSON.stringify(r), r])).values()],
    ...(!text.includes('DNS configuration') && !/No DNS configuration/i.test(text) ? { issues: ['malformed'] } : {}) }
}

export function parseResolved(text: string, field: 'servers' | 'search'): Parsed<Resolver> {
  const rows: Resolver[] = []
  let malformed = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = /^(Global|Link \d+ \(([^)]+)\)):\s*(.*)$/.exec(line)
    if (!m) { malformed = true; continue }
    const iface = m[2]
    if (iface && !validInterface(iface)) { malformed = true; continue }
    const values = unique((m[3] ?? '').split(/\s+/).filter((v) =>
      field === 'servers' ? Boolean(addressFamily(v)) : domain(v)))
    if (!values.length) continue
    rows.push({ scope: iface ? 'interface' : 'system', ...(iface ? { interface: iface } : {}),
      servers: field === 'servers' ? values : [], search: field === 'search' ? values : [],
    })
  }
  return { rows, ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function discoverDns(platform = process.platform) {
  if (platform === 'linux') return [
    observe('resolv.conf', readLocal('/etc/resolv.conf'), parseResolvConf, platform),
    observe('resolvectl dns', linuxNetworkTool('resolvectl', ['dns']), (t) => parseResolved(t, 'servers'), platform),
    observe('resolvectl domain', linuxNetworkTool('resolvectl', ['domain']), (t) => parseResolved(t, 'search'), platform),
  ]
  return [observe('scutil DNS', platform === 'darwin'
    ? localCommand('/usr/sbin/scutil', ['--dns']) : { issue: 'unsupported' }, parseScutilDns, platform)]
}
