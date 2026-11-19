import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTuiTrace } from './trace.ts'

test('a long run retains its worst stall after its percentile window wraps', () => {
  const root = mkdtempSync(join(tmpdir(), 'st-trace-'))
  try {
    const path = join(root, 'trace.json')
    const trace = startTuiTrace(path)!
    trace.since('loopLag', performance.now() - 1_000)
    for (let i = 0; i < 3600; i++) trace.since('loopLag', performance.now())
    trace.finish()
    const { loopLag: phase } = JSON.parse(readFileSync(path, 'utf8'))
    expect(phase.over50ms).toBe(1)
    expect(phase.count).toBe(3601)
    expect(phase.retained).toBe(3600)
    expect(phase.max).toBeGreaterThanOrEqual(1_000)
    expect(phase.p95).toBeLessThan(100)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
