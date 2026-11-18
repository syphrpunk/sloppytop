// Scheduled metrics recorder — launchd user agent on macOS, systemd user
// timer on Linux. Both run `sloppytop record` on an interval with absolute
// paths (neither scheduler inherits a useful PATH). The Linux timer arms
// 5 seconds after the user service manager starts.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { dbPath, logPath } from './config.ts'

export const LABEL = 'com.syphrpunk.sloppytop.record'
export const LEGACY_LABEL = 'com.syphrpunk.neohtop.record'
export const UNIT = 'sloppytop-record'
export const LEGACY_UNIT = 'neohtop-record'

export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

const systemdUserDir = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user')
export const servicePath = () => join(systemdUserDir(), `${UNIT}.service`)
export const timerPath = () => join(systemdUserDir(), `${UNIT}.timer`)
const legacyPlistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LEGACY_LABEL}.plist`)
const legacyServicePath = () => join(systemdUserDir(), `${LEGACY_UNIT}.service`)
const legacyTimerPath = () => join(systemdUserDir(), `${LEGACY_UNIT}.timer`)

/** Scheduler name + identifier for the current platform (for display). */
export function scheduler(): { kind: 'launchd' | 'systemd'; name: string } {
  return process.platform === 'darwin'
    ? { kind: 'launchd', name: LABEL }
    : { kind: 'systemd', name: `${UNIT}.timer` }
}

function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Command line the scheduler should run. Compiled binaries embed their entry
 * as /$bunfs/... — then execPath alone IS the CLI; in dev, run
 * `<abs bun> <abs script> record`.
 */
export function recordCommand(): string[] {
  const entry = process.argv[1] ?? ''
  const compiled = entry.startsWith('/$bunfs')
  return compiled
    ? [process.execPath, 'record']
    : [process.execPath, resolve(entry), 'record']
}

export function renderPlist(args: string[], intervalSecs: number): string {
  const argXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSecs}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath())}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath())}</string>
</dict>
</plist>
`
}

