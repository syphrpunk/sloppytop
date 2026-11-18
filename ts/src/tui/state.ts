// Screen rules shared by the live view and the tests.
// A kill is an effect. This module does not signal the process.

import { FilterQueryError, filterProcesses, sortProcesses, type SortKey } from '../filter/index.ts'
import { splitPinned } from '../filter/pins.ts'
import { buildProcessTree } from '../filter/tree.ts'
import { processTreeIdentity, projectProcessTree, type ProjectedTreeRow } from '../filter/tree-projection.ts'
import { defaultProbes, disabledRecordProbes, PROBE_NAMES, type ProbeName, type ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo } from '../monitor/types.ts'
import { TUI_COLUMNS, type TuiColumn } from '../store/config.ts'
import { validRecorderInterval, type RecorderChange } from './recorder.ts'
import { THEME_NAMES } from './theme.ts'

export type Overlay =
  | 'none'
  | 'help'
  | 'kill'
  | 'detail'
  | 'columns'
  | 'theme'
  | 'net'
  | 'listen'
  | 'hardware'
  | 'history'
  | 'discovery'
  | 'report'
  | 'log'
  | 'settings'
  | 'record'
  | 'artifact'

export interface ArtifactForm {
  kind: 'compare' | 'discovery' | 'diagnostic'
  paths: string[]
  field: number
  column?: number
  status: 'input' | 'loading' | 'ready' | 'error'
  lines: string[]
}

export const DISCOVERY_TABS = ['overview', 'interfaces', 'routes', 'neighbors', 'listeners', 'connections', 'dns'] as const

export interface FileRow {
  fd: string
  type?: string
  name: string
  protocol?: string
}

export interface NetViewRow {
  proto: string
  local: string
  remote: string
  state?: string
  pid: number
  name: string
  rx_bytes_per_s: number
  tx_bytes_per_s: number
}

export interface ListenViewRow {
  protocol: string
  port: number
  pid?: number
  name?: string
}

export interface HardwareView {
  collected_at: string
  chip?: string
  model?: string
  model_id?: string
  logical_cores?: number
  performance_cores?: number
  efficiency_cores?: number
  gpu_cores?: number
  memory_bytes?: number
  displays: { name: string; resolution?: string; main?: boolean }[]
  battery?: import('../monitor/hardware.ts').HardwareBattery
  cpu_features?: string[]
  from_cache?: boolean
}

export interface DetailState {
  pid: number
  loaded: boolean
  cwd?: string
  env?: string[]
  files?: FileRow[]
  filesOmitted?: boolean
  message?: string
  cgroup?: { status: 'loading' | 'ready' | 'unavailable'; cpu?: number; memory?: number }
  subtree?: { status: 'loading' | 'unavailable' } | {
    status: 'ready'; totals: NonNullable<ReturnType<typeof import('../monitor/workload.ts').summarizeTree>>
  }
}

export type PageKind = 'net' | 'listen' | 'hardware'

export interface PageState {
  kind: PageKind
  status: 'loading' | 'ready' | 'off' | 'error'
  message: string
  net?: NetViewRow[]
  listen?: ListenViewRow[]
  hardware?: HardwareView
  topology?: ReturnType<typeof import('../monitor/disk-topology.ts').diskTopology>
  hardwareTab?: 'inventory' | 'topology' | 'readings'
}

export interface HistoryPoint {
  at: string
  timestamp: string
  bootChange?: boolean
  gapSeconds?: number
  interfaces?: import('../monitor/types.ts').NetworkInterfaceRate[]
  anomalies?: import('../store/report.ts').Anomaly[]
  processes?: Omit<import('../store/db.ts').StoredProcessRow, 'command'>[]
  cpu: number
  memory: number
  load: number
}

export interface HistorySeries {
  label: string
  /** Oldest first; null occupies the slot for an unavailable reading. */
  values: (number | null)[]
  /** Scale ceiling. If omitted, use the max of the measured values. */
  max?: number
}

export interface HistoryView {
  status: 'loading' | 'empty' | 'ready' | 'error'
  timeline?: ReturnType<typeof import('../view/history-coverage.ts').historyCoverage>
  message: string
  cpu: number[]
  memory: number[]
  load: number[]
  /** Stored readings other than cpu, memory, and load. Empty when none were measured. */
  series: HistorySeries[]
  diskMetrics: import('../view/disk-history.ts').DiskHistoryMetric[]
  /** One text row per enum, such as `thermal  nominal`. Not a sparkline. */
  notes: string[]
  recent: HistoryPoint[]
}

export function emptyHistoryPage(status: HistoryView['status'], message: string): HistoryView {
  return { status, message, cpu: [], memory: [], load: [], series: [], diskMetrics: [], notes: [], recent: [] }
}

export interface ReportSummary {
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
  anomaly_count: number
}

export interface ReportHourLine {
  hour: string
  samples: number
  cpu_avg: number
  cpu_peak: number
  memory_used_avg: number
  memory_used_peak: number
  load1_avg: number
  load1_peak: number
}

export interface ReportTopLine {
  name: string
  cpu_avg: number
  memory_avg_bytes: number
}

export interface ReportAnomalyLine {
  at: string
  type: string
  detail: string
}

export type ReportLeakLine = import('../store/report.ts').LeakFlag
export type ReportTab = 'overview' | 'compare' | 'workloads' | 'rss'

export interface ReportGroupLine {
  name: string
  score: number
}

