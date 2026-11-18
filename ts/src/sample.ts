// One sample path for commands and the screen: probe flags, field projection, probe log.

import { snapshot, type SampleCheckpoint } from './monitor/index.ts'
import { collectFlags, probeEntries, projectProcesses, projectSystem, type ProbeSet } from './monitor/probes.ts'
import type { ProcessInfo, SystemStats } from './monitor/types.ts'
import { loadConfig } from './store/config.ts'
import { appendProbeLog } from './store/probe-log.ts'

export interface RecordableSample {
  system: SystemStats
  processes: ProcessInfo[]
  /** Internal metadata for comparing Linux OOM counts across stored samples. */
  linuxBootId?: string
}

export interface Sample extends RecordableSample {
  probes: ProbeSet
}

/** Sample, drop disabled probe fields, and append one probe-log line per enabled probe. */
export async function takeSample(sampleMs: number, workloadRootPid?: number, checkpoint?: SampleCheckpoint): Promise<Sample & {
  workload?: NonNullable<Awaited<ReturnType<typeof snapshot>>['workload']>
}> {
  const probes = loadConfig().probes
  checkpoint?.('config')
  const snap = await snapshot(sampleMs, collectFlags(probes), probes.processes ? workloadRootPid : undefined, checkpoint)
  const system = projectSystem(snap.system, probes)
  const processes = projectProcesses(snap.processes, probes)
  appendProbeLog(probeEntries(system, processes, probes))
  return {
    system, processes, probes,
    ...(snap.linuxBootId ? { linuxBootId: snap.linuxBootId } : {}),
    ...(snap.workload ? { workload: snap.workload } : {}),
  }
}
