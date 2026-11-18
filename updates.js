import { BUILD, CHANGES, VERSION } from './version.js'

const SEEN_KEY = 'gmrl.seenVersion'

// Compares dotted version numbers like '0.10.2': negative if a is older than b, 0 if the same, positive if newer.
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0))
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

// The changes since the version this browser last ran, newest first, and remembers this one. A new player
// gets none: everything is new to them.
export function unseenChanges() {
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    if (!seen || compareVersions(VERSION, seen) > 0) localStorage.setItem(SEEN_KEY, VERSION)
    return seen ? CHANGES.filter((c) => compareVersions(c.version, seen) > 0) : []
  } catch {
    return []
  }
}

// The deploy on the server, if it isn't the one running: { version } from version.json (see tools/build.mjs),
// else null, also when offline or running from source.
export async function newerBuild() {
  if (BUILD === 'dev') return null
  try {
    const response = await fetch('version.json', { cache: 'no-store' })
    if (!response.ok) return null
    const live = await response.json()
    return typeof live?.build === 'string' && live.build !== BUILD ? { version: String(live.version ?? '') } : null
  } catch {
    return null
  }
}

// The service worker (sw.js) lets the game load offline and be installed as an app.
export function registerServiceWorker() {
  if (BUILD === 'dev' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Offline play is unavailable.', error))
}
