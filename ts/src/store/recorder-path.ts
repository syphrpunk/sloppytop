import { accessSync, closeSync, constants, lstatSync, openSync, readSync } from 'node:fs'
import { endianness } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

/** Don't reinterpret a scheduler-relative path, SQLite URI, directory, or sidecar as a DB. */
export function explicitDatabasePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value ||
      /[\x00-\x1f\x7f]/.test(value) || !/\.(db|sqlite|sqlite3)$/i.test(basename(value))) {
    throw new Error('Use a normalized absolute SQLite filename ending in .db, .sqlite or .sqlite3')
  }
  if (process.platform === 'win32' && (!/^[a-z]:\\/i.test(value) ||
      /[:<>"|?*]|[. ](?:\\|$)|(?:^|\\)(?:CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\.|\\|$)/i.test(value.slice(2)))) {
    throw new Error('Use an unambiguous local drive path')
  }
  return value
}

function trustedOwner(uid: bigint) {
  return !process.geteuid || uid === 0n || uid === BigInt(process.geteuid())
}

export function regularFile(path: string) {
  const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true })
  if (stat && (!stat.isFile() || stat.nlink !== 1n)) throw new Error(`Not a regular, single-link file: ${path}`)
  if (stat && !trustedOwner(stat.uid)) throw new Error(`File owned by another user: ${path}`)
  if (stat && process.platform !== 'win32' && (stat.mode & 0o022n)) throw new Error(`Group/world-writable file: ${path}`)
  return stat
}

/** Walk from the root so no component is followed before it is checked. A sticky
 * temp root is OK above a private directory, not as a database/sidecar parent. */
export function checkedParent(path: string, allowMissing: boolean) {
  let dir = dirname(path)
  if (!isAbsolute(dir)) throw new Error(`Expected absolute directory: ${dir}`)
  const chain = [dir]
  while (dirname(dir) !== dir) {
    dir = dirname(dir)
    chain.push(dir)
  }
  let nearest: { dir: string; id: string; shared: boolean } | undefined
  for (const component of chain.reverse()) {
    const stat = lstatSync(component, { throwIfNoEntry: false, bigint: true })
    if (!stat && allowMissing) break
    if (!stat?.isDirectory()) throw new Error(`Missing or unsafe directory: ${component}`)
    if (!trustedOwner(stat.uid)) throw new Error(`Directory owned by another user: ${component}`)
    const shared = process.platform !== 'win32' && (stat.mode & 0o022n) !== 0n
    if (shared && !(stat.mode & 0o1000n)) throw new Error(`Group/world-writable directory: ${component}`)
    nearest = { dir: component, id: `${stat.dev}:${stat.ino}`, shared }
  }
  if (!nearest || nearest.shared) throw new Error(`Use a private directory for recorder files: ${path}`)
  return nearest
}

export function writable(path: string, directory = false): boolean {
  try {
    accessSync(path, constants.W_OK | (directory ? constants.X_OK : 0))
    return true
  } catch { return false }
}

export function fileStamp(stat: ReturnType<typeof regularFile>) {
  return stat && `${stat.dev}:${stat.ino}:${stat.size}:${stat.ctimeNs}:${stat.mtimeNs}`
}

// Some macOS SQLite builds leave a zero-length WAL and its index after a
// clean close. Reject unrelated files occupying the -shm name. SQLite's WAL
// index starts with duplicate 48-byte native-endian headers (version 3007000).
function looksLikeWalIndex(path: string, size: bigint) {
  if (!size || size % 32768n !== 0n) return false
  const head = Buffer.alloc(96)
  const fd = openSync(path, 'r')
  try {
    if (readSync(fd, head, 0, head.length, 0) !== head.length) return false
  } finally { closeSync(fd) }
  const version = endianness() === 'LE' ? head.readUInt32LE() : head.readUInt32BE()
  return version === 3007000 && head.subarray(0, 48).equals(head.subarray(48))
}

/** immutable SQLite inspection ignores journals. Never guess when they could contain data. */
export function databaseFiles(path: string, allowMissingParent: boolean) {
  const parent = checkedParent(path, allowMissingParent)
  const file = regularFile(path)
  const wal = regularFile(`${path}-wal`)
  const shm = regularFile(`${path}-shm`)
  if (regularFile(`${path}-journal`) || (wal && (!file || wal.size !== 0n)) || (shm && (!wal || !looksLikeWalIndex(`${path}-shm`, shm.size)))) {
    throw new Error(`Active or ambiguous SQLite sidecars: ${path}`)
  }
  return {
    exists: !!file,
    writable: writable(parent.dir, true) && (!file || writable(path)) &&
      (!wal || writable(`${path}-wal`)) && (!shm || writable(`${path}-shm`)),
    stamp: [parent.id, fileStamp(file), fileStamp(wal), fileStamp(shm)],
  }
}
