import type { Database } from 'bun:sqlite'
import { historyCoverage } from '../view/history-coverage.ts'
import { dbInfo } from './db.ts'
import { reportAnomalies, reportLeaks } from './report.ts'
import { sampleFreshness, type StatusResult } from './service.ts'

/** Build from an allowlist, never from serialized report or scheduler objects. */
export function diagnosticReport(db: Database, since: string, status?: StatusResult) {
  const rows = db.query('SELECT at FROM system_samples WHERE at >= ? ORDER BY at, id').all(since) as { at: string }[]
  const anomalies = {
    io_pressure: 0,
    cpu_saturation: 0,
    memory_pressure: 0,
    kernel_oom_kill: 0,
  }
  for (const finding of reportAnomalies(db, since)) anomalies[finding.type]++
  return {
    version: 1,
    redacted: true,
    recorder: {
      ...sampleFreshness(dbInfo(db).last),
      ...(status ? {
        scheduler: status.scheduler,
        installed: status.installed,
        scheduler_state: status.scheduler_state,
        recorder_state: status.recorder_state,
        ...(status.last_run ? {
          last_run: {
            outcome: status.last_run.outcome,
            ...(status.last_run.exit_code !== undefined ? { exit_code: status.last_run.exit_code } : {}),
          },
        } : {}),
      } : {}),
    },
    coverage: {
      from: since,
      samples: rows.length,
      ...historyCoverage(rows).coverage,
    },
    findings: { anomalies, rss_growth_flags: reportLeaks(db, since).length },
  }
}
