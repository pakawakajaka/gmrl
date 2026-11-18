// Loads main.html in jsdom with the real modules and exercises farming. Run: node tests/farm-test.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const HOUR = 3600 * 1000
const html = readFileSync(ROOT + 'main.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/main.html#/farm', pretendToBeVisual: true })
const w = dom.window
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)

const realNow = Date.now
let clock = realNow()
Date.now = () => clock

const { default: Account } = await import(ROOT + 'account.js')
const { accountOf, addTo, savedCharacters, sampleAccount } = await import('./helpers.mjs')
const { ZONES } = await import(ROOT + 'zones.js')

// --- Model checks
const a = sampleAccount()
const [troll, paka] = a.characters
console.log('zones:', ZONES.length)
console.log('send L1 Troll to Elwynn (Alliance):', a.sendToZone(troll.id, 'Elwynn Forest'))
console.log('send L1 Troll to Stranglethorn (L30):', a.sendToZone(troll.id, 'Stranglethorn Vale'))
console.log('send L1 Troll to Durotar:', a.sendToZone(troll.id, 'Durotar'))
clock += 10 * HOUR
const r = a.tick()
console.log('after 10h in Durotar -> level', troll.characterLevel, 'xp', Math.floor(troll.characterXp), 'xp/hr', troll.xpPerHour, '| gold', a.guilds.map((g) => `${g.guildName} ${Math.floor(g.totalGold())}`).join(), '| levelUps', r.levelUps.map((c) => c.characterName))
clock += 100 * HOUR
a.tick()
console.log('after 100h more -> level', troll.characterLevel, 'xp/hr', troll.xpPerHour, '(gray zone stops XP)')
console.log('idle Paka unchanged:', paka.characterLevel, paka.characterXp)

const restored = Account.fromJSON(JSON.parse(JSON.stringify(a)), clock)
console.log('round-trip:', restored.characters[0].zone, restored.characters[0].characterLevel, Math.floor(restored.guilds[0].totalGold()) === Math.floor(a.guilds[0].totalGold()), 'account gold gone:', !('gold' in a))
const tampered = JSON.parse(JSON.stringify(a))
savedCharacters(tampered)[1].zone = 'Winterspring'; tampered.gold = 'lots'; savedCharacters(tampered)[0].characterXp = 1e12
const t = Account.fromJSON(tampered, clock)
console.log('tampered -> paka zone:', t.characters[1].zone, '| gold:', t.guilds[0].totalGold(), '| troll xp:', t.characters[0].characterXp)

// --- UI checks: offline progress + farm view
localStorage.setItem('gmrl.account', JSON.stringify(a))
clock += 2 * HOUR
const intervals = []
w.setInterval = globalThis.setInterval = (fn) => intervals.push(fn)
await import(ROOT + 'interface.js')
const q = (s) => document.querySelector(s)
const qa = (s) => [...document.querySelectorAll(s)]
console.log('notice:', q('.notice p')?.textContent)
console.log('title:', document.title, '| gold header:', q('#gold').textContent)
console.log('rows:', qa('.zone-table tbody tr').length, '| send buttons for Troll:', qa('.zone-table button').map((b) => b.closest('tr').querySelector('th').textContent + ':' + b.textContent).join(', '))

// Select Pakawakajaka and send to Mulgore
qa('.farmer-select').find((b) => b.textContent.includes('Pakawakajaka')).click()
console.log('selected:', q('.farmer.selected .character-name').textContent, '| intro:', q('.zone-intro').textContent)
qa('.zone-table tbody tr').find((tr) => tr.querySelector('th').firstChild.textContent === 'Mulgore').querySelector('button').click()
console.log('Mulgore row now:', qa('.zone-table tr.current th').map((e) => e.textContent), '| farmers:', qa('.zone-table tr.current .zone-farmers').map((e) => e.textContent))

clock += 60 * 1000
intervals[0]()
const pakaCard = qa('.farmer').find((c) => c.textContent.includes('Pakawakajaka'))
console.log('after 1 min tick:', pakaCard.querySelector('.xp-text').textContent, '|', pakaCard.querySelector('.eta').textContent, '| fill', pakaCard.querySelector('.xp-fill').style.width)

clock += 10 * 60 * 1000
intervals[0]()
console.log('after level-up notices:', qa('.notice p').map((p) => p.textContent))

pakaCard.ownerDocument.querySelector('.farmer.selected .farmer-recall').click()
console.log('after recall, Paka zone:', qa('.farmer').find((c) => c.textContent.includes('Pakawakajaka')).querySelector('.farmer-zone').textContent)

location.hash = '#/roster'
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
console.log('roster statuses:', qa('.farm-status').map((e) => e.textContent), '| nav current:', q('.site-nav [aria-current]').textContent)
console.log('saved gold > 0:', savedCharacters(JSON.parse(localStorage.getItem('gmrl.account'))).reduce((s, c) => s + c.copper, 0) > 0)
