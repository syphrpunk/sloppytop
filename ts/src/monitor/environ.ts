/** The screen decodes names only. Full entries are for the explicit CLI --env option. */
export type EnvMode = 'none' | 'names' | 'entries'

export function readEnvBlock(data: Uint8Array, mode: Exclude<EnvMode, 'none'>): string[] {
  const decoder = new TextDecoder()
  const rows: string[] = []
  for (let start = 0; start < data.length;) {
    const end = data.indexOf(0, start)
    if (end <= start) break
    const entry = data.subarray(start, end)
    const equals = entry.indexOf(61)
    if (equals > 0) rows.push(decoder.decode(mode === 'names' ? entry.subarray(0, equals) : entry))
    start = end + 1
  }
  return rows
}
