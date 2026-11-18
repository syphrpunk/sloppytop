// The stats strip and process table. Takes data and returns text.
// An omitted reading stays blank. A measured 0 is drawn as 0.

import type { SortKey } from '../filter/index.ts'
import { PROBE_NAMES, RECORD_PROBES } from '../monitor/probes.ts'
import type { CpuCoreKind, DiskDevice, ProcessInfo, SystemStats } from '../monitor/types.ts'
import { TUI_COLUMNS, type TuiColumn } from '../store/config.ts'
import { sparkline, type SparklinePoint } from '../view/sparkline.ts'
import {
  clip,
  formatBytes,
  formatBytesCompact,
  formatPercent,
  formatRuntime,
  formatWatts,
  padLeft,
  padRight,
  plain,
  widthOf,
  wrapCells,
  skipCells,
} from './format.ts'
import {
  DISCOVERY_TABS,
  SETTINGS_SECTIONS,
  recorderActions,
  reduce,
  toggleSort,
  visibleRows,
  type DisplayRow,
  type HardwareView,
  type ListenViewRow,
  type NetViewRow,
  type ScreenEffect,
  type ScreenState,
} from './state.ts'
import type { LocalSocket } from '../discovery/sockets.ts'
import { THEME_NAMES, getTheme } from './theme.ts'

const MARKER = 2
const HISTORY_CAP = 120

interface ColumnSpec {
  label: string
  width: number
  sort?: SortKey
  align: 'left' | 'right'
}

const COLUMNS: Record<TuiColumn, ColumnSpec> = {
  pid: { label: 'PID', width: 7, sort: 'pid', align: 'right' },
  name: { label: 'Name', width: 16, sort: 'name', align: 'left' },
  command: { label: 'Command', width: 24, sort: 'command', align: 'left' },
  threads: { label: 'Thr', width: 5, sort: 'threads', align: 'right' },
  user: { label: 'User', width: 10, sort: 'user', align: 'left' },
  memory: { label: 'Memory', width: 8, sort: 'memory', align: 'right' },
  cpu: { label: 'CPU%', width: 7, sort: 'cpu', align: 'right' },
  status: { label: 'Status', width: 9, sort: 'status', align: 'left' },
  runtime: { label: 'Time', width: 8, sort: 'runtime', align: 'right' },
  disk: { label: 'Disk', width: 8, sort: 'disk', align: 'right' },
  virtual: { label: 'Virt', width: 8, align: 'right' },
  gpu: { label: 'GPU', width: 7, align: 'right' },
  footprint: { label: 'Foot', width: 8, align: 'right' },
  wakeups: { label: 'Wake', width: 7, align: 'right' },
  owning_app: { label: 'App', width: 12, align: 'left' },
  cgroup: { label: 'Cgroup', width: 16, align: 'left' },
}

export interface SampleHistory {
  cpu: number[]
  mem: number[]
  disk: number[]
  rx: (number | null)[]
  tx: (number | null)[]
  /** One series per core. Absent from a sample means that tick adds no point. */
  cores: number[][]
}

export interface ColumnSpan {
  id: TuiColumn
  x: number
  width: number
  sort?: SortKey
}

export interface Layout {
  headerLine: number
  columns: ColumnSpan[]
  bodyStart: number
  bodyRows: number
  discoveryMaxOffset?: number
  overlayScrollMax?: number
  close?: { x: number; y: number; width: number }
}

export interface Frame {
  text: string
  layout: Layout
  rows: DisplayRow[]
}

export interface Pointer {
  x: number
  y: number
  kind: 'down' | 'scroll'
  scroll?: 'up' | 'down'
}

export function emptyHistory(): SampleHistory {
  return { cpu: [], mem: [], disk: [], rx: [], tx: [], cores: [] }
}

/** Retain missing network intervals as chart gaps. A measured 0 is kept. */
export function pushHistory(history: SampleHistory, system: Partial<SystemStats>): SampleHistory {
  const next: SampleHistory = {
    cpu: [...history.cpu],
    mem: [...history.mem],
    disk: [...history.disk],
    rx: [...history.rx],
    tx: [...history.tx],
    cores: history.cores.map((series) => [...series]),
  }
  if (system.cpu_usage_total !== undefined) next.cpu.push(system.cpu_usage_total)
  const mem = percent(system.memory_used, system.memory_total)
  if (mem !== undefined) next.mem.push(mem)
  const disk = percent(system.disk_used_bytes, system.disk_total_bytes)
  if (disk !== undefined) next.disk.push(disk)
  next.rx.push(system.network_rx_bytes ?? null)
  next.tx.push(system.network_tx_bytes ?? null)
  if (system.cpu_usage_per_core !== undefined) {
    const values = system.cpu_usage_per_core
    if (next.cores.length !== values.length) next.cores = values.map(() => [])
    for (let index = 0; index < values.length; index++) {
      const value = values[index]
      const series = next.cores[index] ?? []
      if (typeof value === 'number' && Number.isFinite(value)) series.push(value)
      next.cores[index] = series.length > HISTORY_CAP ? series.slice(-HISTORY_CAP) : series
    }
  }
  for (const key of ['cpu', 'mem', 'disk', 'rx', 'tx'] as const) {
    next[key].splice(0, Math.max(0, next[key].length - HISTORY_CAP))
  }
  return next
}

export function compose(
  state: ScreenState,
  input: { processes: ProcessInfo[]; system: Partial<SystemStats>; history: SampleHistory },
  view = visibleRows(state, input.processes),
): Frame {
  const width = Math.max(1, state.width)
  const height = Math.max(1, state.height)
  const fitted = fitColumns(state.columns, width, state.sortBy)
  const lines: string[] = []
  const capacity = Math.max(0, height - 1)
  const add = (line: string): boolean => {
    if (lines.length >= capacity) return false
    lines.push(fit(line, width))
    return true
  }

  add(`sloppytop  ${getTheme(state.theme).label}`)

  let headerLine = -1
  let bodyStart = lines.length
  let bodyRows = 0
  let discoveryMaxOffset: number | undefined
  let overlayScrollMax: number | undefined
  if (state.overlay === 'none') {
    for (const line of stripLines(input.system, input.history, width, height)) {
      if (!add(line)) break
    }
    const header = headerLineText(state, fitted)
    if (add(header)) headerLine = lines.length - 1
    add(hairline(width))
    bodyStart = lines.length
    const budget = Math.max(0, capacity - lines.length - 1)
    bodyRows = budget
    const shown = windowRows(view.rows, state.scroll, budget)
    let drawn = 0
    if (shown.length === 0) {
      if (budget > 0 && add(emptyText(state, view.error))) drawn++
    } else {
      for (const row of shown) {
        if (!add(rowLine(state, row, fitted))) break
        drawn++
      }
    }
    while (drawn < budget && lines.length < capacity - 1) {
      if (!add('')) break
      drawn++
    }
    add(footerText(state, input.system, view.rows))
  } else {
    bodyStart = lines.length
    const discovery = state.overlay === 'discovery' ? discoveryLines(state) : undefined
    discoveryMaxOffset = discovery?.maxOffset
    const historical = state.overlay === 'history' ? historyLines(state) : undefined
    overlayScrollMax = historical?.maxOffset
    let body = discovery?.lines ?? historical?.lines ?? overlayLines(state, input.processes, input.system)
    if (['hardware', 'detail', 'net', 'listen', 'report', 'log', 'help', 'artifact'].includes(state.overlay) ||
        (state.overlay === 'settings' && state.settingsPage?.section === 'recorder')) {
      const room = Math.max(0, height - 4)
      overlayScrollMax = Math.max(0, body.length - room)
      const offset = Math.min(state.overlayScroll ?? 0, overlayScrollMax)
      body = body.slice(offset, offset + room)
    }
    for (const line of framed(overlayTitle(state.overlay), body.filter((line) => line !== 'esc  close'), width)) {
      if (!add(line)) break
    }
    while (lines.length < capacity) add('')
  }

  const applyingRecorder = state.overlay === 'settings' && state.settingsPage?.recorderEdit?.step === 'applying'
  const close = applyingRecorder ? '' : state.overlay === 'artifact' && state.artifact?.status === 'input' ? 'Esc back' : 'q close'
  const overlayHints = state.overlay === 'kill' ? 'y confirm   n cancel'
    : state.overlay === 'discovery' ? '←/→ tab ↑/↓ scroll r refresh c diff e export'
    : state.overlay === 'hardware' ? state.page?.hardwareTab === 'readings' ? 'd disks   s inventory'
      : state.page?.hardwareTab === 'topology' ? 'd inventory   s readings   r refresh' : 'd disks   s readings   r refresh'
    : state.overlay === 'detail' ? state.detail?.subtree ? 't process details' : 't subtree   g cgroup   e env   o files'
    : state.overlay === 'columns' ? '↑/↓ select   Space toggle'
    : state.overlay === 'theme' ? '↑/↓ preview   Enter use'
    : state.overlay === 'settings' ? settingsHints(state)
    : state.overlay === 'report' ? 'c compare  w workloads  l RSS  e export'
    : state.overlay === 'artifact' && state.artifact?.status === 'input' ? 'Tab field   Enter submit'
    : state.overlay === 'artifact' && state.artifact?.kind === 'compare' && state.artifact.status === 'ready' ? '←/→ pan'
    : state.overlay === 'history' && state.historyPage?.status === 'ready'
      ? state.historyPointIndex !== null ? 'i overview   ←/→ sample'
        : state.historyDiskIndex === null ? (state.historyPage.diskMetrics.length ? 'd disks   i inspect' : 'i inspect')
          : 'd overview   ←/→ metric' : ''
  const scrollHint = overlayScrollMax ? '   ↑/↓ scroll' : ''
  const toolbar = fit(state.overlay === 'none' ? toolbarText(state, view.rows, input.processes.length, view.error)
    : [close, overlayHints].filter(Boolean).join('   ') + scrollHint, width)
  const text = [...lines, toolbar].slice(0, height).join('\n')
  return {
    text,
    rows: view.rows,
    layout: {
      headerLine,
      columns: spans(fitted),
      bodyStart,
      bodyRows,
      discoveryMaxOffset,
      overlayScrollMax,
      ...(state.overlay === 'none' ? {} : { close: { x: 0, y: capacity, width: Math.min(width, close.length) } }),
    },
  }
}

