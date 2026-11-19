import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { hidReadCount, hidSetupCounts } from './monitor/darwin_sensors.ts'
import { defaultProbes } from './monitor/probes.ts'
import { takeSample } from './sample.ts'
import { configParseCount, configPath, loadConfig, updateProbes } from './store/config.ts'
import { defaultPageLoaders, fulfillPage, pageFulfillCount } from './tui/pages.ts'
import { createTuiSampler } from './tui/sampler.ts'

function names(sample: Awaited<ReturnType<typeof takeSample>>): string[] {
  return (sample.system.temperatures ?? []).map((reading) => reading.name).sort()
}

describe('sample and tick', () => {
  test('a second sample does not repeat setup, and an off probe is not read', async () => {
    const previous = process.env.XDG_CONFIG_HOME
    const home = mkdtempSync(join(tmpdir(), 'sloppytop-repeat-'))
    process.env.XDG_CONFIG_HOME = home
    try {
      const fulfills = pageFulfillCount()
      const patch = await fulfillPage(
        {},
        { probes: defaultProbes(), sampleMs: 0, processes: [] },
        defaultPageLoaders(),
      )
      expect(patch.log).toEqual([])
      expect(pageFulfillCount()).toBe(fulfills + 1)

      const pausedReads = hidReadCount()
      const pausedParses = configParseCount()
      const sampler = createTuiSampler()
      expect(await sampler.tick({ paused: true, sampleMs: 0 })).toBeUndefined()
      sampler.close()
      expect(hidReadCount()).toBe(pausedReads)
      expect(configParseCount()).toBe(pausedParses)
      expect(pageFulfillCount()).toBe(fulfills + 1)

      const parsesBefore = configParseCount()
      const setupBefore = hidSetupCounts()
      const readsBefore = hidReadCount()
      const first = await takeSample(0)
      const parsesMid = configParseCount()
      const setupMid = hidSetupCounts()
      const readsMid = hidReadCount()
      const second = await takeSample(0)
      const parsesAfter = configParseCount()
      const setupAfter = hidSetupCounts()
      const readsAfter = hidReadCount()

      expect(second).toBeDefined()
      expect(parsesMid).toBe(parsesBefore + 1)
      expect(parsesAfter).toBe(parsesMid)
      expect(setupAfter.managers).toBe(setupMid.managers)
      expect(setupAfter.clients).toBe(setupMid.clients)
      expect(pageFulfillCount()).toBe(fulfills + 1)
      expect(names(second!)).toEqual(names(first))
      for (const reading of first.system.temperatures ?? []) {
        expect(Number.isFinite(reading.celsius)).toBe(true)
        expect(names(second!)).toContain(reading.name)
      }
      for (const name of (first.system.temperatures ?? []).filter((reading) => reading.celsius === 0).map((reading) => reading.name)) {
        expect(second!.system.temperatures?.some((reading) => reading.name === name)).toBe(true)
      }

      if (process.platform === 'darwin' && readsMid > readsBefore) {
        expect(setupMid.clients).toBeGreaterThan(setupBefore.clients)
        expect(setupMid.managers).toBeGreaterThan(setupBefore.managers)
        expect(readsMid - readsBefore).toBe(2)
        expect(readsAfter - readsMid).toBe(2)
        // A successful HID read does not imply a particular physical sensor
        // exists (notably on hosted Macs). Validate reported readings above.
      }

      const seen = loadConfig()
      seen.pins.push('not-written')
      expect(loadConfig().pins).toEqual([])
      const parsesCached = configParseCount()
      writeFileSync(configPath(), `${JSON.stringify({ pins: ['shown'] })}\n`)
      expect(loadConfig().pins).toEqual(['shown'])
      expect(configParseCount()).toBe(parsesCached + 1)

      updateProbes(['sensors'], false)
      const readsOff = hidReadCount()
      const off = await takeSample(0)
      expect(off.probes.sensors).toBe(false)
      expect(off.system.temperatures).toBeUndefined()
      expect(off.system.fans).toBeUndefined()
      expect(off.system.thermal_state).toBeUndefined()
      expect(hidReadCount()).toBe(readsOff)
      expect(pageFulfillCount()).toBe(fulfills + 1)

      console.log(
        JSON.stringify({
          names: names(first),
          count: names(first).length,
          zero: (first.system.temperatures ?? []).filter((reading) => reading.celsius === 0).map((reading) => reading.name),
          negative: (first.system.temperatures ?? [])
            .filter((reading) => reading.celsius < 0)
            .map((reading) => reading.name),
          fans: first.system.fans === undefined ? 'omitted' : 'present',
          secondSetup: {
            parses: parsesAfter - parsesMid,
            managers: setupAfter.managers - setupMid.managers,
            clients: setupAfter.clients - setupMid.clients,
            reads: readsAfter - readsMid,
          },
          sensorsOffReads: hidReadCount() - readsOff,
        }),
      )
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})