export interface ReportView {
  status: 'loading' | 'empty' | 'ready' | 'error'
  message: string
  summary: ReportSummary | null
  cpu: number[]
  memory: number[]
  load: number[]
  hourly: ReportHourLine[]
  top: ReportTopLine[]
  anomalies: ReportAnomalyLine[]
  leaks: ReportLeakLine[]
  groups: ReportGroupLine[]
  evidence?: {
    comparison: ReturnType<typeof import('../store/report.ts').compareReportWindows>
    workloads: ReturnType<typeof import('../store/report.ts').reportWorkloadHistory>
    groupCount: number
    leaks: ReportLeakLine[]
  }
}

export interface LogView {
  status: 'loading' | 'ready' | 'error'
  message: string
  lines: string[]
}

export const SETTINGS_SECTIONS = ['recorder', 'probes', 'metrics'] as const

export interface SettingsView {
  section: 'overview' | (typeof SETTINGS_SECTIONS)[number]
  probeIndex: number
  probes: ProbeSet
  metricsEnabled: boolean
  host: string
  port: number
  listening: boolean
  metricsMessage: string
  recorderEdit?: { step: 'interval'; kind: 'enable' | 'cadence'; draft: string }
    | { step: 'confirm'; change: RecorderChange } | { step: 'applying' }
  recorderMessage?: string
  recorder: { status: 'loading' } | { status: 'error'; message: string }
    | { status: 'ready'; health: import('./store.ts').RecorderHealth }
}

export interface ScreenState {
  width: number
  height: number
  paused: boolean
  search: string
  draft: string
  searching: boolean
  sortBy: SortKey
  sortOrder: 'asc' | 'desc'
  tree: boolean
  collapsed: ReadonlySet<string>
  treeFocus: string | null
  treeManualScroll: boolean
  selectedPid: number | null
  scroll: number
  overlay: Overlay
  overlayScroll?: number
  overlayScrollMax?: number
  panelIndex: number
  columns: TuiColumn[]
  theme: string
  refreshMs: number
  pins: string[]
  processesOff: boolean
  waiting: boolean
  detail: DetailState | null
  page: PageState | null
  statusMessage: string
  /** Table rows that fit under the current strip. Null until the first paint. */
  bodyRows: number | null
  /** Theme to restore when the theme list is cancelled. */
  savedTheme: string
  probes: ProbeSet
  metricsListening: boolean
  metricsEnabled: boolean
  metricsHost: string
  metricsPort: number
  historyPage: HistoryView | null
  discoveryPage: {
    tab: number
    offset: number
    maxOffset?: number
    refreshed?: boolean
    loading?: boolean
    data?: import('../discovery/overview.ts').Overview
    detail?: import('../discovery/overview.ts').DiscoveryDetail
    message?: string
  } | null
  /** Null is the overview; otherwise an index into available disk metrics. */
  historyDiskIndex: number | null
  historyPointIndex: number | null
  reportPage: ReportView | null
  reportTab: ReportTab
  logPage: LogView | null
  settingsPage: SettingsView | null
  recordPage: { message: string } | null
  artifact?: ArtifactForm
}

export interface ScreenEffect {
  kill?: { pid: number }
  pins?: string[]
  tui?: { columns?: TuiColumn[]; theme?: string; refreshMs?: number }
  detailPid?: number
  loadEnv?: number
  loadFiles?: number
  openNet?: boolean
  openListen?: boolean
  openHardware?: boolean
  refreshHardware?: boolean
  openTopology?: boolean
  loadCgroup?: number
  loadSubtree?: number
  openHistory?: boolean
  openDiscovery?: boolean
  openReport?: boolean
  openLog?: boolean
  openSettings?: boolean
  changeRecorder?: RecorderChange
  toggleProbe?: { name: ProbeName; enabled: boolean }
  toggleMetrics?: boolean
  record?: boolean
  artifact?: import('./artifacts.ts').ArtifactRequest
}

export interface ReduceResult {
  state: ScreenState
  effect?: ScreenEffect
}

export type DisplayRow =
  | { kind: 'process'; proc: ProcessInfo; pinned: boolean; prefix: string; branch?: ProjectedTreeRow }
  | { kind: 'missing'; pin: string }

export interface KeyPress {
  name: string
  ctrl: boolean
  shift: boolean
}

const REFRESH_MS = [1000, 2000, 3000, 5000, 500] as const

const SORT_BY_NUMBER: Record<string, SortKey> = {
  '1': 'pid',
  '2': 'name',
  '3': 'cpu',
  '4': 'memory',
  '5': 'status',
  '6': 'user',
  '7': 'command',
  '8': 'runtime',
  '9': 'disk',
  '0': 'threads',
}

/** Title, four meters, header, and the hint line, before any optional reading rows. */
const BODY_CHROME = 7

export function initialState(
  config: { columns: TuiColumn[]; theme: string; refreshMs: number; pins: string[] },
  size: { width: number; height: number } = { width: 80, height: 24 },
): ScreenState {
  return {
    width: size.width,
    height: size.height,
    paused: false,
    search: '',
    draft: '',
    searching: false,
    sortBy: 'cpu',
    sortOrder: 'desc',
    tree: false,
    collapsed: new Set(),
    treeFocus: null,
    treeManualScroll: false,
    selectedPid: null,
    scroll: 0,
    overlay: 'none',
    panelIndex: 0,
    columns: [...config.columns],
    theme: config.theme,
    refreshMs: config.refreshMs,
    pins: [...config.pins],
    processesOff: false,
    waiting: true,
    detail: null,
    page: null,
    statusMessage: '',
    savedTheme: config.theme,
    bodyRows: null,
    probes: defaultProbes(),
    metricsListening: false,
    metricsEnabled: false,
    metricsHost: '127.0.0.1',
    metricsPort: 9464,
    historyPage: null,
    discoveryPage: null,
    historyDiskIndex: null,
    historyPointIndex: null,
    reportPage: null,
    reportTab: 'overview',
    logPage: null,
    settingsPage: null,
    recordPage: null,
  }
}

