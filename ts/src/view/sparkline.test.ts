import { describe, expect, test } from 'bun:test'
import { sparkline } from './sparkline.ts'

describe('sparkline', () => {
  test('maps 0-100 percentages to the 5 braille levels', () => {
    expect(sparkline([0, 10, 30, 60, 80, 100], { max: 100 })).toBe('⠀⣀⣀⣤⣶⣿')
  })

  test('non-zero values never render empty', () => {
    expect(sparkline([1], { max: 100 })).toBe('⣀')
  })

  test('scales to the series max when no max given', () => {
    // max=40 → 40 is full height, 20 is half
    expect(sparkline([0, 20, 40])).toBe('⠀⣤⣿')
  })

  test('fixed width pads short series with the track character', () => {
    expect(sparkline([100], { max: 100, width: 4 })).toBe('⠤⠤⠤⣿')
  })

  test('fixed width keeps the most recent points of long series', () => {
    expect(sparkline([100, 0, 100], { max: 100, width: 2 })).toBe('⠀⣿')
  })

  test('all-zero series renders empty cells, not NaN artifacts', () => {
    expect(sparkline([0, 0])).toBe('⠀⠀')
  })

  test('missing points are distinct from zero and padding and do not set the scale', () => {
    expect(sparkline([0, null, 10, NaN, 20, Infinity], { width: 7 })).toBe('⠤⠀⠂⣤⠂⣿⠂')
  })

  test('clipping keeps the gap slots in the most recent points', () => {
    expect(sparkline([20, 5, null, 0, null], { width: 3 })).toBe('⠂⠀⠂')
  })
})
