import { UNOBSERVED } from './sparkline.ts'

/** Descriptive threshold, not an inference about a historical timer schedule. */
export const HISTORY_GAP_SECONDS = 90 * 60

export function historyCoverage(
  rows: readonly { at: string; boot_changed_since_previous?: true }[],
  now = Date.now(),
) {
  const breaks: number[] = []
  const unobserved_intervals: {
    after: string; before: string; seconds: number; evidence: 'boot-change-observed' | 'unknown'
  }[] = []
  for (let i = 1; i < rows.length; i++) {
    const after = rows[i - 1]!.at
    const before = rows[i]!.at
    const seconds = (Date.parse(before) - Date.parse(after)) / 1000
    if (seconds <= HISTORY_GAP_SECONDS || !Number.isFinite(seconds)) continue
    breaks.push(i)
    unobserved_intervals.push({
      after, before, seconds,
      evidence: rows[i]!.boot_changed_since_previous ? 'boot-change-observed' : 'unknown',
    })
  }
  const last = rows.at(-1)
  const age = last ? now - Date.parse(last.at) : NaN
  return {
    breaks,
    coverage: {
      gap_threshold_seconds: HISTORY_GAP_SECONDS,
      unobserved_interval_marker: UNOBSERVED,
      ...(Number.isFinite(age) && age >= 0 ? { latest_sample_age_seconds: Math.floor(age / 1000) } : {}),
      unobserved_intervals,
    },
  }
}
