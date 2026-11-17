// Levels a character per race 1-60 from its starting zone (farm() picks zones on its own).
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = process.env.ROOT ?? fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
const { default: Character } = await import(root + 'character.js')
const { startZone } = await import(root + 'leveling.js')
const specs = [
  ['Warrior', 'Arms', 'Human', 'DPS'],
  ['Paladin', 'Retribution', 'Dwarf', 'DPS'],
  ['Mage', 'Frost', 'Gnome', 'DPS'],
  ['Hunter', 'Beast Mastery', 'Night Elf', 'DPS'],
  ['Warrior', 'Protection', 'Orc', 'Tank'],
  ['Shaman', 'Enhancement', 'Troll', 'DPS'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'],
  ['Druid', 'Restoration', 'Tauren', 'Healer'],
]
const only = process.argv[2]
for (const [cls, spec, race, role] of specs.filter(([, , r]) => !only || r === only)) {
  const c = new Character({ characterName: 'Sim', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role })
  c.zone = startZone(c)
  let hours = 0
  const log = []
  let stuck = 0
  while (c.characterLevel < 60 && hours < 2000) {
    const lv = c.characterLevel, xp = c.characterXp
    const { travels } = c.farm(0.25, 0)
    hours += 0.25
    for (const t of travels) log.push(`${t.level}:${t.reason[0]}>${t.to}`)
    stuck = lv === c.characterLevel && xp === c.characterXp ? stuck + 1 : 0
    if (stuck > 40) { log.push(`STUCK L${c.characterLevel} in ${c.zone}`); break }
  }
  console.log(`${race} ${cls} ${spec}: L${c.characterLevel} in ${hours.toFixed(1)}h, ${c.questsDone.length} quests\n  ${log.join(' | ')}`)
}
