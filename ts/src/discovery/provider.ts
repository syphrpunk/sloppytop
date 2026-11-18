import { spawnSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'

export const MAX_BYTES = 512 * 1024
export const MAX_ROWS = 4096
export const TIMEOUT_MS = 1500
export type Issue = 'denied' | 'missing' | 'timeout' | 'failed' | 'malformed' | 'clipped' | 'unsupported' | 'visibility'
export type DiscoveryStatus = 'ready' | 'empty' | 'unavailable' | 'partial' | 'truncated'
export interface Observation<T> {
  source: string
  observed_at: string
  platform: string
  status: DiscoveryStatus
  issues: Issue[]
  rows: T[]
}
export type Input = { text: string; clipped?: boolean } | { issue: Issue }
export type Parsed<T> = { rows: T[]; issues?: Issue[] }

export function observe<T>(
  source: string,
  input: Input,
  parse: (text: string) => Parsed<T>,
  platform = process.platform,
  now = new Date(),
): Observation<T> {
  const metadata = { source, platform, observed_at: now.toISOString() }
  if ('issue' in input) return { ...metadata, status: 'unavailable', issues: [input.issue], rows: [] }
  let parsed: Parsed<T>
  try { parsed = parse(input.text) } catch { parsed = { rows: [], issues: ['malformed'] } }
  const issues = new Set(parsed.issues)
  if (input.clipped || parsed.rows.length > MAX_ROWS) issues.add('clipped')
  const rows = parsed.rows.slice(0, MAX_ROWS)
  const status = issues.has('clipped') ? 'truncated'
    : issues.size ? rows.length ? 'partial' : 'unavailable'
      : rows.length ? 'ready' : 'empty'
  return { ...metadata, status, issues: [...issues], rows }
}

function errorIssue(error: unknown): Issue {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return 'missing'
  if (code === 'EACCES' || code === 'EPERM') return 'denied'
  if (code === 'ETIMEDOUT') return 'timeout'
  return 'failed'
}

function decode(bytes: Buffer, clipped: boolean): Input {
  if (!clipped) return { text: bytes.toString('utf8') }
  // Don't parse a partial final line as a real observation.
  return { text: bytes.subarray(0, bytes.lastIndexOf(10) + 1).toString('utf8'), clipped: true }
}

export function readLocal(path: string, limit = MAX_BYTES): Input {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    if (!fstatSync(fd).isFile()) return { issue: 'failed' }
    const bytes = Buffer.alloc(limit + 1)
    let used = 0
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null)
      if (!count) break
      used += count
    }
    return decode(bytes.subarray(0, Math.min(used, limit)), used > limit)
  } catch (error) {
    return { issue: errorIssue(error) }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Internal callers supply fixed numeric, read-only OS commands, never CLI input. */
export function localCommand(path: string, args: readonly string[]): Input {
  const result = spawnSync(path, args, {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    maxBuffer: MAX_BYTES, timeout: TIMEOUT_MS, killSignal: 'SIGKILL',
  })
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS') {
    return decode(result.stdout?.subarray(0, MAX_BYTES) ?? Buffer.alloc(0), true)
  }
  if (result.error) return { issue: errorIssue(result.error) }
  if (result.status !== 0) return { issue: /permission denied|operation not permitted/i.test(result.stderr.toString()) ? 'denied' : 'failed' }
  return decode(result.stdout.subarray(0, MAX_BYTES), result.stdout.length > MAX_BYTES)
}
