import { addressFamily, linuxNetworkTool } from './interfaces.ts'
import { localCommand, observe, type Parsed } from './provider.ts'

type Protocol = 'tcp' | 'udp'
export interface LocalSocket {
  protocol: Protocol
  family: 4 | 6
  dual_stack?: true
  address: string
  port: number
  scope: 'wildcard' | 'loopback' | 'specific'
  state: string
  remote?: string
  owner_visibility: 'reported' | 'unknown'
  pids: number[]
  rx_bytes_per_s?: number
  tx_bytes_per_s?: number
}
type Sample = LocalSocket & { key?: string; rx?: number; tx?: number }

export function socketEndpoint(text: string, delimiter: ':' | '.') {
  const split = text.lastIndexOf(delimiter)
  if (split < 1 || !/^\d+$/.test(text.slice(split + 1))) return
  const port = Number(text.slice(split + 1))
  const address = text.slice(0, split).replace(/^\[|\]$/g, '')
  if (port > 65535 || (address !== '*' && !addressFamily(address))) return
  return { address, port }
}

function scope(address: string): LocalSocket['scope'] {
  if (['*', '0.0.0.0', '::'].includes(address)) return 'wildcard'
  if (address.startsWith('127.') || address === '::1' || /^::ffff:127\./i.test(address)) return 'loopback'
  return 'specific'
}

function socket(protocol: Protocol, family: 4 | 6, endpoint: NonNullable<ReturnType<typeof socketEndpoint>>,
  state: string, owners: number[], remote?: string): LocalSocket {
  const pids = [...new Set(owners.filter((pid) => Number.isSafeInteger(pid) && pid > 0))].sort((a, b) => a - b)
  return { protocol, family, ...endpoint, scope: scope(endpoint.address), state, pids,
    owner_visibility: pids.length ? 'reported' : 'unknown', ...(remote ? { remote } : {}),
  }
}

