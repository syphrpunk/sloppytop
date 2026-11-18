import { writeFileSync } from 'node:fs'

/** Optional timing-only diagnostics; never serialize screen or sample data. */
export function startTuiTrace(path = process.env.SLOPPYTOP_TUI_TRACE) {
  if (!path) return undefined
  const capacity = 3600
  const phases = new Map<string, { count: number; max: number; values: number[] }>()
  function record(name: string, duration: number) {
    let phase = phases.get(name)
    if (!phase) {
      phase = { count: 0, max: 0, values: [] }
      phases.set(name, phase)
    }
    phase.values[phase.count++ % capacity] = duration
    phase.max = Math.max(phase.max, duration)
  }
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    record('loopLag', Math.max(0, now - last - 20))
    last = now
  }, 20)
  timer.unref()
  return {
    since(name: string, start: number) {
      record(name, performance.now() - start)
    },
    finish() {
      clearInterval(timer)
      const summary = Object.fromEntries([...phases].map(([name, { count, max, values }]) => {
        values.sort((a, b) => a - b)
        const percentile = (p: number) => Number(values[Math.ceil(values.length * p) - 1]!.toFixed(2))
        return [name, { count, retained: values.length, p50: percentile(.50), p95: percentile(.95), max: Number(max.toFixed(2)) }]
      }))
      try {
        writeFileSync(path, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
      } catch {
        // Diagnostics must not prevent exiting or restoring the terminal.
      }
    },
  }
}
