// Power calibration: levels several class/specs from 1 to 60 by always farming the best-XP zone,
// printing gear rating, power and kill speed along the way.
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { ZONES, zoneLockReason } = await import(root + 'zones.js')
const { farmRates } = await import(root + 'combat.js')

const specs = [
  ['Warrior', 'Arms', 'Human', 'DPS'],
  ['Warrior', 'Protection', 'Orc', 'Tank'],
  ['Mage', 'Frost', 'Gnome', 'DPS'],
  ['Priest', 'Holy', 'Human', 'Healer'],
  ['Hunter', 'Beast Mastery', 'Night Elf', 'DPS'],
  ['Rogue', 'Combat', 'Human', 'DPS'],
  ['Paladin', 'Retribution', 'Human', 'DPS'],
  ['Shaman', 'Enhancement', 'Orc', 'DPS'],
  ['Druid', 'Restoration', 'Tauren', 'Healer'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'],
]
const only = process.argv[2]
const checkpoints = new Set([2, 5, 10, 15, 20, 30, 40, 50, 60])
for (const [cls, spec, race, role] of specs.filter(([c]) => !only || c === only)) {
  const t0 = performance.now()
  const c = new Character({ characterName: 'Sim', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role })
  let hours = 0
  let level = 0
  const rows = []
  while (c.characterLevel < 60 && hours < 2000) {
    if (c.characterLevel !== level) {
      level = c.characterLevel
      const open = ZONES.filter((z) => !zoneLockReason(c, z))
      c.zone = open.reduce((best, z) => (farmRates(c, z).xpPerHour > farmRates(c, best).xpPerHour ? z : best)).name
    }
    const before = c.characterLevel
    const r = farmRates(c, { name: c.zone })
    c.farm(0.25, 0)
    hours += 0.25
    if (c.characterLevel !== before && checkpoints.has(c.characterLevel)) {
      rows.push(`L${c.characterLevel} ${hours.toFixed(1)}h ${c.zone} ilvl ${c.itemLevel.toFixed(1)} solo ${r.power.solo.toFixed(0)} fight ${r.fightSeconds.toFixed(0)}s rest ${r.eatSeconds.toFixed(0)}s kills/h ${r.killsPerHour.toFixed(0)} xp/h ${r.xpPerHour.toFixed(0)} quests ${c.questsDone.length}`)
    }
  }
  c.zone = 'Eastern Plaguelands'
  c.farm(30, 0)
  const r = c.rates
  rows.push(`L60+30h ilvl ${c.itemLevel.toFixed(1)} solo ${r.power.solo.toFixed(0)} fight ${r.fightSeconds.toFixed(0)}s rest ${r.eatSeconds.toFixed(0)}s gold/h ${(r.copperPerHour / 10000).toFixed(1)}`)
  console.log(`${cls} ${spec} (${role}) ${(performance.now() - t0).toFixed(0)}ms\n  ` + rows.join('\n  '))
}
