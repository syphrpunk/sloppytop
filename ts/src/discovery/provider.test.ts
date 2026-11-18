import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { localCommand, MAX_ROWS, observe, readLocal } from './provider.ts'

test('distinguishes empty, denied, missing, failed parsing, partial and clipped', () => {
  const parse = (text: string) => ({ rows: text.trim().split('\n').filter(Boolean) })
  const run = (input: Parameters<typeof observe>[1]) => observe('fixture', input, parse)
  expect(run({ text: '' }).status).toBe('empty')
  expect(run({ issue: 'denied' }).issues).toEqual(['denied'])
  expect(run({ issue: 'missing' }).status).toBe('unavailable')
  expect(observe('fixture', { text: '?' }, () => { throw Error() }).issues).toEqual(['malformed'])
  expect(observe('fixture', { text: 'ok' }, () => ({ rows: ['ok'], issues: ['malformed'] })).status).toBe('partial')
  const large = observe('fixture', { text: '' }, () => ({ rows: Array(MAX_ROWS + 1).fill('ok') }))
  expect(large.status).toBe('truncated')
  expect(large.rows.length).toBe(MAX_ROWS)
})

test('bounds file reads, excludes incomplete lines, and does not invoke a shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-provider-'))
  try {
    const file = join(dir, 'rows')
    writeFileSync(file, 'ok\npartial\n')
    expect(readLocal(file, 5)).toEqual({ text: 'ok\n', clipped: true })
    expect(readLocal(join(dir, 'missing'))).toEqual({ issue: 'missing' })
    expect(localCommand(join(dir, 'missing'), [])).toEqual({ issue: 'missing' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
