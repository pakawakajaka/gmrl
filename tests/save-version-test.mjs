// Run: node tests/save-version-test.mjs
// A save from a newer version of the game is never loaded or written over; the page asks for a reload.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
globalThis.setInterval = () => 1
globalThis.clearInterval = () => {}

// A fresh page with `saved` in localStorage, running its own copy of interface.js.
let pages = 0
async function openPage(saved) {
  const w = new JSDOM(html, { url: 'http://localhost/#/roster', pretendToBeVisual: true }).window
  w.scrollTo = () => {}
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage })
  if (saved) w.localStorage.setItem('gmrl.account', saved)
  await import(`${ROOT}interface.js?page=${++pages}`)
  return w
}

const { SAVE_VERSION } = await import(ROOT + 'account.js')
const { sampleAccount } = await import('./helpers.mjs')

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const newer = JSON.stringify({ ...JSON.parse(JSON.stringify(sampleAccount())), saveVersion: SAVE_VERSION + 1, futureField: 'keep me' })

// An old cached page opens a save made by the update.
let w = await openPage(newer)
const title = () => w.document.querySelector('#view-title')?.textContent
check('newer save shows reload prompt', title() === 'Update available' && w.document.querySelector('.update-needed button').textContent === 'Reload', title())
w.dispatchEvent(new w.Event('pagehide'))
w.location.hash = '#/farm'
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('newer save left untouched', w.localStorage.getItem('gmrl.account') === newer)
check('still showing the prompt after navigating', title() === 'Update available', title())

// A page is open when another tab loads the update and saves.
w = await openPage(null)
check('new player plays normally', title() === 'Create Guild', title())
const version = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8')).version
const footer = (s) => w.document.querySelector(`.site-footer ${s}`)?.textContent
check('footer: Alpha and the version', footer('.badge-alpha') === 'Alpha' && footer('#version') === `v${version}`, footer('#version'))
w.dispatchEvent(new w.Event('pagehide'))
const current = w.localStorage.getItem('gmrl.account')
check('saves start with the version', current?.startsWith(`{"saveVersion":${SAVE_VERSION},`), current?.slice(0, 20))
w.localStorage.setItem('gmrl.account', newer)
w.dispatchEvent(new w.StorageEvent('storage', { key: 'gmrl.account', newValue: newer }))
check('newer save from another tab stops the page', title() === 'Update available', title())
w.dispatchEvent(new w.Event('pagehide'))
check('stopped page does not save over it', w.localStorage.getItem('gmrl.account') === newer)

// The write guard alone, e.g. the update saved but this page missed the storage event.
w = await openPage(null)
w.localStorage.setItem('gmrl.account', newer)
w.dispatchEvent(new w.Event('pagehide'))
check('save refuses to write over a newer save', w.localStorage.getItem('gmrl.account') === newer && title() === 'Update available', title())

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