interface RowView {
  rows: DisplayRow[]
  error: string
  treeIndexes?: Map<number, number>
  hiddenFocus?: { identity: string; ancestor: number }
}

// A selector belongs to one accepted sample. Only the tree is cached;
// pins and folds are replaced (never mutated) by the reducer.
export function createRowSelector(processes: ProcessInfo[]) {
  let cached: { pins: string[]; search: string; collapsed: ReadonlySet<string>; focus: string | null; view: RowView } | undefined
  return (state: ScreenState): RowView => {
    if (!state.tree || state.processesOff) {
      cached = undefined
      return visibleRows(state, processes)
    }
    const { pins, search, collapsed, treeFocus } = state
    if (cached && cached.pins === pins && cached.search === search && cached.collapsed === collapsed) {
      // Visible selections never need a redirect. Reproject for a *new*
      // hidden focus rather than reusing another descendant's ancestor.
      if (cached.focus === treeFocus || !treeFocus || !collapsed.size ||
          (state.selectedPid !== null && cached.view.treeIndexes?.has(state.selectedPid))) return cached.view
    }
    const view = visibleRows(state, processes)
    cached = { pins, search, collapsed, focus: treeFocus, view }
    return view
  }
}

// Prune against the sample, not its filtered/unpinned subset. No work on
// flat-mode ticks: returning to tree mode prunes against the latest sample.
export function pruneTreeFolds(state: ScreenState, processes: ProcessInfo[]): ScreenState {
  if (!state.tree || !state.collapsed.size) return state
  const live = new Set<string>()
  for (const proc of processes) {
    const id = processTreeIdentity(proc)
    if (state.collapsed.has(id)) live.add(id)
  }
  return live.size === state.collapsed.size ? state : { ...state, collapsed: live }
}

export function visibleRows(
  state: ScreenState,
  processes: ProcessInfo[],
): RowView {
  if (state.processesOff) return { rows: [], error: '' }
  let filtered: ProcessInfo[]
  try {
    filtered = filterProcesses(processes, state.search)
  } catch (err) {
    const message = err instanceof FilterQueryError ? err.message : 'invalid filter'
    return { rows: [], error: message }
  }

  if (state.tree) {
    const split = splitPinned(filtered, state.pins)
    const { rows, focus } = projectProcessTree(buildProcessTree(split.rest), state.collapsed, state.treeFocus)
    const display: DisplayRow[] = [
      ...split.pinned.map(proc => processRow(proc, true, '')),
      ...missingRows(split.missing, state.search),
    ]
    for (const branch of rows) display.push({ kind: 'process', proc: branch.proc, pinned: false, prefix: branch.proc.tree_prefix, branch })
    const treeIndexes = new Map<number, number>()
    display.forEach((row, i) => { if (row.kind === 'process') treeIndexes.set(row.proc.pid, i) })
    return {
      rows: display, treeIndexes,
      error: '',
      ...(focus && state.treeFocus && focus.identity !== state.treeFocus
        ? { hiddenFocus: { identity: state.treeFocus, ancestor: focus.proc.pid } } : {}),
    }
  }

  const sorted = sortProcesses(filtered, state.sortBy, state.sortOrder)
  const split = splitPinned(sorted, state.pins)
  return {
    rows: [
      ...split.pinned.map((proc) => processRow(proc, true, '')),
      ...missingRows(split.missing, state.search),
      ...split.rest.map((proc) => processRow(proc, false, '')),
    ],
    error: '',
  }
}

function ensureTreeSelection(state: ScreenState, view: RowView): ScreenState {
  const { rows } = view
  const pid = view.hiddenFocus && view.hiddenFocus.identity === state.treeFocus ? view.hiddenFocus.ancestor : state.selectedPid
  let index = pid !== null ? view.treeIndexes?.get(pid) ?? -1 : -1
  const match = rows[index]
  if (pid === state.selectedPid && match?.kind === 'process' && state.treeFocus && rowIdentity(match) !== state.treeFocus) index = -1
  if (index < 0) {
    // On distinguishable PID reuse prefer another live row over the replacement.
    index = rows.findIndex(row => row.kind === 'process' && row.proc.pid !== state.selectedPid)
    if (index < 0) index = rows.findIndex(row => row.kind === 'process')
  }
  const row = rows[index]
  const identity = row?.kind === 'process' ? rowIdentity(row) : null
  const changed = identity !== state.treeFocus
  const treeManualScroll = !changed && state.treeManualScroll
  const size = bodyWindow(state)
  let scroll = Math.min(state.scroll, Math.max(0, rows.length - size))
  if (!treeManualScroll && index >= 0) scroll = Math.max(index - size + 1, Math.min(index, scroll))
  // Never retarget an open confirmation when its process disappears.
  const overlay = changed && state.overlay === 'kill' ? 'none' : state.overlay
  return { ...state, scroll, treeManualScroll, overlay, selectedPid: row?.kind === 'process' ? row.proc.pid : null, treeFocus: identity }
}

export function ensureSelection(state: ScreenState, view: RowView): ScreenState {
  const { rows } = view
  if (state.tree) return ensureTreeSelection(state, view)
  const indexes = processIndexes(rows)
  if (indexes.length === 0) {
    return state.selectedPid === null ? state : { ...state, selectedPid: null }
  }
  const stillThere = indexes.some((index) => {
    const row = rows[index]
    return row?.kind === 'process' && row.proc.pid === state.selectedPid
  })
  if (stillThere) return state
  return revealAt(state, rows, indexes[0]!)
}

