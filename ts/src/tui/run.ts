// The screen. Only `sloppytop tui` imports this module, so other commands
// do not load the native renderer.

import { createCliRenderer, MouseButton, TextRenderable, type CliRenderer } from '@opentui/core'
import type { ProbeSet } from '../monitor/probes.ts'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { isProbeName, type ProbeName } from '../monitor/probes.ts'
import { ensureTuiConfig, loadConfig, saveConfig, updateMetrics, updateProbes } from '../store/config.ts'
import { appendProbeLog } from '../store/probe-log.ts'
import type { PageLoaders } from './pages.ts'
import { recorderMatches, type RecorderChange } from './recorder.ts'
import type { RecorderHealth } from './store.ts'
import {
  applyPointer,
  compose,
  emptyHistory,
  pushHistory,
  stripLineCount,
  type Layout,
  type SampleHistory,
} from './frame.ts'
import {
  DISCOVERY_TABS,
  emptyHistoryPage,
  ensureSelection,
  initialState,
  reduce,
  setArtifactPath,
  createRowSelector,
  pruneTreeFolds,
  wantsQuit,
  type DisplayRow,
  type DetailState,
  type KeyPress,
  type ScreenEffect,
  type ScreenState,
} from './state.ts'
import { styleFrame } from './style.ts'
import { getTheme, type Theme } from './theme.ts'
import { startTuiTrace } from './trace.ts'
import { createCollectorWorker, createTuiSampler, type SampleTick } from './sampler.ts'
import type { DiscoveryDetail, Overview } from '../discovery/overview.ts'

export function mountFrame(renderer: CliRenderer, theme: Theme): void {
  renderer.root.add(
    new TextRenderable(renderer, {
      id: 'title',
      content: `sloppytop  ${theme.label}`,
      fg: theme.text,
    }),
  )
  renderer.root.add(
    new TextRenderable(renderer, {
      id: 'hint',
      content: 'q  quit',
      fg: theme.subtext0,
    }),
  )
}

export function quitKey(name: string, ctrl: boolean): boolean {
  return name === 'q' || name === 'escape' || (ctrl && name === 'c')
}

export function bindQuit(renderer: CliRenderer, onQuit: () => void): void {
  renderer.keyInput.on('keypress', (ev) => {
    if (quitKey(ev.name, ev.ctrl)) onQuit()
  })
}

