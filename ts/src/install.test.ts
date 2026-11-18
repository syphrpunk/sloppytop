import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installBinary } from '../install.ts'

test.skipIf(process.platform === 'win32')('installs st only when destination, PATH, and shell are clear', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloppytop-install-'))
  try {
    const bin = join(root, 'bin'), other = join(root, 'other'), source = join(root, 'source')
    mkdirSync(bin)
    mkdirSync(other)
    const shell = join(root, 'shell')
    const env = { HOME: root, PATH: `${bin}:${other}`, SHELL: shell }
    writeFileSync(source, 'one')
    writeFileSync(shell, '#!/bin/sh\nexit 44\n', { mode: 0o755 })
    expect(installBinary(source, bin, env).shortcut).toBe(join(bin, 'st'))
    expect(readlinkSync(join(bin, 'st'))).toBe('sloppytop')
    writeFileSync(source, 'two')
    expect(installBinary(source, bin, env).shortcut).toBe('already installed')
    expect(readFileSync(join(bin, 'st'), 'utf8')).toBe('two')
    rmSync(join(bin, 'st'))
    symlinkSync('nonexistent', join(bin, 'st'))
    expect(installBinary(source, bin, env).shortcut).toContain('occupied')
    expect(readlinkSync(join(bin, 'st'))).toBe('nonexistent')
    rmSync(join(bin, 'st'))
    writeFileSync(join(other, 'st'), 'unrelated', { mode: 0o755 })
    expect(installBinary(source, bin, env).shortcut).toContain('PATH')
    rmSync(join(other, 'st'))
    writeFileSync(shell, '#!/bin/sh\nexit 43\n')
    expect(installBinary(source, bin, env).shortcut).toContain('already exists in the login shell')
    expect(installBinary(source, bin, { ...env, SHELL: '/nonexistent' }).shortcut).toContain('could not verify')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
