export interface WorkloadMember {
  pid: number
  ppid: number
  cpu?: number
  rss?: number
}

/** Sum the visible members reachable from one PID, without exporting process records. */
export function summarizeTree(members: WorkloadMember[], rootPid: number) {
  const children = new Map<number, WorkloadMember[]>()
  let root: WorkloadMember | undefined
  for (const member of members) {
    if (member.pid === rootPid) root = member
    const list = children.get(member.ppid) ?? []
    list.push(member)
    children.set(member.ppid, list)
  }
  if (!root) return
  const seen = new Set<number>()
  const queue = [root]
  let cpu = 0
  let rss = 0
  let cpuCount = 0
  let rssCount = 0
  while (queue.length) {
    const member = queue.pop()!
    if (seen.has(member.pid)) continue
    seen.add(member.pid)
    if (member.cpu !== undefined && Number.isFinite(member.cpu) && member.cpu >= 0) {
      cpu += member.cpu
      cpuCount++
    }
    if (member.rss !== undefined && Number.isFinite(member.rss) && member.rss >= 0) {
      rss += member.rss
      rssCount++
    }
    for (const child of children.get(member.pid) ?? []) queue.push(child)
  }
  return {
    root_pid: rootPid,
    membership: 'visible_process_tree_only' as const,
    membership_verified_complete: false,
    visible_processes: seen.size,
    cpu: {
      measured_processes: cpuCount,
      incomplete: cpuCount < seen.size,
      ...(cpuCount ? { percent_of_one_core: Math.round(cpu * 10) / 10 } : {}),
    },
    memory: {
      measured_processes: rssCount,
      incomplete: rssCount < seen.size,
      ...(rssCount ? { summed_rss_bytes: rss } : {}),
    },
  }
}
