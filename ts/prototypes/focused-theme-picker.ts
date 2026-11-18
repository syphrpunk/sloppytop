import { SelectRenderable, SelectRenderableEvents, TextRenderable, type CliRenderer } from '@opentui/core'
import { getTheme, THEME_NAMES, type ThemeName } from '../src/tui/theme.ts'

/**
 * nht-1a1d21 — Reject migration of the existing theme picker.
 * `cd ts && bun test prototypes/focused-theme-picker.test.ts` exercises actual
 * focused key dispatch and captured cells, including shrink/grow mid-preview.
 * Select supplies bounded arrows/j/k, a cursor and a window that tracks selection.
 * These match reduceTheme + themeLines/pickerWindow; they don't add a user action.
 * We still have to own preview vs. commit, cancellation and focus restoration.
 * In run.ts the global keypress handler also reduces each key: integration would
 * need a single input owner to avoid double movement or handling q as quit.
 * Keep the reducer/one-frame composition. This compares integration work, not speed.
 */
export function mountThemePicker(renderer: CliRenderer, initial: ThemeName, commit: (name: ThemeName) => void) {
  let saved = initial
  const launcher = new TextRenderable(renderer, {
    id: 'theme-launcher', height: 1,
    onKeyDown: (key) => { if (key.name === 't') open() },
  })
  launcher.focusable = true
  renderer.root.add(launcher)

  function showLauncher() {
    const theme = getTheme(saved)
    launcher.content = `Theme: ${theme.label} [t]`
    launcher.fg = theme.text
    launcher.bg = theme.base
    launcher.focus()
  }

  function open() {
    const list = new SelectRenderable(renderer, {
      id: 'theme-options', width: '100%', flexGrow: 1, showDescription: false,
      options: THEME_NAMES.map(name => ({ name: getTheme(name).label, description: '' })),
      selectedIndex: THEME_NAMES.indexOf(saved),
      keyBindings: [{ name: 'space', action: 'select-current' }],
      onKeyDown: key => {
        if (key.name === 'escape' || key.name === 'q') {
          key.preventDefault()
          close()
        }
      },
    })
    function preview(index: number) {
      const theme = getTheme(THEME_NAMES[index]!)
      list.focusedTextColor = launcher.fg = theme.text
      list.focusedBackgroundColor = launcher.bg = theme.base
      list.selectedTextColor = theme.base
      list.selectedBackgroundColor = theme.blue
    }
    function close() {
      list.destroy()
      showLauncher()
    }
    list.on(SelectRenderableEvents.SELECTION_CHANGED, preview)
    list.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      saved = THEME_NAMES[index]!
      close()
      commit(saved)
    })
    launcher.content = 'Theme: ↑↓ preview ↵ use Esc cancel'
    renderer.root.add(list)
    list.focus()
    preview(list.getSelectedIndex())
  }
  showLauncher()
}
