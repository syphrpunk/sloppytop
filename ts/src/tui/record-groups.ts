import { RECORD_PROBES, type ProbeSet } from '../monitor/probes.ts'
import { updateRecordGroup } from '../store/config.ts'
import { OPTIONAL_RECORD_GROUPS, type OptionalRecordGroup, type RecordGroups } from '../store/record-policy.ts'

const rows = [
  ...RECORD_PROBES.map(name => ({ name, required: true as const })),
  ...OPTIONAL_RECORD_GROUPS.map(name => ({ name, required: false as const })),
]

export interface RecordGroupsView {
  index: number
  optionalGroups: RecordGroups
  error?: string
}

export interface RecordGroupChange {
  group: OptionalRecordGroup
  enabled: boolean
}

export function openRecordGroups(optionalGroups: RecordGroups): RecordGroupsView {
  return { index: 0, optionalGroups: { ...optionalGroups } }
}

/** The Settings owner handles Esc/back and q/close. Only Space requests a write. */
export function reduceRecordGroups(view: RecordGroupsView, key: string): { view: RecordGroupsView; change?: RecordGroupChange } {
  const delta = key === 'up' || key === 'k' ? -1 : key === 'down' || key === 'j' ? 1 : 0
  const index = Math.max(0, Math.min(rows.length - 1, view.index + delta))
  if (index !== view.index) return { view: { ...view, index, error: undefined } }
  const row = rows[index]!
  if (key === 'space' && !row.required) {
    return { view, change: { group: row.name, enabled: !view.optionalGroups[row.name] } }
  }
  return { view }
}

/** Adopt the saved choices only after a successful write; leave the selection retryable on failure. */
export function saveRecordGroupChange(view: RecordGroupsView, change: RecordGroupChange): RecordGroupsView {
  try {
    const saved = updateRecordGroup(change.group, change.enabled)
    return { ...view, optionalGroups: saved.record.optionalGroups, error: undefined }
  } catch {
    return { ...view, error: `Could not save ${change.group}. Check config write access.` }
  }
}

/** rowBudget is picker rows, excluding the single scope/error line and the frame's key hints. */
export function recordGroupLines(view: RecordGroupsView, probes: ProbeSet, rowBudget: number): string[] {
  const room = Math.max(1, rowBudget)
  const start = Math.max(0, Math.min(rows.length - room, view.index - Math.floor(room / 2)))
  return [view.error ?? 'Recording groups · SQLite only (when measured)', ...rows.slice(start, start + room).map((row, i) => {
    const mark = start + i === view.index ? '>' : ' '
    const choice = row.required ? `${row.name} (required, read-only)`
      : `${view.optionalGroups[row.name] ? '[x]' : '[ ]'} ${row.name} (optional)`
    const off = probes[row.name] ? '' : row.required ? ' · probe off: recording blocked' : ' · probe off: not collected'
    return `${mark} ${choice}${off}`
  })]
}
