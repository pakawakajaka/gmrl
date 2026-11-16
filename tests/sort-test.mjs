// Sort control on the roster and farming pages. Run: node tests/sort-test.mjs
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { renderRoster } = await import(root + 'roster.js')
const { renderFarm } = await import(root + 'farm.js')
const { ITEMS } = await import(root + 'gear-data.js')

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`)
  if (!ok) failures++
}

const account = new Account('Test')
const add = (name, cls, spec, race, role, level) => {
  const c = new Character({ characterName: name, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level })
  addTo(account, c, 0)
  c.characterLevel = level // new characters start at 1
  return c
}
add('Bravo', 'Warrior', 'Arms', 'Human', 'DPS', 30)
add('Alpha', 'Mage', 'Frost', 'Gnome', 'DPS', 20)
add('Delta', 'Priest', 'Holy', 'Human', 'Healer', 30)
const charlie = add('Charlie', 'Hunter', 'Beast Mastery', 'Dwarf', 'DPS', 10)
// Give the warrior good gear so power and level orders differ.
account.getCharacter(account.characters.find((c) => c.characterName === 'Bravo').id)
  .equipBest(Object.keys(ITEMS).map(Number).filter((id) => ITEMS[id].quality === 2 && !ITEMS[id].suffixes && ITEMS[id].itemLevel >= 28 && ITEMS[id].itemLevel <= 32))

const noop = () => {}
const rosterOrder = (sortKey) => [...renderRoster({ account, selectedGuild: null, sortKey, onSelectGuild: noop, onSort: noop, onReset: noop, onSaveToFile: noop })
  .querySelectorAll('.character-card .character-name')].map((e) => e.textContent).join(',')
const farmOrder = (sortKey) => [...renderFarm({ account, selectedId: charlie.id, sortKey, onSelect: noop, onSort: noop, onSend: noop, onRecall: noop })
  .querySelectorAll('.farm-characters .character-name')].map((e) => e.textContent).join(',')

for (const [render, page] of [[rosterOrder, 'roster'], [farmOrder, 'farm']]) {
  check(`${page}: name`, render('name') === 'Alpha,Bravo,Charlie,Delta', render('name'))
  check(`${page}: level (high first, ties by name)`, render('level') === 'Bravo,Delta,Alpha,Charlie', render('level'))
  check(`${page}: power level (high first)`, render('power') === 'Bravo,Delta,Alpha,Charlie', render('power'))
  check(`${page}: class`, render('class') === 'Charlie,Alpha,Delta,Bravo', render('class'))
  check(`${page}: unknown key falls back to name`, render('bogus') === 'Alpha,Bravo,Charlie,Delta')
}

// The control shows the current sort and reports changes.
let picked
const view = renderRoster({ account, selectedGuild: null, sortKey: 'level', onSelectGuild: noop, onSort: (k) => { picked = k }, onReset: noop, onSaveToFile: noop })
const select = view.querySelector('.sort-control select')
check('select shows current sort', select.value === 'level')
check('select has the eight options', [...select.options].map((o) => o.textContent).join(',') === 'Name,Level,Power level,Gold,DPS,Honor,Honorable kills,Class')
select.value = 'power'
select.dispatchEvent(new dom.window.Event('change'))
check('changing the select calls onSort', picked === 'power')

console.log(failures ? `${failures} FAILED` : 'All passed')
process.exitCode = failures ? 1 : 0