export function wantsQuit(state: ScreenState, key: KeyPress): boolean {
  if (key.ctrl && key.name === 'c') return true
  if (state.searching || state.overlay !== 'none') return false
  return key.name === 'q' || key.name === 'escape' || key.name === 'esc'
}

export function reduce(state: ScreenState, key: KeyPress, rows: DisplayRow[]): ReduceResult {
  if (key.ctrl && key.name === 'c') return { state }
  if (state.searching) return reduceSearch(state, key)
  if (state.overlay !== 'none') {
    if (state.overlayScrollMax && (key.name === 'up' || key.name === 'down')) {
      const overlayScroll = Math.min(state.overlayScrollMax, Math.max(0, (state.overlayScroll ?? 0) + (key.name === 'up' ? -1 : 1)))
      return { state: { ...state, overlayScroll } }
    }
    return reduceOverlay(state, key)
  }
  return reduceMain(state, key, rows)
}

function reduceSearch(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc') {
    return { state: { ...state, searching: false, draft: state.search } }
  }
  if (key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, searching: false, search: state.draft, scroll: 0, treeManualScroll: false } }
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    return { state: { ...state, draft: [...state.draft].slice(0, -1).join('') } }
  }
  if (key.name === 'space') return { state: { ...state, draft: `${state.draft} ` } }
  if (key.name.length === 1) return { state: { ...state, draft: state.draft + key.name } }
  return { state }
}

function reduceOverlay(state: ScreenState, key: KeyPress): ReduceResult {
  if (state.overlay === 'artifact' && state.artifact) return reduceArtifact(state, key, state.artifact)
  if (state.overlay === 'report') {
    if (key.name === 'e') return openArtifact(state, 'diagnostic')
    const tab = key.name === 'c' ? 'compare' : key.name === 'w' ? 'workloads' : key.name === 'l' ? 'rss' : undefined
    if (tab) return { state: { ...state, reportTab: state.reportTab === tab ? 'overview' : tab, overlayScroll: 0 } }
  }
  if (state.overlay === 'kill') return reduceKill(state, key)
  if (state.overlay === 'columns') return reduceColumns(state, key)
  if (state.overlay === 'theme') return reduceTheme(state, key)
  if (state.overlay === 'detail') return reduceDetail(state, key)
  if (state.overlay === 'hardware') return reduceHardware(state, key)
  if (state.overlay === 'settings') return reduceSettings(state, key)
  if (state.overlay === 'discovery' && state.discoveryPage) {
    const page = state.discoveryPage
    if (key.name === 'c') return openArtifact(state, 'compare')
    if (key.name === 'e') return openArtifact(state, 'discovery')
    if (key.name === 'r') return {
      state: { ...state, discoveryPage: { tab: page.tab, offset: 0, refreshed: true, loading: true, data: page.data } },
      effect: { openDiscovery: true },
    }
    if (key.name === 'left' || key.name === 'right') {
      const tab = (page.tab + (key.name === 'left' ? -1 : 1) + DISCOVERY_TABS.length) % DISCOVERY_TABS.length
      const section = DISCOVERY_TABS[tab]
      const needsLoad = section === 'connections' || section === 'dns' || !page.data
      return {
        state: { ...state, discoveryPage: { tab, data: page.data, offset: 0 } },
        ...(needsLoad ? { effect: { openDiscovery: true } } : {}),
      }
    }
    if (key.name === 'up' || key.name === 'down') return {
      state: { ...state, discoveryPage: { ...page, offset: Math.min(page.maxOffset ?? 0, Math.max(0, page.offset + (key.name === 'up' ? -1 : 1))) } },
    }
  }
  if (state.overlay === 'history' && state.historyPage?.status === 'ready') {
    const points = state.historyPage.recent.length
    if (key.name === 'i' && points) return {
      state: { ...state, overlayScroll: 0, historyDiskIndex: null, historyPointIndex: state.historyPointIndex === null ? 0 : null },
    }
    if (state.historyPointIndex !== null && points && (key.name === 'left' || key.name === 'right')) {
      const step = key.name === 'left' ? 1 : -1
      return { state: { ...state, overlayScroll: 0, historyPointIndex: Math.max(0, Math.min(points - 1, state.historyPointIndex + step)) } }
    }
    if (key.name === 'd') {
      return { state: { ...state, overlayScroll: 0, historyPointIndex: null, historyDiskIndex: state.historyDiskIndex === null ? 0 : null } }
    }
    const count = state.historyPage.diskMetrics.length
    if (state.historyDiskIndex !== null && count > 0 && (key.name === 'left' || key.name === 'right')) {
      const step = key.name === 'left' ? -1 : 1
      return { state: { ...state, overlayScroll: 0, historyDiskIndex: (state.historyDiskIndex + step + count) % count } }
    }
  }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function openArtifact(state: ScreenState, kind: ArtifactForm['kind']): ReduceResult {
  const missing = kind === 'discovery' && (!state.discoveryPage?.data || !state.probes.network)
  return { state: { ...state, overlay: 'artifact', artifact: {
    kind, paths: kind === 'compare' ? ['', ''] : [''], field: 0,
    status: missing ? 'error' : 'input',
    lines: missing ? ['open or refresh discovery overview before exporting'] : [],
  } } }
}

function reduceArtifact(state: ScreenState, key: KeyPress, form: ArtifactForm): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc' || (key.name === 'q' && form.status !== 'input')) {
    const overlay = form.kind === 'diagnostic' ? 'report' : 'discovery'
    // A cancelled live read may have been invalidated while the form was open.
    const reload = overlay === 'discovery' && state.discoveryPage?.loading
    return { state: { ...state, overlay, artifact: undefined }, ...(reload ? { effect: { openDiscovery: true } }
      : overlay === 'report' && state.reportPage?.status === 'loading' ? { effect: { openReport: true } } : {}) }
  }
  if (form.status === 'ready' && form.kind === 'compare' && (key.name === 'left' || key.name === 'right')) {
    const column = Math.max(0, (form.column ?? 0) + (key.name === 'left' ? -8 : 8))
    return { state: { ...state, artifact: { ...form, column } } }
  }
  if (form.status !== 'input') return { state }
  const current = form.paths[form.field] ?? ''
  if (key.name === 'tab') return { state: { ...state, artifact: { ...form, field: (form.field + 1) % form.paths.length } } }
  if (key.name === 'return' || key.name === 'enter') {
    if (!current.trim()) return { state }
    const empty = form.paths.findIndex(path => !path.trim())
    if (empty >= 0) return { state: { ...state, artifact: { ...form, field: empty } } }
    const path = form.paths[0]!
    const overview = state.discoveryPage?.data
    const artifact = form.kind === 'compare' ? { kind: 'compare' as const, before: path, after: form.paths[1]! }
      : form.kind === 'diagnostic' ? { kind: 'diagnostic' as const, path }
      : overview ? { kind: 'discovery' as const, path, overview } : undefined
    if (!artifact) return { state }
    return { state: { ...state, artifact: { ...form, status: 'loading' } }, effect: { artifact } }
  }
  let next = current
  if (key.name === 'backspace' || key.name === 'delete') next = [...current].slice(0, -1).join('')
  else if (!key.ctrl && key.name === 'space') next += ' '
  else if (!key.ctrl && [...key.name].length === 1) next += key.name
  return setArtifactPath(state, next)
}

