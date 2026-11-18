import { addressFamily, jsonRows, linuxIp, validInterface } from './interfaces.ts'
import { localCommand, observe, type Parsed } from './provider.ts'

export interface Route {
  family: 4 | 6
  destination: string
  default: boolean
  interface?: string
  gateway?: string
  metric?: number
  table?: string | number
}

export function parseIpRoutes(text: string, family: 4 | 6): Parsed<Route> {
  const rows: Route[] = []
  let malformed = false
  for (const item of jsonRows(text)) {
    const dst = item.dst
    if (typeof dst !== 'string' || (dst !== 'default' && addressFamily(dst.split('/')[0]) !== family)) {
      malformed = true
      continue
    }
    const base = { family, destination: dst, default: dst === 'default' || dst === (family === 4 ? '0.0.0.0/0' : '::/0'),
      ...(typeof item.metric === 'number' ? { metric: item.metric } : {}),
      ...(typeof item.table === 'number' || typeof item.table === 'string' ? { table: item.table } : {}),
    }
    const paths = Array.isArray(item.nexthops) && item.nexthops.length ? item.nexthops : [item]
    for (const path of paths) {
      if (!path || typeof path !== 'object') { malformed = true; continue }
      rows.push({ ...base,
        ...(validInterface(path.dev) ? { interface: path.dev } : {}),
        ...(typeof path.gateway === 'string' && addressFamily(path.gateway) === family ? { gateway: path.gateway } : {}),
      })
    }
  }
  return { rows, ...(malformed ? { issues: ['malformed'] } : {}) }
}

export function parseNetstatRoutes(text: string, family: 4 | 6): Parsed<Route> {
  const rows: Route[] = []
  let header: string[] | undefined
  let malformed = false
  for (const line of text.trim().split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] === 'Destination') { header = cols; continue }
    if (!header || !line.trim()) continue
    const [dst, gw] = cols
    const iface = cols[header.indexOf('Netif')]
    if (!dst || !gw || !validInterface(iface) || !/^[a-f0-9:.%/\w-]+$/i.test(dst)) { malformed = true; continue }
    rows.push({ family, destination: dst, default: dst === 'default', interface: iface,
      ...(addressFamily(gw) === family && cols[2]?.includes('G') ? { gateway: gw } : {}),
    })
  }
  return { rows, ...(!header || malformed ? { issues: ['malformed'] } : {}) }
}

export function discoverRoutes(platform = process.platform) {
  return ([4, 6] as const).map((family) => {
    const af = family === 4 ? 'inet' : 'inet6'
    if (platform === 'linux') return observe(`ip ${af} routes`, linuxIp(['-j', `-${family}`, 'route', 'show', 'table', 'all']), (text) => parseIpRoutes(text, family), platform)
    return observe(`netstat ${af} routes`, platform === 'darwin'
      ? localCommand('/usr/sbin/netstat', ['-rn', '-f', af]) : { issue: 'unsupported' }, (text) => parseNetstatRoutes(text, family), platform)
  })
}
