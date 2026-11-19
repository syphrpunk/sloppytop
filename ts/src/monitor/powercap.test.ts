import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageWatts, readPackageEnergy, type PackageEnergy } from './powercap.ts'

test('uses monotonic per-zone time, preserves zero, and rejects ambiguous decreases', () => {
  const start: PackageEnergy = { name: 'package-0', zone: 'intel-rapl:0', identity: '1:1', at: 10, microjoules: 900719925474099300n }
  const next = { ...start, at: 510, microjoules: start.microjoules + 2_500_000n }
  expect(packageWatts([start], [next])).toEqual([{ zone: start.zone, name: start.name, watts: 5 }])
  expect(packageWatts([start], [{ ...next, microjoules: start.microjoules }])[0]?.watts).toBe(0)
  for (const sample of [
    { ...next, microjoules: 1n }, { ...next, identity: '1:2' },
    { ...next, at: 10 }, { ...next, at: 2011 }, { ...next, name: 'package-1' },
  ]) expect(packageWatts([start], [sample])).toEqual([])
  expect(packageWatts(undefined, [next])).toEqual([])
})

// Linux sysfs zone directory names contain colons, illegal on NTFS.
test.skipIf(process.platform === 'win32')('reads only explicitly named packages and omits inaccessible counters', () => {
  const root = mkdtempSync(join(tmpdir(), 'powercap-'))
  try {
    for (const [zone, name] of [
      ['intel-rapl:0', 'package-0'], ['intel-rapl:1', 'package-1'],
      ['intel-rapl:0:0', 'core'], ['intel-rapl:2', 'psys'], ['intel-rapl-mmio:0', 'package-0'],
    ]) {
      const path = join(root, zone!)
      mkdirSync(path)
      writeFileSync(join(path, 'name'), name!)
      writeFileSync(join(path, 'energy_uj'), '0\n')
    }
    const reports = readPackageEnergy(root, (path) => {
      if (path.endsWith('intel-rapl:1/energy_uj')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return readFileSync(path, 'utf8')
    }, () => 400)
    expect(reports.map(({ zone, microjoules, at }) => ({ zone, microjoules, at }))).toEqual([
      { zone: 'intel-rapl:0', microjoules: 0n, at: 400 },
    ])
    expect(readPackageEnergy(join(root, 'absent'))).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
