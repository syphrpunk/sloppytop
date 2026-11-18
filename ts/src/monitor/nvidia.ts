import type { NvidiaDevice } from './types.ts'

const MIB = 1024 ** 2
const OUTPUT_LIMIT = 32 * 1024
const FIELDS = 'uuid,driver_version,utilization.gpu,memory.used,memory.total'

export function parseNvidiaDevices(stdout: string): NvidiaDevice[] {
  const devices = new Map<string, NvidiaDevice>()
  const number = (field: string | undefined, limit: number) => {
    if (!field || !/^\d+$/.test(field)) return
    const n = Number(field)
    if (Number.isSafeInteger(n) && n <= limit) return n
  }
  for (const line of stdout.split('\n')) {
    const [uuid, driver, busy, used, total, extra] = line.split(',').map((field) => field.trim())
    if (!uuid || !/^GPU-[\da-f-]+$/i.test(uuid) || !driver || !/^\d+(\.\d+)+$/.test(driver) || extra !== undefined) continue
    const utilization = number(busy, 100)
    const usedMiB = number(used, Math.floor(Number.MAX_SAFE_INTEGER / MIB))
    const totalMiB = number(total, Math.floor(Number.MAX_SAFE_INTEGER / MIB))
    if (utilization === undefined && usedMiB === undefined && totalMiB === undefined) continue
    devices.set(uuid, {
      uuid, driver_version: driver,
      ...(utilization !== undefined ? { utilization_percent: utilization } : {}),
      ...(usedMiB !== undefined ? { vram_used_bytes: usedMiB * MIB } : {}),
      ...(totalMiB !== undefined ? { vram_total_bytes: totalMiB * MIB } : {}),
    })
  }
  return [...devices.values()]
}

export class NvidiaProbe {
  #pending = false

  constructor(private readonly executable = 'nvidia-smi', private readonly timeoutMs = 250) {}

  /** Return a getter immediately. It yields only results from this window. */
  start(): () => NvidiaDevice[] | undefined {
    let result: NvidiaDevice[] | undefined
    const get = () => result
    // A SIGKILLed task can stay in a driver call; never accumulate more children.
    if (this.#pending) return get
    const launch = () => Bun.spawn([this.executable, `--query-gpu=${FIELDS}`, '--format=csv,noheader,nounits'], {
        stdin: 'ignore', stdout: 'pipe', stderr: 'ignore',
      })
    let child: ReturnType<typeof launch>
    try {
      child = launch()
    } catch {
      return get
    }
    this.#pending = true
    const reader = child.stdout.getReader()
    let failed = false
    let done = false
    const stop = () => {
      clearTimeout(timer)
      failed = true
      void reader.cancel().catch(() => {})
      child.kill('SIGKILL')
      child.unref()
    }
    const timer = setTimeout(stop, this.timeoutMs)
    const read = async () => {
      let bytes = 0
      let stdout = ''
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return stdout + decoder.decode()
        bytes += value.byteLength
        if (bytes > OUTPUT_LIMIT) {
          stop()
          return ''
        }
        stdout += decoder.decode(value, { stream: true })
      }
    }
    void Promise.allSettled([read().catch(() => { if (!failed) stop() }), child.exited]).then(([output, exit]) => {
      done = true
      this.#pending = false
      clearTimeout(timer)
      if (failed || exit.status !== 'fulfilled' || exit.value !== 0 || output.status !== 'fulfilled' || !output.value) return
      const parsed = parseNvidiaDevices(output.value)
      if (parsed.length) result = parsed
    })
    return () => {
      if (!done && !failed) stop()
      return get()
    }
  }
}

const probe = new NvidiaProbe()

export function startNvidiaSample(gpu = true) {
  if (gpu && process.platform === 'linux' && process.env['SLOPPYTOP_NVIDIA'] === '1') return probe.start()
  return () => undefined
}
