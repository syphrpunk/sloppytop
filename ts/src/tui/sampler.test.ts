import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('startup trace accounts for only the first unpaused worker sample, without sample data', () => {
  const home = mkdtempSync(join(tmpdir(), 'st-sampler-'))
  try {
    // Set XDG_CONFIG_HOME at process launch so Bun workers inherit the sandbox too.
    execFileSync(process.execPath, ['-e', `
      import { createTuiSampler } from './sampler.ts'
      import { updateProbes } from '../store/config.ts'
      updateProbes(['sensors', 'power', 'gpu', 'swap'], false)
      const sampler = createTuiSampler()
      try {
        if (await sampler.tick({ paused: true, sampleMs: 0 })) throw new Error('paused sample')
        const first = await sampler.tick({ paused: false, sampleMs: 25 })
        if (!first?.processes.length || first.probes.swap || first.system.swap_total_bytes !== undefined
          || 'phasesMs' in first) throw new Error('unexpected sample')
        await sampler.tick({ paused: false, sampleMs: 0 })
      } finally { sampler.close() }
    `], {
      cwd: import.meta.dir,
      env: { ...process.env, XDG_CONFIG_HOME: home, SLOPPYTOP_TUI_STARTUP_TRACE: join(home, 'startup.json') },
      timeout: 45_000,
    })
    const report = JSON.parse(readFileSync(join(home, 'startup.json'), 'utf8'))
    expect(Object.keys(report).sort()).toEqual(['outsideWorkerMs', 'phasesMs', 'requestMs', 'requestedWindowMs'])
    expect(report.requestedWindowMs).toBe(25)
    expect(Object.keys(report.phasesMs)).toEqual(['import', 'config', 'platform', 'firstRefresh', 'window', 'secondRefresh', 'projectAndLog'])
    const phases = Object.values(report.phasesMs) as number[]
    expect(phases.every(ms => Number.isFinite(ms) && ms >= 0)).toBe(true)
    expect(report.requestMs).toBeCloseTo(phases.reduce((total, ms) => total + ms, report.outsideWorkerMs))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}, 60_000)
