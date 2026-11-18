// Run: node tests/form-input-test.mjs
// Game events and saves from another tab don't re-render the create screens over what the player has typed.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const HOUR = 3600 * 1000
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
let clock = Date.now()
Date.now = () => clock
globalThis.clearInterval = () => {}

// A fresh page on `hash` with `saved` in localStorage, running its own copy of interface.js.
let pages = 0
let intervals
async function openPage(hash, saved) {
  const w = new JSDOM(html, { url: `http://localhost/${hash}`, pretendToBeVisual: true }).window
  w.scrollTo = () => {}
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage })
  intervals = []
  globalThis.setInterval = (fn) => intervals.push(fn)
  if (saved) w.localStorage.setItem('gmrl.account', saved)
  await import(`${ROOT}interface.js?page=${++pages}`)
  return w
}

const { sampleAccount, addTo } = await import('./helpers.mjs')
const { default: Character } = await import(ROOT + 'character.js')
const { default: Account } = await import(ROOT + 'account.js')

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }

// Create Character, while a character levels up.
const acc = sampleAccount()
acc.sendToZone(acc.characters[0].id, 'Durotar')
let w = await openPage('#/create', JSON.stringify(acc))
let q = (s) => w.document.querySelector(s)
const notices = () => [...w.document.querySelectorAll('.notice p')].map((p) => p.textContent).join(' | ')
const click = (name, value) => q(`input[name=${name}][value="${value}"]`).closest('label').querySelector('.tile-body').click()
const type = (id, value) => { q(`#${id}`).value = value; q(`#${id}`).dispatchEvent(new w.Event('input', { bubbles: true })) }
const submit = () => q('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))

const form = q('form')
type('characterName', 'Keepme')
click('characterRace', 'Orc')
clock += 2 * HOUR
intervals[0]()
check('a game event happened', notices().includes('Trollwarrior'), notices())
check('create character form kept', q('form') === form && q('#characterName').value === 'Keepme' && q('input[name=characterRace][value=Orc]').checked)

// Another tab makes a character of the same name meanwhile.
w.dispatchEvent(new w.Event('pagehide'))
const other = Account.fromJSON(JSON.parse(w.localStorage.getItem('gmrl.account')))
addTo(other, new Character({ characterName: 'Keepme', characterRace: 'Undead', characterClass: 'Rogue', characterSpec: 'Combat', characterRole: 'DPS' }))
w.localStorage.setItem('gmrl.account', JSON.stringify(other))
w.dispatchEvent(new w.StorageEvent('storage', { key: 'gmrl.account', newValue: JSON.stringify(other) }))
check('form kept over another tab saving', q('form') === form && q('#characterName').value === 'Keepme' && q('input[name=characterRace][value=Orc]').checked)
click('guildId', other.guilds[0].id)
click('characterClass', 'Warrior')
click('characterSpec', 'Arms') // Arms picks DPS
submit()
check('taken name is refused, input kept', w.location.hash === '#/create' && notices().includes('You already have a character named Keepme.') && q('#characterName').value === 'Keepme', notices())
type('characterName', 'Keepyou')
submit()
check('a free name is saved', w.location.hash === '#/roster' && JSON.parse(w.localStorage.getItem('gmrl.account')).guilds[0].characters.some((c) => c.characterName === 'Keepyou'))

// Create Guild, while another tab founds a Horde guild.
w = await openPage('#/create-guild', null)
q = (s) => w.document.querySelector(s)
const guildForm = q('form')
type('guildName', 'Keepers')
click('faction', 'Horde')
const founded = JSON.stringify(sampleAccount())
w.localStorage.setItem('gmrl.account', founded)
w.dispatchEvent(new w.StorageEvent('storage', { key: 'gmrl.account', newValue: founded }))
check('create guild form kept', q('form') === guildForm && q('#guildName').value === 'Keepers' && q('input[name=faction][value=Horde]').checked)
submit()
check('taken faction is refused, input kept', w.location.hash === '#/create-guild' && notices().includes('You already have a Horde guild.') && q('#guildName').value === 'Keepers', notices())

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
