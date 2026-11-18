// Run: node tests/classic-test.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/#/create', pretendToBeVisual: true })
const w = dom.window
w.scrollTo = () => {}
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)
globalThis.setInterval = () => {}

const { MAX_LEVEL, RACES, xpToNextLevel } = await import(ROOT + 'data.js')
const { ZONES } = await import(ROOT + 'zones.js')
const { accountOf, addTo, savedCharacters, sampleAccount } = await import('./helpers.mjs')
console.log('max level:', MAX_LEVEL, '| xp 59->60:', xpToNextLevel(59), '| xp at 60:', xpToNextLevel(60))
console.log('races:', Object.keys(RACES).join(', '))
console.log('zones:', ZONES.length, '| max zone level:', Math.max(...ZONES.map((z) => z.maxLevel)))
console.log('sample:', sampleAccount().characters.map((c) => `${c.characterName} ${c.characterRace} ${c.characterClass}`).join('; '))

// Old save: Bassor as a Blood Elf, Trollwarrior level 20 farming in Eversong Woods.
const old = JSON.parse(JSON.stringify(sampleAccount()))
savedCharacters(old)[2].characterRace = 'Blood Elf'
savedCharacters(old)[0].characterLevel = 20
savedCharacters(old)[0].zone = 'Eversong Woods'
savedCharacters(old)[1].characterLevel = 65
localStorage.setItem('gmrl.account', JSON.stringify(old))

await import(ROOT + 'interface.js')
const q = (s) => document.querySelector(s)
const qa = (s) => [...document.querySelectorAll(s)]
console.log('notices:', qa('.notice p').map((p) => p.textContent))
console.log('level input present:', Boolean(q('#characterLevel')), '| hint:', q('.view-header .field-hint')?.textContent)
console.log('race tiles:', qa('input[name=characterRace]').map((i) => i.value).join(', '))

const click = (name, value) => q(`input[name=${name}][value="${value}"]`).closest('label').querySelector('.tile-body').click()
q('#characterName').value = 'Newbie'
click('characterRace', 'Orc'); click('characterClass', 'Warlock'); click('characterSpec', 'Affliction')
console.log('preview:', q('.preview .character-info p').textContent)
q('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))
const saved = JSON.parse(localStorage.getItem('gmrl.account'))
console.log('saved characters:', savedCharacters(saved).map((c) => `${c.characterName} L${c.characterLevel} ${c.zone ?? 'idle'}`).join('; '))

// Roster cards: no buttons, the whole card links to the character page.
location.hash = '#/roster'
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
const troll = savedCharacters(saved).find((c) => c.characterName === 'Trollwarrior')
console.log('card buttons:', qa('.character-list .button, .character-list button').length, '| card links:', qa('.character-list a.character-card').length, '/', savedCharacters(saved).length)
const trollCard = qa('.character-list a.character-card').find((a) => a.textContent.includes('Trollwarrior'))
console.log('card href ok:', trollCard.getAttribute('href') === `#/character/${troll.id}`)

// The old edit route no longer opens a form.
location.hash = `#/edit/${troll.id}`
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
console.log('edit route shows form:', Boolean(q('form.character-form')), '| title:', q('#view-title').textContent)

// Delete from the character page needs the modal.
w.HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
w.HTMLDialogElement.prototype.close ??= function () { this.open = false }
location.hash = `#/character/${troll.id}`
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
const delButton = qa('.sheet-actions button').find((b) => b.textContent === 'Delete')
delButton.click()
console.log('modal open:', q('dialog.modal').open, '| text:', q('dialog.modal h3').textContent)
qa('dialog.modal button').find((b) => b.textContent === 'Cancel').click()
console.log('cancel keeps char:', !q('dialog.modal').open && savedCharacters(JSON.parse(localStorage.getItem('gmrl.account'))).some((c) => c.id === troll.id))
delButton.click()
qa('dialog.modal button').find((b) => b.textContent === 'Delete character').click()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
console.log('after delete:', location.hash, '| still saved:', savedCharacters(JSON.parse(localStorage.getItem('gmrl.account'))).some((c) => c.id === troll.id))

location.hash = '#/farm'
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
console.log('farm rows:', qa('.zone-table tbody tr').length, '| non-classic rows:', qa('.zone-table tbody th').map((t) => t.textContent).filter((n) => /Eversong|Ghostlands|Azuremyst|Bloodmyst|Quel/.test(n)))
