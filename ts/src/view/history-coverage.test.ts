import { expect, test } from 'bun:test'
import { historyCoverage } from './history-coverage.ts'
import { sparkline } from './sparkline.ts'
import { historyView } from '../tui/store.ts'

test('describes hourly, bursty and mixed histories without inferring a timer failure', () => {
  const rows = (minutes: number[]) => minutes.map((minute) => ({
    at: new Date(Date.UTC(2026, 0, 1) + minute * 60_000).toISOString(),
    cpu_usage_total: 0, memory_used: 0, load_1: 0,
  }))
  for (const offsets of [[0, 60, 120], [0, 1, 2, 3], [0, 5, 65, 125]]) {
    expect(historyCoverage(rows(offsets)).breaks).toEqual([])
  }
  const overnight = rows([0, 5, 65, 600])
  const timeline = historyCoverage(overnight, Date.parse(overnight[3]!.at) + 60_000)
  expect(timeline.coverage.latest_sample_age_seconds).toBe(60)
  expect(timeline.coverage.unobserved_intervals).toEqual([{
    after: overnight[2]!.at, before: overnight[3]!.at, seconds: 535 * 60,
  }])
  const tui = historyView([...overnight].reverse())
  expect(tui.timeline?.breaks).toEqual(timeline.breaks)
  expect(sparkline([0, null, 0, 0], { breaks: timeline.breaks })).toBe('⠀⠂⠀╌⠀')
  expect(overnight).toHaveLength(4)
})
