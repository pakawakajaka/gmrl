// Boots the app in jsdom with a level 40 character and drives the talent selector.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'main.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/main.html#/roster', pretendToBeVisual: true })
const w = dom.window
w.scrollTo = () => {}
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)
globalThis.setInterval = () => {}

let failed = 0
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failed++ }
const tick = () => new Promise((r) => setTimeout(r, 20))

const { sampleAccount } = await import('./helpers.mjs')
const save = JSON.parse(JSON.stringify(sampleAccount()))
const c = save.guilds[0].characters[0]
c.characterLevel = 40
delete c.talents // a save from before talents
save.lastTick = Date.now()
localStorage.setItem('gmrl.account', JSON.stringify(save))

await import(ROOT + 'interface.js')
const doc = w.document
w.location.hash = `#/character/${c.id}`
await tick()
const tile = doc.querySelector('.talent-tile')
check(!!tile, 'sheet has a talent tile')
check(/default build/.test(tile.textContent), `tile says default: ${tile.querySelector('p').textContent}`)
w.location.hash = tile.querySelector('a').getAttribute('href')
await tick()
check(doc.querySelectorAll('.talent-tree').length === 3, 'three trees')
check(/0 points left/.test(doc.querySelector('.talent-points-left').textContent), 'all 31 spent')
const defaults = doc.querySelectorAll('.talent.default')
check(defaults.length > 5, `default picks highlighted: ${defaults.length}`)

doc.querySelector('[data-focus-key="talents-reset"]').click()
await tick()
check(/31 points left/.test(doc.querySelector('.talent-points-left').textContent), 'reset frees 31')
check(JSON.parse(localStorage.getItem('gmrl.account')).guilds[0].characters[0].talents && Object.keys(JSON.parse(localStorage.getItem('gmrl.account')).guilds[0].characters[0].talents).length === 0, 'reset saved')

const first = doc.querySelector('.talent.available')
const key = first.dataset.talent
first.focus()
first.click()
await tick()
const again = doc.querySelector(`[data-talent="${key}"]`)
check(again.querySelector('.talent-rank').textContent.startsWith('1/'), `learned ${key}`)
check(doc.activeElement === again, 'focus kept on the talent')
again.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
await tick()
check(doc.querySelector(`[data-talent="${key}"] .talent-rank`).textContent.startsWith('0/'), 'right-click unlearns')
const locked = doc.querySelector('.talent.locked')
locked.click()
await tick()
check(doc.querySelector(`[data-talent="${locked.dataset.talent}"] .talent-rank`).textContent.startsWith('0/'), 'locked talent ignored')
check(/Requires/.test(locked.querySelector('.tooltip').textContent), 'locked tooltip shows requirement')

doc.querySelector('[data-focus-key="talents-default"]').click()
await tick()
check(/0 points left/.test(doc.querySelector('.talent-points-left').textContent), 'default build re-applied')
const saved = JSON.parse(localStorage.getItem('gmrl.account')).guilds[0].characters[0].talents
check(Object.values(saved).reduce((a, b) => a + b, 0) === 31, 'default saved')
console.log('title:', doc.title)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
