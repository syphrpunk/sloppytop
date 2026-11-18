import { discoverInterfaces } from './interfaces.ts'
import { discoverRoutes } from './routes.ts'
import { discoverNeighbors } from './neighbors.ts'
import { discoverConnections, discoverSockets } from './sockets.ts'
import { discoverDns } from './dns.ts'
import { hostname } from 'node:os'
import { readlinkSync } from 'node:fs'
import { readLocal } from './provider.ts'

export const SECTIONS = ['interfaces', 'routes', 'neighbors', 'listeners', 'connections', 'dns'] as const
export type Section = (typeof SECTIONS)[number]

export async function discoverSection(section: Section) {
  switch (section) {
    case 'interfaces': return { providers: [await discoverInterfaces()] }
    case 'routes': return { providers: discoverRoutes() }
    case 'neighbors': return { providers: discoverNeighbors() }
    case 'listeners': return { providers: discoverSockets() }
    case 'connections': return { providers: await discoverConnections() }
    case 'dns': return { providers: discoverDns() }
  }
}

export function composeOverview(interfaces: Awaited<ReturnType<typeof discoverInterfaces>>[],
  routes: ReturnType<typeof discoverRoutes>, neighbors: ReturnType<typeof discoverNeighbors>,
  listeners: ReturnType<typeof discoverSockets>, scope: string, now = new Date()) {
  const counts = new Map<string, number>()
  for (const { rows } of neighbors) for (const row of rows) counts.set(row.interface, (counts.get(row.interface) ?? 0) + 1)
  return {
    version: 1 as const,
    scope,
    collected_at: now.toISOString(),
    interfaces, routes, neighbors, listeners,
    default_routes: routes.flatMap(({ rows }) => rows.filter((row) => row.default)),
    counts: {
      tcp_listeners: listeners.flatMap((p) => p.rows).filter((row) => row.protocol === 'tcp').length,
      udp_bound: listeners.flatMap((p) => p.rows).filter((row) => row.protocol === 'udp').length,
      cached_neighbors: neighbors.reduce((n, p) => n + p.rows.length, 0),
      cached_by_interface: [...counts].map(([name, count]) => ({ name, count })),
    },
  }
}
export async function discoverOverview() {
  let scope = `host:${hostname()}`
  if (process.platform === 'linux') {
    try {
      const boot = readLocal('/proc/sys/kernel/random/boot_id', 64)
      if (!('text' in boot) || !/^[a-f\d-]{36}$/.test(boot.text.trim())) scope = ''
      else scope += `/${boot.text.trim()}/${readlinkSync('/proc/self/ns/net')}`
    } catch { scope = '' }
  }
  return composeOverview([await discoverInterfaces()], discoverRoutes(), discoverNeighbors(), discoverSockets(), scope)
}
export type Overview = Awaited<ReturnType<typeof discoverOverview>>
