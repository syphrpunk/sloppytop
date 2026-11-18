import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

type Kind = 'disk' | 'partition' | 'virtual' | 'apfs_volume' | 'unknown'
interface Device {
  name: string
  kind: Kind
  parent?: string
  backing_devices?: string[]
}

const valid = (name: unknown): name is string => typeof name === 'string' && /^[\w.+!-]+$/.test(name)
const list = (path: string) => {
  try { return readdirSync(path).filter(valid).sort() } catch { return [] }
}

export function linuxDiskTopology(root = '/sys/class/block'): Device[] {
  const devices = new Map<string, { path: string; row: Device }>()
  for (const name of list(root)) {
    let path: string
    try { path = realpathSync(join(root, name)) } catch { continue }
    const partition = existsSync(join(path, 'partition'))
    const kind = partition ? 'partition'
      : path.includes('/virtual/block/') ? 'virtual'
      : existsSync(join(path, 'device')) ? 'disk' : 'unknown'
    devices.set(name, { path, row: { name, kind } })
  }
  for (const { path, row } of devices.values()) {
    const parent = basename(dirname(path))
    if (row.kind === 'partition' && devices.get(parent)?.path === dirname(path)) row.parent = parent
    const backing = list(join(path, 'slaves')).filter((name) => devices.has(name) && name !== row.name)
    if (backing.length) row.backing_devices = backing
  }
  return [...devices.values()].map(({ row }) => row)
}

const objects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object') : []

export function darwinDiskTopology(value: unknown): Device[] {
  if (!value || typeof value !== 'object') return []
  const devices = new Map<string, Device>()
  const disks = objects((value as Record<string, unknown>)['AllDisksAndPartitions'])
  for (const disk of disks) {
    const name = disk['DeviceIdentifier']
    if (!valid(name)) continue
    const hasApfsTopology = Array.isArray(disk['APFSPhysicalStores'])
    devices.set(name, { name, kind: hasApfsTopology ? 'virtual' : 'unknown' })
    for (const [key, kind] of [['Partitions', 'partition'], ['APFSVolumes', 'apfs_volume']] as const) {
      for (const child of objects(disk[key])) {
        const childName = child['DeviceIdentifier']
        if (valid(childName) && childName !== name) devices.set(childName, { name: childName, parent: name, kind })
      }
    }
  }
  for (const disk of disks) {
    const name = disk['DeviceIdentifier']
    if (!valid(name)) continue
    const row = devices.get(name)!
    const backing = [...new Set(objects(disk['APFSPhysicalStores']).map((s) => s['DeviceIdentifier'])
      .filter((id): id is string => valid(id) && devices.has(id) && id !== name))].sort()
    if (backing.length) row.backing_devices = backing
  }
  return [...devices.values()]
}

export function diskTopology(): Device[] {
  if (process.platform === 'linux') return linuxDiskTopology()
  if (process.platform !== 'darwin') return []
  const opts = { timeout: 3000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' } as const
  const plist = execFileSync('/usr/sbin/diskutil', ['list', '-plist'], opts)
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { ...opts, input: plist, encoding: 'utf8' })
  return darwinDiskTopology(JSON.parse(json))
}
