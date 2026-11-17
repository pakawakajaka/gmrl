import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { offSpecGear, specOptions, getItem, profileOf } = await import(root + 'gear.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')
const { renderTalents } = await import(root + 'talents-view.js')
const { defaultBuild } = await import(root + 'talents.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
Math.random = ((s) => () => ((s = (s * 16807) % 2147483647) / 2147483647))(7)

check('feral has tank and dps', specOptions('Druid').map((o) => o.label).join() === 'Balance,Feral Combat (Tank),Feral Combat (DPS),Restoration')

const w = new Character({ characterName: 'Arms', characterClass: 'Warrior', characterSpec: 'Arms', characterRace: 'Human', characterRole: 'DPS' })
w.zone = 'Elwynn Forest'
while (w.characterLevel < 25) w.farm(1, 0)
const off = offSpecGear(w, [...Object.values(w.equipment), ...w.bag])
const offIds = w.bag.filter((id) => off.has(id))
console.log('  level', w.characterLevel, w.zone, 'bag', w.bag.length, 'off-spec', offIds.map((id) => `${getItem(id).name} [${off.get(id)}]`).join('; '))
check('bag keeps off-spec gear', offIds.length > 0)
check('off-spec labeled Protection only', offIds.every((id) => off.get(id).join() === 'Protection'))
check('no worn item in bag', w.bag.every((id) => !Object.values(w.equipment).includes(id)))

const armsGear = { ...w.equipment }
check('invalid spec refused', !w.changeSpec('Holy', 'Healer') && w.characterSpec === 'Arms')
check('protection needs tank role', !w.changeSpec('Protection', 'DPS'))
check('switch to Protection', w.changeSpec('Protection', 'Tank') && w.characterSpec === 'Protection' && w.characterRole === 'Tank')
check('talents respent on protection default', Object.keys(w.talents).every((k) => k in defaultBuild('Warrior', 'Protection')) && Object.keys(w.talents).length > 0)
const swapped = Object.entries(armsGear).filter(([s, id]) => w.equipment[s] !== id)
check('gear swapped', swapped.length > 0, `${swapped.length} slots`)
const off2 = offSpecGear(w, [...Object.values(w.equipment), ...w.bag])
check('old arms gear now off-spec in bag', swapped.every(([, id]) => !w.bag.includes(id) || off2.get(id)?.join() === 'Arms,Fury'), swapped.map(([, id]) => `${getItem(id).name}:${off2.get(id)}`).join('; '))
check('back to Arms restores gear', w.changeSpec('Arms', 'DPS') && Object.entries(armsGear).every(([s, id]) => w.equipment[s] === id))

// Same-profile specs keep nothing extra.
const m = new Character({ characterName: 'Mage', characterClass: 'Mage', characterSpec: 'Frost', characterRace: 'Gnome', characterRole: 'DPS' })
check('mage has no off-spec profile', offSpecGear(m, ['2504']).size === 0)

// Save and load.
const a = accountOf('T', [w])
const back = Account.fromJSON(JSON.parse(JSON.stringify(a)))
const w2 = back.characters[0]
check('save/load keeps bag and spec', w2.bag.join() === w.bag.join() && w2.characterSpec === 'Arms', `${w2.bag.length}/${w.bag.length}`)
w.changeSpec('Protection', 'Tank')
const w3 = Account.fromJSON(JSON.parse(JSON.stringify(accountOf('T', [w])))).characters[0]
check('save/load after spec change', w3.characterSpec === 'Protection' && w3.characterRole === 'Tank' && JSON.stringify(w3.equipment) === JSON.stringify(w.equipment))
w.changeSpec('Arms', 'DPS')

// Sheet: Recent Loot sits under Bag; bag groups labeled.
const sheet = renderCharacterSheet({ character: w })
const stack = sheet.querySelector('[aria-label="Bag"]').parentElement
check('bag then loot in a stack', stack.classList.contains('sheet-stack') && [...stack.children].map((s) => s.getAttribute('aria-label')).join() === 'Bag,Recent loot')
check('questing panel has no loot', ![...sheet.querySelectorAll('[aria-label="Quests"] h3')].some((h) => h.textContent === 'Recent Loot'))
const labels = [...sheet.querySelectorAll('.bag-label')].map((h) => h.textContent)
console.log('  bag groups:', labels.join(' | '))
check('off-spec group shown', labels.includes('Off-spec: Protection'))
check('every bag item shown once', sheet.querySelectorAll('[aria-label="Bag"] .bag li').length === w.bag.length)

// Talent page spec picker.
let picked
const view = renderTalents({ character: w, onLearn() {}, onUnlearn() {}, onReset() {}, onDefault() {}, onSpec: (o) => { picked = o } })
const select = view.querySelector('.spec-picker select')
check('picker lists specs, current selected', [...select.options].map((o) => o.textContent).join() === 'Arms,Fury,Protection' && select.selectedOptions[0].textContent === 'Arms')
select.value = '2'; select.dispatchEvent(new dom.window.Event('change'))
check('picker calls onSpec', picked?.spec === 'Protection' && picked.role === 'Tank')
console.log(fails ? `${fails} FAILED` : 'ok')
process.exit(fails ? 1 : 0)
