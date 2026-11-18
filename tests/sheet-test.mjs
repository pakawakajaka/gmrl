// Boots the real app in jsdom with a saved, geared character and opens the character sheet.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/#/roster', pretendToBeVisual: true })
const w = dom.window
w.scrollTo = () => {}
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)
globalThis.setInterval = () => {}

const { sampleAccount } = await import('./helpers.mjs')
const save = JSON.parse(JSON.stringify(sampleAccount()))
const c = save.guilds[0].characters[0]
c.zone = 'Durotar'
c.characterRace = c.characterRace // keep
save.lastTick = Date.now() - 6 * 3600 * 1000
localStorage.setItem('gmrl.account', JSON.stringify(save))

await import(ROOT + 'interface.js')
const doc = w.document
console.log('notices:', [...doc.querySelectorAll('.notice p')].map((p) => p.textContent).join(' || '))
console.log('gear links on roster:', doc.querySelectorAll('a[href^="#/character/"]').length)
const link = doc.querySelector('a.character-card[href^="#/character/"]')
w.location.hash = link.getAttribute('href')
await new Promise((r) => setTimeout(r, 20))
console.log('title:', doc.title)
console.log('slots:', [...doc.querySelectorAll('.paper-doll .slot')].map((s) => s.getAttribute('aria-label')).join('; '))
console.log('stats:', [...doc.querySelectorAll('.stat-group')].map((g) => g.querySelector('h3').textContent + ' ' + [...g.querySelectorAll('dt')].map((dt) => `${dt.textContent}=${dt.nextElementSibling.textContent}`).join(',')).join('\n  '))
console.log('quest:', doc.querySelector('.sheet-panel p:nth-of-type(2)')?.textContent)
console.log('loot log:', doc.querySelectorAll('.loot-log li').length)
w.location.hash = '#/farm'
await new Promise((r) => setTimeout(r, 20))
console.log('farm gear links:', doc.querySelectorAll('.farmer-gear').length)
