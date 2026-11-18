// Run: node tests/away-test.mjs
// Time away: paid out up to MAX_AWAY_HOURS, and the welcome-back notice shows for any time away we can detect.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
globalThis.setInterval = () => 1

const { default: Account, MAX_AWAY_HOURS } = await import(ROOT + 'account.js')
const { sampleAccount } = await import('./helpers.mjs')

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const HOUR = 3600e3

// Account.tick pays out the last MAX_AWAY_HOURS only.
const now = Date.now() + HOUR
const sendAll = (acc) => { for (const c of acc.characters) acc.sendToZone(c.id, c.faction === 'Horde' ? 'Durotar' : 'Elwynn Forest', acc.lastTick) }
const xpAfter = (hoursAway) => {
  const acc = sampleAccount()
  sendAll(acc)
  acc.lastTick = now - hoursAway * HOUR
  const random = Math.random
  Math.random = () => 0.5 // farm() rolls loot with Math.random
  const r = acc.tick(now, () => 0.5)
  Math.random = random
  return { r, levels: acc.characters.map((c) => c.characterLevel + c.characterXp / c.xpToNextLevel), lastTick: acc.lastTick }
}
const capped = xpAfter(72)
const full = xpAfter(MAX_AWAY_HOURS)
check('away 72h pays out 30h', capped.r.awayHours === 72 && capped.r.hours === MAX_AWAY_HOURS, `${capped.r.awayHours} ${capped.r.hours}`)
check('same progress as 30h away', capped.levels.join() === full.levels.join(), `${capped.levels.map((l) => l.toFixed(2))} vs ${full.levels.map((l) => l.toFixed(2))}`)
check('lastTick moves to now', capped.lastTick === now)
const short = xpAfter(2)
check('under the cap pays it all', short.r.awayHours === 2 && short.r.hours === 2)

// A fresh page with a save last ticked `secondsAgo` seconds ago; returns the notice texts.
let pages = 0
async function noticesAfter(secondsAgo) {
  const w = new JSDOM(html, { url: 'http://localhost/#/roster', pretendToBeVisual: true }).window
  w.scrollTo = () => {}
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage })
  const acc = sampleAccount()
  acc.lastTick = Date.now() - secondsAgo * 1000
  w.localStorage.setItem('gmrl.account', JSON.stringify(acc))
  await import(`${ROOT}interface.js?page=${++pages}`)
  return [...w.document.querySelectorAll('#notices .notice p')].map((p) => p.textContent)
}
const welcome = (notices) => notices.find((n) => n.startsWith('Welcome back!'))

check('5s away gets a welcome', /^Welcome back! You were away for [56]s\.$/.test(welcome(await noticesAfter(5)) ?? ''), welcome(await noticesAfter(5)))
check('no welcome under a second', !welcome(await noticesAfter(0)))
const day = welcome(await noticesAfter(2 * 3600 + 5 * 60))
check('2h 5m away', day?.startsWith('Welcome back! You were away for 2h 5m.') && !day.includes('the most'), day)
const long = welcome(await noticesAfter(3 * 86400))
check('3 days away says it was capped', long?.includes('away for 3d 0h. Your characters worked for the last 30 hours of it, the most they can.'), long)

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
