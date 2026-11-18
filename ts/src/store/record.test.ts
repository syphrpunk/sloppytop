import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { ProcessInfo, SystemStats } from '../monitor/types.ts'
import { loadConfig, updateProbes, updateRecordGroup } from './config.ts'
import { openDb, queryHistory, queryTopProcesses } from './db.ts'
import { renderSystemMetrics } from './openmetrics.ts'
import { readProbeLog } from './probe-log.ts'
import { OPTIONAL_RECORD_GROUPS } from './record-policy.ts'
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
      const stored = await recordSample(async () => ({
        system: { ...system, linux_oom_kills: 0 },
        processes: [proc],
        linuxBootId: 'private-boot-id',
      }))
      expect(stored.recorded).toBe(true)
      expect(stored.processes_stored).toBe(1)
      expect(stored.db_path).toBe(join(home, 'sloppytop', 'sloppytop.db'))
      const db = openDb(stored.db_path)
      try {
        const rows = queryHistory(db, new Date(Date.now() - 3_600_000).toISOString(), 10)
        expect(rows).toHaveLength(1)
        expect(rows[0]!.cpu_usage_total).toBe(15)
        expect(rows[0]!.linux_oom_kills).toBe(0)
        expect(JSON.stringify(rows)).not.toContain('private-boot-id')
        expect(db.query('SELECT linux_boot_id FROM system_samples').get()).toEqual({ linux_boot_id: 'private-boot-id' })
      } finally {
        db.close()
      }
    })
  })

  test('storage choices omit SQLite fields and process rows without masking the live sample', async () => {
    await withConfigHome(async () => {
      const readings: SystemStats = {
        ...system, cpu_power_watts: 0, gpu_power_watts: 0, ane_power_watts: 0, dram_power_watts: 0,
        psi_cpu_some_avg10: 0, psi_io_some_avg10: 0, psi_memory_some_avg10: 0,
        memory_pressure_level: 'normal', linux_oom_kills: 0,
        battery_charge_percent: 0, battery_charging: false, swap_total_bytes: 0, swap_used_bytes: 0,
        thermal_state: 'nominal', fans: [{ name: 'idle', rpm: 0 }], temperatures: [{ name: 'test', celsius: 0 }],
      }
      const sample = { system: readings, processes: [proc], linuxBootId: 'boot' }
      const live = structuredClone(sample)
      const take = async () => sample
      const enabled = await recordSample(take)
      for (const group of OPTIONAL_RECORD_GROUPS) updateRecordGroup(group, false)
      const omitted = await recordSample(take)
      updateRecordGroup('battery', true)
      const selective = await recordSample(take)

      const db = openDb()
      try {
        const rows = queryHistory(db, '', 3)
        const row = (id: number) => rows.find(r => r.id === id)!
        expect(row(enabled.sample_id)).toMatchObject({ cpu_power_watts: 0, linux_oom_kills: 0,
          swap_used_bytes: 0, battery_charging: false, fans: readings.fans, temperatures: readings.temperatures })
        expect(queryTopProcesses(db, enabled.sample_id)).toHaveLength(1)
        expect(omitted.processes_stored).toBe(0)
        expect(queryTopProcesses(db, omitted.sample_id)).toHaveLength(0)
        const raw = db.query('SELECT * FROM system_samples WHERE id = ?').get(omitted.sample_id) as Record<string, unknown>
        for (const key of ['cpu_power_watts', 'gpu_power_watts', 'ane_power_watts', 'dram_power_watts',
          'psi_cpu_some_avg10', 'psi_io_some_avg10', 'psi_memory_some_avg10', 'memory_pressure_level',
          'linux_oom_kills', 'linux_boot_id', 'swap_total_bytes', 'swap_used_bytes', 'battery_charge_percent',
          'battery_charging', 'temperatures', 'fans', 'thermal_state']) {
          expect(raw[key]).toBeNull()
          expect(row(omitted.sample_id)).not.toHaveProperty(key)
        }
        expect(raw).toMatchObject({ hostname: system.hostname, process_count: 1, cpu_usage_total: 15,
          memory_used: 600, network_rx_bytes: 50, disk_used_bytes: 2500 })
        expect(row(selective.sample_id)).toMatchObject({ battery_charge_percent: 0, battery_charging: false })
        expect(row(selective.sample_id)).not.toHaveProperty('cpu_power_watts')
      } finally {
        db.close()
      }
      expect(sample).toEqual(live)
      expect(loadConfig().probes.power).toBe(true)
      expect(renderSystemMetrics(sample.system)).toContain('sloppytop_cpu_power_watts 0\n')
    })
  })

  test('the scheduled record command honors storage config but still logs collected processes', async () => {
    await withConfigHome(async () => {
      updateRecordGroup('processes', false)
      // Execute the dev-mode scheduler command directly; do not install or start a job.
      const result = spawnSync(process.execPath, [join(import.meta.dir, '../index.ts'), 'record'], {
        encoding: 'utf8', timeout: 60_000,
      })
      expect(result.status, result.stderr).toBe(0)
      const db = openDb()
      try {
        const rows = queryHistory(db, '', 1)
        expect(rows).toHaveLength(1)
        expect(queryTopProcesses(db, rows[0]!.id)).toHaveLength(0)
        expect(readProbeLog({ probe: 'processes', limit: 1 })[0]?.count).toBeGreaterThan(0)
      } finally {
        db.close()
      }
    })
  }, 65_000)

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
