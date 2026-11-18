import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSystemMetrics } from '../store/openmetrics.ts'
import { NvidiaProbe, parseNvidiaDevices } from './nvidia.ts'

test('parses independent device readings, including zero and unavailable values', () => {
  const devices = parseNvidiaDevices(`GPU-a, 550.12, 0, 0, 8192
GPU-b, 550.12, [N/A], 100, 4096
GPU-c, 550.12, 101, [N/A], [N/A]
not a device`)
  expect(devices).toEqual([
    { uuid: 'GPU-a', driver_version: '550.12', utilization_percent: 0, vram_used_bytes: 0, vram_total_bytes: 8192 * 2 ** 20 },
    { uuid: 'GPU-b', driver_version: '550.12', vram_used_bytes: 100 * 2 ** 20, vram_total_bytes: 4096 * 2 ** 20 },
  ])
  const metrics = renderSystemMetrics({ nvidia_devices: devices })
  expect(metrics).toContain('sloppytop_nvidia_utilization_percent{uuid="GPU-a"} 0\n')
  expect(metrics).not.toContain('sloppytop_nvidia_utilization_percent{uuid="GPU-b"}')
  expect(metrics).toContain('sloppytop_nvidia_vram_used_bytes{uuid="GPU-b"} 104857600\n')
})

test.skipIf(process.platform === 'win32')('isolates absent, failed, oversized and stuck helpers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sloppytop-nvidia-'))
  try {
    const file = (name: string, script: string) => {
      const path = join(dir, name)
      writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o700 })
      return path
    }
    const csv = `echo 'GPU-a, 550.12, 0, 0, 8192'`
    const healthy = new NvidiaProbe(file('healthy', csv), 500).start()
    const failed = new NvidiaProbe(file('failed', `${csv}\nexit 1`), 500).start()
    const absent = new NvidiaProbe(join(dir, 'absent')).start()
    const oversized = new NvidiaProbe(file('oversized', `exec yes '${'x'.repeat(200)}'`), 80).start()
    const stuck = new NvidiaProbe(file('stuck', `${csv}\nwhile :; do :; done`), 40)
    const pending = stuck.start()
    const overlapping = stuck.start()
    expect(overlapping()).toBeUndefined()
    await Bun.sleep(300)
    expect(pending()).toBeUndefined()
    expect(healthy()?.[0]?.vram_used_bytes).toBe(0)
    expect(failed()).toBeUndefined()
    expect(absent()).toBeUndefined()
    expect(oversized()).toBeUndefined()
    expect(stuck.start()()).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
