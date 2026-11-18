import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configPath, dbPath } from './config.ts'
import { openDb } from './db.ts'
import { confirmRecorderDestination as confirm, previewRecorderDestination as preview } from './destination.ts'

function isolated(run: (dir: string) => void) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'recorder-destination-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try { run(dir) } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

// Include sidecars, file identity, bytes and last modification (not access time).
function contents(dir: string, omitConfig = false): Record<string, unknown> {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true })
    .filter(entry => !omitConfig || join(dir, entry.name) !== configPath()).map(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return [entry.name, contents(path, omitConfig)]
    const stat = statSync(path, { bigint: true })
    return [entry.name, [stat.ino, stat.mtimeNs, readFileSync(path).toString('hex')]]
  }))
}

test('first-run preview/cancel creates nothing; confirming only creates config', () => isolated(dir => {
  const file = join(dir, 'other #1%.sqlite3')
  const before = contents(dir)
  const first = preview(file)
  expect(first.target).toEqual({ path: file, exists: false, writable: true, samples: 0 })
  expect(contents(dir)).toEqual(before)
  expect(() => confirm(structuredClone(first))).toThrow()
  confirm(first)
  expect(dbPath()).toBe(file)
  expect(existsSync(file)).toBe(false)
  expect(() => confirm(first)).toThrow()
  openDb().close()
  const beforeReset = contents(dir)
  const reset = preview(null)
  expect(reset.current).toMatchObject({ path: file, exists: true, samples: 0 })
  expect(contents(dir)).toEqual(beforeReset)
  confirm(reset)
  expect(dbPath()).toBe(join(dir, 'sloppytop', 'sloppytop.db'))
  expect(existsSync(dbPath())).toBe(false)
  expect(existsSync(file)).toBe(true)
}))

test('keeps legacy config/DB, unknown settings and both DBs intact when switching', () => isolated(dir => {
  const legacy = join(dir, 'neohtop', 'neohtop.db')
  mkdirSync(dirname(legacy))
  writeFileSync(configPath(), '{"future":5,"record":{"future":true}}')
  const other = join(dir, 'prior.db')
  openDb(legacy).close()
  openDb(other).close()
  const databases = contents(dir, true)
  const before = contents(dir)
  const view = preview(other)
  expect(view.current.path).toBe(legacy)
  expect(view.target.exists).toBe(true)
  expect(contents(dir)).toEqual(before)
  const configInode = statSync(configPath()).ino
  confirm(view)
  expect(statSync(configPath()).ino).not.toBe(configInode)
  expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toEqual({ future: 5, record: { future: true, databasePath: other } })
  confirm(preview(null))
  expect(dbPath()).toBe(legacy)
  // Exclude config: compare database bytes, identity, timestamps and all sidecars.
  expect(contents(dir, true)).toEqual(databases)
}))

test('stale preview refuses config edits, replaced DB and now-occupied new path', () => isolated(dir => {
  const file = join(dir, 'next.db')
  openDb().close()
  const first = preview(file)
  writeFileSync(configPath(), '{"pins":["keep"]}')
  function unchangedOnFailure(act: () => void) {
    const before = contents(dir)
    expect(act).toThrow()
    expect(contents(dir)).toEqual(before)
  }
  unchangedOnFailure(() => confirm(first))
  const missing = preview(file)
  writeFileSync(file, '')
  unchangedOnFailure(() => confirm(missing))
  rmSync(file)
  openDb(file).close()
  const existing = preview(file)
  const replacement = join(dir, 'replacement.db')
  openDb(replacement).close()
  renameSync(replacement, file)
  unchangedOnFailure(() => confirm(existing))
}))

test('refuses unrelated/partial/mixed schemas, malformed config and journals without writes', () => isolated(dir => {
  openDb().close()
  const file = join(dir, 'other.db')
  function refused() {
    const before = contents(dir)
    expect(() => preview(file)).toThrow()
    expect(contents(dir)).toEqual(before)
  }
  writeFileSync(file, 'not SQLite')
  refused()
  rmSync(file)
  const db = new Database(file)
  db.run('CREATE TABLE system_samples(at TEXT); CREATE TABLE process_samples(sample_id INT)')
  db.close()
  refused()
  rmSync(file)
  openDb(file).close()
  const mixed = new Database(file)
  mixed.run('CREATE TABLE unrelated(secret TEXT)')
  mixed.close()
  refused()
  rmSync(file)
  writeFileSync(file + '-journal', 'ambiguous')
  refused()
  writeFileSync(configPath(), '{')
  refused()
}))

test('will not ignore live WAL history or accept an unrelated file at the sidecar path', () => isolated(dir => {
  const path = join(dir, 'busy.db')
  const db = openDb(path)
  try {
    db.run('CREATE TABLE pending(x)')
    const before = contents(dir)
    expect(() => preview(path)).toThrow(/sidecars/)
    expect(contents(dir)).toEqual(before)
  } finally { db.close(true) }
  writeFileSync(path + '-wal', '')
  writeFileSync(path + '-shm', 'unrelated file')
  const before = contents(dir)
  expect(() => preview(path)).toThrow(/sidecars/)
  expect(contents(dir)).toEqual(before)
}))

test('rejects unsafe path forms, links, missing parents and ambiguous legacy reset', () => isolated(dir => {
  const file = join(dir, 'file.db')
  for (const path of ['', ':memory:', 'file:abc?mode=ro', 'relative.db', dir, dir + '/../test.db',
    dir + '/test.db/', join(dir, 'missing', 'file.db'), configPath(), join(dir, 'line\nbreak.db')]) {
    expect(() => preview(path)).toThrow()
  }
  symlinkSync(join(dir, 'absent'), file)
  expect(() => preview(file)).toThrow()
  rmSync(file)
  const alias = join(dir, 'alias')
  symlinkSync(dir, alias)
  expect(() => preview(join(alias, 'file.db'))).toThrow()
  openDb(file).close()
  linkSync(file, join(dir, 'alias.db'))
  expect(() => preview(file)).toThrow()
  openDb().close()
  openDb(join(dirname(dbPath()), 'neohtop.db')).close()
  expect(() => preview(null)).toThrow(/ambiguous/i)
}))

test('unwritable candidate is shown but cannot be confirmed', () => isolated(dir => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return
  const file = join(dir, 'readonly.db')
  openDb(file).close()
  chmodSync(file, 0o400)
  const before = contents(dir)
  const view = preview(file)
  expect(view.target.writable).toBe(false)
  expect(() => confirm(view)).toThrow(/not writable/i)
  expect(contents(dir)).toEqual(before)
}))

test('a manually invalid explicit setting or unrelated replacement fails closed on open', () => isolated(dir => {
  const file = join(dir, 'next.db')
  confirm(preview(file))
  const unrelated = new Database(file)
  unrelated.run('CREATE TABLE other(x)')
  unrelated.close()
  const before = contents(dir)
  expect(() => openDb()).toThrow()
  expect(contents(dir)).toEqual(before)
  for (const invalid of [null, '', 42, '../outside.db']) {
    writeFileSync(configPath(), JSON.stringify({ record: { databasePath: invalid } }))
    expect(() => openDb()).toThrow()
    expect(existsSync(join(dir, 'sloppytop', 'sloppytop.db'))).toBe(false)
  }
}))