export function parseSsSockets(text: string, protocol: Protocol, family: 4 | 6): Parsed<Sample> {
  const rows: Sample[] = []
  let malformed = false
  const lines = text.split('\n')
  for (const [i, line] of lines.entries()) {
    if (!line.trim() || /^\s/.test(line)) continue
    const [state, , , local, remote] = line.trim().split(/\s+/)
    const endpoint = local && socketEndpoint(local, ':')
    if (!state || !/^[A-Z-]+$/.test(state) || !endpoint) { malformed = true; continue }
    const users = line.match(/users:\(\(.*\)\)/)?.[0] ?? ''
    const row: Sample = socket(protocol, family, endpoint, state.toLowerCase(), [...users.matchAll(/,pid=(\d+),fd=\d+/g)].map((m) => Number(m[1])), remote)
    const cookie = /\bsk:([a-f0-9]+)\b/i.exec(line)?.[1]
    if (cookie && !/^0+$/.test(cookie)) row.key = cookie
    const info = /^\s/.test(lines[i + 1] ?? '') ? lines[i + 1]! : ''
    const rx = /\bbytes_received:(\d+)\b/.exec(info)?.[1]
    const tx = /\bbytes_sent:(\d+)\b/.exec(info)?.[1]
    if (rx !== undefined) row.rx = Number(rx)
    if (tx !== undefined) row.tx = Number(tx)
    rows.push(row)
  }
  return { rows, ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function parseDarwinSockets(text: string, protocol: Protocol): Parsed<Sample> {
  const rows: Sample[] = []
  let malformed = false
  const header = /Proto\s+Recv-Q\s+Send-Q.*process:pid/.test(text)
  for (const line of text.split('\n')) {
    if (!/^(tcp|udp)/.test(line.trim())) continue
    const m = /^(?:tcp|udp)(4|6|46)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(?:([A-Z_]+)\s+)?(\d+)\s+(\d+)\s+\d+\s+\d+\s+.+:(-?\d+)\s+[\da-f]{5}\s+[\da-f]+\s+([\da-f]+)/i.exec(line.trim())
    const endpoint = m && socketEndpoint(m[2]!, '.')
    if (!m || !endpoint) { malformed = true; continue }
    const explicit = addressFamily(endpoint.address)
    const row: Sample = socket(protocol, explicit || (m[1] === '4' ? 4 : 6), endpoint,
      m[4]?.toLowerCase() ?? (m[3] === '*.*' ? 'bound' : 'connected'), [Number(m[7])], m[3])
    // Darwin 46 wildcard is a single explicitly dual-stack row, not two sockets.
    if (m[1] === '46') row.dual_stack = true
    if (m[8] && !/^0+$/.test(m[8])) row.key = m[8]
    row.rx = Number(m[5])
    row.tx = Number(m[6])
    rows.push(row)
  }
  return { rows, ...(!header || malformed ? { issues: ['malformed'] } : {}) }
}

function sampleSockets(platform: NodeJS.Platform, mode: 'bound' | 'all') {
  const protocols = ['tcp', 'udp'] as const
  const select = (parsed: Parsed<Sample>, protocol: Protocol): Parsed<Sample> => {
    const rows = mode === 'all' ? parsed.rows : parsed.rows.filter((row) =>
      protocol === 'tcp' ? row.state === 'listen' : ['bound', 'unconn'].includes(row.state))
    const issues = [...(parsed.issues ?? [])]
    if (rows.some((row) => row.owner_visibility === 'unknown')) issues.push('visibility')
    return { rows, issues }
  }
  if (platform === 'linux') return protocols.flatMap((protocol) => ([4, 6] as const).map((family) =>
    observe(`ss ${protocol}${family}`, linuxNetworkTool('ss', ['-H', '-n', '-p', `-${family}`, mode === 'bound' ? '-l' : '-a', protocol === 'tcp' ? '-t' : '-u', ...(mode === 'all' ? ['-e', '-i'] : [])]),
      (text) => select(parseSsSockets(text, protocol, family), protocol), platform)))
  return protocols.map((protocol) => observe(`netstat ${protocol}`, platform === 'darwin'
    ? localCommand('/usr/sbin/netstat', ['-anv', '-p', protocol]) : { issue: 'unsupported' },
  (text) => select(parseDarwinSockets(text, protocol), protocol), platform))
}

export function socketRates(before: Sample[], after: Sample[], elapsed: number): LocalSocket[] {
  const stableKey = (row: Sample) => row.key && JSON.stringify([row.key, row.family, row.protocol, row.address, row.port, row.remote, row.pids])
  const old = new Map(before.map((row) => [stableKey(row), row]))
  const rate = (previous: number | undefined, next: number | undefined) =>
    previous !== undefined && next !== undefined && Number.isSafeInteger(previous) && Number.isSafeInteger(next) &&
      next >= previous && elapsed > 0 ? Math.round((next - previous) / elapsed) : undefined
  return after.map(({ key, rx, tx, ...row }) => {
    const prior = key ? old.get(stableKey({ ...row, key })) : undefined
    const received = rate(prior?.rx, rx), sent = rate(prior?.tx, tx)
    return { ...row, ...(received !== undefined ? { rx_bytes_per_s: received } : {}),
      ...(sent !== undefined ? { tx_bytes_per_s: sent } : {}) }
  })
}

export function discoverSockets(platform = process.platform) {
  return sampleSockets(platform, 'bound').map((provider) => ({ ...provider, rows: socketRates([], provider.rows, 0) }))
}

export async function discoverConnections(platform = process.platform) {
  const before = sampleSockets(platform, 'all')
  const at = performance.now()
  if (before.some((provider) => provider.rows.length)) await Bun.sleep(150)
  return sampleSockets(platform, 'all').map((provider, i) =>
    ({ ...provider, rows: socketRates(before[i]?.rows ?? [], provider.rows, (performance.now() - at) / 1000) }))
}