export function applyPointer(
  state: ScreenState,
  layout: Layout,
  rows: DisplayRow[],
  pointer: Pointer,
): { state: ScreenState; effect?: ScreenEffect } {
  if (state.overlay !== 'none') {
    const close = layout.close
    if (pointer.kind === 'down' && close && pointer.y === close.y && pointer.x >= close.x && pointer.x < close.x + close.width) {
      return reduce(state, { name: 'q', ctrl: false, shift: false }, rows)
    }
    if (pointer.kind === 'scroll' && pointer.scroll && (layout.overlayScrollMax || ['discovery', 'columns', 'theme', 'settings'].includes(state.overlay))) {
      const page = state.discoveryPage
      const maxOffset = layout.discoveryMaxOffset ?? 0
      const bounded = state.overlay === 'discovery' && page
        ? { ...state, discoveryPage: { ...page, maxOffset, offset: Math.min(page.offset, maxOffset) } }
        : { ...state, overlayScrollMax: layout.overlayScrollMax }
      return reduce(bounded, { name: pointer.scroll, ctrl: false, shift: false }, rows)
    }
    return { state }
  }

  if (pointer.kind === 'scroll') {
    const delta = pointer.scroll === 'up' ? -3 : 3
    const max = Math.max(0, rows.length - layout.bodyRows)
    const scroll = Math.min(max, Math.max(0, state.scroll + delta))
    return { state: { ...state, scroll } }
  }

  if (pointer.y === layout.headerLine) {
    const span = layout.columns.find((column) => pointer.x >= column.x && pointer.x < column.x + column.width)
    if (!span?.sort) return { state }
    return { state: toggleSort(state, span.sort) }
  }

  if (pointer.y >= layout.bodyStart && pointer.y < layout.bodyStart + layout.bodyRows) {
    const row = rows[state.scroll + (pointer.y - layout.bodyStart)]
    if (row?.kind === 'process') return { state: { ...state, selectedPid: row.proc.pid } }
  }
  return { state }
}

function percent(used: number | undefined, total: number | undefined): number | undefined {
  if (used === undefined || total === undefined || !(total > 0)) return undefined
  return (used / total) * 100
}

function fit(text: string, width: number): string {
  return padRight(text, width)
}

function meter(
  label: string,
  value: string,
  series: number[],
  max: number,
  width: number,
  drawSpark: boolean,
): string {
  const head = `${label}  ${value}`
  const room = width - widthOf(head) - 2
  if (!drawSpark || room < 1 || series.length === 0) return head
  return `${head}  ${sparkline(series, { max, width: room })}`
}

function cpuValue(system: Partial<SystemStats>): string {
  if (system.cpu_usage_total === undefined) return '—'
  return formatPercent(system.cpu_usage_total)
}

function memValue(system: Partial<SystemStats>): string {
  if (system.memory_used === undefined || system.memory_total === undefined) return '—'
  return `${formatBytes(system.memory_used)} / ${formatBytes(system.memory_total)}`
}

function diskValue(system: Partial<SystemStats>): string {
  if (system.disk_used_bytes === undefined || system.disk_total_bytes === undefined) return '—'
  return `${formatBytes(system.disk_used_bytes)} / ${formatBytes(system.disk_total_bytes)}`
}

/** Rows under the title and above the table. The four meters are always here. Optional readings are not. */
export function stripLineCount(system: Partial<SystemStats>, width: number, height = 24): number {
  return stripLines(system, emptyHistory(), width, height).length
}

function stripLines(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  if (width >= 96 && height >= 30) return panelStrip(system, history, width, height)
  return compactStrip(system, history, width, height)
}

/** Short terminals keep one labeled band so the process table still has rows. */
function compactStrip(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  const half = Math.max(8, Math.floor((width - 2) / 2))
  const required = [
    band('system', width),
    ...joinPair(
      meter('CPU', cpuValue(system), history.cpu, 100, half, system.cpu_usage_total !== undefined),
      meter('MEM', memValue(system), history.mem, 100, half, system.memory_used !== undefined && system.memory_total !== undefined),
      width,
    ),
    meter(
      'DSK',
      diskValue(system),
      history.disk,
      100,
      width,
      system.disk_used_bytes !== undefined && system.disk_total_bytes !== undefined,
    ),
    ...netRows(system, history, width),
  ]
  if (showCores(system, width)) required.push(coresLine(system))
  const optional = [
    ...powerRows(system, width),
    ...thermalRows(system, width),
    ...pressureRows(system, width),
    ...memoryRows(system, width),
    ...gpuRows(system, width),
    ...sensorRows(system, width),
    ...batteryRows(system, width),
    ...swapRows(system, width),
    ...diskRows(system, width),
    ...hostRows(system, width),
  ]
  const max = Math.max(4, height - 13)
  return fitBudget(required, optional, max)
}

/**
 * Wide terminals give each probe its own box. Readings stay one labeled cell,
 * not a wrapped sentence. cpu, mem, disk, and net are always present.
 */
function panelStrip(system: Partial<SystemStats>, history: SampleHistory, width: number, height: number): string[] {
  const columns = width >= 120 ? 3 : 2
  // Keep short wide terminals table-first, growing the panels with spare rows.
  const budget = Math.min(height - 14, 10 + 2 * (height - 30))
  const slotWidths = columnWidths(width, Array.from({ length: columns }, () => 1))
  const contentW = Math.max(8, (slotWidths[0] ?? 12) - 4)
  const fitted = fitProbePanels(probePanels(system, history, contentW), columns, budget)
  const lines: string[] = []
  for (let index = 0; index < fitted.panels.length; index += columns) {
    const row = fitted.panels.slice(index, index + columns)
    const boxes = alignPanels(
      row.map((panel, column) => {
        const panelWidth = slotWidths[column] ?? 10
        const inner = Math.max(1, panelWidth - 4)
        return box(panel.title, panel.lines.map((line) => clip(line, inner)), panelWidth)
      }),
    )
    const rowHeight = boxes[0]?.length ?? 0
    while (boxes.length < columns) boxes.push(blankColumn(slotWidths[boxes.length] ?? 10, rowHeight))
    lines.push(...zipPanels(boxes))
  }
  if (fitted.dropped.length > 0) lines.push(clip(`also  ${fitted.dropped.join('  ')}`, width))
  return lines
}

interface ProbePanel {
  title: string
  lines: string[]
}

function probePanels(system: Partial<SystemStats>, history: SampleHistory, contentW: number): ProbePanel[] {
  const panels: ProbePanel[] = [
    { title: 'cpu', lines: cpuPanel(system, history, contentW) },
    { title: 'mem', lines: memPanel(system, history, contentW) },
    { title: 'disk', lines: diskPanel(system, history, contentW) },
    { title: 'net', lines: netRows(system, history, contentW) },
  ]
  const extra: ProbePanel[] = [
    { title: 'power', lines: powerRows(system, contentW) },
    { title: 'gpu', lines: gpuRows(system, contentW) },
    { title: 'sensors', lines: [...thermalRows(system, contentW), ...sensorRows(system, contentW)] },
    { title: 'pressure', lines: pressureRows(system, contentW) },
    { title: 'battery', lines: batteryRows(system, contentW) },
    { title: 'swap', lines: swapRows(system, contentW) },
    { title: 'host', lines: hostRows(system, contentW) },
  ]
  for (const panel of extra) if (panel.lines.length > 0) panels.push(panel)
  return panels
}

function fitProbePanels(
  panels: ProbePanel[],
  columns: number,
  budget: number,
): { panels: ProbePanel[]; dropped: string[] } {
  let cap = 12
  let current = capPanels(panels, cap)
  while (cap > 3 && panelRowsHeight(current, columns) > budget) {
    cap -= 1
    current = capPanels(panels, cap)
  }
  const dropped: string[] = []
  while (panelRowsHeight(current, columns) > budget && current.length > 4) {
    const panel = current.pop()
    if (panel) dropped.unshift(panel.title)
  }
  return { panels: current, dropped }
}

function capPanels(panels: ProbePanel[], cap: number): ProbePanel[] {
  return panels.map((panel) => {
    if (panel.lines.length <= cap) return panel
    const kept = panel.lines.slice(0, Math.max(1, cap - 1))
    kept.push(`+${panel.lines.length - kept.length} more`)
    return { title: panel.title, lines: kept }
  })
}

function panelRowsHeight(panels: ProbePanel[], columns: number): number {
  let total = 0
  for (let index = 0; index < panels.length; index += columns) {
    const row = panels.slice(index, index + columns)
    total += Math.max(1, ...row.map((panel) => panel.lines.length + 2))
  }
  return total
}

function blankColumn(width: number, height: number): string[] {
  const line = ' '.repeat(Math.max(0, width))
  return Array.from({ length: Math.max(1, height) }, () => line)
}

function cpuPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  const lines = [meter('CPU', cpuValue(system), history.cpu, 100, contentW, system.cpu_usage_total !== undefined)]
  const cores = system.cpu_usage_per_core
  if (!cores || cores.length === 0) return lines
  const kinds = system.cpu_core_kinds
  const labeled = !!kinds && kinds.length === cores.length
  const shown = Math.min(cores.length, 16)
  const colW = Math.max(6, Math.floor((contentW - 2) / 2))
  for (let index = 0; index < shown; index += 2) {
    const left = coreCell(system, history, index, labeled, colW)
    const right = index + 1 < shown ? coreCell(system, history, index + 1, labeled, colW) : ''
    lines.push(...joinPair(left, right, contentW))
  }
  if (cores.length > 16) lines.push(`+${cores.length - 16} cores`)
  return lines
}

function coreCell(
  system: Partial<SystemStats>,
  history: SampleHistory,
  index: number,
  labeled: boolean,
  colW: number,
): string {
  const value = system.cpu_usage_per_core?.[index]
  const pct = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(0) : '—'
  const mark = labeled ? kindMark(system.cpu_core_kinds?.[index]) : ''
  const series = history.cores[index] ?? []
  const label = `c${index}`
  const reading = `${pct}${mark}`
  const sparkW = colW - widthOf(label) - widthOf(reading) - 2
  if (sparkW < 3 || series.length === 0) return `${label} ${reading}`
  return `${label} ${sparkline(series, { max: 100, width: sparkW })} ${reading}`
}

function memPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  return [
    meter(
      'MEM',
      memValue(system),
      history.mem,
      100,
      contentW,
      system.memory_used !== undefined && system.memory_total !== undefined,
    ),
    ...memoryRows(system, contentW),
  ]
}

function diskPanel(system: Partial<SystemStats>, history: SampleHistory, contentW: number): string[] {
  const lines = [
    meter(
      'DSK',
      diskValue(system),
      history.disk,
      100,
      contentW,
      system.disk_used_bytes !== undefined && system.disk_total_bytes !== undefined,
    ),
  ]
  if (system.disk_free_bytes !== undefined) lines.push(factLine({ label: 'free', value: formatBytes(system.disk_free_bytes) }, contentW))
  lines.push(...diskRows(system, contentW))
  return lines
}

function fitBudget(required: string[], optional: string[], max: number): string[] {
  if (required.length >= max) return required.slice(0, max)
  const lines = [...required]
  for (const line of optional) {
    if (lines.length >= max) return lines
    lines.push(line)
  }
  return lines
}

function joinPair(left: string, right: string, width: number): string[] {
  if (!right) return left ? [left] : []
  if (!left) return [right]
  const joined = `${left}  ${right}`
  if (widthOf(joined) <= width) return [joined]
  return [left, right]
}

function columnWidths(width: number, flexes: number[]): number[] {
  const gaps = Math.max(0, flexes.length - 1)
  const avail = Math.max(flexes.length, width - gaps)
  const total = flexes.reduce((sum, flex) => sum + flex, 0)
  const widths: number[] = []
  let used = 0
  flexes.forEach((flex, index) => {
    if (index === flexes.length - 1) widths.push(Math.max(1, avail - used))
    else {
      const column = Math.max(1, Math.floor((avail * flex) / total))
      widths.push(column)
      used += column
    }
  })
  return widths
}

function zipPanels(panels: string[][]): string[] {
  const height = Math.max(0, ...panels.map((panel) => panel.length))
  const lines: string[] = []
  for (let index = 0; index < height; index++) {
    lines.push(panels.map((panel) => panel[index] ?? '').join(' '))
  }
  return lines
}

function alignPanels(panels: string[][]): string[][] {
  const height = Math.max(0, ...panels.map((panel) => panel.length))
  return panels.map((panel) => {
    if (panel.length >= height) return panel
    const sample = panel[0] ?? ''
    const empty = `│ ${' '.repeat(Math.max(0, widthOf(sample) - 4))} │`
    const bottom = panel[panel.length - 1] ?? empty
    const mid = panel.slice(0, -1)
    while (mid.length + 1 < height) mid.push(empty)
    return [...mid, bottom]
  })
}

function box(title: string, body: string[], width: number): string[] {
  const contentW = Math.max(0, width - 4)
  const rows = (body.length > 0 ? body : ['']).map((line) => `│ ${padRight(line, contentW)} │`)
  return [band(title, width), ...rows, bandBottom(width)]
}

function band(title: string, width: number): string {
  if (width <= 0) return ''
  const label = title ? ` ${title} ` : ''
  const dashes = width - 3 - widthOf(label)
  if (dashes < 1) return clip(`╭─${label}╮`, width)
  return `╭─${label}${'─'.repeat(dashes)}╮`
}

function bandBottom(width: number): string {
  if (width < 2) return clip('╰╯', width)
  return `╰${'─'.repeat(width - 2)}╯`
}

function hairline(width: number): string {
  return '─'.repeat(Math.max(1, width))
}

const LABEL_W = 8

interface Fact {
  label: string
  value: string
  graphic?: string
}

function factLine(fact: Fact, width: number): string {
  const label = padRight(clip(fact.label, LABEL_W), Math.min(LABEL_W, Math.max(0, width)))
  let rest = Math.max(0, width - widthOf(label))
  const graphic = fact.graphic ?? ''
  if (graphic && rest > widthOf(graphic) + 1) {
    rest -= widthOf(graphic) + 1
    return clip(`${label}${graphic} ${clip(fact.value, rest)}`, width)
  }
  return clip(`${label}${clip(fact.value, rest)}`, width)
}

/** One fact per row. Two facts on one row move every row under them when a reading appears or disappears. */
function stackFacts(facts: Fact[], width: number): string[] {
  return facts.map((fact) => factLine(fact, width))
}

function usageBar(pct: number, width: number): string {
  if (width <= 0 || !Number.isFinite(pct)) return ''
  const clamped = Math.max(0, Math.min(100, pct)) / 100
  const exact = clamped * width
  const full = Math.floor(exact)
  const half = exact - full >= 0.5 && full < width
  let bar = '⣿'.repeat(full)
  if (half) bar += '⡇'
  while ([...bar].length < width) bar += '⠶'
  return [...bar].slice(0, width).join('')
}

function memoryRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatBytes(value) })
  }
  add('wired', system.memory_wired_bytes)
  add('comp', system.memory_compressed_bytes)
  add('app', system.memory_app_bytes)
  add('cache', system.memory_cached_bytes)
  add('free', system.memory_free)
  const lines = stackFacts(facts, width)
  const pages: Fact[] = []
  const addRate = (label: string, value: number | undefined) => {
    if (value === undefined) return
    pages.push({ label, value: `${formatRate(value)}/s` })
  }
  addRate('in', system.pageins_per_s)
  addRate('out', system.pageouts_per_s)
  addRate('cmp', system.compressions_per_s)
  addRate('dec', system.decompressions_per_s)
  lines.push(...stackFacts(pages, width))
  return lines
}

function diskRows(system: Partial<SystemStats>, width: number): string[] {
  const devices = system.disk_devices ?? []
  const lines: string[] = []
  for (const device of devices.slice(0, 2)) lines.push(...deviceRows(device, width))
  if (devices.length > 2) lines.push(`+${devices.length - 2} disks`)
  return lines
}

function deviceRows(device: DiskDevice, width: number): string[] {
  const lines = [clip(plain(device.name), width), directionRow('read', device, width), directionRow('write', device, width)]
  const merge = sideRow('merge', device.read_merges_per_s, device.write_merges_per_s, '/s', width)
  if (merge) lines.push(merge)
  const size = sizeRow(device, width)
  if (size) lines.push(size)
  return lines
}

function directionRow(dir: 'read' | 'write', device: DiskDevice, width: number): string {
  const bytes = dir === 'read' ? device.read_bytes_per_s : device.write_bytes_per_s
  const iops = dir === 'read' ? device.read_iops : device.write_iops
  const latency = dir === 'read' ? device.read_latency_ms : device.write_latency_ms
  const parts = [`${formatBytesCompact(bytes)}/s`, `${formatRate(iops)} iops`]
  if (latency !== undefined) parts.push(formatMs(latency))
  return factLine({ label: dir, value: parts.join('  ') }, width)
}

function sideRow(
  label: string,
  read: number | undefined,
  write: number | undefined,
  suffix: string,
  width: number,
): string | undefined {
  if (read === undefined && write === undefined) return undefined
  const parts = [
    read === undefined ? '' : `r ${formatRate(read)}${suffix}`,
    write === undefined ? '' : `w ${formatRate(write)}${suffix}`,
  ].filter((part) => part !== '')
  return factLine({ label, value: parts.join('  ') }, width)
}

function sizeRow(device: DiskDevice, width: number): string | undefined {
  if (device.read_request_bytes === undefined && device.write_request_bytes === undefined) return undefined
  const parts = [
    device.read_request_bytes === undefined ? '' : `r ${formatBytesCompact(device.read_request_bytes)}`,
    device.write_request_bytes === undefined ? '' : `w ${formatBytesCompact(device.write_request_bytes)}`,
  ].filter((part) => part !== '')
  return factLine({ label: 'size', value: parts.join('  ') }, width)
}

function hostRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const load = loadNumbers(system.load_avg)
  if (load) facts.push({ label: 'load', value: load })
  if (system.uptime_secs !== undefined) facts.push({ label: 'up', value: formatRuntime(system.uptime_secs) })
  if (system.hostname) facts.push({ label: 'host', value: plain(system.hostname) })
  if (system.os_version) facts.push({ label: 'os', value: plain(system.os_version) })
  if (system.kernel_version) facts.push({ label: 'kernel', value: plain(system.kernel_version) })
  if (system.process_count !== undefined) facts.push({ label: 'procs', value: String(system.process_count) })
  if (system.cpu_brand) facts.push({ label: 'chip', value: plain(system.cpu_brand) })
  if ((system.cpu_usage_per_core?.length ?? 0) === 0 && system.core_count !== undefined) {
    facts.push({ label: 'cores', value: String(system.core_count) })
  }
  return stackFacts(facts, width)
}

function loadNumbers(load: SystemStats['load_avg'] | undefined): string | undefined {
  if (!load || load.length !== 3) return undefined
  if (!load.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  return load.map((value) => value.toFixed(2)).join(' ')
}

function powerRows(system: Partial<SystemStats>, width: number): string[] {
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatWatts(value) })
  }
  add('cpu', system.cpu_power_watts)
  add('gpu', system.gpu_power_watts)
  add('ane', system.ane_power_watts)
  add('dram', system.dram_power_watts)
  return stackFacts(facts, width)
}

function gpuRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  if (system.gpu_utilization_percent !== undefined) {
    const pct = system.gpu_utilization_percent
    lines.push(factLine({ label: 'gpu', value: formatPercent(pct), graphic: width >= 28 ? usageBar(pct, 10) : undefined }, width))
  }
  const extra: Fact[] = []
  if (system.gpu_renderer_utilization_percent !== undefined) {
    extra.push({ label: 'render', value: formatPercent(system.gpu_renderer_utilization_percent) })
  }
  if (system.gpu_tiler_utilization_percent !== undefined) {
    extra.push({ label: 'tiler', value: formatPercent(system.gpu_tiler_utilization_percent) })
  }
  lines.push(...stackFacts(extra, width))
  if (system.gpu_memory_bytes !== undefined) lines.push(factLine({ label: 'vram', value: formatBytes(system.gpu_memory_bytes) }, width))
  return lines
}

function sensorRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  for (const reading of (system.temperatures ?? []).slice(0, 8)) {
    lines.push(sensorLine(plain(reading.name), formatCelsius(reading.celsius), width))
    if (reading.headroom_celsius !== undefined && Number.isFinite(reading.headroom_celsius)) {
      lines.push(sensorLine(`${plain(reading.name)} headroom`, formatCelsius(reading.headroom_celsius), width))
    }
  }
  for (const fan of (system.fans ?? []).slice(0, 4)) {
    lines.push(sensorLine(plain(fan.name), formatRpm(fan.rpm), width))
  }
  const hiddenTemps = Math.max(0, (system.temperatures?.length ?? 0) - 8)
  const hiddenFans = Math.max(0, (system.fans?.length ?? 0) - 4)
  const hidden = hiddenTemps + hiddenFans
  if (hidden > 0) lines.push(`+${hidden} sensors`)
  return lines
}

/** The Celsius or rpm value stays at the end. The name uses whatever columns remain. */
function sensorLine(name: string, value: string, width: number): string {
  const tail = `  ${value}`
  const room = width - widthOf(tail)
  if (room < 1) return clip(value, width)
  return `${clip(name, room)}${tail}`
}

function thermalRows(system: Partial<SystemStats>, _width: number): string[] {
  const state = system.thermal_state
  if (state !== 'nominal' && state !== 'fair' && state !== 'serious' && state !== 'critical') return []
  return [`thermal  ${state}`]
}

function pressureRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  const level = system.memory_pressure_level
  if (level === 'normal' || level === 'warning' || level === 'critical') lines.push(`pressure  ${level}`)
  const facts: Fact[] = []
  const add = (label: string, value: number | undefined) => {
    if (value === undefined) return
    facts.push({ label, value: formatPercent(value) })
  }
  add('cpu', system.psi_cpu_some_avg10)
  add('io', system.psi_io_some_avg10)
  add('mem', system.psi_memory_some_avg10)
  if (system.linux_oom_kills !== undefined) {
    facts.push({ label: 'kernel OOM kills since boot', value: String(system.linux_oom_kills) })
  }
  lines.push(...stackFacts(facts, width))
  return lines
}

function batteryRows(system: Partial<SystemStats>, width: number): string[] {
  const lines: string[] = []
  if (system.battery_charge_percent !== undefined) {
    const charge = system.battery_charge_percent
    const value = Number.isFinite(charge) ? (charge === 0 ? '0%' : `${charge.toFixed(0)}%`) : '—'
    const graphic = Number.isFinite(charge) && width >= 28 ? usageBar(charge, 10) : undefined
    lines.push(factLine({ label: 'charge', value, graphic }, width))
  }
  if (system.battery_charging !== undefined) {
    lines.push(factLine({ label: 'state', value: system.battery_charging ? 'charging' : 'not charging' }, width))
  }
  return lines
}

function swapRows(system: Partial<SystemStats>, width: number): string[] {
  const used = system.swap_used_bytes
  const total = system.swap_total_bytes
  if (used === undefined && total === undefined) return []
  const value =
    used !== undefined && total !== undefined
      ? `${formatBytes(used)} / ${formatBytes(total)}`
      : formatBytes(used ?? total ?? 0)
  const share = percent(used, total)
  const graphic = share !== undefined && width >= 28 ? usageBar(share, 10) : undefined
  return [factLine({ label: 'swap', value, graphic }, width)]
}

function netRows(system: Partial<SystemStats>, history: SampleHistory, width: number): string[] {
  return [
    rateRow('rx', system.network_rx_bytes, history.rx, width),
    rateRow('tx', system.network_tx_bytes, history.tx, width),
  ]
}

function rateRow(label: string, bytes: number | undefined, series: (number | null)[], width: number): string {
  const value = bytes === undefined ? '—' : `${formatBytesCompact(bytes)}/s`
  const room = width - LABEL_W - widthOf(value) - 2
  const graphic = room >= 4 && series.some((point) => point !== null)
    ? sparkline(series, { width: Math.min(room, 24) })
    : undefined
  return factLine({ label, value, graphic }, width)
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  return abs >= 100 ? value.toFixed(0) : value.toFixed(1)
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0ms'
  return `${value.toFixed(1)}ms`
}

function formatCelsius(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0°C'
  return `${value.toFixed(1)}°C`
}

function formatRpm(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0 rpm'
  return `${Math.round(value)} rpm`
}

function showCores(system: Partial<SystemStats>, width: number): boolean {
  return width >= 60 && (system.cpu_usage_per_core?.length ?? 0) > 0
}

function coresLine(system: Partial<SystemStats>): string {
  const cores = system.cpu_usage_per_core ?? []
  const kinds = system.cpu_core_kinds
  const labeled = !!kinds && kinds.length === cores.length
  const body = cores
    .map((core, index) => {
      const value = Number.isFinite(core) ? core.toFixed(0) : '—'
      if (!labeled) return value
      return `${value}${kindMark(kinds?.[index])}`
    })
    .join(' ')
  return `cores  ${body}`
}

function kindMark(kind: CpuCoreKind | undefined): string {
  if (kind === 'performance') return 'P'
  if (kind === 'efficiency') return 'E'
  return '?'
}

const COLUMN_GAP = 1

function fitColumns(requested: TuiColumn[], width: number, sort: SortKey): { id: TuiColumn; width: number }[] {
  let cols = (requested.length > 0 ? requested : (['pid', 'name'] as TuiColumn[])).filter((id) => COLUMNS[id])
  const widths = new Map<TuiColumn, number>(cols.map((id) => [id, COLUMNS[id].width]))
  const sum = () =>
    MARKER + cols.reduce((total, id) => total + (widths.get(id) ?? 0), 0) + Math.max(0, cols.length - 1) * COLUMN_GAP
  const shrink = (id: TuiColumn, min: number) => {
    const current = widths.get(id)
    if (current !== undefined && current > min) widths.set(id, Math.max(min, current - Math.max(0, sum() - width)))
  }
  const protectedColumn = (id: TuiColumn) => id === 'pid' || id === 'name'
  const priority = (id: TuiColumn) => COLUMNS[id].sort === sort ? 2 : id === 'cpu' || id === 'memory' ? 1 : 0
  shrink('command', 12)
  while (sum() > width) {
    const drop = [...cols].reverse().filter((id) => !protectedColumn(id)).sort((a, b) => priority(a) - priority(b))[0]
    if (!drop) break
    if (priority(drop) > 0) shrink('name', 8)
    if (sum() <= width) break
    cols = cols.filter((id) => id !== drop)
    widths.delete(drop)
  }
  shrink('name', 1)
  shrink('pid', 1)
  return cols.map((id) => ({ id, width: Math.max(1, widths.get(id) ?? 1) }))
}

function spans(fitted: { id: TuiColumn; width: number }[]): ColumnSpan[] {
  let x = MARKER
  return fitted.map((column, index) => {
    const span: ColumnSpan = { id: column.id, x, width: column.width, sort: COLUMNS[column.id].sort }
    x += column.width + (index < fitted.length - 1 ? COLUMN_GAP : 0)
    return span
  })
}

function headerLineText(state: ScreenState, fitted: { id: TuiColumn; width: number }[]): string {
  const cells = fitted.map((column) => {
    const spec = COLUMNS[column.id]
    const mark = state.sortBy === spec.sort ? (state.sortOrder === 'asc' ? '^' : 'v') : ''
    return headerCell(spec.label, column.width, mark)
  })
  return `  ${cells.join(' ')}`
}

function headerCell(label: string, width: number, mark: string): string {
  if (!mark) return padRight(label, width)
  if (width === 1) return mark
  return padRight(label, width - 1) + mark
}

function rowLine(state: ScreenState, row: DisplayRow, fitted: { id: TuiColumn; width: number }[]): string {
  if (row.kind === 'missing') return padRight(`  ? ${row.pin}`, state.width)
  const selected = row.proc.pid === state.selectedPid
  const marker = selected && row.pinned ? '>*' : selected ? '> ' : row.pinned ? '* ' : '  '
  const cells = fitted.map((column) => cell(column.id, row.proc, row.prefix, column.width))
  return marker + cells.join(' ')
}

function cell(id: TuiColumn, proc: ProcessInfo, prefix: string, width: number): string {
  const spec = COLUMNS[id]
  // Fold distant ancestors before clipping the label; a deep branch must
  // not turn the entire name cell into whitespace and line art.
  if (id === 'name' && prefix && prefix.length > width - 4) {
    prefix = width >= 8 ? '…' + prefix.slice(-3) : ''
  }
  const text = cellText(id, proc, prefix)
  return spec.align === 'right' ? padLeft(text, width) : padRight(text, width)
}

function cellText(id: TuiColumn, proc: ProcessInfo, prefix: string): string {
  switch (id) {
    case 'pid':
      return String(proc.pid)
    case 'name':
      return plain(prefix + proc.name)
    case 'command':
      return plain(proc.command)
    case 'threads':
      return proc.threads === undefined ? '' : String(proc.threads)
    case 'user':
      return plain(proc.user)
    case 'memory':
      return formatBytesCompact(proc.memory_bytes)
    case 'cpu':
      return Number.isFinite(proc.cpu_usage) ? proc.cpu_usage.toFixed(1) : ''
    case 'status':
      return plain(proc.status)
    case 'runtime':
      return formatRuntime(proc.runtime_secs)
    case 'disk':
      return formatBytesCompact(proc.disk_read_bytes + proc.disk_write_bytes)
    case 'virtual':
      return proc.virtual_memory_bytes === undefined ? '' : formatBytesCompact(proc.virtual_memory_bytes)
    case 'gpu':
      return proc.gpu_time_ms === undefined ? '' : proc.gpu_time_ms.toFixed(1)
    case 'footprint':
      return proc.phys_footprint_bytes === undefined ? '' : formatBytesCompact(proc.phys_footprint_bytes)
    case 'wakeups':
      return proc.idle_wakeups_per_s === undefined ? '' : proc.idle_wakeups_per_s.toFixed(1)
    case 'owning_app':
      return proc.owning_app === undefined ? '' : plain(proc.owning_app)
    case 'cgroup':
      return proc.cgroup === undefined ? '' : plain(proc.cgroup)
    default:
      return ''
  }
}

