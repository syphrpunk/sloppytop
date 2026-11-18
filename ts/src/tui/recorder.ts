// Shared by the Settings reducer and its on-demand worker. Keep collector and
// scheduler imports out of the reducer's startup path.
import type { RecorderHealth } from './store.ts'

export type RecorderChange = { kind: 'disable' } | { kind: 'enable' | 'cadence'; seconds: number }

export function validRecorderInterval(seconds: number): boolean {
  return Number.isSafeInteger(seconds) && seconds >= 60
}

// systemctl may render 3660 seconds as "1h 1min". Compare only known units;
// missing or unfamiliar scheduler output is not proof that the write took.
export function recorderMatches(change: RecorderChange, service: RecorderHealth['service']): boolean {
  if (!service) return false
  if (change.kind === 'disable') return !service.installed && service.scheduler_state === 'inactive'
  if (!service.installed || service.scheduler_state !== 'armed' || !service.cadence) return false
  const units: Record<string, number> = { us: .000001, ms: .001, s: 1, min: 60, h: 3600, d: 86400, w: 604800 }
  let seconds = 0
  for (const part of service.cadence.split(' ')) {
    const m = /^(\d+(?:\.\d+)?)(us|ms|s|min|h|d|w)$/.exec(part)
    if (!m) return false
    seconds += Number(m[1]) * units[m[2]!]!
  }
  return seconds === change.seconds
}

interface RecorderDeps {
  platform: string
  record: () => Promise<{ sample_id: number; db_path: string }>
  install: (seconds: number) => void
  uninstall: () => void
}

const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err)

/** Like service install: commit one sample first. Never undo it or retry a partial install. */
export async function changeRecorder(change: RecorderChange, deps: RecorderDeps): Promise<string> {
  if (!['linux', 'darwin'].includes(deps.platform)) return `Recorder controls unsupported on ${deps.platform}.`
  if (change.kind === 'disable') {
    try {
      deps.uninstall()
      return 'Requested recorder removal.'
    } catch (err) {
      return `Recorder removal failed: ${errorMessage(err)}`
    }
  }
  if (!validRecorderInterval(change.seconds)) return 'Invalid interval: enter whole seconds (at least 60).'
  let stored: Awaited<ReturnType<RecorderDeps['record']>>
  try {
    stored = await deps.record()
  } catch (err) {
    return `Record failed; scheduler not changed: ${errorMessage(err)}`
  }
  const receipt = `Sample ${stored.sample_id} stored at ${stored.db_path}.`
  try {
    deps.install(change.seconds)
    return `${receipt} Requested cadence: ${change.seconds}s.`
  } catch (err) {
    return `${receipt} Scheduler install failed: ${errorMessage(err)}`
  }
}
