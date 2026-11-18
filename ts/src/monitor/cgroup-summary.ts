import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface Source {
  read(path: string): string | undefined
  identity(path: string): string | undefined
  now(): number
  wait(ms: number): Promise<unknown>
}

const linuxSource: Source = {
  read(path) {
    try { return readFileSync(path, 'utf8') } catch { return undefined }
  },
  identity(path) {
    try {
      const s = statSync(path, { bigint: true })
      if (s.isDirectory()) return `${s.dev}:${s.ino}`
    } catch { return undefined }
  },
  now: () => performance.now(),
  wait: (ms) => Bun.sleep(ms),
}

function validPath(path: string) {
  return path.startsWith('/') && !path.split('/').some((part) => part === '.' || part === '..')
}

function mountPath(text: string, group: string): string | undefined {
  const decode = (path: string) => path.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)))
  let best: { root: string; path: string } | undefined
  for (const line of text.split('\n')) {
    const [fields, fs] = line.split(' - ')
    if (!fs?.startsWith('cgroup2 ')) continue
    const [, , , rawRoot, rawMount] = fields!.split(' ')
    if (!rawRoot || !rawMount) continue
    const root = decode(rawRoot)
    const mount = decode(rawMount)
    if (!validPath(root) || !validPath(mount)) continue
    if (root !== '/' && group !== root && !group.startsWith(`${root}/`)) continue
    if (!best || root.length > best.root.length) best = { root, path: join(mount, group.slice(root.length)) }
  }
  return best?.path
}

function counter(raw: string | undefined): bigint | undefined {
  if (raw && /^\d+$/.test(raw)) return BigInt(raw)
}

/** Read only the target PID's placement and the kernel's hierarchical counters. */
export async function summarizeCgroup(pid: number, ms: number, source = linuxSource) {
  const proc = `/proc/${pid}`
  const readPlacement = () => {
    const stat = source.read(`${proc}/stat`)
    const start = stat?.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
    const group = source.read(`${proc}/cgroup`)?.match(/^0::(\/[^\n]*)$/m)?.[1]
    if (start && /^\d+$/.test(start) && group && validPath(group)) return { start, group }
  }
  const first = readPlacement()
  if (!first) return
  const path = mountPath(source.read('/proc/self/mountinfo') ?? '', first.group)
  const id = path && source.identity(path)
  if (!path || !id) return
  const same = () => {
    const placement = readPlacement()
    return placement?.group === first.group && placement.start === first.start && source.identity(path) === id
  }
  const usage = () => counter(source.read(join(path, 'cpu.stat'))?.match(/^usage_usec\s+(\d+)$/m)?.[1])
  const before = usage()
  const start = source.now()
  if (!same()) return
  await source.wait(ms)
  const after = usage()
  const elapsed = source.now() - start
  const memory = counter(source.read(join(path, 'memory.current'))?.trim())
  if (!same()) return
  const cpu = before !== undefined && after !== undefined && after >= before && elapsed > 0
    ? Number(after - before) / (elapsed * 10)
    : undefined
  return {
    pid,
    cgroup: first.group,
    scope: 'cgroup_and_descendants',
    ...(cpu !== undefined && Number.isFinite(cpu) ? { cpu_percent_of_one_core: Math.round(cpu * 100) / 100 } : {}),
    ...(memory !== undefined && memory <= BigInt(Number.MAX_SAFE_INTEGER) ? { charged_memory_bytes: Number(memory) } : {}),
  }
}