function windowRows(rows: DisplayRow[], scroll: number, budget: number): DisplayRow[] {
  if (budget <= 0) return []
  const max = Math.max(0, rows.length - budget)
  const start = Math.min(Math.max(0, scroll), max)
  return rows.slice(start, start + budget)
}

function emptyText(state: ScreenState, error: string): string {
  if (state.processesOff) return 'processes probe is off'
  if (error) return error
  if (state.waiting) return 'sampling…'
  return 'no processes'
}

function overlayLines(state: ScreenState, processes: ProcessInfo[], system: Partial<SystemStats>): string[] {
  if (state.overlay === 'help') return helpLines()
  if (state.overlay === 'kill') return killLines(state, processes)
  if (state.overlay === 'detail') return detailLines(state, processes)
  if (state.overlay === 'columns') return columnLines(state)
  if (state.overlay === 'theme') return themeLines(state)
  if (state.overlay === 'net' || state.overlay === 'listen' || state.overlay === 'hardware') return pageLines(state, system)
  if (state.overlay === 'report') return reportLines(state)
  if (state.overlay === 'log') return logLines(state)
  if (state.overlay === 'settings') return settingsLines(state)
  if (state.overlay === 'record') return recordLines(state)
  if (state.overlay === 'artifact') return artifactLines(state)
  return []
}

function overlayTitle(overlay: ScreenState['overlay']): string {
  switch (overlay) {
    case 'help':
      return 'help'
    case 'kill':
      return 'kill'
    case 'detail':
      return 'process'
    case 'columns':
      return 'columns'
    case 'theme':
      return 'theme'
    case 'net':
      return 'connections'
    case 'listen':
      return 'listen'
    case 'hardware':
      return 'hardware'
    case 'history':
      return 'history'
    case 'discovery':
      return 'network discovery'
    case 'report':
      return 'report'
    case 'log':
      return 'probe log'
    case 'settings':
      return 'settings'
    case 'record':
      return 'record'
    case 'artifact':
      return 'local JSON'
    default:
      return 'sloppytop'
  }
}

function artifactLines(state: ScreenState): string[] {
  const form = state.artifact
  if (!form) return []
  const title = form.kind === 'compare' ? 'compare saved discovery snapshots'
    : form.kind === 'discovery' ? 'export redacted discovery overview' : 'export redacted diagnostics'
  if (form.status === 'loading') return [title, 'working…']
  if (form.status !== 'input') return [title, ...form.lines.map(line => skipCells(plain(line), form.column ?? 0))]
  const labels = form.kind === 'compare' ? ['before', 'after'] : ['destination']
  const width = panelWidth(state.width)
  return [title, ...(form.kind === 'compare' ? ['two local JSON files of the same kind'] : ['new file only; never overwrites']),
    ...labels.flatMap((label, i) => [`${form.field === i ? '>' : ' '} ${label}`,
      `  ${form.paths[i] ? clip(form.paths[i]!, width - 2) : '(type file path)'}`])]
}

function framed(title: string, body: string[], width: number): string[] {
  if (width < 5) return [band(title, width), ...body, bandBottom(width)]
  const inner = width - 4
  return [band(title, width), ...body.map((line) => `│ ${padRight(clip(line, inner), inner)} │`), bandBottom(width)]
}

const panelWidth = (width: number) => Math.max(1, width - 4)

function footerText(state: ScreenState, system: Partial<SystemStats>, rows: DisplayRow[]): string {
  const left = [system.hostname, system.os_version, system.kernel_version]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => plain(part))
    .join(' · ')
  const selected = rows.find((row) => row.kind === 'process' && row.proc.pid === state.selectedPid)
  let right: string
  if (state.processesOff) right = 'processes off'
  else if (selected?.kind === 'process') right = `PID ${selected.proc.pid}  ${plain(selected.proc.name)}`
  else {
    const count = system.process_count !== undefined ? system.process_count : rows.filter((row) => row.kind === 'process').length
    right = `${count} processes`
  }
  if (!left) return right
  const gap = state.width - widthOf(left) - widthOf(right)
  if (gap < 2) return `${left}  ${right}`
  return `${left}${' '.repeat(gap)}${right}`
}

function helpLines(): string[] {
  return [
    'sloppytop',
    '/ s f  search     space  pause     ?  help     q  quit',
    'up j  move        g G  ends        1-9 0  sort  T  tree',
    'p  pin   i  detail   k  kill   c  columns   t  theme   r  refresh',
    'e  env   o  files   n  connections   l  listen   h  hardware',
    'D  local network discovery',
    'a  record   v  history   w  report   b  probe log   m  settings',
    'y  confirm a kill    n  cancel    hardware r  re-read',
  ]
}

function discoveryCount(
  count: number,
  label: string,
  providers: { source: string; status: string; issues: string[]; rows: unknown[] }[],
  expected: string[],
  ownerVisibilityOnly = false,
): string {
  const observed = providers.filter(p => expected.includes(p.source))
  const complete = (p: (typeof observed)[number]) => p.status === 'ready' || p.status === 'empty' ||
    (ownerVisibilityOnly && p.status === 'partial' && p.issues.every(issue => issue === 'visibility'))
  if (expected.every(source => observed.some(p => p.source === source && complete(p)))) return `${count} ${label}`
  if (count > 0 || observed.some(complete)) return `${count} ${label} (partial)`
  return `${label}: unknown`
}

function discoveryLines(state: ScreenState): { lines: string[]; maxOffset: number } {
  const page = state.discoveryPage
  const data = page?.data
  const section = DISCOVERY_TABS[page?.tab ?? 0] ?? 'overview'
  const tab = `${section} ${1 + (page?.tab ?? 0)}/${DISCOVERY_TABS.length}`
  const detail = page?.detail
  const isDetail = section === 'connections' || section === 'dns'
  if (!page || page.loading || page.message || (isDetail ? detail?.section !== section : !data)) {
    return { lines: [tab, page?.message ?? 'reading local tables…'], maxOffset: 0 }
  }
  const lines: string[] = []
  const provider = (p: { source: string; status: string; observed_at: string; issues: string[]; rows: unknown[] }) =>
    `${p.source}: ${p.status} (${p.rows.length}) ${p.observed_at.slice(11, 19)}Z ${p.issues.join(', ')}`
  if (detail?.section === 'connections' && section === 'connections') {
    for (const p of detail.providers) {
      lines.push(provider(p))
      for (const row of p.rows) {
        lines.push(discoverySocket(row))
        lines.push(`  ${row.state} · rx ${discoveryRate(row.rx_bytes_per_s)} · tx ${discoveryRate(row.tx_bytes_per_s)}`)
      }
    }
  } else if (detail?.section === 'dns' && section === 'dns') {
    for (const p of detail.providers) {
      lines.push(provider(p))
      for (const row of p.rows) {
        lines.push(`resolver: ${row.scope}${row.interface ? ` ${row.interface}` : ''}${row.domain ? ` ${row.domain}` : ''}`)
        for (const server of row.servers) lines.push(`  server ${server}`)
        for (const suffix of row.search) lines.push(`  search ${suffix}`)
      }
    }
  } else if (data && section === 'overview') {
    const linuxSockets = data.listeners.some(p => p.platform === 'linux')
    const linuxNeighbors = data.neighbors.some(p => p.source === 'ip neighbors')
    lines.push(
      discoveryCount(data.counts.tcp_listeners, 'TCP listens', data.listeners,
        linuxSockets ? ['ss tcp4', 'ss tcp6'] : ['netstat tcp'], true),
      discoveryCount(data.counts.udp_bound, 'UDP bound', data.listeners,
        linuxSockets ? ['ss udp4', 'ss udp6'] : ['netstat udp'], true),
      `${discoveryCount(data.counts.cached_neighbors, 'cached peers', data.neighbors,
        linuxNeighbors ? ['ip neighbors'] : ['ARP cache', 'NDP cache'])} (not online status)`,
    )
    lines.push(...data.default_routes.map((r) => `default v${r.family} ${r.interface ?? '—'} via ${r.gateway ?? 'on-link or unknown'}`))
    lines.push(...[...data.interfaces, ...data.routes, ...data.neighbors, ...data.listeners].map(provider))
  } else if (data && section === 'interfaces') {
    for (const p of data.interfaces) {
      lines.push(provider(p))
      for (const row of p.rows) {
        lines.push(`${row.name} ${row.link_state ?? '—'} rx ${row.rx_bytes_per_s ?? '—'} tx ${row.tx_bytes_per_s ?? '—'} B/s`)
        for (const a of row.addresses) lines.push(`  ${a.address}${a.prefix === undefined ? '' : `/${a.prefix}`}`)
      }
    }
  } else if (data && section === 'routes') {
    for (const p of data.routes) lines.push(provider(p), ...p.rows.map((r) => `${r.destination} ${r.interface ?? '—'} ${r.gateway ?? ''}`))
  } else if (data && section === 'neighbors') {
    for (const p of data.neighbors) lines.push(provider(p), ...p.rows.map((r) => `${r.interface} ${r.address} ${r.state}`))
  } else if (data && section === 'listeners') {
    for (const p of data.listeners) lines.push(provider(p), ...p.rows.map(discoverySocket))
  }
  const size = Math.max(0, state.height - 5)
  const maxOffset = Math.max(0, lines.length - size)
  const offset = Math.min(page.offset, maxOffset)
  const observedAt = isDetail ? detail?.providers[0]?.observed_at : data?.collected_at
  return { maxOffset, lines: [`${tab}${observedAt ? ` · ${observedAt.slice(11, 19)}Z` : ''}${page.refreshed ? ' refreshed' : ''}`,
    ...lines.slice(offset, offset + size).map((line) => plain(line))] }
}

function discoverySocket(row: LocalSocket): string {
  const host = row.address.includes(':') ? `[${row.address}]` : row.address
  const owners = row.owner_visibility === 'reported' ? `PID ${row.pids.join(',')}` : 'PID unknown'
  return `${row.protocol}${row.dual_stack ? '46' : row.family} ${host}:${row.port} ${owners} · ${row.scope}`
}

