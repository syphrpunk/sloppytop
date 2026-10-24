import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../..', import.meta.url))
const entry = join(root, 'ts', 'src', 'index.ts')
const formats = ['toon', 'json', 'yaml', 'md', 'jsonl'] as const

const domainCodes = [
  'PROBE_DISABLED',
  'BAD_FILTER',
  'BAD_PROBE',
  'HARDWARE_UNAVAILABLE',
  'NET_UNAVAILABLE',
  'LISTEN_UNAVAILABLE',
  'METRICS_DISABLED',
  'METRICS_BIND_FAILED',
  'SIGNAL_FAILED',
  'INSTALL_FAILED',
  'UNINSTALL_FAILED',
  'STATUS_FAILED',
  'NOT_FOUND',
  'NO_DATA',
]

const commands: { id: string; args: string[] }[] = [
  { id: 'hardware', args: ['hardware'] },
  { id: 'system', args: ['system', '--sample-ms', '0'] },
  { id: 'net', args: ['net', '--sample-ms', '100', '--limit', '1'] },
  { id: 'listen', args: ['listen'] },
  { id: 'processes', args: ['processes', '--sample-ms', '0', '--limit', '1'] },
  { id: 'top', args: ['top', '--sample-ms', '0', '--count', '1'] },
  { id: 'tree', args: ['tree', '--sample-ms', '0'] },
  { id: 'proc', args: ['proc', '1'] },
  { id: 'snapshot', args: ['snapshot', '--sample-ms', '0'] },
  { id: 'watch', args: ['watch', '--count', '1', '--interval-ms', '100', '--limit', '1'] },
  { id: 'record', args: ['record'] },
  { id: 'history', args: ['history', '--limit', '1'] },
  { id: 'report', args: ['report'] },
  { id: 'config', args: ['config'] },
  { id: 'probe-list', args: ['probe', 'list'] },
  { id: 'probe-enable', args: ['probe', 'enable', 'sensors'] },
  { id: 'probe-disable', args: ['probe', 'disable', 'sensors'] },
  { id: 'probe-enable-again', args: ['probe', 'enable', 'sensors'] },
  { id: 'log', args: ['log', '--limit', '1'] },
  { id: 'log-bad', args: ['log', '--probe', 'not-a-probe', '--limit', '1'] },
  { id: 'metrics-serve', args: ['metrics', 'serve'] },
  { id: 'metrics-disable', args: ['metrics', 'disable'] },
  { id: 'metrics-enable', args: ['metrics', 'enable'] },
  { id: 'metrics-disable-again', args: ['metrics', 'disable'] },
  { id: 'service-install-help', args: ['service', 'install', '--help'] },
  { id: 'service-uninstall-help', args: ['service', 'uninstall', '--help'] },
  { id: 'service-status', args: ['service', 'status'] },
  { id: 'tui-help', args: ['tui', '--help'] },
  { id: 'kill-absent', args: ['kill', '2147483646'] },
]

function isUsage(stdout: string): boolean {
  return stdout.startsWith('sloppytop ') && stdout.includes('\nUsage:')
}

function classify(format: (typeof formats)[number], status: number | null, stdout: string, stderr: string) {
  const text = `${stdout}\n${stderr}`
  const code = domainCodes.find((item) => text.includes(item))
  const uncaught = /TypeError:|SyntaxError:|ReferenceError:|Unhandled/.test(text)
  if (status === 0 && isUsage(stdout)) return { kind: 'ok' as const, detail: 'help' }
  if (format === 'json' && !isUsage(stdout)) {
    try {
      JSON.parse(stdout)
    } catch {
      return { kind: 'bad' as const, detail: 'json did not parse' }
    }
  }
  if (status === 0) {
    if (uncaught) return { kind: 'bad' as const, detail: 'uncaught on success' }
    if (format === 'jsonl') {
      const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
      if (lines.length === 0) return { kind: 'bad' as const, detail: 'empty jsonl' }
      for (const line of lines) {
        try {
          JSON.parse(line)
        } catch {
          return { kind: 'bad' as const, detail: 'jsonl line did not parse' }
        }
      }
    } else if (format !== 'json' && stdout.trim().length === 0) {
      return { kind: 'bad' as const, detail: 'empty stdout' }
    }
    return { kind: 'ok' as const, detail: '' }
  }
  if (status === null) return { kind: 'bad' as const, detail: 'no exit' }
  if (uncaught || !code) return { kind: 'bad' as const, detail: code ? `uncaught ${code}` : `exit ${status}` }
  return { kind: 'domain' as const, detail: code }
}

describe('command formats', () => {
  test('each shipped command exits with a payload or a domain error', () => {
    const alive = spawnSync('ps', ['-p', '2147483646'], { encoding: 'utf8' })
    expect(alive.status).not.toBe(0)

    const home = mkdtempSync(join(tmpdir(), 'sloppytop-perm-'))
    mkdirSync(join(home, 'sloppytop'), { recursive: true })
    writeFileSync(join(home, 'sloppytop', 'config.json'), `${JSON.stringify({ record: { sampleMs: 0 } })}\n`)
    const lines: string[] = []
    try {
      for (const format of formats) {
        for (const command of commands) {
          const result = spawnSync(process.execPath, [entry, ...command.args, '--format', format], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, XDG_CONFIG_HOME: home },
            timeout: command.id === 'hardware' ? 180_000 : 90_000,
            maxBuffer: 64 * 1024 * 1024,
          })
          const outcome = classify(format, result.status, result.stdout ?? '', result.stderr ?? '')
          const line = `${command.id} ${format} ${outcome.kind}${outcome.detail ? ` ${outcome.detail}` : ''}`
          lines.push(line)
          if (outcome.kind === 'bad') {
            const stdout = (result.stdout ?? '').slice(0, 400)
            const stderr = (result.stderr ?? '').slice(0, 400)
            throw new Error(`${line}\nstdout: ${stdout}\nstderr: ${stderr}`)
          }
        }
      }
      console.log(lines.join('\n'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 600_000)
})
