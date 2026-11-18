import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { updateProbes } from './config.ts'
import { openDb, queryHistory } from './db.ts'
import { RecordBlocked, recordSample } from './record.ts'

const system: SystemStats = {
  cpu_brand: 'Test CPU',
  cpu_usage_per_core: [10, 20],
  cpu_usage_total: 15,
  core_count: 2,
  memory_total: 1000,
  memory_used: 600,
  memory_free: 400,
  uptime_secs: 100,
  load_avg: [1, 2, 3],
  network_rx_bytes: 50,
  network_tx_bytes: 25,
  disk_total_bytes: 5000,
  disk_used_bytes: 2500,
  disk_free_bytes: 2500,
  hostname: 'testhost',
  os_version: 'TestOS',
  kernel_version: '1.0',
  process_count: 1,
}

const proc: ProcessInfo = {
  pid: 7,
  ppid: 1,
  name: 'p7',
  cpu_usage: 5,
  memory_bytes: 700,
  status: 'Running',
  user: 'test',
  command: '/bin/p7',
  runtime_secs: 10,
  disk_read_bytes: 0,
  disk_write_bytes: 0,
}

async function withConfigHome(run: (home: string) => Promise<void>) {
  const previous = process.env.XDG_CONFIG_HOME
  const home = mkdtempSync(join(tmpdir(), 'sloppytop-record-'))
  process.env.XDG_CONFIG_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

describe('recordSample', () => {
  test('stores one sample from the supplied reading', async () => {
    await withConfigHome(async (home) => {
      const stored = await recordSample(async () => ({ system, processes: [proc] }))
      expect(stored.recorded).toBe(true)
      expect(stored.processes_stored).toBe(1)
      expect(stored.db_path).toBe(join(home, 'sloppytop', 'sloppytop.db'))
      const db = openDb(stored.db_path)
      try {
        const rows = queryHistory(db, new Date(Date.now() - 3_600_000).toISOString(), 10)
        expect(rows).toHaveLength(1)
        expect(rows[0]!.cpu_usage_total).toBe(15)
      } finally {
        db.close()
      }
    })
  })

  test('a required probe that is off stores nothing and does not sample', async () => {
    await withConfigHome(async (home) => {
      updateProbes(['cpu'], false)
      let sampled = false
      await expect(
        recordSample(async () => {
          sampled = true
          return { system, processes: [proc] }
        }),
      ).rejects.toBeInstanceOf(RecordBlocked)
      expect(sampled).toBe(false)
      expect(existsSync(join(home, 'sloppytop', 'sloppytop.db'))).toBe(false)
    })
  })
})
