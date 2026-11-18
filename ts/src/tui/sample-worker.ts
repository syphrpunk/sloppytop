import { takeSample, type Sample } from '../sample.ts'
import { discoverDetail, discoverOverview, type DiscoveryDetail, type Overview } from '../discovery/overview.ts'

export type WorkerRequest = { kind: 'sample'; ms: number } | { kind: 'discovery'; section: 'overview' | 'connections' | 'dns' }
export type WorkerReply = { sample: Sample } | { overview: Overview } | { detail: DiscoveryDetail } | { error: string }
const self = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void
  postMessage: (result: WorkerReply) => void
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'sample') self.postMessage({ sample: await takeSample(data.ms) })
    else if (data.section === 'overview') self.postMessage({ overview: await discoverOverview() })
    else self.postMessage({ detail: await discoverDetail(data.section) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'collector failed' })
  }
}
