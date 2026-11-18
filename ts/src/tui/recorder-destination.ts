import { randomUUID } from 'node:crypto'
import { sampleFreshness } from '../store/service.ts'
import { loadConfig } from '../store/config.ts'
import { confirmRecorderDestination, previewRecorderDestination, type RecorderDestinationPreview, type RecorderLocation } from '../store/destination.ts'

export type DestinationRequest = { kind: 'preview'; path: string | null } | { kind: 'confirm'; id: string }
export type DestinationReply = { kind: 'review'; id: string; preview: RecorderDestinationPreview }
  | { kind: 'verified'; location: RecorderLocation; freshness: ReturnType<typeof sampleFreshness> } | { kind: 'unverified'; message: string }

// The backend authorizes only its original preview object. Keep it in the worker;
// never rebuild it from a renderer message (or silently preview again on confirm).
let pending: { id: string; path: string | null; preview: RecorderDestinationPreview } | undefined
export function handleDestination(request: DestinationRequest): DestinationReply {
  const previous = pending
  pending = undefined
  if (request.kind === 'preview') {
    const preview = previewRecorderDestination(request.path)
    const id = randomUUID()
    pending = { id, path: request.path, preview }
    return { kind: 'review', id, preview }
  }
  if (!previous || previous.id !== request.id) throw new Error('Preview expired; preview again')
  confirmRecorderDestination(previous.preview)
  try {
    const location = previewRecorderDestination(previous.path).current
    if (location.path !== previous.preview.target.path || loadConfig().record.databasePath !== (previous.path ?? undefined)) {
      throw new Error('Configured destination differs from the reviewed target')
    }
    return { kind: 'verified', location, freshness: sampleFreshness(location.last) }
  } catch (err) {
    return { kind: 'unverified', message: err instanceof Error ? err.message : 'Readback unavailable' }
  }
}
