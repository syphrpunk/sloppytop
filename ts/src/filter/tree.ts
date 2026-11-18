// Flatten a process list into depth-first tree
// order with rendering prefixes based on PPID→PID relationships.

import type { ProcessInfo } from '../monitor/types.ts'

export interface TreeProcess extends ProcessInfo {
  tree_depth: number
  /** rendering connector, e.g. "├─ ", "│  └─ "; "? " marks cycle orphans */
  tree_prefix: string
}

/**
 * Processes whose parent is not in the list are treated as roots.
 * Children are sorted by PID within each parent. Cycle orphans are
 * appended at the end with a "? " prefix.
 */
export function buildProcessTree(procs: ProcessInfo[]): TreeProcess[] {
  if (procs.length === 0) return []

  const pidSet = new Set<number>()
  const children = new Map<number, number[]>() // PPID → indices into procs
  for (const p of procs) pidSet.add(p.pid)
  procs.forEach((p, i) => {
    const kids = children.get(p.ppid)
    if (kids) kids.push(i)
    else children.set(p.ppid, [i])
  })
  for (const kids of children.values()) {
    kids.sort((a, b) => procs[a]!.pid - procs[b]!.pid)
  }

  const roots: number[] = []
  procs.forEach((p, i) => {
    if (!pidSet.has(p.ppid) || p.ppid === 0 || p.pid === p.ppid) roots.push(i)
  })
  roots.sort((a, b) => procs[a]!.pid - procs[b]!.pid)

  const result: TreeProcess[] = []
  const visited = new Set<number>()

  // A process chain can be as deep as the sample is long. Walk iteratively
  // rather than spending a JS call frame on each process.
  const pending = roots.reverse().map((idx) => ({ idx, depth: 0, prefix: '', isLast: true }))
  while (pending.length) {
    const { idx, depth, prefix, isLast } = pending.pop()!
    const p = procs[idx]!
    if (visited.has(p.pid)) continue // avoid cycles
    visited.add(p.pid)

    result.push({
      ...p,
      tree_depth: depth,
      tree_prefix: depth === 0 ? '' : prefix + (isLast ? '└─ ' : '├─ '),
    })

    const kids = children.get(p.pid) ?? []
    const childPrefix = depth === 0 ? prefix : prefix + (isLast ? '   ' : '│  ')
    for (let i = kids.length - 1; i >= 0; i--) {
      pending.push({ idx: kids[i]!, depth: depth + 1, prefix: childPrefix, isLast: i === kids.length - 1 })
    }
  }

  // Any processes not visited (orphans from cycles) go at the end
  for (const p of procs) {
    if (!visited.has(p.pid)) {
      result.push({ ...p, tree_depth: 0, tree_prefix: '? ' })
    }
  }

  return result
}