function discoveryRate(rate: number | undefined): string {
  return rate === undefined ? '—' : `${rate} B/s`
}

function historyChart(label: string, values: readonly SparklinePoint[], width: number, max?: number, breaks: readonly number[] = []): string {
  const name = clip(plain(label), 18)
  const sparkWidth = Math.max(4, width - widthOf(name) - 2)
  const spark = sparkline(values, { width: sparkWidth, breaks, ...(max === undefined ? {} : { max }) })
  return `${name}  ${spark}`
}

/** Title and toolbar sit outside this list, and the frame adds two bands. */
function fitHistory(state: ScreenState, lines: string[], tail: string[] = []) {
  const budget = Math.max(0, state.height - 4)
  const head = lines[0] ?? 'history'
  const middle = lines.slice(1)
  const keptTail = tail.slice(0, Math.max(0, budget - 2))
  const room = Math.max(0, budget - 1 - keptTail.length)
  const maxOffset = room > 0 ? Math.max(0, middle.length - room) : 0
  const offset = Math.min(state.overlayScroll ?? 0, maxOffset)
  return { lines: budget ? [head, ...middle.slice(offset, offset + room), ...keptTail] : [], maxOffset }
}

function historyLines(state: ScreenState) {
  const page = state.historyPage
  if (!page || page.status === 'loading') return fitHistory(state, ['history …'])
  if (page.status !== 'ready') return fitHistory(state, ['history', ...wrapWords(page.message, panelWidth(state.width))])
  const width = chartWidth(panelWidth(state.width))
  const breaks = page.timeline?.breaks ?? []
  const coverage = page.timeline?.coverage
  const age = coverage?.latest_sample_age_seconds
  const titleSuffix = age === undefined ? '' : ` · latest ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago`
  const legend = breaks.length ? `${coverage!.unobserved_interval_marker} unobserved time   ⠂ missing reading` : '⠂ missing reading'
  if (state.historyPointIndex !== null) {
    const point = page.recent[state.historyPointIndex]
    if (!point) return fitHistory(state, ['history sample', 'no recorded sample'])
    const lines = [
      `history sample ${state.historyPointIndex + 1}/${page.recent.length}`,
      plain(point.timestamp),
      `cpu ${point.cpu.toFixed(1)}%  mem ${formatBytesCompact(point.memory)}  load ${point.load.toFixed(2)}`,
      point.gapSeconds ? `preceding gap ${point.gapSeconds}s · ${point.bootChange ? 'boot change observed' : 'cause unknown'}` : 'sample recorded · no gap flagged',
      'anomaly evidence',
    ]
    if (!point.anomalies?.length) lines.push('  no flags at this sample')
    for (const finding of point.anomalies ?? []) {
      lines.push(...wrapWords(`${finding.type}: ${finding.detail}`, panelWidth(state.width)))
      for (const item of finding.evidence) {
        lines.push(...wrapWords(`  ${item.metric} ${item.observed} ${item.operator} ${item.threshold}`, panelWidth(state.width)))
      }
    }
    lines.push('recorded interfaces')
    if (!point.interfaces?.length) lines.push('  no recorded interface readings')
    for (const link of point.interfaces ?? []) {
      lines.push(`  ${plain(link.name)}  rx ${discoveryRate(link.rx_bytes_per_s)}  tx ${discoveryRate(link.tx_bytes_per_s)}`)
    }
    lines.push('recorded top processes (by CPU)')
    if (!point.processes?.length) lines.push('  no process rows stored')
    for (const process of point.processes ?? []) {
      lines.push(`  ${process.pid}  ${formatPercent(process.cpu_usage)}  ${formatBytesCompact(process.memory_bytes)}  ${plain(process.name)}`)
    }
    return fitHistory(state, lines)
  }
  if (state.historyDiskIndex !== null) {
    const metric = page.diskMetrics[state.historyDiskIndex]
    if (!metric) return fitHistory(state, ['disk history', 'no recorded device readings'])
    const labelWidth = Math.min(32, Math.floor(width / 2))
    const chartSize = Math.max(1, width - labelWidth - 2)
    const lines = [`disk  ${metric.title}  ${state.historyDiskIndex + 1}/${page.diskMetrics.length}${titleSuffix}`]
    for (const [index, { name, values }] of metric.series.entries()) {
      const label = padRight(clip(`${index + 1} ${plain(name)}`, labelWidth), labelWidth)
      lines.push(`${label}  ${sparkline(values, { width: chartSize, max: metric.max, breaks })}`)
    }
    return fitHistory(state, lines, [legend])
  }
  const lines = [`history${titleSuffix}`]
  if (page.cpu.length > 0) lines.push(historyChart('cpu', page.cpu, width, 100, breaks))
  if (page.memory.length > 0) lines.push(historyChart('mem', page.memory, width, undefined, breaks))
  if (page.load.length > 0) lines.push(historyChart('load', page.load, width, undefined, breaks))
  for (const series of page.series) {
    if (series.values.length === 0) continue
    lines.push(historyChart(series.label, series.values, width, series.max, breaks))
  }
  for (const note of page.notes) lines.push(note)
  if (page.recent.length > 0) {
    lines.push('recent')
    for (const point of page.recent) {
      lines.push(`  ${point.at}  cpu ${point.cpu.toFixed(1)}  mem ${formatBytesCompact(point.memory)}  load ${point.load.toFixed(2)}`)
    }
  }
  return fitHistory(state, lines, breaks.length ? [legend] : [])
}

function reportLines(state: ScreenState): string[] {
  const page = state.reportPage
  if (!page || page.status === 'loading') return ['report …', 'esc  close']
  if (page.evidence && state.reportTab !== 'overview') {
    const { comparison, workloads, groupCount, leaks } = page.evidence
    if (state.reportTab === 'compare') {
      const lines = ['24h window comparison', `coverage  ${comparison.coverage.replaceAll('_', ' ')}`]
      for (const [label, window] of [['current', comparison.current], ['previous', comparison.previous]] as const) {
        lines.push(`${label}  ${window.samples} samples · ${window.observed_slots}/${window.hourly_slots} hourly slots`,
          `  from ${window.from}`, `  until ${window.to_exclusive} (excluded)`)
        if (window.cpu_avg_pct !== null && window.memory_used_avg_bytes !== null && window.load1_avg !== null) {
          lines.push(`  avg CPU ${formatPercent(window.cpu_avg_pct)}  mem ${formatBytesCompact(window.memory_used_avg_bytes)}`,
            `  avg load ${window.load1_avg.toFixed(2)}`)
        }
      }
      const delta = comparison.sampled_delta
      const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
      lines.push('sampled delta (current − previous)')
      if (delta) lines.push(`  CPU ${signed(delta.cpu_avg_percentage_points)} pp · load ${signed(delta.load1_avg)}`,
        `  memory ${delta.memory_used_avg_bytes < 0 ? '−' : delta.memory_used_avg_bytes > 0 ? '+' : ''}${formatBytes(Math.abs(delta.memory_used_avg_bytes))}`)
      else lines.push('  unavailable')
      if (comparison.warning) lines.push(...wrapWords(comparison.warning, panelWidth(state.width)))
      return lines
    }
    if (state.reportTab === 'workloads') return [
      'recorded workload CPU and summed RSS', 'coverage refers to stored process rows',
      'an incomplete zero does not prove absence',
      ...(!groupCount ? ['no workload groups configured'] : !workloads.length ? ['no samples in the last 24h'] :
        workloads.flatMap(sample => [
          `${sample.at}  #${sample.sample_id}`,
          `  ${sample.coverage}  ${sample.stored_processes}/${sample.sampled_processes} stored`,
          ...sample.groups.flatMap(group => [
            `  ${plain(group.name)} (${group.matched_processes} matched)`,
            `    CPU ${formatPercent(group.cpu_pct)}   RSS ${formatBytes(group.rss_bytes)}`,
          ]),
        ])),
    ]
    return ['RSS growth evidence', 'stored process rows · not proof of a leak',
      ...(!leaks.length ? ['no RSS growth flags in the last 24h'] : leaks.flatMap(row => [
        plain(row.name),
        `  ${row.samples} points · ${row.duration_secs} s · R² ${row.r_squared}`,
        `  from ${row.evidence.from}`,
        `  to   ${row.evidence.to}`,
        `  first ${row.evidence.first_rss_bytes} B`,
        `  last  ${row.evidence.last_rss_bytes} B`,
        `  growth ${row.total_growth_bytes} B`,
        `  slope ${row.slope_bytes_per_s} B/s`,
        `  recent slope ${row.evidence.recent_slope_bytes_per_s} B/s`,
        '  thresholds',
        ...Object.entries(row.evidence.thresholds).map(([name, value]) => `    ${name}: ${value}`),
      ])),
    ]
  }
  if (page.status !== 'ready' || !page.summary) return ['report', ...wrapWords(page.message, panelWidth(state.width)), 'esc  close']
  const summary = page.summary
  const width = chartWidth(panelWidth(state.width))
  const lines = [
    'report',
    `cpu ${summary.cpu_avg.toFixed(1)} avg  ${summary.cpu_peak.toFixed(1)} peak`,
    `mem ${formatBytesCompact(summary.memory_used_avg)} avg  ${formatBytesCompact(summary.memory_used_peak)} peak`,
    `load ${summary.load1_avg.toFixed(2)} avg  ${summary.load1_peak.toFixed(2)} peak`,
  ]
  if (page.cpu.length > 0) lines.push(`cpu  ${sparkline(page.cpu, { max: 100, width })}`)
  if (page.memory.length > 0) lines.push(`mem  ${sparkline(page.memory, { width })}`)
  if (page.load.length > 0) lines.push(`load ${sparkline(page.load, { width })}`)
  for (const hour of page.hourly.slice(-4)) {
    lines.push(`${hour.hour.slice(11, 16)}  n ${hour.samples}  cpu ${hour.cpu_avg.toFixed(1)}/${hour.cpu_peak.toFixed(1)}`)
  }
  if (page.top.length > 0) {
    lines.push('top')
    for (const row of page.top) lines.push(`  ${plain(row.name)}  ${row.cpu_avg.toFixed(1)}%  ${formatBytesCompact(row.memory_avg_bytes)}`)
  }
  if (page.anomalies.length > 0) {
    lines.push('anomalies')
    for (const row of page.anomalies) lines.push(`  ${row.at.slice(11, 19)}  ${row.type}`)
  }
  if (page.leaks.length > 0) {
    lines.push('rss leaks')
    for (const row of page.leaks) lines.push(`  ${plain(row.name)}  ${formatBytesCompact(row.total_growth_bytes)}`)
  }
  if (page.groups.length > 0) {
    lines.push('groups')
    for (const row of page.groups) lines.push(`  ${plain(row.name)}  ${row.score.toFixed(1)}`)
  }
  lines.push('esc  close')
  return lines
}

