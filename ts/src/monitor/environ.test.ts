import { expect, test } from 'bun:test'
import { readEnvBlock } from './environ.ts'

test('names mode decodes only the prefix before the first equals, skipping malformed entries', () => {
  // Synthetic bytes only; no process lookup or environment input.
  const bytes = new TextEncoder().encode('FIXTURE_A===\0malformed\0=\0FIXTURE_B=\0')
  expect(readEnvBlock(bytes, 'names')).toEqual(['FIXTURE_A', 'FIXTURE_B'])
  expect(readEnvBlock(new Uint8Array(), 'names')).toEqual([])
})