export function setArtifactPath(state: ScreenState, path: string): ReduceResult {
  const form = state.artifact
  if (state.overlay !== 'artifact' || form?.status !== 'input' || /[\x00-\x1f\x7f]/.test(path) || path.length > 4096) return { state }
  return { state: { ...state, artifact: { ...form, paths: form.paths.map((value, i) => i === form.field ? path : value) } } }
}

function reduceDetail(state: ScreenState, key: KeyPress): ReduceResult {
  const pid = state.detail?.pid ?? state.selectedPid
  if (key.name === 't' && state.detail) {
    if (state.detail.subtree) return {
      state: { ...state, overlayScroll: 0, detail: { ...state.detail, subtree: undefined } },
    }
    return {
      state: { ...state, overlayScroll: 0, detail: { ...state.detail, subtree: { status: 'loading' } } },
      effect: { loadSubtree: state.detail.pid },
    }
  }
  if (key.name === 'g' && pid && !state.detail?.subtree) return {
    state: { ...state, detail: { ...state.detail, pid, loaded: state.detail?.loaded ?? false, cgroup: { status: 'loading' } } },
    effect: { loadCgroup: pid },
  }
  if (key.name === 'e' && pid && !state.detail?.subtree) return { state, effect: { loadEnv: pid } }
  if (key.name === 'o' && pid && !state.detail?.subtree) return { state, effect: { loadFiles: pid } }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceHardware(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 's') {
    const readings = state.page?.hardwareTab !== 'readings'
    return {
      state: { ...state, overlayScroll: 0, page: { kind: 'hardware', status: readings ? 'ready' : 'loading',
        message: '', hardwareTab: readings ? 'readings' : 'inventory' } },
      ...(readings ? {} : { effect: { openHardware: true } }),
    }
  }
  if (key.name === 'r' && state.page?.hardwareTab === 'readings') return { state }
  if (key.name === 'd' || key.name === 'r' && state.page?.hardwareTab === 'topology') {
    const topology = key.name === 'r' || state.page?.hardwareTab !== 'topology'
    return {
      state: { ...state, overlayScroll: 0, page: { kind: 'hardware', status: 'loading', message: '',
        hardwareTab: topology ? 'topology' : 'inventory' } },
      effect: topology ? { openTopology: true } : { openHardware: true },
    }
  }
  if (key.name === 'r') {
    const page = state.page?.kind === 'hardware' ? { ...state.page, status: 'loading' as const, message: '' } : state.page
    return { state: { ...state, page }, effect: { refreshHardware: true } }
  }
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

export function recorderActions(page: SettingsView) {
  const service = page.recorder.status === 'ready' && page.recorder.health.service
  const active = service && service.scheduler_state === 'armed'
  return {
    enable: service && service.scheduler_state === 'inactive',
    disable: service && (service.installed || active),
    cadence: active,
  }
}

function reduceRecorder(state: ScreenState, page: SettingsView, key: KeyPress): ReduceResult | undefined {
  const edit = page.recorderEdit
  const update = (recorderEdit?: SettingsView['recorderEdit'], recorderMessage?: string): ReduceResult => ({
    state: { ...state, overlayScroll: 0, overlayScrollMax: 0, settingsPage: { ...page, recorderEdit, recorderMessage } },
  })
  if (edit?.step === 'applying') return { state }
  if (edit && (key.name === 'escape' || key.name === 'esc' || (edit.step === 'confirm' && key.name === 'n'))) return update()
  if (key.name === 'q') return undefined // normal Settings close, without a write
  if (edit?.step === 'confirm') {
    if (key.name !== 'y' || key.ctrl) return { state }
    return { ...update({ step: 'applying' }), effect: { changeRecorder: edit.change } }
  }
  if (edit?.step === 'interval') {
    if (key.name === 'enter' || key.name === 'return') {
      const seconds = Number(edit.draft)
      return /^\d+$/.test(edit.draft) && validRecorderInterval(seconds)
        ? update({ step: 'confirm', change: { kind: edit.kind, seconds } })
        : update(edit, 'Enter whole seconds (at least 60).')
    }
    if (key.name === 'backspace' || key.name === 'delete') return update({ ...edit, draft: edit.draft.slice(0, -1) })
    if (!key.ctrl && key.name.length === 1 && edit.draft.length < 20) return update({ ...edit, draft: edit.draft + key.name })
    return { state }
  }
  const actions = recorderActions(page)
  if (key.name === 'd' && actions.disable) return update({ step: 'confirm', change: { kind: 'disable' } })
  if ((key.name === 'e' && actions.enable) || (key.name === 'c' && actions.cadence)) {
    const blocked = disabledRecordProbes(page.probes)
    if (blocked.length) return update(undefined, `Cannot record: required probes off: ${blocked.join(', ')}`)
    return update({ step: 'interval', kind: key.name === 'e' ? 'enable' : 'cadence', draft: key.name === 'e' ? '3600' : '' })
  }
}

function reduceSettings(state: ScreenState, key: KeyPress): ReduceResult {
  const page = state.settingsPage
  if (!page) return { state: { ...state, overlay: 'none' } }
  const section = page.section
  if (section === 'recorder') {
    const result = reduceRecorder(state, page, key)
    if (result) return result
  }
  if (key.name === 'q') return { state: { ...state, overlay: 'none' } }
  if (key.name === 'escape' || key.name === 'esc') {
    return section === 'overview' ? { state: { ...state, overlay: 'none' } }
      : { state: { ...state, overlayScroll: 0, overlayScrollMax: 0, settingsPage: { ...page, section: 'overview' } } }
  }
  const delta = key.name === 'up' || key.name === 'k' ? -1 : key.name === 'down' || key.name === 'j' ? 1 : 0
  if (section === 'overview') {
    if (delta) return { state: { ...state, panelIndex: Math.min(SETTINGS_SECTIONS.length - 1, Math.max(0, state.panelIndex + delta)) } }
    if (key.name === 'enter' || key.name === 'return' || key.name === 'space') {
      return { state: { ...state, settingsPage: { ...page, section: SETTINGS_SECTIONS[state.panelIndex]! } } }
    }
  }
  if (section === 'probes' && delta) {
    const probeIndex = Math.min(PROBE_NAMES.length - 1, Math.max(0, page.probeIndex + delta))
    return { state: { ...state, settingsPage: { ...page, probeIndex } } }
  }
  if (section === 'probes' && key.name === 'space') {
    const name = PROBE_NAMES[page.probeIndex]!
    const enabled = !page.probes[name]
    const probes: ProbeSet = { ...page.probes, [name]: enabled }
    return {
      state: { ...state, probes, settingsPage: { ...page, probes } },
      effect: { toggleProbe: { name, enabled } },
    }
  }
  if (key.name === 'm' && (section === 'overview' || section === 'metrics')) {
    return {
      state: { ...state, panelIndex: SETTINGS_SECTIONS.indexOf('metrics'), settingsPage: {
        ...page, section: 'metrics', metricsMessage: state.metricsListening ? 'stopping…' : 'starting…',
      } },
      effect: { toggleMetrics: true },
    }
  }
  return { state }
}

function reduceKill(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'y' || key.name === 'return' || key.name === 'enter') {
    if (state.selectedPid === null) return { state: { ...state, overlay: 'none' } }
    return {
      state: { ...state, overlay: 'none' },
      effect: { kill: { pid: state.selectedPid } },
    }
  }
  if (key.name === 'n' || key.name === 'escape' || key.name === 'esc' || key.name === 'q') {
    return { state: { ...state, overlay: 'none' } }
  }
  return { state }
}

