import type { Sample } from '../sample.ts'
import type { SampleReply } from './sample-worker.ts'

export type SampleTick = (options: { paused: boolean; sampleMs: number }) => Promise<Sample | undefined>

export function createTuiSampler() {
  let worker: Worker | undefined
  let cancel: (() => void) | undefined
  return {
    async tick({ paused, sampleMs }: { paused: boolean; sampleMs: number }): Promise<Sample | undefined> {
      if (paused) return undefined
      if (cancel) throw new Error('sample already running')
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
        const timer = setTimeout(() => fail('sampling timed out'), sampleMs + 10_000)
        const onClose = () => fail('sampling worker exited')
        active.addEventListener('close', onClose)
        cancel = () => {
          finish()
          resolve(undefined)
        }
        active.onmessage = ({ data }: MessageEvent<SampleReply>) => {
          finish()
          if ('error' in data) reject(new Error(data.error))
          else resolve(data.sample)
        }
        active.onerror = (event) => {
          event.preventDefault()
          fail('sampling worker failed')
        }
        try {
          active.postMessage(sampleMs)
        } catch {
          fail('could not request sample')
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