function logLines(state: ScreenState): string[] {
  const page = state.logPage
  if (!page || page.status === 'loading') return ['probe log …', 'esc  close']
  if (page.status === 'error') return ['probe log', page.message, 'esc  close']
  if (page.lines.length === 0) return ['probe log', 'no probe lines', 'esc  close']
  return ['probe log', ...page.lines.slice(-12), 'esc  close']
}

function settingsHints(state: ScreenState): string {
  switch (state.settingsPage?.section) {
    case 'probes': return 'Esc back   ↑/↓ select   Space toggle'
    case 'recorder': {
      const page = state.settingsPage
      switch (page.recorderEdit?.step) {
        case 'interval': return 'Enter review   Esc cancel'
        case 'confirm': return 'y confirm   n/Esc cancel'
        case 'applying': return ''
      }
      const { enable, disable, cadence } = recorderActions(page)
      return [enable && 'e enable', cadence && 'c cadence', disable && 'd disable', 'Esc back'].filter(Boolean).join('   ')
    }
    case 'metrics': return 'Esc back   m toggle listener'
    default: return '↑/↓ select   Enter open   m listener'
  }
}

function settingsLines(state: ScreenState): string[] {
  const page = state.settingsPage
  if (!page) return []
  if (page.section === 'probes') {
    const room = Math.max(1, state.height - 5) // framed panel, plus the scope line
    return ['Global probes · affect all collection', ...pickerWindow(PROBE_NAMES, page.probeIndex, room).map(name => {
      const mark = name === PROBE_NAMES[page.probeIndex] ? '>' : ' '
      const box = page.probes[name] ? '[x]' : '[ ]'
      const required = RECORD_PROBES.some(probe => probe === name)
      return `${mark} ${box} ${name} (${required ? 'required' : 'optional'} for recording)`
    })]
  }
  if (page.section === 'metrics') return [
    `metrics  ${page.host}:${page.port}  ${page.listening ? 'listening' : 'stopped'}`, plain(page.metricsMessage),
  ]
  const { recorder } = page
  const health = recorder.status === 'ready' ? recorder.health : undefined
  const service = health?.service
  const on = service?.scheduler_state === 'armed' ? 'on' : service?.scheduler_state === 'inactive' ? 'off' : 'unknown'
  const summary = recorder.status === 'loading' ? 'Recorder: checking…' : recorder.status === 'error' ? 'Recorder: unavailable'
    : `Recorder: ${on} · cadence ${service?.cadence ?? 'unknown'} · last run ${service?.last_run?.outcome ?? 'unknown'}`
  if (page.section === 'overview') {
    const labels = {
      recorder: 'Recorder details', probes: 'Global probe switches',
      metrics: `Metrics listener (${page.listening ? 'listening' : 'stopped'})`,
    }
    const compact = state.height <= 12
    const choices = compact ? [SETTINGS_SECTIONS[state.panelIndex]!] : SETTINGS_SECTIONS
    const position = compact ? ` (${state.panelIndex + 1}/${SETTINGS_SECTIONS.length})` : ''
    return [summary, ...choices.map(section => `${section === SETTINGS_SECTIONS[state.panelIndex] ? '>' : ' '} ${labels[section]}${position}`)]
  }
  const edit = page.recorderEdit
  const wrap = (lines: string[]) => lines.flatMap(line => wrapCells(plain(line), panelWidth(state.width)))
  const message = page.recorderMessage?.split('\n') ?? []
  if (edit?.step === 'applying') return ['Applying change and checking actual state…']
  if (edit?.step === 'interval') return wrap([
    edit.kind === 'enable' ? 'Enable scheduled recording' : 'Change recorder cadence',
    `Interval in seconds (minimum 60): ${edit.draft}▏`, ...message,
  ])
  if (edit?.step === 'confirm') {
    const change = edit.change
    return wrap(change.kind === 'disable' ? ['Disable scheduled recording?', 'Remove the scheduled job. Stored history is kept.']
      : [change.kind === 'enable' ? 'Enable scheduled recording?' : 'Change recorder cadence?',
        `Store one sample now, then schedule every ${change.seconds}s.`, `Database: ${health?.databasePath ?? 'unknown'}`])
  }
  if (!health) return [...wrap(message), summary, ...(recorder.status === 'error' ? wrapCells(plain(recorder.message), panelWidth(state.width)) : [])]
  const run = service?.last_run
  const exit = run?.exit_code === undefined ? '' : ` (exit ${run.exit_code})`
  const disabled = RECORD_PROBES.filter(name => !page.probes[name])
  const details = [
    summary, ...message,
    service ? `service  ${service.scheduler}  ${service.installed ? 'installed' : 'not installed'}` : `scheduler: ${health.schedulerError ?? 'unavailable'}`,
    `scheduler  ${service?.scheduler_state ?? 'unknown'}   recorder  ${service?.recorder_state ?? 'unknown'}`,
    `last run  ${run ? run.outcome + exit : 'unknown'}`,
    `latest insert  ${health.last_successful_sample_at ?? (health.insertError ? 'unavailable' : 'none')}`,
    ...(health.insertError ? [`database error: ${health.insertError}`] : []),
    `sample age  ${health.sample_age_seconds === undefined ? 'unavailable' : `${health.sample_age_seconds} s`} (any insert)`,
    `database  ${health.databasePath}`,
    disabled.length ? `recording blocked: required probes off: ${disabled.join(', ')}` : 'required probes: all enabled',
  ]
  return wrap(details)
}

function recordLines(state: ScreenState): string[] {
  return ['record', ...wrapWords(state.recordPage?.message ?? 'recording…', panelWidth(state.width)), 'esc  close']
}

