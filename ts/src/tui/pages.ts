// On-demand pages. The table tick does not call these loaders.
// The probe log gets counts and flags only: no cwd, environment, or addresses.

import { openFiles } from '../monitor/files.ts'
import { hardwareInventory } from '../monitor/hardware.ts'
import { diskTopology } from '../monitor/disk-topology.ts'
import { summarizeCgroup } from '../monitor/cgroup-summary.ts'
import { processDetail } from '../monitor/index.ts'
import { listeningSockets } from '../monitor/listen.ts'
import { sampleNet } from '../monitor/net.ts'
import {
  countEntry,
  hardwareEntry,
  procEntry,
  type ProbeLogEntry,
  type ProbeSet,
} from '../monitor/probes.ts'
import type { ProcessInfo } from '../monitor/types.ts'
import type { DetailState, HardwareView, PageState, ScreenEffect } from './state.ts'

export interface PageLoaders {
  processDetail: (pid: number, mode: 'names' | 'none') => Promise<{ cwd?: string; envNames?: string[] }>
  openFiles: (pid: number) => { fd: string; type?: string; name: string; protocol?: string }[] | undefined
  sampleNet: (sampleMs: number) => Promise<PageState['net']>
  listeningSockets: () => PageState['listen']
  hardwareInventory: (opts: { refresh?: boolean }) => HardwareView
  diskTopology: typeof diskTopology
  summarizeCgroup: (pid: number, ms: number) => ReturnType<typeof summarizeCgroup>
}

export interface PageContext {
  probes: ProbeSet
  sampleMs: number
  processes: ProcessInfo[]
}

export interface PagePatch {
  detail?: DetailState
  page?: PageState
  log: ProbeLogEntry[]
}

export function defaultPageLoaders(): PageLoaders {
  return {
    processDetail,
    openFiles,
    sampleNet: async (sampleMs) => sampleNet(sampleMs),
    listeningSockets: () => listeningSockets(),
    hardwareInventory: (opts) => hardwareInventory(opts),
    diskTopology,
    summarizeCgroup: (pid, ms) => process.platform === 'linux' ? summarizeCgroup(pid, ms) : Promise.resolve(undefined),
  }
}

let pageFulfills = 0

/** Overlay pages loaded. The screen tick does not add to this. */
export function pageFulfillCount(): number {
  return pageFulfills
}

export async function fulfillPage(effect: ScreenEffect, ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  pageFulfills += 1
  if (effect.openNet) return loadConnections(ctx, loaders)
  if (effect.openListen) return loadListen(ctx, loaders)
  if (effect.openTopology) return loadTopology(ctx, loaders)
  if (effect.loadCgroup != null) return loadCgroup(effect.loadCgroup, ctx, loaders)
  if (effect.openHardware || effect.refreshHardware) return loadHardware(effect.refreshHardware === true, ctx, loaders)
  const pid = effect.loadFiles ?? effect.loadEnv ?? effect.detailPid
  if (pid == null) return { log: [] }
  return loadProc(pid, effect.loadEnv != null, effect.loadFiles != null, ctx, loaders)
}

async function loadCgroup(pid: number, ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  const unavailable: PagePatch = { log: [], detail: { pid, loaded: false, cgroup: { status: 'unavailable' } } }
  if (procBlocked(ctx.probes)) return unavailable
  try {
    const totals = await loaders.summarizeCgroup(pid, ctx.sampleMs)
    if (!totals) return unavailable
    return { log: [], detail: { pid, loaded: false, cgroup: {
      status: 'ready', cpu: totals.cpu_percent_of_one_core, memory: totals.charged_memory_bytes,
    } } }
  } catch {
    return unavailable
  }
}

async function loadProc(
  pid: number,
  wantEnv: boolean,
  wantFiles: boolean,
  ctx: PageContext,
  loaders: PageLoaders,
): Promise<PagePatch> {
  const unavailable = (message: string): PagePatch => {
    const detail: DetailState = { pid, loaded: true }
    if (wantEnv) detail.env = { status: 'unavailable', message }
    else if (wantFiles) detail.files = { status: 'unavailable', message }
    else detail.message = message
    return { log: [], detail }
  }
  const blocked = procBlocked(ctx.probes)
  if (blocked) return unavailable(blocked)
  try {
    const detail = await loaders.processDetail(pid, wantEnv ? 'names' : 'none')
    const files = wantFiles ? loaders.openFiles(pid) : undefined
    const children = ctx.processes.filter((row) => row.ppid === pid).length
    const next: DetailState = { pid, loaded: true, cwd: detail.cwd }
    if (wantEnv) next.env = detail.envNames ? { status: 'ready', rows: detail.envNames } : { status: 'unavailable' }
    if (wantFiles) next.files = files ? { status: 'ready', rows: files } : { status: 'unavailable' }
    return {
      detail: next,
      log: [
        procEntry({
          pid,
          children,
          hasCwd: Boolean(detail.cwd),
          fileCount: !wantFiles || files === undefined ? null : files.length,
        }),
      ],
    }
  } catch {
    return unavailable('unavailable')
  }
}

