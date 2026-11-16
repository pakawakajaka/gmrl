// Gear, loot, quests, stats and character sheet checks.
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { characterStats } = await import(root + 'stats.js')
const { getItem, bestLoadout, QUESTS } = await import(root + 'gear.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`)
  if (!ok) failures++
}

// Naked level-60 Human Warrior: AP = 60*3 + 120*2 - 20 = 400, armor = 80*2 = 160.
const war = new Character({ characterName: 'Tank', characterClass: 'Warrior', characterSpec: 'Protection', characterRace: 'Human', characterRole: 'Tank', characterLevel: 60 })
let s = characterStats(war)
check('L60 human warrior stats', s.stats.str.total === 120 && s.stats.agi.total === 80 && s.stats.spi.total === Math.trunc(47 * 1.05), JSON.stringify(Object.values(s.stats).map((v) => v.total)))
check('L60 warrior AP 400', s.melee.attackPower === 400, s.melee.attackPower)
check('L60 warrior armor 160', s.defenses.armor === 160, s.defenses.armor)
check('L60 warrior health', s.health === 1689 + 20 + (110 - 20) * 10, s.health)
check('warrior parry 5%', s.defenses.parry === 5)
check('warrior no mana, spell stats still present', s.mana === 0 && s.spell.damage === 0 && s.spell.regen === 0)

// Gnome mage: +5% int, arcane resist 10, mana.
const mage = new Character({ characterName: 'Mage', characterClass: 'Mage', characterSpec: 'Frost', characterRace: 'Gnome', characterRole: 'DPS', characterLevel: 60 })
s = characterStats(mage)
check('gnome mage arcane 10', s.resist.arcane === 10)
check('gnome mage mana > 0 and spell crit', s.mana > 0 && s.spell.crit > 0, `${s.mana} ${s.spell.crit.toFixed(2)}`)

// Equipping Mark of Fordring adds crit/AP.
war.equipment = { neck: 15411 }
s = characterStats(war)
check('Mark of Fordring AP/crit', s.melee.attackPower === 426 && Math.abs(s.melee.crit - (80 / 20 + 1)) < 1e-9, `${s.melee.attackPower} ${s.melee.crit}`)

// Proficiency: mage can't wear plate or a 2H sword.
const plate = Object.entries((await import(root + 'gear-data.js')).ITEMS).find(([, i]) => i.class === 4 && i.subclass === 4)[0]
check('mage ignores plate and 2H sword', Object.keys(bestLoadout(mage, [Number(plate), 5182]).equipment).length === 0)
check('L60 warrior wears Shiver Blade', bestLoadout(war, [5182]).equipment.mainHand === 5182)

