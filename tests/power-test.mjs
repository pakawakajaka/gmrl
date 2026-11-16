// Power and farm-rate checks. Run: node tests/power-test.mjs
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { getZone, grayLevel, zoneDifficulty } = await import(root + 'zones.js')
const { farmRates, fightAgainst, killXp, questXp, XP_RATE } = await import(root + 'combat.js')

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`)
  if (!ok) failures++
}
const make = (cls, spec, race, role, level, extra = {}) =>
  new Character({ characterName: 'Test', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, ...extra })

check('Classic gray levels', [grayLevel(5), grayLevel(10), grayLevel(20), grayLevel(40), grayLevel(60)].join() === '0,4,13,31,51')

const westfall = getZone('Westfall') // 10-20, mobs up to 19
const war23 = make('Warrior', 'Arms', 'Human', 'DPS', 23)
const war27 = make('Warrior', 'Arms', 'Human', 'DPS', 27)
check('L23 Westfall some XP', farmRates(war23, westfall).xpPerHour > 0)
check('L27 Westfall gray, no XP', zoneDifficulty(war27, westfall) === 'gray' && farmRates(war27, westfall).xpPerHour === 0)
check('gray zone still pays gold', farmRates(war27, westfall).copperPerHour > 0)
check('outleveled zone pays more gold than at level', farmRates(war27, westfall).copperPerHour > farmRates(make('Warrior', 'Arms', 'Human', 'DPS', 20), westfall).copperPerHour)
const war15 = make('Warrior', 'Arms', 'Human', 'DPS', 15)
check('in-range zone: beatable, fights under a minute', farmRates(war15, westfall).beatable && farmRates(war15, westfall).fightSeconds < 60, farmRates(war15, westfall).fightSeconds)
check('level 60: no XP', farmRates(make('Mage', 'Frost', 'Gnome', 'DPS', 60), getZone('Winterspring')).xpPerHour === 0)
check('level 1 cannot beat Winterspring', farmRates(make('Mage', 'Frost', 'Gnome', 'DPS', 1), getZone('Winterspring')).beatable === false)

// Classic XP formulas.
check('same-level kill XP (L10: 95)', killXp(10, 10, {}) === Math.round(95.5 * XP_RATE), killXp(10, 10, {}))
check('elite kill XP doubles', killXp(10, 10, { elite: true }) === Math.round(95.5 * 2 * XP_RATE))
check('gray mob gives no XP', killXp(20, 13, {}) === 0)
check('quest XP falls off 6+ levels over', questXp(15, { level: 10, xp: 100 }) === 100 * XP_RATE && questXp(16, { level: 10, xp: 100 }) === 80 * XP_RATE && questXp(30, { level: 10, xp: 100 }) === 10 * XP_RATE)

// Fights: time spent per kill is the fight plus rest and overhead.
const vermin = fightAgainst(make('Warrior', 'Arms', 'Human', 'DPS', 2), 6)
check('fight result shape', vermin.mob?.name === 'Kobold Vermin' && vermin.beatable && vermin.seconds > vermin.fightSeconds && vermin.xp > 0, JSON.stringify({ fight: vermin.fightSeconds, rest: vermin.eatSeconds, xp: vermin.xp }))

// Same level, no gear: tanks and healers solo slower but bring more to a party.
const dps = make('Warrior', 'Arms', 'Human', 'DPS', 30).power
const tank = make('Warrior', 'Protection', 'Human', 'Tank', 30).power
const healer = make('Priest', 'Holy', 'Human', 'Healer', 30).power
const mage = make('Mage', 'Frost', 'Gnome', 'DPS', 30).power
check('tank solo < DPS solo', tank.solo < dps.solo)
check('tank party > DPS party', tank.party > dps.party)
check('healer solo < DPS solo, party > DPS party', healer.solo < mage.solo && healer.party > mage.party)

// Gear raises power and farming speed.
const { ITEMS } = await import(root + 'gear-data.js')
const geared = make('Warrior', 'Arms', 'Human', 'DPS', 30)
geared.equipBest(Object.keys(ITEMS).map(Number).filter((id) => ITEMS[id].quality === 2 && !ITEMS[id].suffixes && ITEMS[id].itemLevel >= 28 && ITEMS[id].itemLevel <= 32))
const naked = make('Warrior', 'Arms', 'Human', 'DPS', 30)
const stv = getZone('Stranglethorn Vale')
check('gear raises power level', geared.power.solo > naked.power.solo, `${naked.power.solo.toFixed(0)} -> ${geared.power.solo.toFixed(0)}`)
check('gear raises item level', geared.itemLevel > 25 && naked.itemLevel === 0, geared.itemLevel.toFixed(1))
check('gear raises kill speed, XP and gold', farmRates(geared, stv).killsPerHour > farmRates(naked, stv).killsPerHour &&
  farmRates(geared, stv).xpPerHour > farmRates(naked, stv).xpPerHour && farmRates(geared, stv).copperPerHour > farmRates(naked, stv).copperPerHour)

// Farming a long stretch equips gear along the way (not only at the end).
const farmer = make('Rogue', 'Combat', 'Human', 'DPS', 1, { zone: 'Elwynn Forest' })
const result = farmer.farm(8, 0)
check('long farm levels up and equips', result.levels > 5 && result.upgrades.length > 0 && result.copper > 0, `levels ${result.levels} upgrades ${result.upgrades.length}`)

console.log(failures ? `${failures} FAILED` : 'All passed')
process.exitCode = failures ? 1 : 0
