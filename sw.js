// Service worker: lets the game load offline and be installed as an app. Requests go to the network first, so
// players get an update as soon as it's deployed, and fall back to the copy kept here when offline. Installing
// keeps a copy of every file, so the game works offline from the first visit. tools/build.mjs fills in BUILD
// and FILES; running from source it isn't registered (see updates.js).
const BUILD = 'dev'
const FILES = []
const CACHE = `gmrl-${BUILD}`

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))
    await self.skipWaiting()
  })())
})

// Drops the copies kept by earlier deploys.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((key) => key.startsWith('gmrl-') && key !== CACHE)
    await Promise.all(old.map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Other sites (item icons) and the update check (version.json) always go to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/version.json')) return
  event.respondWith(networkFirst(event))
})

async function networkFirst(event) {
  const { request } = event
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && !response.redirected) event.waitUntil(cache.put(request, response.clone()))
    return response
  } catch (error) {
    const kept = await cache.match(request) ?? (request.mode === 'navigate' ? await cache.match('./') : undefined)
    if (kept) return kept
    throw error
  }
}