async function loadConnections(ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.connections) return { log: [], page: off('net', 'connections') }
  try {
    const rows = (await loaders.sampleNet(ctx.sampleMs)) ?? []
    return {
      log: [countEntry('connections', rows.length)],
      page: { kind: 'net', status: 'ready', message: '', net: rows },
    }
  } catch (err) {
    return { log: [], page: failed('net', err) }
  }
}

async function loadListen(ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.listen) return { log: [], page: off('listen', 'listen') }
  try {
    const rows = loaders.listeningSockets() ?? []
    return {
      log: [countEntry('listen', rows.length)],
      page: { kind: 'listen', status: 'ready', message: '', listen: rows },
    }
  } catch (err) {
    return { log: [], page: failed('listen', err) }
  }
}

async function loadHardware(refresh: boolean, ctx: PageContext, loaders: PageLoaders): Promise<PagePatch> {
  if (!ctx.probes.hardware) return { log: [], page: off('hardware', 'hardware') }
  try {
    const report = allowHardware(loaders.hardwareInventory({ refresh }))
    return {
      log: [hardwareEntry(report)],
      page: { kind: 'hardware', status: 'ready', message: '', hardware: report },
    }
  } catch (err) {
    return { log: [], page: failed('hardware', err) }
  }
}

function loadTopology(ctx: PageContext, loaders: PageLoaders): PagePatch {
  const hardwareTab = 'topology'
  if (!ctx.probes.hardware) return { log: [], page: { ...off('hardware', 'hardware'), hardwareTab } }
  try {
    const topology = loaders.diskTopology()
    return { log: [], page: { kind: 'hardware', status: 'ready', hardwareTab, message: '', topology } }
  } catch (err) {
    return { log: [], page: { ...failed('hardware', err), hardwareTab } }
  }
}

function procBlocked(probes: ProbeSet): string | null {
  if (!probes.proc) return probeOff('proc')
  if (!probes.processes) return probeOff('processes')
  return null
}

function probeOff(name: string): string {
  return `probe ${name} is off — sloppytop probe enable ${name}`
}

function off(kind: PageState['kind'], name: string): PageState {
  return { kind, status: 'off', message: probeOff(name) }
}

function failed(kind: PageState['kind'], err: unknown): PageState {
  const message = err instanceof Error && err.message ? err.message : 'unavailable'
  return { kind, status: 'error', message }
}

/** Copy the allowlisted inventory. Serials are not part of this view. */
function allowHardware(report: HardwareView): HardwareView {
  const view: HardwareView = {
    collected_at: report.collected_at,
    displays: (report.displays ?? []).map((display) => ({
      name: display.name,
      ...(display.resolution ? { resolution: display.resolution } : {}),
      ...(display.main ? { main: true } : {}),
    })),
    ...(report.from_cache ? { from_cache: true } : {}),
  }
  const text = (key: 'chip' | 'model' | 'model_id') => {
    const value = report[key]
    if (value) view[key] = value
  }
  text('chip')
  text('model')
  text('model_id')
  const num = (key: 'logical_cores' | 'performance_cores' | 'efficiency_cores' | 'gpu_cores' | 'memory_bytes') => {
    const value = report[key]
    if (value !== undefined) view[key] = value
  }
  num('logical_cores')
  num('performance_cores')
  num('efficiency_cores')
  num('gpu_cores')
  num('memory_bytes')
  if (report.battery) {
    view.battery = {
      ...(report.battery.health ? { health: report.battery.health } : {}),
      ...(report.battery.maximum_capacity_percent !== undefined
        ? { maximum_capacity_percent: report.battery.maximum_capacity_percent }
        : {}),
      ...(report.battery.cycle_count !== undefined ? { cycle_count: report.battery.cycle_count } : {}),
      ...(report.battery.design_capacity_mah !== undefined ? { design_capacity_mah: report.battery.design_capacity_mah } : {}),
      ...(report.battery.raw_maximum_capacity_mah !== undefined ? { raw_maximum_capacity_mah: report.battery.raw_maximum_capacity_mah } : {}),
    }
  }
  if (report.cpu_features && report.cpu_features.length > 0) view.cpu_features = [...report.cpu_features]
  return view
}
