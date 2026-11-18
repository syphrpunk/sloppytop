import { takeSample, type Sample } from '../sample.ts'

export type SampleReply = { sample: Sample } | { error: string }
const self = globalThis as unknown as {
  onmessage: (event: MessageEvent<number>) => void
  postMessage: (result: SampleReply) => void
}
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ sample: await takeSample(data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'sample failed' })
  }
}
