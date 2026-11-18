import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

function occupied(path: string) {
  try { lstatSync(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function installBinary(binary: string, directory: string, env = process.env) {
  const dir = resolve(directory)
  const target = join(dir, 'sloppytop')
  const alias = join(dir, 'st')
  if (occupied(target) && !lstatSync(target).isFile()) {
    throw Error(`Refusing to replace non-regular installation: ${target}`)
  }
  const stage = mkdtempSync(join(dir, '.sloppytop-install-'))
  try {
    const path = join(stage, 'sloppytop')
    copyFileSync(binary, path)
    chmodSync(path, 0o755)
    renameSync(path, target)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  if (occupied(alias)) {
    if (lstatSync(alias).isSymbolicLink() && readlinkSync(alias) === 'sloppytop') return { target, shortcut: 'already installed' }
    return { target, shortcut: 'left unchanged (destination is occupied)' }
  }
  if ((env.PATH ?? '').split(delimiter).some((entry) => occupied(join(entry || '.', 'st')))) {
    return { target, shortcut: 'skipped (st already exists on PATH)' }
  }
  const shell = env.SHELL
  if (!shell || !isAbsolute(shell)) return { target, shortcut: 'skipped (login shell unknown)' }
  // Ask the user's interactive login shell, not the recipe shell, about
  // aliases and functions. Require a positive signal that the check ran.
  const check = spawnSync(shell, ['-lic', shell.endsWith('/fish')
    ? 'if type -q st; exit 43; else; exit 44; end'
    : 'if type st >/dev/null 2>&1; then exit 43; else exit 44; fi'], {
    cwd: env.HOME ?? process.cwd(), env, stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL',
  })
  if (check.status !== 44) return { target, shortcut: check.status === 43
    ? 'skipped (st already exists in the login shell)' : 'skipped (could not verify the login shell)' }
  try { symlinkSync('sloppytop', alias) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { target, shortcut: 'left unchanged (destination became occupied)' }
    throw error
  }
  return { target, shortcut: alias }
}

if (import.meta.main) {
  const { target, shortcut } = installBinary(process.argv[2]!, process.argv[3] ?? '/usr/local/bin')
  console.log(`Installed ${target}\nst: ${shortcut}`)
}
