import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeOverview } from '../discovery/overview.ts'
import { observe } from '../discovery/provider.ts'
import { runArtifact } from './artifacts.ts'

test('discovery export allows counts only, refuses overwrite, and compares saved snapshots', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-artifact-'))
  try {
    const before = join(dir, 'before.json'), after = join(dir, 'after.json')
    const at = new Date('2026-11-18T00:00:00Z')
    const empty = composeOverview([], [], [], [], 'private-scope', at)
    const cache = observe('private-provider', { text: '' }, () => ({ rows: [{
      interface: 'private-interface', family: 4 as const, address: '192.0.2.10', state: 'stale',
    }] }), 'linux', at)
    const observed = composeOverview([], [], [cache], [], 'private-scope', at)
    await runArtifact({ kind: 'discovery', path: before, overview: empty })
    await runArtifact({ kind: 'discovery', path: after, overview: observed })
    const raw = readFileSync(after, 'utf8')
    expect(raw).not.toContain('private-')
    expect(raw).not.toContain('192.0.2.10')
    await expect(runArtifact({ kind: 'discovery', path: after, overview: empty })).rejects.toThrow('nothing overwritten')
    expect(readFileSync(after, 'utf8')).toBe(raw)
    const result = JSON.parse((await runArtifact({ kind: 'compare', before, after })).join('\n'))
    expect(result.sections.find((row: { section: string }) => row.section === 'neighbors').visible_delta).toBe(1)
    writeFileSync(join(dir, 'raw.json'), JSON.stringify(observed))
    await expect(runArtifact({ kind: 'compare', before, after: join(dir, 'raw.json') })).rejects.toThrow('not one of each')
    await expect(runArtifact({ kind: 'compare', before, after: dir })).rejects.toThrow('could not read')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
