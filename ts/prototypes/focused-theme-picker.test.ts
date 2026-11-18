import { expect, test } from 'bun:test'
import { RGBA } from '@opentui/core'
import { getTheme } from '../src/tui/theme.ts'
import { createTestRenderer } from '@opentui/core/testing'
import { mountThemePicker } from './focused-theme-picker.ts'

test('keyboard preview, cancel, commit and return to launcher focus', async () => {
  await using ui = await createTestRenderer({ width: 48, height: 9, kittyKeyboard: true })
  const commits: string[] = []
  mountThemePicker(ui.renderer, 'mocha', name => commits.push(name))
  const headerBg = () => ui.captureSpans().lines[0]?.spans[0]?.bg.toInts()
  const key = ui.mockInput
  key.pressKey('t')
  key.pressArrow('up')
  key.pressKey('k') // clamped at the first row, not wrapped
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ Charm')
  key.pressKey('j')
  key.pressArrow('down')
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ Catppuccin Latte')
  expect(headerBg()).toEqual(RGBA.fromHex(getTheme('latte').base).toInts())
  expect(commits).toEqual([]) // palette changed, but not the saved theme
  key.pressEscape()
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('Theme: Catppuccin Mocha [t]')
  expect(headerBg()).toEqual(RGBA.fromHex(getTheme('mocha').base).toInts())
  expect(ui.captureCharFrame()).not.toContain('▶')
  expect(commits).toEqual([])

  key.pressKey('t') // reopened by the restored launcher, at the saved option
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ Catppuccin Mocha')
  key.pressKey('j')
  key.pressEnter()
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('Theme: Catppuccin Latte [t]')
  expect(commits).toEqual(['latte'])
})

test('shrink and grow while focused keeps the selection visible and actionable', async () => {
  await using ui = await createTestRenderer({ width: 80, height: 20 })
  const commits: string[] = []
  mountThemePicker(ui.renderer, 'highContrast', name => commits.push(name))
  ui.mockInput.pressKey('t')
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ High Contrast')
  expect(ui.captureCharFrame()).toContain('Charm')
  ui.resize(36, 4)
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ High Contrast')
  expect(ui.captureCharFrame()).not.toContain('Charm')
  ui.mockInput.pressKey('j')
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('▶ Green Terminal')
  ui.resize(80, 20)
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('Charm')
  expect(ui.captureCharFrame()).toContain('▶ Green Terminal')
  ui.mockInput.pressKey(' ')
  await ui.flush()
  expect(ui.captureCharFrame()).toContain('Theme: Green Terminal [t]')
  expect(commits).toEqual(['terminal'])
})
