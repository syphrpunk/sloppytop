import { describe, expect, test } from 'bun:test'
import type { ProcessInfo } from '../monitor/types.ts'
import { buildProcessTree } from './tree.ts'
import { processTreeIdentity, projectProcessTree } from './tree-projection.ts'

function proc(pid: number, ppid: number, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid, ppid, name: `p${pid}`, user: 'u', command: `p${pid} --arg`, status: 'Running',
    cpu_usage: 0, memory_bytes: 0, runtime_secs: 30, disk_read_bytes: 0, disk_write_bytes: 0,
    ...extra,
  }
}

// 10 → {20 → {30 → 40, 50}, 60}; 70 is a separate root.
const forest = [proc(70, 0), proc(10, 0), proc(60, 10), proc(30, 20), proc(20, 10), proc(50, 20), proc(40, 30)]
const tree = buildProcessTree(forest)
const key = (pid: number) => processTreeIdentity(forest.find((p) => p.pid === pid)!)

describe('projectProcessTree', () => {
  test('expanded rows preserve prefixes, parent keys and counts for the displayed input', () => {
    const { rows, focus } = projectProcessTree(tree, new Set(), key(40))
    expect(rows.map((r) => r.proc)).toEqual(tree)
    expect(rows.map((r) => r.descendantCount)).toEqual([5, 3, 1, 0, 0, 0, 0])
    expect(rows.every((r) => r.hiddenCount === 0)).toBe(true)
    expect(rows.map((r) => r.parentIdentity)).toEqual([null, key(10), key(20), key(30), key(20), key(10), null])
    expect(focus?.identity).toBe(key(40))
  })

  test('collapse resolves hidden focus to the visible ancestor; expansion restores nested state', () => {
    const collapsed = new Set([key(30), key(20)])
    const outer = projectProcessTree(tree, collapsed, key(40))
    expect(outer.rows.map((r) => r.proc.pid)).toEqual([10, 20, 60, 70])
    expect(outer.rows.map((r) => r.hiddenCount)).toEqual([0, 3, 0, 0])
    expect(outer.focus).toBe(outer.rows[1]!)
    expect(projectProcessTree(tree, collapsed, key(20)).focus?.identity).toBe(key(20))
    expect(projectProcessTree(tree, collapsed, key(60)).focus?.identity).toBe(key(60))

    collapsed.delete(key(20))
    const inner = projectProcessTree(tree, collapsed, key(40))
    expect(inner.rows.map((r) => r.proc.pid)).toEqual([10, 20, 30, 50, 60, 70])
    expect(inner.rows.map((r) => r.hiddenCount)).toEqual([0, 0, 1, 0, 0, 0])
    expect(inner.focus?.identity).toBe(key(30))
    collapsed.clear()
    expect(projectProcessTree(tree, collapsed).rows.map((r) => r.proc)).toEqual(tree)
  })

  test('focus and collapse survive a fresh sample, reparenting, and counter changes', () => {
    const refreshed = buildProcessTree(forest.toReversed().map((p) => ({
      ...p, runtime_secs: 31, cpu_usage: 12, ppid: p.pid === 20 ? 70 : p.ppid,
    })))
    const result = projectProcessTree(refreshed, new Set([key(20)]), key(40))
    expect(result.rows.map((r) => r.proc.pid)).toEqual([10, 60, 70, 20])
    expect(result.focus?.identity).toBe(key(20))
    expect(result.focus?.parentIdentity).toBe(key(70))
    expect(result.focus?.hiddenCount).toBe(3)
  })

  test('stale focus and collapse do not transfer to distinguishable replacements at the same PID', () => {
    for (const change of [{ name: 'new' }, { user: 'other' }, { command: 'new args' }]) {
      const reused = buildProcessTree(forest.map((p) => p.pid === 20 ? { ...p, ...change } : p))
      const result = projectProcessTree(reused, new Set([key(20)]), key(20))
      expect(result.focus).toBeNull()
      expect(result.rows.map((r) => r.proc.pid)).toEqual([10, 20, 30, 40, 50, 60, 70])
    }
    expect(projectProcessTree([], new Set([key(20)]), key(20))).toEqual({ rows: [], focus: null })
  })

  test('detached roots and cycle orphans follow displayed depth rather than raw PPID', () => {
    const partial = buildProcessTree([proc(20, 10), proc(30, 20), proc(80, 90), proc(90, 80)])
    const result = projectProcessTree(partial, new Set([key(10), processTreeIdentity(proc(80, 90))]))
    expect(result.rows.map((r) => r.parentIdentity)).toEqual([null, key(20), null, null])
    expect(result.rows.map((r) => r.descendantCount)).toEqual([1, 0, 0, 0])
    expect(result.rows.map((r) => r.proc.tree_prefix)).toEqual(['', '└─ ', '? ', '? '])
  })

  test('5000-row chain expands and collapses without recursive traversal', () => {
    const n = 5000
    const chain = buildProcessTree(Array.from({ length: n }, (_, i) => proc(i + 1, i)))
    const last = processTreeIdentity(chain[n - 1]!)
    const expanded = projectProcessTree(chain, new Set(), last)
    expect(expanded.rows).toHaveLength(n)
    expect(expanded.rows[0]!.descendantCount).toBe(n - 1)
    expect(expanded.focus?.proc.tree_depth).toBe(n - 1)
    const middle = expanded.rows[2499]!
    const folded = projectProcessTree(chain, new Set([middle.identity]), last)
    expect(folded.rows).toHaveLength(2500)
    expect(folded.focus?.proc.pid).toBe(middle.proc.pid)
    expect(folded.focus?.hiddenCount).toBe(2500)
  })
})
