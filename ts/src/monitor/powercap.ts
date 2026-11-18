import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PowercapPackage } from './types.ts'

export interface PackageEnergy {
  zone: string
  name: string
  identity: string
  microjoules: bigint
  at: number
}

const read = (path: string) => readFileSync(path, 'utf8')

/** Restrict the first collector to the standard RAPL package zones, not MMIO aliases or subdomains. */
export function readPackageEnergy(root = '/sys/class/powercap', readText = read, clock = () => performance.now()): PackageEnergy[] {
  let zones: string[]
  try { zones = readdirSync(root).sort() } catch { return [] }
  return zones.flatMap((zone) => {
    if (!/^intel-rapl:\d+$/.test(zone)) return []
    try {
      const path = join(root, zone)
      const name = readText(join(path, 'name')).trim()
      if (!/^package-\d+$/.test(name)) return []
      const file = join(path, 'energy_uj')
      const before = statSync(file, { bigint: true })
      const value = readText(file).trim()
      const at = clock()
      const after = statSync(file, { bigint: true })
      if (!/^\d+$/.test(value) || before.dev !== after.dev || before.ino !== after.ino) return []
      return [{ zone, name, identity: `${before.dev}:${before.ino}`, microjoules: BigInt(value), at }]
    } catch {
      return []
    }
  })
}

export function packageWatts(before: PackageEnergy[] | undefined, after: PackageEnergy[] | undefined): PowercapPackage[] {
  const prior = new Map(before?.map((row) => [row.zone, row]))
  return (after ?? []).flatMap((row) => {
    const start = prior.get(row.zone)
    if (!start || start.identity !== row.identity || start.name !== row.name || row.microjoules < start.microjoules) return []
    const elapsed = row.at - start.at
    // Never attempt to interpolate across a long sample pause.
    if (!(elapsed > 0 && elapsed <= 2000)) return []
    const watts = Number(row.microjoules - start.microjoules) / (1000 * elapsed)
    if (!Number.isFinite(watts)) return []
    return [{ zone: row.zone, name: row.name, watts }]
  })
}
