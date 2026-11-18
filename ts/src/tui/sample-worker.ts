import type { Sample } from '../sample.ts'
import type { DiscoveryDetail, Overview } from '../discovery/overview.ts'
import type { RecorderHealth } from './store.ts'
import type { summarizeTree } from '../monitor/workload.ts'

export type WorkerRequest = { kind: 'sample'; ms: number } | { kind: 'discovery'; section: 'overview' | 'connections' | 'dns' }
  | { kind: 'recorder' } | { kind: 'subtree'; pid: number; ms: number }
export type WorkerReply = { sample: Sample } | { overview: Overview } | { detail: DiscoveryDetail }
  | { recorder: RecorderHealth } | { subtree: ReturnType<typeof summarizeTree> } | { error: string }
const self = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void
  postMessage: (result: WorkerReply) => void
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'sample') {
      const { takeSample } = await import('../sample.ts')
      self.postMessage({ sample: await takeSample(data.ms) })
    } else if (data.kind === 'recorder') {
      const { readService } = await import('./store.ts')
      self.postMessage({ recorder: readService() })
    } else if (data.kind === 'subtree') {
      const { takeSample } = await import('../sample.ts')
      self.postMessage({ subtree: (await takeSample(data.ms, data.pid)).workload })
    } else {
      const { discoverDetail, discoverOverview } = await import('../discovery/overview.ts')
      if (data.section === 'overview') self.postMessage({ overview: await discoverOverview() })
      else self.postMessage({ detail: await discoverDetail(data.section) })
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'collector failed' })
  }
}
