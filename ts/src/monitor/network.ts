import type { NetworkInterfaceRate } from './types.ts'

type Counters = { rx?: number; tx?: number; name?: string }
export type NetworkCounters = ReadonlyMap<string, Counters>

function delta(old: number | undefined, now: number | undefined) {
  if (old !== undefined && now !== undefined && now >= old) return now - old
}

function rate(bytes: number | undefined, elapsed: number) {
  if (bytes === undefined || !Number.isFinite(elapsed) || elapsed <= 0) return
  const value = bytes / elapsed
  if (Number.isFinite(value)) return Math.round(value)
}

export function byteCounter(value: string | number | undefined): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return
  const n = Number(value)
  if (Number.isSafeInteger(n) && n >= 0) return n
}

export function networkRate(
  prev: NetworkCounters | undefined,
  next: NetworkCounters | undefined,
  direction: 'rx' | 'tx',
  elapsed: number,
): number | undefined {
  if (!prev || !next || !Number.isFinite(elapsed) || elapsed <= 0 || prev.size !== next.size) return
  let sum = 0
  for (const [name, counters] of next) {
    const value = delta(prev.get(name)?.[direction], counters[direction])
    if (value === undefined) return
    sum += value
  }
  return rate(sum, elapsed)
}

export function interfaceRates(prev: NetworkCounters | undefined, next: NetworkCounters | undefined, elapsed: number) {
  if (!next?.size) return
  return [...next].map(([id, current]): NetworkInterfaceRate => {
    const prior = prev?.get(id)
    const rx = rate(delta(prior?.rx, current.rx), elapsed)
    const tx = rate(delta(prior?.tx, current.tx), elapsed)
    return {
      name: current.name ?? id,
      ...(rx === undefined ? {} : { rx_bytes_per_s: rx }),
      ...(tx === undefined ? {} : { tx_bytes_per_s: tx }),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function parseProcNetDev(text: string): NetworkCounters | undefined {
  const [header, fields, ...rows] = text.trimEnd().split('\n')
  if (!header?.match(/\|\s*Receive\s*\|\s*Transmit/) || !fields?.match(/\|\s*bytes\b.*\|\s*bytes\b/)) return
  const result = new Map<string, Counters>()
  for (const row of rows) {
    if (!row.trim()) continue
    const match = row.match(/^\s*(\S+):\s*(.*)$/)
    if (!match) return
    const [, name, values] = match
    if (name === 'lo') continue
    if (!name || result.has(name)) return
    const parts = values!.trim().split(/\s+/)
    result.set(name, { rx: byteCounter(parts[0]), tx: byteCounter(parts[8]) })
  }
  return result
}

export function parseNetstatBytes(text: string): NetworkCounters | undefined {
  const [first, ...rows] = text.split('\n')
  const header = first?.trim().split(/\s+/) ?? []
  const address = header.indexOf('Address')
  const rx = header.indexOf('Ibytes')
  const tx = header.indexOf('Obytes')
  if (address < 0 || rx <= address || tx <= address) return
  const result = new Map<string, Counters>()
  let sawLink = false
  for (const row of rows) {
    const parts = row.trim().split(/\s+/)
    if (!/^<Link#\d+>$/.test(parts[2] ?? '')) continue
    sawLink = true
    const name = parts[0]!.replace(/\*$/, '')
    if (/^lo\d+$/.test(name)) continue
    const id = `${parts[2]}:${name}`
    if (result.has(id)) return
    // netstat leaves Address blank on some link rows.
    const shift = header.length - parts.length
    result.set(id, shift === 0 || shift === 1
      ? { name, rx: byteCounter(parts[rx - shift]), tx: byteCounter(parts[tx - shift]) }
      : { name })
  }
  if (sawLink) return result
}
