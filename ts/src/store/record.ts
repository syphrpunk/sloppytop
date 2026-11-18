// One stored sample for `record` and `service install`. The scheduler is separate:
// a blocked probe must not leave an hourly job that fails every run.

import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { disabledRecordProbes } from '../monitor/probes.ts'
import { takeSample } from '../sample.ts'
import { dbPath, initConfig } from './config.ts'
import { insertSample, openDb } from './db.ts'

export class RecordBlocked extends Error {
  readonly blocked: string[]

  constructor(blocked: string[]) {
    super(`record needs these probes enabled: ${blocked.join(', ')}`)
    this.name = 'RecordBlocked'
    this.blocked = blocked
  }
}

export interface StoredSample {
  recorded: true
  sample_id: number
  at: string
  processes_stored: number
  pruned: number
  db_path: string
}

type Sampler = (sampleMs: number) => Promise<{ system: SystemStats; processes: ProcessInfo[] }>

/** Create config on first run, require the record probes, and insert one sample. */
export async function recordSample(take: Sampler = takeSample): Promise<StoredSample> {
  const config = initConfig()
  const blocked = disabledRecordProbes(config.probes)
  if (blocked.length > 0) throw new RecordBlocked(blocked)
  const { system, processes } = await take(config.record.sampleMs)
  const db = openDb()
  try {
    const at = new Date().toISOString()
    const result = insertSample(db, at, system, processes, config.record)
    return {
      recorded: true,
      sample_id: result.sampleId,
      at,
      processes_stored: result.processesStored,
      pruned: result.pruned,
      db_path: dbPath(),
    }
  } finally {
    db.close()
  }
}
