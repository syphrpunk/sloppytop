import type { SamplePhase } from '../monitor/index.ts'
import type { Sample } from '../sample.ts'
import type { DiscoveryDetail, Overview } from '../discovery/overview.ts'
import type { RecorderHealth } from './store.ts'
import type { summarizeTree } from '../monitor/workload.ts'
import type { ReportView } from './state.ts'

export type WorkerRequest = { kind: 'sample'; ms: number; traceStartup?: true } | { kind: 'discovery'; section: 'overview' | 'connections' | 'dns' }
  | { kind: 'changeRecorder'; change: import('./recorder.ts').RecorderChange; command: string[] }
  | { kind: 'recorder' } | { kind: 'subtree'; pid: number; ms: number } | { kind: 'report' }
  | { kind: 'artifact'; input: import('./artifacts.ts').ArtifactRequest }
export type WorkerPhases = Partial<Record<SamplePhase, number>>
export type WorkerReply = { sample: Sample; phasesMs?: WorkerPhases } | { overview: Overview } | { detail: DiscoveryDetail }
  | { recorderMessage: string } | { recorder: RecorderHealth } | { subtree: ReturnType<typeof summarizeTree> } | { report: ReportView }
  | { artifact: string[] } | { error: string }
const self = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void
  postMessage: (result: WorkerReply) => void
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'sample') {
      let last = data.traceStartup ? performance.now() : 0
      const phasesMs: WorkerPhases | undefined = data.traceStartup ? {} : undefined
      const checkpoint = phasesMs && ((phase: SamplePhase) => {
        const now = performance.now()
        phasesMs[phase] = now - last
        last = now
      })
      const { takeSample } = await import('../sample.ts')
      checkpoint?.('import')
      const sample = await takeSample(data.ms, undefined, checkpoint)
      checkpoint?.('projectAndLog')
      self.postMessage({ sample, ...(phasesMs && { phasesMs }) })
    } else if (data.kind === 'changeRecorder') {
      const { changeRecorder } = await import('./recorder.ts')
      const { recordSample } = await import('../store/record.ts')
      const { install, uninstall } = await import('../store/service.ts')
      self.postMessage({ recorderMessage: await changeRecorder(data.change, {
        platform: process.platform, record: recordSample, install: seconds => install(seconds, data.command), uninstall,
      }) })
    } else if (data.kind === 'recorder') {
      const { readService } = await import('./store.ts')
      self.postMessage({ recorder: readService() })
    } else if (data.kind === 'subtree') {
      const { takeSample } = await import('../sample.ts')
      self.postMessage({ subtree: (await takeSample(data.ms, data.pid)).workload })
    } else if (data.kind === 'report') {
      const { loadReport } = await import('./store.ts')
      self.postMessage({ report: loadReport() })
    } else if (data.kind === 'artifact') {
      const { runArtifact } = await import('./artifacts.ts')
      self.postMessage({ artifact: await runArtifact(data.input) })
    } else {
      const { discoverDetail, discoverOverview } = await import('../discovery/overview.ts')
      if (data.section === 'overview') self.postMessage({ overview: await discoverOverview() })
      else self.postMessage({ detail: await discoverDetail(data.section) })
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'collector failed' })
  }
}