function reduceColumns(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q' || key.name === 'return' || key.name === 'enter') {
    return closeColumns(state)
  }
  if (key.name === 'up' || key.name === 'k') {
    return { state: { ...state, panelIndex: Math.max(0, state.panelIndex - 1) } }
  }
  if (key.name === 'down' || key.name === 'j') {
    return { state: { ...state, panelIndex: Math.min(TUI_COLUMNS.length - 1, state.panelIndex + 1) } }
  }
  if (key.name === 'space') {
    const id = TUI_COLUMNS[state.panelIndex]
    if (!id) return { state }
    return { state: { ...state, columns: toggleColumn(state.columns, id) } }
  }
  return { state }
}

function reduceTheme(state: ScreenState, key: KeyPress): ReduceResult {
  if (key.name === 'escape' || key.name === 'esc' || key.name === 'q') {
    return { state: { ...state, overlay: 'none', theme: state.savedTheme } }
  }
  if (key.name === 'return' || key.name === 'enter' || key.name === 'space') {
    return {
      state: { ...state, overlay: 'none' },
      effect: { tui: { theme: state.theme, columns: state.columns, refreshMs: state.refreshMs } },
    }
  }
  if (key.name === 'up' || key.name === 'k') return moveTheme(state, -1)
  if (key.name === 'down' || key.name === 'j') return moveTheme(state, 1)
  return { state }
}

