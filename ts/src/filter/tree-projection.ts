import type { ProcessInfo } from '../monitor/types.ts'
import type { TreeProcess } from './tree.ts'

/** Best-effort, session-local key. ProcessInfo has no start token: identical
 * metadata on PID reuse is indistinguishable. Don't persist or log the key
 * (it contains the command). Reparenting and changing counters don't change it. */
export function processTreeIdentity(p: ProcessInfo): string {
  return JSON.stringify([p.pid, p.user, p.name, p.command])
}

export interface ProjectedTreeRow {
  proc: TreeProcess
  identity: string
  parentIdentity: string | null
  /** All descendants in the input tree, not just immediate children. */
  descendantCount: number
  /** Rows omitted directly by collapsing this branch (not a nested one). */
  hiddenCount: number
}

/** Project the preorder rows from buildProcessTree, without modifying their
 * order or connectors. Nested collapse keys remain caller-owned. A focused
 * process resolves to itself, its visible collapsed ancestor, or null if absent. */
export function projectProcessTree(
  tree: readonly TreeProcess[],
  collapsed: ReadonlySet<string>,
  focusIdentity: string | null = null,
): { rows: ProjectedTreeRow[]; focus: ProjectedTreeRow | null } {
  // A subtree is contiguous in preorder. Jump across each immediate child
  // once instead of scanning every descendant once per ancestor.
  const ends = new Array<number>(tree.length)
  for (let i = tree.length - 1; i >= 0; i--) {
    let end = i + 1
    while (end < tree.length && tree[end]!.tree_depth > tree[i]!.tree_depth) end = ends[end]!
    ends[i] = end
  }

  const rows: ProjectedTreeRow[] = []
  const path: string[] = []
  let focus: ProjectedTreeRow | null = null
  for (let i = 0; i < tree.length;) {
    const proc = tree[i]!
    const identity = processTreeIdentity(proc)
    const descendantCount = ends[i]! - i - 1
    const hiddenCount = collapsed.has(identity) ? descendantCount : 0
    const row = {
      proc, identity, parentIdentity: proc.tree_depth === 0 ? null : path[proc.tree_depth - 1]!,
      descendantCount, hiddenCount,
    }
    path[proc.tree_depth] = identity
    rows.push(row)
    if (focusIdentity === identity) focus = row
    else if (focusIdentity !== null && focus === null) {
      for (let j = i + 1; j <= i + hiddenCount; j++) {
        if (processTreeIdentity(tree[j]!) === focusIdentity) {
          focus = row
          break
        }
      }
    }
    i += hiddenCount + 1
  }
  return { rows, focus }
}
