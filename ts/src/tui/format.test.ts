import { expect, test } from 'bun:test'
import { clip, padRight, widthOf, wrapCells } from './format.ts'

test('pads terminal cells and clips without splitting grapheme clusters', () => {
  expect(padRight('界a', 5)).toBe('界a  ')
  expect(clip('界abc', 3)).toBe('界…')
  expect(clip('界', 1)).toBe('…')
  expect(clip('a\u0301bc', 2)).toBe('a\u0301…')
  expect(clip('👩‍💻abc', 3)).toBe('👩‍💻…')
  expect(widthOf('👩‍💻⠤')).toBe(3)
})

test('wraps a full database path without cutting a grapheme or dropping cells', () => {
  expect(wrapCells('/👩‍💻/界/db', 3)).toEqual(['/👩‍💻', '/界', '/db'])
})
