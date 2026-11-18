import { describe, expect, test } from 'bun:test'
import {
  LABEL, LINUX_STARTUP_SEC, UNIT, launchdHealth, renderPlist, renderServiceUnit,
  renderTimerUnit, sampleFreshness, systemdHealth,
} from './service.ts'

describe('launchd plist', () => {
  test('embeds label, absolute command, and interval', () => {
    const plist = renderPlist(['/usr/local/bin/sloppytop', 'record'], 3600)
    expect(plist).toContain(`<string>${LABEL}</string>`)
    expect(plist).toContain('<string>/usr/local/bin/sloppytop</string>')
    expect(plist).toContain('<string>record</string>')
    expect(plist).toContain('<integer>3600</integer>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
  })

  test('xml-escapes paths', () => {
    const plist = renderPlist(['/tmp/a&b/sloppytop', 'record'], 60)
    expect(plist).toContain('/tmp/a&amp;b/sloppytop')
  })
})

describe('systemd units', () => {
  test('service unit runs the command as oneshot', () => {
    const unit = renderServiceUnit(['/usr/local/bin/sloppytop', 'record'])
    expect(unit).toContain('Type=oneshot')
    expect(unit).toContain('ExecStart=/usr/local/bin/sloppytop record')
  })

  test('args with spaces are quoted', () => {
    const unit = renderServiceUnit(['/home/d k/.proto/bun', '/home/d k/src/index.ts', 'record'])
    expect(unit).toContain('ExecStart="/home/d k/.proto/bun" "/home/d k/src/index.ts" record')
  })

  test('timer unit fires seconds after startup, then on the interval', () => {
    const timer = renderTimerUnit(1800)
    expect(timer).toContain(`OnStartupSec=${LINUX_STARTUP_SEC}s`)
    expect(timer).toContain('AccuracySec=1s')
    expect(timer).toContain('OnUnitActiveSec=1800s')
    expect(timer).not.toContain('OnBootSec')
    expect(timer).toContain('WantedBy=timers.target')
    expect(UNIT).toBe('sloppytop-record')
  })
})

describe('recorder health', () => {
  const ok = (output: string) => ({ ok: true, output })

  test('launchd distinguishes an armed idle job from a running job and reports failed exits', () => {
    expect(launchdHealth(ok('\tstate = not running\n\tlast exit code = 7\n'))).toEqual({
      loaded: true, scheduler_state: 'armed', recorder_state: 'idle',
      last_run: { outcome: 'failed', exit_code: 7 },
    })
    expect(launchdHealth(ok('\tstate = running\n')).recorder_state).toBe('running')
    expect(launchdHealth(ok('\tstate = not running\n')).last_run).toBeUndefined()
    expect(launchdHealth(ok('\tlast terminating signal = Terminated: 15\n')).last_run).toEqual({ outcome: 'failed' })
    expect(launchdHealth({ ok: false, output: 'Could not find service', code: 113 }).scheduler_state).toBe('inactive')
    expect(launchdHealth({ ok: false, output: 'Permission denied', code: 113 }).scheduler_state).toBe('unknown')
  })

  test('systemd separates timer activity from failed oneshot execution', () => {
    const timer = ok('ActiveState=active\n')
    expect(systemdHealth(timer, ok('ActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=7\n')))
      .toEqual({
        loaded: true, scheduler_state: 'armed', recorder_state: 'idle',
        last_run: { outcome: 'failed', exit_code: 7 },
      })
    expect(systemdHealth(timer, ok('ActiveState=activating\nResult=success\n')).recorder_state).toBe('running')
    expect(systemdHealth(timer, ok('ActiveState=inactive\nResult=success\nExecMainStartTimestampMonotonic=0\n')).last_run)
      .toBeUndefined()
    expect(systemdHealth(timer, ok('ActiveState=inactive\nResult=success\nExecMainStartTimestampMonotonic=42\nExecMainCode=1\nExecMainStatus=0\n')).last_run)
      .toEqual({ outcome: 'success', exit_code: 0 })
    const unavailable = { ok: false, output: 'Failed to connect to bus' }
    expect(systemdHealth(unavailable, unavailable)).toEqual({
      loaded: false, scheduler_state: 'unknown', recorder_state: 'unknown',
    })
  })

  test('cadence comes from the recurring scheduler trigger, never the startup delay', () => {
    expect(launchdHealth(ok('\trun interval = 45 seconds\n')).cadence).toBe('45s')
    expect(launchdHealth(ok('\t\trun interval = 45 seconds\n')).cadence).toBeUndefined()
    const startup = 'TimersMonotonic={ OnStartupUSec=5s ; next_elapse=0 }\n'
    const repeat = 'TimersMonotonic={ OnUnitActiveUSec=1min 30s ; next_elapse=12h }\n'
    const cadence = (text: string) => systemdHealth(ok(startup + text), ok('')).cadence
    expect(cadence(repeat)).toBe('1min 30s')
    for (const text of ['', repeat + repeat, repeat + 'TimersCalendar=weekly', repeat.replace('1min 30s', 'infinity')]) {
      expect(cadence(text)).toBeUndefined()
    }
  })

  test('database freshness preserves zero without inventing an age for missing or future samples', () => {
    const last = '2026-11-18T12:00:00.000Z'
    const now = Date.parse(last)
    expect(sampleFreshness(last, now + 12_345)).toEqual({ last_successful_sample_at: last, sample_age_seconds: 12 })
    expect(sampleFreshness(last, now)).toEqual({ last_successful_sample_at: last, sample_age_seconds: 0 })
    expect(sampleFreshness(last, now - 1)).toEqual({ last_successful_sample_at: last })
    expect(sampleFreshness(undefined, now)).toEqual({})
  })
})