// Random suffixes.
const { rollSuffix, itemKey } = await import(root + 'gear.js')
const monkey = getItem('6590:596')
check('Battleforge Boots of the Monkey', monkey?.name === 'Battleforge Boots of the Monkey' && monkey.stats.agi === 5 && monkey.stats.sta === 5 && monkey.armor === 134, JSON.stringify(monkey?.stats))
check('invalid suffix rejected', getItem('6590:5') === undefined && itemKey('6590:99999') === undefined && itemKey('<img>') === undefined && itemKey('6590:596') === '6590:596')
const rolls = {}
for (let i = 0; i < 5000; i++) { const name = getItem(rollSuffix(6590)).name.replace('Battleforge Boots ', ''); rolls[name] = (rolls[name] ?? 0) + 1 }
console.log('  Battleforge Boots suffix distribution:', Object.entries(rolls).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${(c / 50).toFixed(1)}%`).join(', '))
const tt = renderCharacterSheet({ character: Object.assign(new Character({ characterName: 'Tt', characterClass: 'Hunter', characterSpec: 'Marksmanship', characterRace: 'Dwarf', characterRole: 'DPS', characterLevel: 30 }), { equipment: { feet: '6590:596' } }) })
console.log('  suffix tooltip:', [...tt.querySelector('.paper-doll .tooltip').children].map((p) => p.textContent).join(' | '))
const war30 = new Character({ characterName: 'Warr', characterClass: 'Warrior', characterSpec: 'Arms', characterRace: 'Human', characterRole: 'DPS', characterLevel: 30 })
const agiBefore = characterStats(war30).stats.agi.total
war30.equipment = { feet: '6590:596' }
check('suffix stats count in sheet', characterStats(war30).stats.agi.total === agiBefore + 5)

// Farming: a level-1 human warrior in Elwynn for 20 hours.
const account = new Account('Test')
const fresh = new Character({ characterName: 'Fresh', characterClass: 'Warrior', characterSpec: 'Arms', characterRace: 'Human', characterRole: 'DPS' })
const t0 = 1_000_000_000_000
account.lastTick = t0
addTo(account, fresh, t0)
account.sendToZone(fresh.id, 'Elwynn Forest', t0)
account.tick(t0 + 10 * 60 * 1000)
check('errands and quests started in 10 min', fresh.questsDone.length >= 1 && fresh.activeQuests.length > 0, fresh.questsDone)
const naked = new Character({ characterName: 'Naked', characterClass: 'Warrior', characterSpec: 'Arms', characterRace: 'Human', characterRole: 'DPS', zone: 'Elwynn Forest' })
check('naked level 1 can beat Elwynn mobs', naked.rates.beatable && naked.itemLevel === 0, naked.rates.fightSeconds)
check('level 1 is sent after quest mobs', naked.plannedAction?.questId !== undefined, JSON.stringify(naked.plannedAction && { quest: naked.plannedAction.questId, mob: naked.plannedAction.fight?.mob.name }))
account.tick(t0 + 3600 * 1000)
check('kill quests turned in within an hour', fresh.questsDone.some((id) => QUESTS[id].kills || QUESTS[id].items), fresh.questsDone)
const result = account.tick(t0 + 20 * 3600 * 1000)
console.log('  level', fresh.characterLevel, 'quests', fresh.questsDone.length, 'equipped', Object.keys(fresh.equipment).length, 'bag', fresh.bag.length, 'upgrades', result.upgrades.length)
for (const [slot, id] of Object.entries(fresh.equipment)) console.log('   ', slot, getItem(id).name)
check('gear acquired over time', Object.keys(fresh.equipment).length >= 4)

// Westfall at 10+ until 25 hours more.
account.sendToZone(fresh.id, 'Westfall', t0 + 20 * 3600 * 1000)
account.tick(t0 + 40 * 3600 * 1000)
console.log('  after Westfall: level', fresh.characterLevel, 'quests', fresh.questsDone.length)
for (const [slot, id] of Object.entries(fresh.equipment)) console.log('   ', slot, getItem(id).name)

// Save/load round trip keeps gear.
const loaded = Account.fromJSON(JSON.parse(JSON.stringify(account)), t0 + 40 * 3600 * 1000)
const back = loaded.getCharacter(fresh.id)
check('round trip keeps gear', JSON.stringify(back.equipment) === JSON.stringify(fresh.equipment) && back.questsDone.length === fresh.questsDone.length)
const tampered = JSON.parse(JSON.stringify(account))
savedCharacters(tampered)[0].equipment = { head: 999999, mainHand: 15411, chest: '<img src=x>' }
savedCharacters(tampered)[0].questsDone = ['x', 1e9]
const cleaned = Account.fromJSON(tampered).characters[0]
check('tampered gear dropped', Object.values(cleaned.equipment).every((id) => getItem(id)) && cleaned.questsDone.length === 0, JSON.stringify(cleaned.equipment))

// Sheet renders.
const sheet = renderCharacterSheet({ character: account.getCharacter(fresh.id) })
check('sheet renders 19 slots', sheet.querySelectorAll('.paper-doll .slot').length === 19)
check('sheet has tooltips', sheet.querySelectorAll('.paper-doll .tooltip').length === Object.keys(fresh.equipment).length)
console.log('  sample tooltip:', [...sheet.querySelector('.paper-doll .tooltip').children].map((p) => p.textContent).join(' | '))

// Horde caster farms Durotar.
const shaman = new Character({ characterName: 'Thrall', characterClass: 'Shaman', characterSpec: 'Restoration', characterRace: 'Orc', characterRole: 'Healer' })
addTo(account, shaman, t0 + 40 * 3600 * 1000)
account.sendToZone(shaman.id, 'Durotar', t0 + 40 * 3600 * 1000)
account.tick(t0 + 50 * 3600 * 1000)
console.log('  shaman level', shaman.characterLevel, 'quests', shaman.questsDone.map((id) => id).length)
for (const [slot, id] of Object.entries(shaman.equipment)) console.log('   ', slot, getItem(id).name)
check('shaman got quest gear', shaman.questsDone.length > 0 && Object.keys(shaman.equipment).length > 0)

// Long offline payout is fast.
const start = performance.now()
const big = new Account('Big')
big.lastTick = t0
for (let i = 0; i < 10; i++) {
  const c = new Character({ characterName: `Big${'abcdefghij'[i]}`, characterClass: 'Rogue', characterSpec: 'Combat', characterRace: 'Human', characterRole: 'DPS' })
  addTo(big, c, t0)
  big.sendToZone(c.id, 'Elwynn Forest', t0)
}
big.tick(t0 + 7 * 24 * 3600 * 1000)
check('week offline for 10 chars (each leveling 1-60 along its path) < 5s', performance.now() - start < 5000, `${(performance.now() - start).toFixed(0)}ms`)

console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
