// Compiled only by the discovery smoke check, never by the release build.
import { composeOverview } from './src/discovery/overview.ts'
import { observe } from './src/discovery/provider.ts'
import { runTui } from './src/tui/run.ts'

await runTui(undefined, async () => {
  const time = new Date()
  const denied = observe('ip address', { issue: 'denied' }, () => ({ rows: [] as never[] }), 'linux', time)
  const cache = observe('ARP cache', { text: '' }, () => ({
    rows: [{ interface: 'eth0', family: 6 as const, address: 'fe80::1%eth0', state: 'stale' }],
    issues: ['visibility'],
  }), 'linux', time)
  return composeOverview([denied], [], [cache], [], 'fixture', time)
})
