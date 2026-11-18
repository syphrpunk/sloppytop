import { defaultProbes, projectSystem, type ProbeName } from '../monitor/probes.ts'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'

/** Only optional probes with SQLite fields. Core CPU/memory/disk/network/host are never choices here. */
export const OPTIONAL_RECORD_GROUPS = ['processes', 'power', 'sensors', 'pressure', 'battery', 'swap'] as const satisfies readonly ProbeName[]
export type OptionalRecordGroup = (typeof OPTIONAL_RECORD_GROUPS)[number]
export type RecordGroups = Record<OptionalRecordGroup, boolean>

/** Only an explicit false opts out. Old configs and newly added groups retain existing behavior. */
export function parseRecordGroups(raw?: unknown): RecordGroups {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return Object.fromEntries(OPTIONAL_RECORD_GROUPS.map(group => [group, input[group] !== false])) as RecordGroups
}

/** Project the already-collected sample for this insert, not for sampling, probe logs or live metrics. */
export function projectRecordGroups(system: SystemStats, processes: ProcessInfo[], groups?: Partial<RecordGroups>) {
  const mask = defaultProbes()
  for (const group of OPTIONAL_RECORD_GROUPS) mask[group] = groups?.[group] !== false
  return { system: projectSystem(system, mask), processes: mask.processes ? processes : [] }
}
