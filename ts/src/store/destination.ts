// Switching destinations changes only config. In particular, never use openDb
// for discovery: opening a recorder normally creates/migrates tables and WAL.
import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configPath, defaultDbPath } from './config.ts'
import { inspectRecorderDb } from './db.ts'
import { checkedParent, databaseFiles, explicitDatabasePath, fileStamp, regularFile, writable } from './recorder-path.ts'

export interface RecorderLocation {
  path: string
  exists: boolean
  writable: boolean
  samples: number
  first?: string
  last?: string
}

export interface RecorderDestinationPreview {
  current: RecorderLocation
  target: RecorderLocation
}

type JsonObject = Record<string, unknown>
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function inspect(path: string, isDefault: boolean) {
  const files = databaseFiles(path, isDefault)
  const history = files.exists ? inspectRecorderDb(path) : { samples: 0 }
  if (JSON.stringify(files) !== JSON.stringify(databaseFiles(path, isDefault))) {
    throw new Error('Recorder destination changed while inspecting it; preview again')
  }
  return { location: { path, exists: files.exists, writable: files.writable, ...history }, stamp: files.stamp }
}

function snapshot(request: string | null) {
  const path = configPath()
  const parent = checkedParent(path, true)
  const stat = regularFile(path)
  if (!writable(parent.dir, true) || (stat && !writable(path))) throw new Error('Recorder config is not writable')
  const raw = stat ? readFileSync(path, 'utf8') : null
  const config: unknown = raw === null ? {} : JSON.parse(raw)
  if (!object(config) || ('record' in config && !object(config.record))) throw new Error('Invalid recorder config')
  const record = (config.record ?? {}) as JsonObject
  const currentDefault = !('databasePath' in record)
  const fallback = defaultDbPath()
  const currentPath = currentDefault ? fallback : explicitDatabasePath(record.databasePath)
  const targetPath = request === null ? fallback : explicitDatabasePath(request)
  // Do not let creation of the preferred name shadow the legacy file on reset.
  const preferred = join(dirname(path), 'sloppytop.db')
  if ((request === null || targetPath === preferred) && regularFile(join(dirname(path), 'neohtop.db')) &&
      (regularFile(preferred) || targetPath === preferred)) throw new Error('Ambiguous legacy and preferred database names')
  const current = inspect(currentPath, currentDefault)
  const target = currentPath === targetPath && (currentDefault === (request === null)) ? current : inspect(targetPath, request === null)
  const preview = { current: current.location, target: target.location }
  const stamp = JSON.stringify([path, parent.id, fileStamp(stat), raw, current, target])
  return { path, config, record, currentDefault, preview, stamp, configStamp: fileStamp(stat) }
}

// Keep the confirmation token private. Mutating a display object cannot change
// what it authorizes, and a serialized or previously confirmed preview is invalid.
const tokens = new WeakMap<RecorderDestinationPreview, { request: string | null; stamp: string }>()

/** null = default (including the legacy name). Discard the result to cancel. */
export function previewRecorderDestination(request: string | null): RecorderDestinationPreview {
  const { preview, stamp } = snapshot(request)
  Object.freeze(preview.current)
  Object.freeze(preview.target)
  Object.freeze(preview)
  tokens.set(preview, { request, stamp })
  return preview
}

/** Only call on explicit confirmation. On error, present the error and require a fresh preview. */
export function confirmRecorderDestination(preview: RecorderDestinationPreview): void {
  const token = tokens.get(preview)
  if (!token) throw new Error('Expected a fresh recorder destination preview')
  tokens.delete(preview)
  const next = snapshot(token.request)
  if (next.stamp !== token.stamp) throw new Error('Recorder destination or config changed; preview again')
  if (!next.preview.target.writable) throw new Error('Recorder destination is not writable')
  if (token.request === null ? next.currentDefault : token.request === next.record.databasePath) return
  if (token.request === null) delete next.record.databasePath
  else next.record.databasePath = token.request
  next.config.record = next.record
  const dir = dirname(next.path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = join(dir, `.config-${randomUUID()}.tmp`)
  const fd = openSync(temp, 'wx', 0o600)
  try {
    try {
      writeFileSync(fd, JSON.stringify(next.config, null, 2) + '\n')
      fsyncSync(fd)
    } finally { closeSync(fd) }
    if (configPath() !== next.path || fileStamp(regularFile(next.path)) !== next.configStamp) {
      throw new Error('Recorder config changed; preview again')
    }
    if (next.configStamp) renameSync(temp, next.path)
    else linkSync(temp, next.path) // first-run config: don't clobber a concurrent creator
  } finally {
    rmSync(temp, { force: true })
  }
}
