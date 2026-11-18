// Run: node tests/updates-test.mjs
// The hosted build (tools/build.mjs): the update banner, What's new, backup reminders, the bug report link, and the
// service worker (sw.js). Runs the built copy, as running from source turns the update check and the worker off.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = mkdtempSync(join(tmpdir(), 'gmrl-updates-'))
const SHA = 'abcdef0123456789'
const BUILD = SHA.slice(0, 12)
execFileSync('node', [ROOT + 'tools/build.mjs', OUT], { env: { ...process.env, CF_PAGES_COMMIT_SHA: SHA }, stdio: 'pipe' })
const { CHANGES, VERSION } = await import(pathToFileURL(join(OUT, 'version.js')).href)
const { sampleAccount } = await import('./helpers.mjs')
const DAY_MS = 24 * 3600 * 1000

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

globalThis.setInterval = () => 1
globalThis.clearInterval = () => {}

// The browser: the server's version.json, the service worker and persistent storage.
let live = { version: VERSION, build: BUILD }
const fetches = []
globalThis.fetch = async (url, options) => {
  fetches.push({ url, cache: options?.cache })
  return { ok: true, json: async () => live }
}
const registered = []
let persists = 0
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    userAgent: 'TestBrowser/1.0',
    serviceWorker: { register: async (url) => { registered.push(url) } },
    storage: { persist: async () => { persists++; return true } },
  },
})

const html = readFileSync(join(OUT, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/, '')
let pages = 0
let w
async function openPage(entry = 'interface.js', storage = {}) {
  w = new JSDOM(html, { url: 'http://localhost/#/roster', pretendToBeVisual: true }).window
  w.scrollTo = () => {}
  w.HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage })
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value)
  await import(`${entry.startsWith('/') ? pathToFileURL(entry).href : pathToFileURL(join(OUT, entry)).href}?page=${++pages}`)
}
const q = (s) => w.document.querySelector(s)
const qa = (s) => [...w.document.querySelectorAll(s)]
const notices = () => q('#notices').textContent
const go = (hash) => { w.location.hash = hash; w.dispatchEvent(new w.HashChangeEvent('hashchange')) }
const backToTab = async () => { w.document.dispatchEvent(new w.Event('visibilitychange')); await settle() }
const account = () => JSON.stringify(sampleAccount())

// A new player.
await openPage()
check('service worker registered', registered.join() === 'sw.js', registered.join())
check('footer version', q('#version').textContent === `v${VERSION}`)
const report = new URL(q('#report').href)
const body = report.searchParams.get('body') ?? ''
check('bug report link', report.href.startsWith('https://github.com/pakawakajaka/gmrl/issues/new?') && body.includes(`v${VERSION} (${BUILD})`) && body.includes('TestBrowser/1.0') && q('#report').target === '_blank' && q('#report').rel === 'noopener', report.href)
check('new player: no What\'s new, no backup reminder', !notices().includes('Updated to') && !notices().includes('backup'), notices())
check('new player: version remembered', w.localStorage.getItem('gmrl.seenVersion') === VERSION)
await backToTab()
check('update check asks the server', fetches.length === 1 && fetches[0].url === 'version.json' && fetches[0].cache === 'no-store', JSON.stringify(fetches))
check('same build: no banner', q('#update').hidden && q('#update').textContent === '')
await backToTab()
check('checks at most once a minute on tab switches', fetches.length === 1, fetches.length)