function wrapWords(text: string, width: number): string[] {
  const limit = Math.max(8, width)
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word
    if (widthOf(next) > limit && current) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

function chartWidth(width: number): number {
  return Math.max(8, width - 6)
}

function processFactLines(proc: ProcessInfo): string[] {
  const lines = [
    `cpu     ${formatPercent(proc.cpu_usage)}`,
    `memory  ${formatBytes(proc.memory_bytes)}`,
    `read    ${formatBytesCompact(proc.disk_read_bytes)}/s`,
    `write   ${formatBytesCompact(proc.disk_write_bytes)}/s`,
    `user    ${plain(proc.user)}`,
    `status  ${plain(proc.status)}`,
    `time    ${formatRuntime(proc.runtime_secs)}`,
  ]
  if (proc.threads !== undefined) lines.push(`threads ${proc.threads}`)
  if (proc.virtual_memory_bytes !== undefined) lines.push(`virtual ${formatBytes(proc.virtual_memory_bytes)}`)
  if (proc.gpu_time_ms !== undefined) lines.push(`gpu     ${proc.gpu_time_ms.toFixed(1)} ms`)
  if (proc.phys_footprint_bytes !== undefined) lines.push(`foot    ${formatBytes(proc.phys_footprint_bytes)}`)
  if (proc.idle_wakeups_per_s !== undefined) lines.push(`wakeups ${proc.idle_wakeups_per_s.toFixed(1)}/s`)
  if (proc.owning_app) lines.push(`app     ${plain(proc.owning_app)}`)
  if (proc.cgroup) lines.push(`cgroup  ${plain(proc.cgroup)}`)
  return lines
}

function killLines(state: ScreenState, processes: ProcessInfo[]): string[] {
  const proc = processes.find((row) => row.pid === state.selectedPid)
  const name = proc ? plain(proc.name) : 'process'
  const pid = state.selectedPid ?? 0
  return [`kill ${pid} ${name}?`, 'y  confirm', 'n  cancel']
}

function detailLines(state: ScreenState, processes: ProcessInfo[]): string[] {
  const pid = state.detail?.pid ?? state.selectedPid
  const subtree = state.detail?.subtree
  if (subtree) {
    if (subtree.status !== 'ready') return [`subtree PID ${pid}`, subtree.status === 'loading' ? 'sampling…' : 'visible subtree unavailable']
    const { totals } = subtree
    const cpu = totals.cpu.percent_of_one_core
    const rss = totals.memory.summed_rss_bytes
    return [
      `subtree PID ${totals.root_pid} · ${totals.visible_processes} visible`,
      'membership may be incomplete',
      `CPU ${cpu === undefined ? 'unmeasured' : `${formatPercent(cpu)} of one core`}`,
      `  measured ${totals.cpu.measured_processes}/${totals.visible_processes} visible`,
      `summed RSS ${rss === undefined ? 'unmeasured' : formatBytes(rss)}`,
      `  measured ${totals.memory.measured_processes}/${totals.visible_processes} visible`,
      'RSS can count shared pages more than once',
    ]
  }
  const proc = processes.find((row) => row.pid === pid)
  if (!proc) return ['process left the list', 'esc  close']
  const detail = state.detail?.pid === proc.pid ? state.detail : null
  if (detail?.message && detail.cwd === undefined && detail.env === undefined && detail.files === undefined && !detail.filesOmitted) {
    return [`pid ${proc.pid}  ${plain(proc.name)}`, detail.message, 'esc  close']
  }
  const cwdLine = !detail?.loaded ? 'cwd …' : detail.cwd ? `cwd ${plain(detail.cwd)}` : 'cwd'
  const children = processes.filter((row) => row.ppid === proc.pid)
  const lines = [
    `pid ${proc.pid}  ${plain(proc.name)}  ppid ${proc.ppid}`,
    ...processFactLines(proc),
    cwdLine,
    'children',
    ...(children.length === 0 ? ['  none'] : children.slice(0, 12).map((child) => `  ${child.pid} ${plain(child.name)}`)),
  ]
  const cgroup = detail?.cgroup
  if (cgroup) {
    const totals = cgroup.status === 'ready' ? [
      `  CPU: ${cgroup.cpu === undefined ? 'unmeasured' : `${cgroup.cpu}% of one core`}`,
      `  charged memory: ${cgroup.memory === undefined ? 'unmeasured' : `${cgroup.memory} B`}`,
    ] : [`  ${cgroup.status === 'loading' ? 'sampling…' : 'unavailable'}`]
    lines.splice(1, 0, 'cgroup v2 (including descendants)', ...totals)
  }
  if (detail?.env) {
    lines.push('env')
    if (detail.env.length === 0) lines.push('  none')
    else {
      for (const item of detail.env.slice(0, 8)) lines.push(`  ${plain(item)}`)
      if (detail.env.length > 8) lines.push(`  +${detail.env.length - 8} more`)
    }
  }
  if (detail?.files || detail?.filesOmitted) {
    lines.push('files')
    if (detail.filesOmitted) lines.push('  unavailable')
    else if (!detail.files || detail.files.length === 0) lines.push('  none')
    else {
      for (const file of detail.files.slice(0, 8)) {
        const type = file.type ? `${plain(file.type)} ` : ''
        const protocol = file.protocol ? ` ${plain(file.protocol)}` : ''
        lines.push(`  ${plain(file.fd)} ${type}${plain(file.name)}${protocol}`)
      }
      if (detail.files.length > 8) lines.push(`  +${detail.files.length - 8} more`)
    }
  }
  return lines
}

const PAGE_CAP = 8

function pageLines(state: ScreenState, system: Partial<SystemStats>): string[] {
  const page = state.page
  if (!page || page.kind !== state.overlay) return ['esc  close']
  if (page.status === 'loading') return [`${pageTitle(page.kind)} …`, 'esc  close']
  if (page.status === 'off' || page.status === 'error') return [page.message || pageTitle(page.kind), 'esc  close']
  if (page.kind === 'net') return netLines(page.net ?? [])
  if (page.kind === 'listen') return listenLines(page.listen ?? [])
  if (page.hardwareTab === 'readings') {
    const units = { volts: 'V', amps: 'A', watts: 'W' }
    const electrical = system.electrical_sensors ?? []
    const power = system.powercap_packages ?? []
    const interfaces = system.network_interfaces ?? []
    return [
      `${state.paused ? 'frozen' : 'latest'} sample readings`,
      'hwmon electrical',
      ...(electrical.length ? electrical.map(r => `  ${plain(r.name)}  ${r.value} ${units[r.unit]}`) : ['  not measured']),
      'package power (experimental)',
      ...(power.length ? power.map(r => `  ${plain(r.name)}  ${formatWatts(r.watts)}`) : ['  not measured']),
      'network interfaces',
      ...(interfaces.length ? interfaces.map(row =>
        `  ${plain(row.name)}  rx ${discoveryRate(row.rx_bytes_per_s)}  tx ${discoveryRate(row.tx_bytes_per_s)}`) : ['  not measured']),
      'NVIDIA devices (experimental)',
      ...(system.nvidia_devices?.length ? system.nvidia_devices.flatMap(device => [
        `  ${plain(device.uuid)}`,
        `  driver ${plain(device.driver_version)}`,
        `  utilization ${device.utilization_percent === undefined ? '—' : formatPercent(device.utilization_percent)}`,
        `  VRAM used ${device.vram_used_bytes === undefined ? '—' : formatBytes(device.vram_used_bytes)}`,
        `  VRAM total ${device.vram_total_bytes === undefined ? '—' : formatBytes(device.vram_total_bytes)}`,
      ]) : ['  not measured (Linux opt-in)']),
    ]
  }
  if (page.hardwareTab === 'topology') {
    const topology = page.topology ?? []
    return ['live disk topology', ...(topology.length ? topology.flatMap(disk => [
      `${plain(disk.name)}  ${disk.kind}${disk.parent ? `  parent ${plain(disk.parent)}` : ''}`,
      ...(disk.backing_devices?.length ? [`  backing: ${disk.backing_devices.map(plain).join(' ')}`] : []),
    ]) : ['disk topology unavailable'])]
  }
  return hardwareLines(page.hardware)
}

function pageTitle(kind: 'net' | 'listen' | 'hardware'): string {
  if (kind === 'net') return 'connections'
  if (kind === 'listen') return 'listen'
  return 'hardware'
}

function netLines(rows: NetViewRow[]): string[] {
  if (rows.length === 0) return ['connections  0', 'no connections', 'esc  close']
  const shown: string[] = []
  for (const row of rows.slice(0, PAGE_CAP)) {
    const socket = row.state ? `  ${plain(row.state)}` : ''
    shown.push(`${plain(row.proto)}  ${plain(row.local)}  ${plain(row.remote)}${socket}`)
    shown.push(`  ${row.pid} ${plain(row.name)}  rx ${formatBytesCompact(row.rx_bytes_per_s)}/s  tx ${formatBytesCompact(row.tx_bytes_per_s)}/s`)
  }
  return [`connections  ${rows.length}`, ...shown, ...more(rows.length), 'esc  close']
}

function listenLines(rows: ListenViewRow[]): string[] {
  if (rows.length === 0) return ['listen  0', 'no listeners', 'esc  close']
  const shown = rows.slice(0, PAGE_CAP).map((row) => {
    const pid = row.pid === undefined ? '' : `${row.pid} `
    return `${plain(row.protocol)}  ${row.port}  ${pid}${plain(row.name ?? '')}`
  })
  return [`listen  ${rows.length}`, ...shown, ...more(rows.length), 'esc  close']
}

function hardwareLines(report: HardwareView | undefined): string[] {
  if (!report) return ['hardware', 'esc  close']
  const lines = [`hardware  ${report.from_cache ? 'cached' : 'fresh'}`]
  if (report.chip) lines.push(`chip  ${plain(report.chip)}`)
  if (report.model) lines.push(`model  ${plain(report.model)}`)
  const cores = [
    report.logical_cores === undefined ? '' : `${report.logical_cores} logical`,
    report.performance_cores === undefined ? '' : `${report.performance_cores}P`,
    report.efficiency_cores === undefined ? '' : `${report.efficiency_cores}E`,
    report.gpu_cores === undefined ? '' : `${report.gpu_cores} GPU`,
  ].filter((part) => part !== '')
  if (cores.length > 0) lines.push(`cores  ${cores.join('  ')}`)
  if (report.memory_bytes !== undefined) lines.push(`memory  ${formatBytes(report.memory_bytes)}`)
  for (const display of report.displays.slice(0, 6)) {
    const resolution = display.resolution ? `  ${plain(display.resolution)}` : ''
    const main = display.main ? '  main' : ''
    lines.push(`display  ${plain(display.name)}${resolution}${main}`)
  }
  if (report.displays.length > 6) lines.push(`+${report.displays.length - 6} more`)
  if (report.battery) {
    const health = report.battery.health ? plain(report.battery.health) : 'battery'
    const capacity = report.battery.maximum_capacity_percent
    const cycles = report.battery.cycle_count
    const extra = [
      capacity === undefined ? '' : `${capacity}%`,
      cycles === undefined ? '' : `${cycles} cycles`,
    ].filter((part) => part !== '')
    lines.push(`battery  ${health}${extra.length ? `  ${extra.join('  ')}` : ''}`)
    if (report.battery.design_capacity_mah !== undefined) lines.push(`  design capacity: ${report.battery.design_capacity_mah} mAh`)
    if (report.battery.raw_maximum_capacity_mah !== undefined) lines.push(`  raw maximum: ${report.battery.raw_maximum_capacity_mah} mAh`)
  }
  if (report.cpu_features && report.cpu_features.length > 0) {
    lines.push(`flags  ${report.cpu_features.map((flag) => plain(flag)).join(' ')}`)
  }
  return lines
}

function more(count: number): string[] {
  return count > PAGE_CAP ? [`+${count - PAGE_CAP} more`] : []
}

function columnLines(state: ScreenState): string[] {
  const selected = TUI_COLUMNS[state.panelIndex]
  return ['columns', ...pickerWindow(TUI_COLUMNS, state.panelIndex, Math.max(1, state.height - 5)).map(id => {
    const on = state.columns.includes(id) ? 'x' : ' '
    const cursor = id === selected ? '>' : ' '
    return `${cursor} [${on}] ${id}`
  })]
}

function themeLines(state: ScreenState): string[] {
  const selected = THEME_NAMES[state.panelIndex]
  return ['theme', ...pickerWindow(THEME_NAMES, state.panelIndex, Math.max(1, state.height - 5)).map(name => {
    const cursor = name === selected ? '>' : ' '
    return `${cursor} ${getTheme(name).label}`
  })]
}

function pickerWindow<T>(options: readonly T[], selected: number, room: number): readonly T[] {
  const start = Math.max(0, Math.min(selected - Math.floor(room / 2), options.length - room))
  return options.slice(start, start + room)
}

function toolbarText(state: ScreenState, rows: DisplayRow[], total: number, error: string): string {
  const shown = rows.filter((row) => row.kind === 'process').length
  const mode = state.paused ? 'FROZEN' : 'live'
  const query = state.searching ? `/${state.draft}` : state.search ? `/${state.search}` : ''
  const notice = state.statusMessage || error
  const search = query || '/ search'
  const full = [
    notice,
    `${shown}/${total}`,
    mode,
    search,
    `${state.refreshMs}ms`,
    'D discover',
    'p pin',
    'k kill',
    'i process',
    'n connections',
    'l listen',
    'h hardware',
    '? help',
    'q quit',
  ]
    .filter((part) => part !== '')
    .join('   ')
  if (widthOf(full) <= state.width) return full
  const short = [notice, `${shown}/${total}`, mode, query, 'D discover', '? help', 'q quit'].filter((part) => part !== '').join('  ')
  if (widthOf(short) <= state.width) return short
  if (widthOf('D discover  q quit') <= state.width) return 'D discover  q quit'
  return 'q quit'
}