function reduceMain(state: ScreenState, key: KeyPress, rows: DisplayRow[]): ReduceResult {
  const sort = SORT_BY_NUMBER[key.name]
  if (sort) return { state: toggleSort(state, sort) }
  if (key.name === 'T' || (key.name === 't' && key.shift)) {
    const proc = state.tree ? null : selected(state, rows)
    return { state: { ...state, tree: !state.tree, treeFocus: proc ? processTreeIdentity(proc) : null, treeManualScroll: false, scroll: 0 } }
  }
  if (state.tree && (key.name === 'left' || key.name === 'right')) return treeArrow(state, rows, key.name)
  if (key.name === 't') {
    const found = THEME_NAMES.findIndex((name) => name === state.theme)
    const index = found < 0 ? 0 : found
    return { state: { ...state, overlay: 'theme', panelIndex: index, savedTheme: state.theme } }
  }
  if (key.name === 'r') {
    const refreshMs = nextRefresh(state.refreshMs)
    return {
      state: { ...state, refreshMs },
      effect: { tui: { refreshMs } },
    }
  }
  if (key.name === 'p' || key.name === 'u') return togglePin(state, rows)
  if (key.name === 'k' || key.name === 'x' || key.name === 'delete' || key.name === 'del') {
    return openKill(state, rows)
  }
  if (key.name === 'i' || key.name === 'return' || key.name === 'enter') return openDetail(state, rows)
  if (key.name === 'e') return openProcPage(state, rows, 'env')
  if (key.name === 'o') return openProcPage(state, rows, 'files')
  if (key.name === 'n') return openPage(state, 'net')
  if (key.name === 'l') return openPage(state, 'listen')
  if (key.name === 'h') return openPage(state, 'hardware')
  if (key.name === 'v') return openHistory(state)
  if (key.name === 'D' || (key.name === 'd' && key.shift)) return {
    state: { ...state, overlay: 'discovery', discoveryPage: { tab: 0, offset: 0 } },
    effect: { openDiscovery: true },
  }
  if (key.name === 'w') return openReport(state)
  if (key.name === 'b') return openLog(state)
  if (key.name === 'a') return openRecord(state)
  if (key.name === 'm') return openSettings(state)
  if (key.name === 'c') return { state: { ...state, overlay: 'columns', panelIndex: 0 } }
  if (key.name === '?' ) return { state: { ...state, overlay: 'help' } }
  if (key.name === '/' || key.name === 's' || key.name === 'f') {
    return { state: { ...state, searching: true, draft: state.search } }
  }
  if (key.name === 'space') return { state: { ...state, paused: !state.paused } }
  if (key.name === 'up') return { state: move(state, rows, -1) }
  if (key.name === 'down' || key.name === 'j') return { state: move(state, rows, 1) }
  if (key.name === 'pageup' || key.name === 'pgup') return { state: move(state, rows, -bodyWindow(state)) }
  if (key.name === 'pagedown' || key.name === 'pgdown') return { state: move(state, rows, bodyWindow(state)) }
  if (key.name === 'home' || (key.name === 'g' && !key.shift)) return { state: moveEnd(state, rows, 'start') }
  if (key.name === 'end' || key.name === 'G' || (key.name === 'g' && key.shift)) {
    return { state: moveEnd(state, rows, 'end') }
  }
  return { state }
}

function treeArrow(state: ScreenState, rows: DisplayRow[], key: 'left' | 'right'): ReduceResult {
  const index = rows.findIndex(row => row.kind === 'process' && row.proc.pid === state.selectedPid)
  const row = rows[index]
  if (row?.kind !== 'process' || !row.branch) return { state }
  const branch = row.branch
  if (key === 'left' ? branch.descendantCount > 0 && !branch.hiddenCount : branch.hiddenCount > 0) {
    const collapsed = new Set(state.collapsed)
    if (key === 'left') collapsed.add(branch.identity)
    else collapsed.delete(branch.identity)
    return { state: { ...state, collapsed, treeManualScroll: false } }
  }
  if (key === 'left' && branch.parentIdentity) {
    const parent = rows.findIndex(r => r.kind === 'process' && r.branch?.identity === branch.parentIdentity)
    return { state: revealAt(state, rows, parent) }
  }
  if (key === 'right' && branch.descendantCount) {
    return { state: revealAt(state, rows, index + 1) }
  }
  return { state }
}

export function toggleSort(state: ScreenState, sortBy: SortKey): ScreenState {
  if (state.sortBy === sortBy) {
    return { ...state, sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }
  }
  return { ...state, sortBy, sortOrder: 'desc', scroll: 0 }
}

function nextRefresh(current: number): number {
  const index = REFRESH_MS.indexOf(current as (typeof REFRESH_MS)[number])
  if (index < 0) return REFRESH_MS[0]
  return REFRESH_MS[(index + 1) % REFRESH_MS.length]!
}

function toggleColumn(columns: TuiColumn[], id: TuiColumn): TuiColumn[] {
  if (columns.includes(id)) {
    if (columns.length === 1) return columns
    return columns.filter((column) => column !== id)
  }
  const chosen = new Set<TuiColumn>([...columns, id])
  return TUI_COLUMNS.filter((column) => chosen.has(column))
}

function closeColumns(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'none' },
    effect: { tui: { columns: state.columns, theme: state.theme, refreshMs: state.refreshMs } },
  }
}

function moveTheme(state: ScreenState, delta: number): ReduceResult {
  const index = Math.min(THEME_NAMES.length - 1, Math.max(0, state.panelIndex + delta))
  const theme = THEME_NAMES[index] ?? state.theme
  return { state: { ...state, panelIndex: index, theme } }
}

