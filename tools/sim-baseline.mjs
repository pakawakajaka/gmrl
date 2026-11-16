// Prints deterministic mob-fight numbers so sim changes can be checked to leave PvE untouched.
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { ZONES, zoneLockReason } = await import(root + 'zones.js')
const { farmRates } = await import(root + 'combat.js')
const { trainSpells } = await import(root + 'spells.js')

const specs = [
  ['Warrior', 'Arms', 'Human', 'DPS'], ['Warrior', 'Protection', 'Orc', 'Tank'], ['Mage', 'Frost', 'Gnome', 'DPS'],
  ['Priest', 'Holy', 'Human', 'Healer'], ['Hunter', 'Beast Mastery', 'Night Elf', 'DPS'], ['Rogue', 'Combat', 'Human', 'DPS'],
  ['Paladin', 'Retribution', 'Human', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'],
]
const lines = []
for (const [cls, spec, race, role] of specs) {
  for (const level of [6, 20, 40, 60]) {
    const c = new Character({ characterName: 'Sim', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, copper: 1e9 })
    trainSpells(c)
    const zones = ZONES.filter((z) => !zoneLockReason(c, z))
    for (const z of zones) {
      const r = farmRates(c, z)
      lines.push(`${cls} ${spec} ${level} ${z.name} ${r.xpPerHour.toFixed(4)} ${r.copperPerHour.toFixed(4)}`)
    }
  }
}
console.log(lines.join('\n'))
