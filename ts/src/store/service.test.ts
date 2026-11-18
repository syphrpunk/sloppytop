import { describe, expect, test } from 'bun:test'
import { LABEL, LINUX_STARTUP_SEC, UNIT, renderPlist, renderServiceUnit, renderTimerUnit } from './service.ts'

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