function openKill(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  return { state: { ...state, overlay: 'kill', selectedPid: proc.pid } }
}

function openDetail(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  return {
    state: { ...state, overlay: 'detail', selectedPid: proc.pid, detail: { pid: proc.pid, loaded: false } },
    effect: { detailPid: proc.pid },
  }
}

function openProcPage(state: ScreenState, rows: DisplayRow[], kind: 'env' | 'files'): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  const detail = state.detail?.pid === proc.pid ? state.detail : { pid: proc.pid, loaded: false }
  return {
    state: { ...state, overlay: 'detail', selectedPid: proc.pid, detail },
    effect: kind === 'env' ? { loadEnv: proc.pid } : { loadFiles: proc.pid },
  }
}

function openHistory(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'history',
      historyPage: emptyHistoryPage('loading', 'loading…'),
      historyDiskIndex: null,
      historyPointIndex: null,
    },
    effect: { openHistory: true },
  }
}

function openReport(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'report',
      reportTab: 'overview',
      reportPage: {
        status: 'loading',
        message: 'loading…',
        summary: null,
        cpu: [],
        memory: [],
        load: [],
        hourly: [],
        top: [],
        anomalies: [],
        leaks: [],
        groups: [],
      },
    },
    effect: { openReport: true },
  }
}

function openLog(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'log', logPage: { status: 'loading', message: 'loading…', lines: [] } },
    effect: { openLog: true },
  }
}

function openRecord(state: ScreenState): ReduceResult {
  return {
    state: { ...state, overlay: 'record', recordPage: { message: 'recording…' } },
    effect: { record: true },
  }
}

function openSettings(state: ScreenState): ReduceResult {
  return {
    state: {
      ...state,
      overlay: 'settings',
      panelIndex: 0,
      settingsPage: {
        section: 'overview',
        probeIndex: 0,
        probes: { ...state.probes },
        metricsEnabled: state.metricsEnabled,
        host: state.metricsHost,
        port: state.metricsPort,
        listening: state.metricsListening,
        metricsMessage: '',
        recorder: { status: 'loading' },
      },
    },
    effect: { openSettings: true },
  }
}

function openPage(state: ScreenState, kind: PageKind): ReduceResult {
  const effect: ScreenEffect =
    kind === 'net' ? { openNet: true } : kind === 'listen' ? { openListen: true } : { openHardware: true }
  return {
    state: { ...state, overlay: kind, page: { kind, status: 'loading', message: '' } },
    effect,
  }
}

function togglePin(state: ScreenState, rows: DisplayRow[]): ReduceResult {
  const proc = selected(state, rows)
  if (!proc) return { state }
  const name = proc.name
  const pins = state.pins.includes(name) ? state.pins.filter((pin) => pin !== name) : [...state.pins, name]
  return { state: { ...state, pins, treeManualScroll: false }, effect: { pins } }
}

function selected(state: ScreenState, rows: DisplayRow[]): ProcessInfo | null {
  for (const row of rows) {
    if (row.kind === 'process' && row.proc.pid === state.selectedPid) return row.proc
  }
  return null
}

function move(state: ScreenState, rows: DisplayRow[], delta: number): ScreenState {
  const indexes = processIndexes(rows)
  if (indexes.length === 0) return state
  let pos = indexes.findIndex((index) => {
    const row = rows[index]
    return row?.kind === 'process' && row.proc.pid === state.selectedPid
  })
  if (pos < 0) pos = delta < 0 ? indexes.length - 1 : 0
  else pos = Math.min(indexes.length - 1, Math.max(0, pos + delta))
  return revealAt(state, rows, indexes[pos]!)
}

function moveEnd(state: ScreenState, rows: DisplayRow[], edge: 'start' | 'end'): ScreenState {
  const indexes = processIndexes(rows)
  if (indexes.length === 0) return state
  const index = edge === 'start' ? indexes[0]! : indexes[indexes.length - 1]!
  return revealAt({ ...state, scroll: edge === 'start' ? 0 : state.scroll }, rows, index)
}

function rowIdentity(row: Extract<DisplayRow, { kind: 'process' }>): string {
  return row.branch?.identity ?? processTreeIdentity(row.proc)
}

export function selectRow(state: ScreenState, row: Extract<DisplayRow, { kind: 'process' }>): ScreenState {
  return state.tree ? { ...state, selectedPid: row.proc.pid, treeFocus: rowIdentity(row), treeManualScroll: false }
    : { ...state, selectedPid: row.proc.pid }
}

function revealAt(state: ScreenState, rows: DisplayRow[], index: number): ScreenState {
  const row = rows[index]
  if (row?.kind !== 'process') return state
  const window = bodyWindow(state)
  let scroll = state.scroll
  if (index < scroll) scroll = index
  if (index >= scroll + window) scroll = index - window + 1
  return { ...selectRow(state, row), scroll }
}

function bodyWindow(state: ScreenState): number {
  if (state.bodyRows !== null) return Math.max(1, state.bodyRows)
  return Math.max(1, state.height - BODY_CHROME)
}

function processIndexes(rows: DisplayRow[]): number[] {
  const indexes: number[] = []
  rows.forEach((row, index) => {
    if (row.kind === 'process') indexes.push(index)
  })
  return indexes
}

function processRow(proc: ProcessInfo, pinned: boolean, prefix: string): DisplayRow {
  return { kind: 'process', proc, pinned, prefix }
}

function missingRows(missing: string[], search: string): DisplayRow[] {
  if (search.trim()) return []
  return missing.map((pin) => ({ kind: 'missing', pin }))
}
