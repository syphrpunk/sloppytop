import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSystemMetrics } from '../store/openmetrics.ts'
import { collectHwmon } from './linux.ts'

test('discovers labeled electrical inputs with ABI units and skips ambiguous files', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloppytop-hwmon-'))
  try {
    const chip = join(root, 'hwmon0')
    mkdirSync(chip)
    for (const [name, data] of Object.entries({
      name: 'meter\n',
      in0_input: '12345\n',
      in0_label: 'VBUS\n',
      in1_input: '2300\n',
      curr1_input: '-1500\n',
      power1_input: '0\n',
      power2_input: '2500312\n',
      power3_input: 'unavailable\n',
      power4_average: '10000000\n',
      power5_cap: '10000000\n',
    })) writeFileSync(join(chip, name), data)
    const output = collectHwmon(root)
    expect(output.electrical_sensors).toEqual([
      { channel: 'hwmon0/curr1', name: 'meter curr1', unit: 'amps', value: -1.5 },
      { channel: 'hwmon0/in0', name: 'meter VBUS', unit: 'volts', value: 12.345 },
      { channel: 'hwmon0/power1', name: 'meter power1', unit: 'watts', value: 0 },
      { channel: 'hwmon0/power2', name: 'meter power2', unit: 'watts', value: 2.500312 },
    ])
    const metrics = renderSystemMetrics(output)
    expect(metrics.match(/# TYPE sloppytop_hwmon_power_watts gauge/g)).toHaveLength(1)
    expect(metrics).toContain('sloppytop_hwmon_power_watts{channel="hwmon0/power1",sensor="meter power1"} 0\n')
    expect(collectHwmon(join(root, 'missing'))).toEqual({})
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