// Founding the first guild asks for persistent storage.
q('input[name=faction][value="Horde"]').checked = true
q('#guildName').value = 'TYMF'
q('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))
check('first guild asks to persist storage', persists === 1 && w.location.hash === '#/roster', persists)

// A returning player on an older version, playing for over a week without a backup.
fetches.length = 0
live = { version: '9.0.0', build: 'ffffffffffff' }
await openPage('interface.js', { 'gmrl.account': account(), 'gmrl.seenVersion': '0.0.1', 'gmrl.playingSince': String(Date.now() - 8 * DAY_MS) })
check('older seen version: What\'s new notice', notices().includes(`Updated to v${VERSION}. See what's new.`) && qa('#notices a').some((a) => a.getAttribute('href') === '#/changes'), notices())
check('seen version updated', w.localStorage.getItem('gmrl.seenVersion') === VERSION)
check('backup reminder', notices().includes("You haven't saved a backup yet.") && qa('#notices button').some((b) => b.textContent === 'Save to file'), notices())
const status = () => q('.view-footer .backup-status')
check('roster: not saved yet, overdue', status()?.textContent === 'Not saved to file yet' && status().classList.contains('overdue'), status()?.outerHTML)
await backToTab()
check('new build: banner names the version', !q('#update').hidden && q('#update').textContent.startsWith('Version 9.0.0 is out. Reload to get it.') && q('#update button')?.textContent === 'Reload', q('#update').textContent)
await backToTab()
check('no more checks once found', fetches.length === 1, fetches.length)

// Saving from the reminder records the backup.
let blobs = 0
const realURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
Object.assign(URL, { createObjectURL: () => { blobs++; return 'blob:save' }, revokeObjectURL: () => {} })
w.HTMLAnchorElement.prototype.click = function () {}
persists = 0
qa('#notices button').find((b) => b.textContent === 'Save to file').click()
await settle()
Object.assign(URL, { createObjectURL: realURL.create, revokeObjectURL: realURL.revoke })
const savedAt = Number(w.localStorage.getItem('gmrl.lastBackup'))
check('reminder saves to file', blobs === 1 && Date.now() - savedAt < 60000 && persists === 1 && !notices().includes('backup yet'), notices())
check('roster: saved today', status()?.textContent === 'Last saved to file today' && !status().classList.contains('overdue'), status()?.textContent)

// What's new.
go('#/changes')
const versions = qa('.change-list h3').map((h) => h.firstChild.textContent)
check("What's new page", q('#view-title').textContent === "What's New" && versions.join() === CHANGES.map((c) => `v${c.version}`).join() && qa('.change-list li li').length === CHANGES.reduce((n, c) => n + c.notes.length, 0), versions.join())
check("What's new: no nav link active", !qa('.site-nav a').some((a) => a.getAttribute('aria-current')))

// A recent backup: no reminder; a version check with no version just says an update is out.
live = { build: 'eeeeeeeeeeee' }
await openPage('interface.js', { 'gmrl.account': account(), 'gmrl.seenVersion': VERSION, 'gmrl.lastBackup': String(Date.now() - 2 * DAY_MS) })
check('recent backup: no reminder, no What\'s new', !notices().includes('backup') && !notices().includes('Updated to'), notices())
check('roster: saved 2 days ago', status()?.textContent === 'Last saved to file 2 days ago' && !status().classList.contains('overdue'), status()?.textContent)
await backToTab()
check('update without a version', q('#update').textContent.startsWith('An update is out.'), q('#update').textContent)
await openPage('interface.js', { 'gmrl.account': account(), 'gmrl.lastBackup': String(Date.now() - 8 * DAY_MS) })
check('old backup: reminder says when', notices().includes('Your last backup was 8 days ago.'), notices())

// Running from source: no update checks, no service worker.
fetches.length = 0
registered.length = 0
live = { version: '9.0.0', build: 'ffffffffffff' }
await openPage(join(ROOT, 'interface.js'))
await backToTab()
check('from source: no update check or service worker', fetches.length === 0 && registered.length === 0 && q('#update').hidden)

// The service worker, with a fake cache and network.
const ORIGIN = 'https://gmrl.example/'
const stores = new Map()
const store = (name) => stores.get(name) ?? stores.set(name, new Map()).get(name)
const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url)
const caches = {
  open: async (name) => {
    const s = store(name)
    return {
      addAll: async (requests) => { for (const r of requests) s.set(r.url, await network(r)) },
      put: async (r, response) => { s.set(keyOf(r), response) },
      match: async (r) => s.get(keyOf(r)),
    }
  },
  keys: async () => [...stores.keys()],
  delete: async (name) => stores.delete(name),
}
let offline = false
const requested = []
async function network(r) {
  if (offline) throw new TypeError('Failed to fetch')
  requested.push(r)
  return { ok: !r.url.endsWith('/missing.js'), redirected: r.url.endsWith('/moved'), body: `fresh ${r.url}`, clone() { return { ...this, body: `copy ${r.url}` } } }
}
const listeners = {}
let skipped = false
let claimed = false
const self = {
  location: new URL(ORIGIN),
  addEventListener: (type, listener) => { listeners[type] = listener },
  skipWaiting: async () => { skipped = true },
  clients: { claim: async () => { claimed = true } },
}
class Request { constructor(url, init) { this.url = new URL(url, ORIGIN).href; this.cache = init?.cache } }
vm.runInNewContext(readFileSync(join(OUT, 'sw.js'), 'utf8'), { self, caches, fetch: network, Request, URL })
const waitFor = async (type, extra = {}) => {
  const waits = []
  let responded = null
  listeners[type]({ ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { responded = p } })
  await Promise.all(waits)
  return responded
}

const FILES = JSON.parse(readFileSync(join(OUT, 'sw.js'), 'utf8').match(/const FILES = (\[.*\])/)[1])
store('gmrl-0000old00000').set(ORIGIN, 'old page')
store('another-app').set(ORIGIN, 'theirs')
await waitFor('install')
const kept = store(`gmrl-${BUILD}`)
check('sw install: keeps every file, fresh from the server', kept.size === FILES.length && FILES.every((f) => kept.has(new URL(f, ORIGIN).href)) && requested.every((r) => r.cache === 'reload') && skipped, `${kept.size}/${FILES.length}`)
await waitFor('activate')
check('sw activate: drops old deploys only', !stores.has('gmrl-0000old00000') && stores.has('another-app') && stores.has(`gmrl-${BUILD}`) && claimed, [...stores.keys()].join())

const get = (path, more = {}) => ({ request: { url: new URL(path, ORIGIN).href, method: 'GET', mode: 'cors', ...more } })
let response = await (await waitFor('fetch', get('styles.css')))
check('sw online: network first, copy kept', response?.body === `fresh ${ORIGIN}styles.css` && kept.get(`${ORIGIN}styles.css`)?.body === `copy ${ORIGIN}styles.css`, response?.body)
check('sw: version.json, other sites and POSTs untouched', await waitFor('fetch', get('version.json')) === null && await waitFor('fetch', get('https://wow.zamimg.com/images/x.jpg')) === null && await waitFor('fetch', get('save', { method: 'POST' })) === null)
await waitFor('fetch', get('missing.js'))
await waitFor('fetch', get('moved'))
check('sw: errors and redirects not kept', !kept.has(`${ORIGIN}missing.js`) && !kept.has(`${ORIGIN}moved`))
offline = true
response = await waitFor('fetch', get('styles.css'))
check('sw offline: kept copy', response?.body === `copy ${ORIGIN}styles.css`, response?.body)
response = await waitFor('fetch', get('?from=homescreen', { mode: 'navigate' }))
check('sw offline: pages fall back to the game', response === kept.get(ORIGIN))
const failed = await waitFor('fetch', get('nothing.js')).catch((error) => error)
check('sw offline: unknown files fail', failed instanceof Error || failed?.message === 'Failed to fetch', String(failed))

rmSync(OUT, { recursive: true })
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
