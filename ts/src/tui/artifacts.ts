import { writeFileSync } from 'node:fs'
import { compareSnapshotFiles } from '../discovery/snapshot.ts'
import { shareableOverview } from '../discovery/redact.ts'
import type { Overview } from '../discovery/overview.ts'

export type ArtifactRequest =
  | { kind: 'compare'; before: string; after: string }
  | { kind: 'discovery'; path: string; overview: Overview }
  | { kind: 'diagnostic'; path: string }

export async function runArtifact(input: ArtifactRequest): Promise<string[]> {
  if (input.kind === 'compare') {
    return JSON.stringify(compareSnapshotFiles(input.before, input.after), null, 2).split('\n')
  }
  const data = input.kind === 'discovery' ? shareableOverview(input.overview)
    : (await import('./store.ts')).loadDiagnostic()
  try {
    writeFileSync(input.path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('destination already exists; nothing overwritten')
    throw new Error('could not write the redacted export')
  }
  return ['redacted JSON saved']
}