/** systemd-style quoting: double-quote any arg with spaces/quotes/backslashes. */
function unitQuote(arg: string): string {
  if (!/[\s"'\\]/.test(arg)) return arg
  return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function renderServiceUnit(args: string[]): string {
  return `[Unit]
Description=sloppytop metrics recorder (one sample into ${dbPath()})

[Service]
Type=oneshot
ExecStart=${args.map(unitQuote).join(' ')}
StandardOutput=append:${logPath()}
StandardError=append:${logPath()}
`
}

/** Seconds after the user service manager starts before the first Linux sample. */
export const LINUX_STARTUP_SEC = 5

export function renderTimerUnit(intervalSecs: number): string {
  return `[Unit]
Description=Run the sloppytop metrics recorder every ${intervalSecs}s

[Timer]
OnStartupSec=${LINUX_STARTUP_SEC}s
OnUnitActiveSec=${intervalSecs}s
AccuracySec=1s

[Install]
WantedBy=timers.target
`
}

interface CommandResult {
  ok: boolean
  output: string
  code?: number
}

function run(cmd: string, args: string[], timeout?: number): CommandResult {
  try {
    const output = execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', timeout })
    return { ok: true, output }
  } catch (err) {
    const failure = err as { stderr?: string; status?: number }
    return { ok: false, output: failure.stderr ?? String(err), code: failure.status ?? undefined }
  }
}

const launchctl = (args: string[]) => run('launchctl', args)
const systemctl = (args: string[]) => run('systemctl', ['--user', ...args])

const domain = () => `gui/${process.getuid?.() ?? 501}`

export interface InstallResult {
  scheduler: 'launchd' | 'systemd'
  files: string[]
  command: string[]
}

function removeLegacyLaunchd(): boolean {
  launchctl(['bootout', `${domain()}/${LEGACY_LABEL}`])
  const path = legacyPlistPath()
  const existed = existsSync(path)
  rmSync(path, { force: true })
  return existed
}

function removeLegacySystemd(): boolean {
  const existed = existsSync(legacyServicePath()) || existsSync(legacyTimerPath())
  if (existed) systemctl(['disable', '--now', `${LEGACY_UNIT}.timer`])
  rmSync(legacyServicePath(), { force: true })
  rmSync(legacyTimerPath(), { force: true })
  return existed
}

export function install(intervalSecs: number): InstallResult {
  const command = recordCommand()
  if (process.platform === 'darwin') {
    removeLegacyLaunchd()
    const path = plistPath()
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(path, renderPlist(command, intervalSecs))
    launchctl(['bootout', `${domain()}/${LABEL}`]) // ignore failure — may not be loaded
    const boot = launchctl(['bootstrap', domain(), path])
    if (!boot.ok) throw new Error(`launchctl bootstrap failed: ${boot.output}`)
    return { scheduler: 'launchd', files: [path], command }
  }
  if (process.platform === 'linux') {
    mkdirSync(systemdUserDir(), { recursive: true })
    writeFileSync(servicePath(), renderServiceUnit(command))
    writeFileSync(timerPath(), renderTimerUnit(intervalSecs))
    removeLegacySystemd()
    const reload = systemctl(['daemon-reload'])
    if (!reload.ok) throw new Error(`systemctl daemon-reload failed: ${reload.output}`)
    const enable = systemctl(['enable', '--now', `${UNIT}.timer`])
    if (!enable.ok) throw new Error(`systemctl enable failed: ${enable.output}`)
    return { scheduler: 'systemd', files: [servicePath(), timerPath()], command }
  }
  throw new Error(`service install is not supported on ${process.platform} (macOS + Linux only)`)
}

export function uninstall(): { scheduler: 'launchd' | 'systemd'; removed: boolean } {
  if (process.platform === 'darwin') {
    launchctl(['bootout', `${domain()}/${LABEL}`])
    const path = plistPath()
    const existed = existsSync(path) || existsSync(legacyPlistPath())
    rmSync(path, { force: true })
    removeLegacyLaunchd()
    return { scheduler: 'launchd', removed: existed }
  }
  if (process.platform === 'linux') {
    systemctl(['disable', '--now', `${UNIT}.timer`])
    const existed =
      existsSync(servicePath()) ||
      existsSync(timerPath()) ||
      existsSync(legacyServicePath()) ||
      existsSync(legacyTimerPath())
    rmSync(servicePath(), { force: true })
    rmSync(timerPath(), { force: true })
    removeLegacySystemd()
    systemctl(['daemon-reload'])
    return { scheduler: 'systemd', removed: existed }
  }
  throw new Error(`service uninstall is not supported on ${process.platform}`)
}

export interface StatusResult {
  scheduler: 'launchd' | 'systemd'
  installed: boolean
  loaded: boolean
  files: string[]
  scheduler_state: 'armed' | 'inactive' | 'unknown'
  recorder_state: 'running' | 'idle' | 'unknown'
  cadence?: string
  last_run?: { outcome: 'success' | 'failed'; exit_code?: number }
}

type JobHealth = Pick<StatusResult, 'loaded' | 'scheduler_state' | 'recorder_state' | 'last_run' | 'cadence'>

export function launchdHealth(print: CommandResult): JobHealth {
  if (!print.ok) {
    return {
      loaded: false,
      scheduler_state: print.code === 113 && /Could not find service/.test(print.output) ? 'inactive' : 'unknown',
      recorder_state: 'unknown',
    }
  }
  // Only read top-level job properties (resource and event sections also contain state).
  const state = /^\tstate = (.+)$/m.exec(print.output)?.[1]
  const exit = /^\tlast exit code = (-?\d+)$/m.exec(print.output)?.[1]
  const interval = /^\trun interval = ([1-9]\d*) seconds?$/m.exec(print.output)?.[1]
  const signalled = /^\tlast terminating signal = \S/m.test(print.output)
  return {
    loaded: true,
    scheduler_state: 'armed',
    ...(interval ? { cadence: `${interval}s` } : {}),
    recorder_state: state === 'running' ? 'running' : state ? 'idle' : 'unknown',
    ...(exit != null
      ? { last_run: { outcome: Number(exit) === 0 ? 'success' : 'failed', exit_code: Number(exit) } }
      : signalled ? { last_run: { outcome: 'failed' } } : {}),
  }
}

function properties(result: CommandResult) {
  if (!result.ok) return new Map<string, string>()
  return new Map(result.output.split('\n').flatMap((line) => {
    const pos = line.indexOf('=')
    return pos > 0 ? [[line.slice(0, pos), line.slice(pos + 1)] as const] : []
  }))
}

// systemctl show prints one property per timer expression. The startup trigger
// is not the recurring interval. Do not guess for mixed or unrecognized timers.
function systemdCadence(timer: CommandResult): string | undefined {
  if (!timer.ok || /^TimersCalendar=.+$/m.test(timer.output)) return
  const entries = timer.output.split('\n').filter(line => line.startsWith('TimersMonotonic='))
  let cadence: string | undefined
  for (const entry of entries) {
    const match = /^TimersMonotonic=\{ (OnStartupUSec|OnUnitActiveUSec)=([^;{}]+?) ; next_elapse=[^{}]* \}$/.exec(entry)
    if (!match) return
    if (match[1] === 'OnStartupUSec') continue
    if (cadence || !/^\d+(?:\.\d+)?(?:us|ms|s|min|h|d|w)(?: \d+(?:\.\d+)?(?:us|ms|s|min|h|d|w))*$/.test(match[2]!)) return
    cadence = match[2]
  }
  return cadence
}

export function systemdHealth(timer: CommandResult, service: CommandResult): JobHealth {
  const timerState = properties(timer).get('ActiveState')
  const cadence = systemdCadence(timer)
  const job = properties(service)
  const jobState = job.get('ActiveState')
  const result = job.get('Result')
  const exited = job.get('ExecMainCode') === '1' // CLD_EXITED, not killed or dumped
  const exit = job.get('ExecMainStatus')
  const hasRun = /^[1-9]\d*$/.test(job.get('ExecMainStartTimestampMonotonic') ?? '')
  return {
    loaded: timerState === 'active',
    ...(cadence ? { cadence } : {}),
    scheduler_state: timerState === 'active' ? 'armed'
      : timerState === 'inactive' || timerState === 'failed' ? 'inactive' : 'unknown',
    recorder_state: jobState === 'activating' || jobState === 'active' ? 'running'
      : jobState === 'inactive' || jobState === 'failed' ? 'idle' : 'unknown',
    ...(result && (result !== 'success' || (hasRun && exited))
      ? { last_run: {
          outcome: result === 'success' ? 'success' : 'failed',
          ...(exited && exit != null && /^\d+$/.test(exit) ? { exit_code: Number(exit) } : {}),
        } }
      : {}),
  }
}

/** Database freshness describes any successful insert, not only scheduled runs. */
export function sampleFreshness(last: string | undefined, now = Date.now()) {
  const timestamp = last && Date.parse(last)
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp <= now
    ? { last_successful_sample_at: last, sample_age_seconds: Math.floor((now - timestamp) / 1000) }
    : { ...(last ? { last_successful_sample_at: last } : {}) }
}

export function status(): StatusResult {
  if (process.platform === 'darwin') {
    const path = plistPath()
    const print = run('launchctl', ['print', `${domain()}/${LABEL}`], 3000)
    return { scheduler: 'launchd', installed: existsSync(path), ...launchdHealth(print), files: [path] }
  }
  if (process.platform === 'linux') {
    const timer = run('systemctl', ['--user', 'show', '-p', 'ActiveState,TimersMonotonic,TimersCalendar', `${UNIT}.timer`], 3000)
    const job = run('systemctl', ['--user', 'show', '-p', 'ActiveState,Result,ExecMainCode,ExecMainStatus,ExecMainStartTimestampMonotonic', `${UNIT}.service`], 3000)
    return {
      scheduler: 'systemd',
      installed: existsSync(servicePath()) && existsSync(timerPath()),
      ...systemdHealth(timer, job),
      files: [servicePath(), timerPath()],
    }
  }
  throw new Error(`service status is not supported on ${process.platform}`)
}
