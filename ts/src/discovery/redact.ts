import type { Overview } from './overview.ts'

/** Only allowlisted enums and counts; never pass provider text or row keys through. */
export function shareableOverview(data: Overview) {
  const statuses = new Set(['ready', 'empty', 'unavailable', 'partial', 'truncated'])
  const summarize = (providers: Overview['interfaces'] | Overview['routes'] | Overview['neighbors'] | Overview['listeners']) =>
    providers.map((p) => ({ status: statuses.has(p.status) ? p.status : 'unavailable', visible_rows: p.rows.length }))
  return {
    version: 1,
    redacted: true,
    interfaces: summarize(data.interfaces),
    routes: summarize(data.routes),
    neighbors: summarize(data.neighbors),
    listeners: summarize(data.listeners),
    tcp_listeners: data.counts.tcp_listeners,
    udp_bound: data.counts.udp_bound,
    cached_neighbors: data.counts.cached_neighbors,
  }
}
