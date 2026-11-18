import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { darwinDiskTopology, linuxDiskTopology } from './disk-topology.ts'

test.skipIf(process.platform === 'win32')('resolves Linux partition and stack edges but skips disconnected devices', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloppytop-block-'))
  const path = (name: string) => join(root, name)
  try {
    for (const dir of ['class', 'pci/sda/device', 'pci/sda/sda1/partition', 'virtual/block/dm-0/slaves', 'mystery']) {
      mkdirSync(path(dir), { recursive: true })
    }
    for (const [name, target] of Object.entries({ sda: 'pci/sda', sda1: 'pci/sda/sda1', 'dm-0': 'virtual/block/dm-0', unknown: 'mystery', removed: 'gone' })) {
      symlinkSync(path(target), path(`class/${name}`))
    }
    symlinkSync(path('pci/sda/sda1'), path('virtual/block/dm-0/slaves/sda1'))
    expect(linuxDiskTopology(path('class'))).toEqual([
      { name: 'dm-0', kind: 'virtual', backing_devices: ['sda1'] },
      { name: 'sda', kind: 'disk' },
      { name: 'sda1', kind: 'partition', parent: 'sda' },
      { name: 'unknown', kind: 'unknown' },
    ])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('reports only explicit Darwin edges and excludes private inventory fields', () => {
  expect(darwinDiskTopology({ AllDisksAndPartitions: [
    { DeviceIdentifier: 'disk0', SerialNumber: 'private', Partitions: [{ DeviceIdentifier: 'disk0s2' }] },
    { DeviceIdentifier: 'disk1', APFSPhysicalStores: [{ DeviceIdentifier: 'disk0s2' }, { DeviceIdentifier: 'removed' }],
      APFSVolumes: [{ DeviceIdentifier: 'disk1s1', VolumeName: 'private' }] },
  ] })).toEqual([
    { name: 'disk0', kind: 'unknown' }, { name: 'disk0s2', kind: 'partition', parent: 'disk0' },
    { name: 'disk1', kind: 'virtual', backing_devices: ['disk0s2'] }, { name: 'disk1s1', kind: 'apfs_volume', parent: 'disk1' },
  ])
})