export async function runTui(
  loaders?: PageLoaders,
  loadDiscovery?: () => Promise<Overview>,
  sampleTick?: SampleTick,
  loadDiscoveryDetail?: (section: 'connections' | 'dns') => Promise<DiscoveryDetail>,
  recorder?: { read: () => RecorderHealth; change: (change: RecorderChange) => Promise<string> },
  loadSubtree?: (pid: number) => ReturnType<typeof import('../monitor/workload.ts').summarizeTree>,
  loadReport?: () => import('./state.ts').ReportView,
): Promise<void> {
  const started = performance.now()
  const trace = startTuiTrace()
  const config = ensureTuiConfig()
  trace?.since('config', started)
  const sampleMs = config.record.sampleMs
  let probes: ProbeSet = config.probes
  let state = initialState(
    {
      columns: config.tui.columns,
      theme: config.tui.theme,
      refreshMs: config.tui.refreshMs,
      pins: config.pins,
    },
    { width: 80, height: 24 },
  )
  let processes: ProcessInfo[] = []
  let system: Partial<SystemStats> = {}
  let history: SampleHistory = emptyHistory()
  let selectRows = createRowSelector(processes)
  let rows: DisplayRow[] = []
  let layout: Layout = { headerLine: -1, columns: [], bodyStart: 0, bodyRows: 0 }
  state = {
    ...state,
    probes: config.probes,
    metricsEnabled: config.metrics.enabled,
    metricsHost: config.metrics.host,
    metricsPort: config.metrics.port,
  }
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pageToken = 0
  let cgroupToken = 0
  let storeToken = 0
  let metricsStop: (() => void) | null = null
  let metricsStarting = false
  const sampler = sampleTick ? undefined : createTuiSampler()
  const discoveryWorker = createCollectorWorker()
  const onDemandWorker = createCollectorWorker()
  let discoveryQueue = Promise.resolve()

  const theme = getTheme(state.theme)
  const rendererStarted = performance.now()
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    // Coalesce a burst of window changes without leaving a stale frame for 100 ms.
    debounceDelay: 16,
    backgroundColor: theme.base,
  })
  trace?.since('rendererSetup', rendererStarted)
  renderer.useMouse = true
  const text = new TextRenderable(renderer, {
    id: 'frame',
    content: '',
    fg: theme.text,
    position: 'absolute',
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    wrapMode: 'none',
  })
  renderer.root.add(text)
  let lastFrame: { text: string; theme: Theme } | undefined

  const paint = () => {
    const paintStarted = performance.now()
    const width = renderer.terminalWidth || state.width || 80
    const height = renderer.terminalHeight || state.height || 24
    const strip = stripLineCount(system, width, height)
    const chrome = state.overlay === 'none' ? 5 : 3
    state = { ...state, width, height, bodyRows: Math.max(0, height - strip - chrome) }
    const view = selectRows(state)
    trace?.since('layoutAndRows', paintStarted)
    state = ensureSelection(state, view)
    const composeStarted = performance.now()
    const frame = compose(state, { processes, system, history }, view)
    trace?.since('compose', composeStarted)
    rows = frame.rows
    layout = frame.layout
    if (state.overlay === 'none') state = { ...state, bodyRows: frame.layout.bodyRows }
    state = { ...state, overlayScrollMax: layout.overlayScrollMax,
      overlayScroll: Math.min(state.overlayScroll ?? 0, layout.overlayScrollMax ?? 0) }
    if (state.overlay === 'discovery' && state.discoveryPage) {
      const maxOffset = layout.discoveryMaxOffset ?? 0
      state = { ...state, discoveryPage: { ...state.discoveryPage, maxOffset, offset: Math.min(state.discoveryPage.offset, maxOffset) } }
    }
    const themeNow = getTheme(state.theme)
    text.width = width
    text.height = height
    if (lastFrame?.text !== frame.text || lastFrame.theme !== themeNow) {
      const styleStarted = performance.now()
      text.content = styleFrame(frame.text, themeNow)
      text.fg = themeNow.text
      lastFrame = { text: frame.text, theme: themeNow }
      trace?.since('styleAndAssign', styleStarted)
    }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    sampler?.close()
    discoveryWorker.close()
    onDemandWorker.close()
    if (metricsStop) {
      try {
        metricsStop()
      } catch {
        // The socket can already be closed.
      }
      metricsStop = null
    }
    renderer.stop()
    renderer.destroy()
    trace?.finish()
  }

  const apply = (effect: ScreenEffect | undefined) => {
    if (!effect) return
    if (effect.kill && effect.kill.pid > 0) {
      try {
        process.kill(effect.kill.pid, 'SIGTERM')
      } catch {
        // The process can exit between the confirm and the signal.
      }
    }
    if (effect.pins || effect.tui) persist(effect)
    if (effect.toggleProbe) persistProbe(effect.toggleProbe)
    if (effect.toggleMetrics) void toggleListener()
    if (effect.detailPid != null || effect.loadEnv != null || effect.loadFiles != null ||
        effect.openNet || effect.openListen || effect.openHardware || effect.refreshHardware ||
        effect.openTopology || effect.loadCgroup != null) void fulfillAndApply(effect)
    if (effect.openHistory || effect.openDiscovery || effect.openReport || effect.openLog ||
        effect.openSettings || effect.changeRecorder || effect.record || effect.loadSubtree != null || effect.artifact) void fulfillStore(effect)
  }

  const persistProbe = (toggle: { name: ProbeName; enabled: boolean }) => {
    if (!isProbeName(toggle.name)) return
    try {
      const saved = updateProbes([toggle.name], toggle.enabled)
      probes = saved.probes
      state = {
        ...state,
        probes: saved.probes,
        settingsPage: state.settingsPage ? { ...state.settingsPage, probes: saved.probes } : state.settingsPage,
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'probe save failed'
      const probesNow = { ...state.probes, [toggle.name]: !toggle.enabled }
      state = {
        ...state,
        probes: probesNow,
        statusMessage: message,
        settingsPage: state.settingsPage
          ? { ...state.settingsPage, probes: { ...state.settingsPage.probes, [toggle.name]: !toggle.enabled } }
          : state.settingsPage,
      }
    }
  }

  const toggleListener = async () => {
    if (metricsStop) {
      const stopListener = metricsStop
      metricsStop = null
      try {
        stopListener()
      } catch {
        // The socket can already be closed.
      }
      let message = 'listener stopped'
      try {
        const saved = updateMetrics({ enabled: false })
        state = {
          ...state,
          metricsListening: false,
          metricsEnabled: saved.metrics.enabled,
          metricsHost: saved.metrics.host,
          metricsPort: saved.metrics.port,
        }
      } catch (err) {
        message = err instanceof Error && err.message ? err.message : 'metrics save failed'
        state = { ...state, metricsListening: false }
      }
      if (state.overlay === 'settings' && state.settingsPage) {
        state = {
          ...state,
          settingsPage: {
            ...state.settingsPage,
            listening: false,
            metricsEnabled: state.metricsEnabled,
            host: state.metricsHost,
            port: state.metricsPort,
            metricsMessage: message,
          },
        }
      }
      if (!stopped) paint()
      return
    }
    if (metricsStarting) return
    metricsStarting = true
    try {
      const { bindMetricsListener } = await import('./store.ts')
      if (stopped) return
      const saved = updateMetrics({ enabled: true })
      const bound = bindMetricsListener({
        host: saved.metrics.host,
        port: saved.metrics.port,
        sample: async () => (await (await import('../sample.ts')).takeSample(sampleMs)).system,
      })
      if (!bound.ok) {
        state = {
          ...state,
          metricsListening: false,
          metricsEnabled: saved.metrics.enabled,
          metricsHost: saved.metrics.host,
          metricsPort: saved.metrics.port,
        }
        if (state.settingsPage) {
          state = {
            ...state,
            settingsPage: {
              ...state.settingsPage,
              listening: false,
              metricsEnabled: saved.metrics.enabled,
              host: saved.metrics.host,
              port: saved.metrics.port,
              metricsMessage: bound.message,
            },
          }
        }
        if (!stopped) paint()
        return
      }
      metricsStop = bound.stop
      state = {
        ...state,
        metricsListening: true,
        metricsEnabled: true,
        metricsHost: saved.metrics.host,
        metricsPort: bound.port,
      }
      if (state.overlay === 'settings' && state.settingsPage) {
        state = {
          ...state,
          settingsPage: {
            ...state.settingsPage,
            listening: true,
            metricsEnabled: true,
            host: saved.metrics.host,
            port: bound.port,
            metricsMessage: `listening ${saved.metrics.host}:${bound.port}`,
          },
        }
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'metrics bind failed'
      if (state.settingsPage) {
        state = { ...state, settingsPage: { ...state.settingsPage, listening: false, metricsMessage: message } }
      }
    } finally {
      metricsStarting = false
    }
    if (!stopped) paint()
  }

  const fulfillStore = async (effect: ScreenEffect) => {
    const token = ++storeToken
    const tab = state.discoveryPage?.tab
    await Promise.resolve()
    if (stopped || token !== storeToken) return
    try {
      if (effect.openDiscovery) {
        const enabled = state.probes.network
        const section = DISCOVERY_TABS[tab ?? 0]
        const detailTab = section === 'connections' || section === 'dns'
        let detail: DiscoveryDetail | undefined
        let data: Overview | undefined
        if (enabled) {
          const collect = async () => {
            if (stopped || token !== storeToken || state.overlay !== 'discovery' || tab !== state.discoveryPage?.tab) return
            if (detailTab && loadDiscoveryDetail) detail = await loadDiscoveryDetail(section)
            else if (!detailTab && loadDiscovery) data = await loadDiscovery()
            else {
              const result = await discoveryWorker.request({ kind: 'discovery', section: detailTab ? section : 'overview' }, 16_000)
              if (result && 'detail' in result) detail = result.detail
              if (result && 'overview' in result) data = result.overview
            }
          }
          const pending = discoveryQueue.then(collect)
          discoveryQueue = pending.catch(() => {})
          await pending
        }
        if (stopped || token !== storeToken || state.overlay !== 'discovery' || !state.discoveryPage) return
        if (tab !== state.discoveryPage.tab) return
        state = { ...state, discoveryPage: { ...state.discoveryPage, loading: false,
          ...(detail ? { detail } : data ? { data } : { message: 'network probe is off' }),
        } }
      } else if ((effect.openSettings || effect.changeRecorder) && state.overlay === 'settings') {
        onDemandWorker.close()
        if (effect.changeRecorder && state.settingsPage) {
          let recorderMessage: string
          try {
            if (recorder) recorderMessage = await recorder.change(effect.changeRecorder)
            else {
              // The worker's argv points to the worker, not to the CLI entrypoint.
              const { recordCommand } = await import('../store/service.ts')
              const result = await onDemandWorker.request({ kind: 'changeRecorder', change: effect.changeRecorder,
                command: recordCommand() }, sampleMs + 60_000)
              if (!result || !('recorderMessage' in result)) throw new Error('worker unavailable')
              recorderMessage = result.recorderMessage
            }
          } catch (err) {
            recorderMessage = `Change outcome unknown: ${err instanceof Error ? err.message : String(err)}`
          }
          if (stopped || token !== storeToken) return
          state = { ...state, settingsPage: { ...state.settingsPage, recorderMessage } }
        }
        // Read both the scheduler and the destination even after a failed write.
        const reply = recorder ? { recorder: recorder.read() } : await onDemandWorker.request({ kind: 'recorder' }, 8_000)
        if (stopped || token !== storeToken || state.overlay !== 'settings' || !state.settingsPage) return
        if (!reply || !('recorder' in reply)) throw new Error('recorder health unavailable')
        const unverified = effect.changeRecorder && !recorderMatches(effect.changeRecorder, reply.recorder.service)
        state = { ...state, settingsPage: { ...state.settingsPage, recorderEdit: undefined,
          recorder: { status: 'ready', health: reply.recorder },
          ...(unverified ? { recorderMessage: `${state.settingsPage.recorderMessage}\nRequested schedule not confirmed by readback.` } : {}),
        } }
      } else if (effect.loadSubtree != null && state.overlay === 'detail') {
        const pid = effect.loadSubtree
        onDemandWorker.close()
        const reply = loadSubtree ? { subtree: loadSubtree(pid) }
          : await onDemandWorker.request({ kind: 'subtree', pid, ms: sampleMs }, sampleMs + 10_000)
        if (stopped || token !== storeToken || state.overlay !== 'detail' || state.detail?.pid !== pid || !state.detail.subtree) return
        const totals = reply && 'subtree' in reply ? reply.subtree : undefined
        state = { ...state, detail: { ...state.detail, subtree: totals ? { status: 'ready', totals } : { status: 'unavailable' } } }
      } else if (effect.artifact && state.overlay === 'artifact') {
        onDemandWorker.close()
        const reply = await onDemandWorker.request({ kind: 'artifact', input: effect.artifact }, 15_000)
        if (stopped || token !== storeToken || state.overlay !== 'artifact' || !state.artifact) return
        if (!reply || !('artifact' in reply)) throw new Error('artifact unavailable')
        state = { ...state, artifact: { ...state.artifact, status: 'ready', lines: reply.artifact } }
      } else if (effect.openReport && state.overlay === 'report') {
        onDemandWorker.close()
        const reply = loadReport ? { report: loadReport() } : await onDemandWorker.request({ kind: 'report' }, 15_000)
        if (stopped || token !== storeToken || state.overlay !== 'report') return
        if (!reply || !('report' in reply)) throw new Error('report unavailable')
        state = { ...state, reportPage: reply.report }
      } else {
        const store = await import('./store.ts')
        if (stopped || token !== storeToken) return
        if (effect.record && state.overlay === 'record') {
          const result = await store.recordWithStore()
          if (stopped || token !== storeToken || state.overlay !== 'record') return
          state = { ...state, recordPage: { message: result.message } }
        } else if (effect.openHistory && state.overlay === 'history') {
          state = { ...state, historyPage: store.loadHistory() }
        } else if (effect.openLog && state.overlay === 'log') {
          state = { ...state, logPage: { status: 'ready', message: '', lines: store.loadLog().lines } }
        }
      }
    } catch (err) {
      if (stopped || token !== storeToken) return
      const message = err instanceof Error && err.message ? err.message : 'store failed'
      if (effect.record && state.overlay === 'record') state = { ...state, recordPage: { message } }
      if (effect.openHistory && state.overlay === 'history') {
        state = { ...state, historyPage: emptyHistoryPage('error', message) }
      }
      if (effect.openDiscovery && state.overlay === 'discovery' && state.discoveryPage?.tab === tab && state.discoveryPage) {
        state = { ...state, discoveryPage: { ...state.discoveryPage, loading: false, message: 'local discovery unavailable' } }
      }
      if (effect.openReport && state.overlay === 'report' && state.reportPage) {
        state = { ...state, reportPage: { ...state.reportPage, status: 'error', message } }
      }
      if (effect.openLog && state.overlay === 'log') {
        state = { ...state, logPage: { status: 'error', message, lines: [] } }
      }
      if ((effect.openSettings || effect.changeRecorder) && state.overlay === 'settings' && state.settingsPage) {
        state = { ...state, settingsPage: { ...state.settingsPage, recorderEdit: undefined, recorder: { status: 'error', message } } }
      }
      if (effect.loadSubtree != null && state.overlay === 'detail' && state.detail?.pid === effect.loadSubtree && state.detail.subtree) {
        state = { ...state, detail: { ...state.detail, subtree: { status: 'unavailable' } } }
      }
      if (effect.artifact && state.overlay === 'artifact' && state.artifact) {
        state = { ...state, artifact: { ...state.artifact, status: 'error', lines: [message] } }
      }
    }
    if (!stopped) paint()
  }

  const fulfillAndApply = async (effect: ScreenEffect) => {
    const forCgroup = effect.loadCgroup != null
    const section = effect.loadEnv != null ? 'env' : effect.loadFiles != null ? 'files' : undefined
    const token = forCgroup ? ++cgroupToken : section ? pageToken : ++pageToken
    const isCurrent = section ? pendingSection(state, section) : () => true
    const stale = () => stopped || token !== (forCgroup ? cgroupToken : pageToken) || !isCurrent(state)
    try {
      const { fulfillPage, defaultPageLoaders } = await import('./pages.ts')
      if (stale()) return
      const patch = await fulfillPage(effect, { probes, sampleMs, processes }, loaders ??= defaultPageLoaders())
      if (stale()) return
      if (patch.detail && state.overlay === 'detail' && state.detail?.pid === patch.detail.pid) {
        state = { ...state, detail: mergeDetail(state.detail, patch.detail) }
      }
      if (patch.page && state.overlay === patch.page.kind &&
          (patch.page.kind !== 'hardware' || (state.page?.hardwareTab ?? 'inventory') === (patch.page.hardwareTab ?? 'inventory'))) {
        state = { ...state, page: patch.page }
      }
      if (patch.log.length > 0) {
        try {
          appendProbeLog(patch.log)
        } catch {
          // A failed probe-log write leaves the page on screen.
        }
      }
      if (!stopped) paint()
    } catch {
      if (section && !stale() && state.detail) {
        state = { ...state, detail: { ...state.detail, [section]: { status: 'unavailable' } } }
        paint()
      }
    }
  }

  const accept = (next: ScreenState) => {
    if (next.tree && !state.tree) next = pruneTreeFolds(next, processes)
    if (state.overlay !== next.overlay) {
      pageToken++
      cgroupToken++
      storeToken++
      state = { ...next, overlayScroll: 0, overlayScrollMax: 0 }
    } else {
      state = next
    }
  }

  text.onMouseDown = (ev) => {
    if (stopped || ev.button !== MouseButton.LEFT) return
    const result = applyPointer(state, layout, rows, { x: ev.x, y: ev.y, kind: 'down' })
    accept(result.state)
    apply(result.effect)
    paint()
  }

  text.onMouseScroll = (ev) => {
    const direction = ev.scroll?.direction
    if (stopped || (direction !== 'up' && direction !== 'down')) return
    const result = applyPointer(state, layout, rows, { x: ev.x, y: ev.y, kind: 'scroll', scroll: direction })
    state = result.state
    paint()
  }

  renderer.on('resize', () => {
    if (!stopped) {
      const resizeStarted = performance.now()
      paint()
      trace?.since('resizeCompose', resizeStarted)
    }
  })

  const tick = async () => {
    if (stopped) return
    const started = performance.now()
    try {
      const options = { paused: state.paused, sampleMs }
      const sample = await (sampleTick ? sampleTick(options) : sampler?.tick(options))
      if (sample) trace?.since('sample', started)
      if (stopped) return
      if (sample && !state.paused) {
        system = sample.system
        processes = sample.processes
        selectRows = createRowSelector(processes)
        probes = sample.probes
        history = pushHistory(history, system)
        state = pruneTreeFolds(state, processes)
        state = {
          ...state,
          waiting: false,
          processesOff: !sample.probes.processes,
          probes: sample.probes,
          statusMessage: '',
        }
        paint()
      }
    } catch (err) {
      if (stopped) return
      const message = err instanceof Error && err.message ? err.message : 'sample failed'
      state = { ...state, waiting: false, statusMessage: message }
      paint()
    }
    if (stopped) return
    const wait = Math.max(0, state.refreshMs - (performance.now() - started))
    timer = setTimeout(() => void tick(), wait)
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      stop()
      resolve()
    }
    renderer.keyInput.on('paste', (ev) => {
      const form = state.artifact
      if (stopped || state.overlay !== 'artifact' || form?.status !== 'input' || ev.bytes.length > 4096) return
      ev.preventDefault()
      const pasted = new TextDecoder().decode(ev.bytes)
      accept(setArtifactPath(state, (form.paths[form.field] ?? '') + pasted).state)
      paint()
    })
    renderer.keyInput.on('keypress', (ev) => {
      if (ev.eventType === 'release' || stopped) return
      const key: KeyPress = { name: ev.name, ctrl: ev.ctrl, shift: ev.shift }
      if (wantsQuit(state, key)) {
        finish()
        return
      }
      const result = reduce(state, key, rows)
      accept(result.state)
      apply(result.effect)
      if (!stopped) paint()
    })
    paint()
    // This screen has no animations; input, resize and changed data request frames.
    renderer.requestRender()
    trace?.since('firstFrameSubmitted', started)
    void tick()
  })
}

// A new loading object is allocated on every open, even for the same PID.
export function pendingSection(start: ScreenState, section: 'env' | 'files') {
  const request = start.detail?.[section]
  const pid = start.detail?.pid
  return (now: ScreenState) => request?.status === 'loading' && now.overlay === 'detail' &&
    now.detail?.pid === pid && now.detail?.[section] === request
}

function mergeDetail(prev: DetailState | null, next: DetailState): DetailState {
  if (!prev || prev.pid !== next.pid) return next
  return {
    ...prev,
    ...next,
    cwd: next.cwd ?? prev.cwd,
    env: next.env ?? prev.env,
    files: next.files ?? prev.files,
    cgroup: next.cgroup ?? prev.cgroup,
    message: next.message ?? prev.message,
    loaded: next.loaded || prev.loaded,
  }
}

function persist(effect: ScreenEffect): void {
  try {
    const config = loadConfig()
    if (effect.pins) config.pins = effect.pins
    if (effect.tui) config.tui = { ...config.tui, ...effect.tui }
    saveConfig(config)
  } catch {
    // A failed write leaves the screen on the values already in memory.
  }
}
