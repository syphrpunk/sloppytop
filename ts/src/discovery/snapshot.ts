import { z } from 'zod'
import { MAX_ROWS, readLocal } from './provider.ts'

const sections = ['interfaces', 'routes', 'neighbors', 'listeners'] as const
const status = z.enum(['ready', 'empty', 'unavailable', 'partial', 'truncated'])
const entries = z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS)
const provider = z.object({
  source: z.string().max(80), platform: z.string().max(30), status,
  observed_at: z.iso.datetime(), rows: entries,
})
const schema = z.object({
  version: z.literal(1), scope: z.string().max(512), collected_at: z.iso.datetime(),
  interfaces: provider.array().max(12), routes: provider.array().max(12),
  neighbors: provider.array().max(12), listeners: provider.array().max(12),
})
type Snapshot = z.infer<typeof schema>

export function readSnapshot(path: string): Snapshot | undefined {
  // Explicit JSON export, not arbitrary streams or network paths.
  const raw = readLocal(path, 4 * 1024 * 1024)
  if ('issue' in raw || raw.clipped) return
  try { return parseSnapshot(JSON.parse(raw.text)) } catch { return undefined }
}

export function parseSnapshot(value: unknown): Snapshot {
  const bounded = (node: unknown, depth: number): boolean => !node || typeof node !== 'object'
    || (depth < 12 && Object.values(node).every((child) => bounded(child, depth + 1)))
  if (!bounded(value, 0)) throw Error('invalid snapshot structure')
  return schema.parse(value)
}

const select = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, row[key]]))
const identities = {
  interfaces: ['name'], routes: ['family', 'destination', 'interface', 'gateway', 'table'],
  neighbors: ['family', 'address', 'interface'], listeners: ['protocol', 'family', 'address', 'port'],
}
const stable = (data: unknown): string => {
  if (Array.isArray(data)) return `[${data.map(stable).sort().join(',')}]`
  if (!data || typeof data !== 'object') return JSON.stringify(data) ?? 'null'
  const entries = Object.entries(data).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}

export function compareSnapshots(before: Snapshot, after: Snapshot) {
  const sameScope = Boolean(before.scope) && before.scope === after.scope
  const compare = (section: typeof sections[number]) => {
    const left = before[section], right = after[section]
    const providers = (items: typeof left) => items.map((p) => `${p.platform}:${p.source}`).sort()
    const complete = (items: typeof left) => items.length > 0 && items.every((p) => p.status === 'ready' || p.status === 'empty')
    const comparable = sameScope && stable(providers(left)) === stable(providers(right))
    const coverage = !comparable ? 'changed_scope_or_provider' : complete(left) && complete(right) ? 'comparable' : 'partial'
    if (coverage !== 'comparable') return { section, coverage, added: [], removed: [], changed: [] }
    const grouped = (items: typeof left) => {
      const result = new Map<string, Record<string, unknown>[]>()
      for (const p of items) for (const data of p.rows) {
        const { rx_bytes_per_s: _rx, tx_bytes_per_s: _tx, ...row } = data
        const identity = stable(select(row, identities[section]))
        const group = result.get(identity) ?? []
        group.push(row)
        result.set(identity, group)
      }
      const normalize = (text: string) => JSON.parse(text) as Record<string, unknown>
      return new Map([...result].map(([k, rows]) => [k, [...new Set(rows.map(stable))].sort().map(normalize)]))
    }
    const a = grouped(left), b = grouped(right)
    const added = [], removed = [], changed = []
    for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(key), y = b.get(key)
      if (!x && y) added.push(y)
      else if (x && !y) removed.push(x)
      else if (x && y && stable(x) !== stable(y)) changed.push({ before: x, after: y })
    }
    return { section, coverage, added, removed, changed }
  }
  return { interpretation: 'Changes to observations only; cache removal is not peer departure.', sections: sections.map(compare) }
}
