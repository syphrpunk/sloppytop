// Braille sparklines (data → string only;
// no ANSI color here, so the output embeds cleanly in any --format).
//
// Each character is one data point; the braille dot pattern encodes the
// value on 5 vertical levels using the 2×4 braille grid:
//   ⠀ empty, ⣀ bottom row, ⣤ two rows, ⣶ three rows, ⣿ full

const LEVELS = ['⠀', '⣀', '⣤', '⣶', '⣿'] as const

/** Dim track character used to left-pad when there are fewer values than width. */
const TRACK = '⠤'
/** One missing sample, distinct from both an idle sample and left padding. */
const GAP = '⠂'
export const UNOBSERVED = '╌'

export type SparklinePoint = number | null

function levelFor(v: number, max: number): string {
  if (!Number.isFinite(v) || v <= 0 || max <= 0) return LEVELS[0]
  let level = Math.floor((v / max) * 4)
  if (level < 1) level = 1 // show at least ⣀ for non-zero values (matches Go)
  if (level > 4) level = 4
  return LEVELS[level] ?? LEVELS[4]
}

export interface SparklineOptions {
  /** Scale ceiling. Defaults to the largest finite measured value (or 0). */
  max?: number
  /** Fixed output width: longer series keep the most recent points, shorter ones get a left track pad. */
  width?: number
  /** Draw an unobserved interval immediately before each indexed point. */
  breaks?: readonly number[]
}

/**
 * Render samples (oldest first) as a braille sparkline string. Null and
 * non-finite samples occupy a gap cell and do not affect scaling.
 * With no width, output length equals the series length.
 */
export function sparkline(values: readonly SparklinePoint[], opts: SparklineOptions = {}): string {
  const max = opts.max ?? values.reduce<number>(
    (peak, value) => value !== null && Number.isFinite(value) ? Math.max(peak, value) : peak,
    0,
  )
  const breaks = opts.breaks?.length ? new Set(opts.breaks) : undefined
  let cells: string[] = []
  for (const [i, v] of values.entries()) {
    const cell = v === null || !Number.isFinite(v) ? GAP : levelFor(v, max)
    if (breaks?.has(i)) cells.push(UNOBSERVED)
    cells.push(cell)
  }
  let pad = 0
  if (opts.width !== undefined) {
    if (cells.length > opts.width) cells = cells.slice(cells.length - opts.width)
    pad = opts.width - cells.length
  }
  return TRACK.repeat(pad) + cells.join('')
}
