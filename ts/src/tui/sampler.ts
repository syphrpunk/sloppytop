import type { Sample } from '../sample.ts'
import type { WorkerReply, WorkerRequest } from './sample-worker.ts'

export type SampleTick = (options: { paused: boolean; sampleMs: number }) => Promise<Sample | undefined>

export function createCollectorWorker() {
  let worker: Worker | undefined
  let cancel: (() => void) | undefined
  return {
    async request(request: WorkerRequest, timeoutMs: number): Promise<Exclude<WorkerReply, { error: string }> | undefined> {
      if (cancel) throw new Error('collector already running')
      // Standalone builds embed the second entrypoint under tui/ in Bun's virtual filesystem.
      const active = worker ??= new Worker(
        import.meta.url.includes('$bunfs')
          ? new URL('./tui/sample-worker.js', import.meta.url).href
          : new URL('./sample-worker.ts', import.meta.url).href,
      )
      return new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer)
          active.onmessage = null
          active.onerror = null
          active.removeEventListener('close', onClose)
          cancel = undefined
        }
        const fail = (message: string) => {
          finish()
          worker = undefined
          active.terminate()
          reject(new Error(message))
        }
        const timer = setTimeout(() => fail('collector timed out'), timeoutMs)
        const onClose = () => fail('collector worker exited')
        active.addEventListener('close', onClose)
        cancel = () => {
          finish()
          resolve(undefined)
        }
        active.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
          finish()
          if ('error' in data) reject(new Error(data.error))
          else resolve(data)
        }
        active.onerror = (event) => {
          event.preventDefault()
          fail('collector worker failed')
        }
        try {
          active.postMessage(request)
        } catch {
          fail('could not request collection')
        }
      })
    },
    close() {
      cancel?.()
      worker?.terminate()
      worker = undefined
    },
  }
}

export function createTuiSampler() {
  const worker = createCollectorWorker()
  return {
    async tick({ paused, sampleMs }: Parameters<SampleTick>[0]): Promise<Sample | undefined> {
      if (paused) return undefined
      const reply = await worker.request({ kind: 'sample', ms: sampleMs }, sampleMs + 10_000)
      return reply && 'sample' in reply ? reply.sample : undefined
    },
    close: worker.close,
  }
}
