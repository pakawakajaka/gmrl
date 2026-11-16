// Balance check for 1v1s: node tools/measure.mjs [gmrl root, default this repo] [hours]
import { JSDOM } from 'jsdom'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = process.argv[2] ? pathToFileURL(process.argv[2]).href : fileURLToPath(new URL('..', import.meta.url))
const HOURS = Number(process.argv[3] ?? 300)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
const { default: Character } = await import(root + '/character.js')
const { worldPvp } = await import(root + '/pvp.js')

const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ALLIANCE = [['Warrior', 'Arms', 'Human'], ['Mage', 'Frost', 'Gnome'], ['Priest', 'Holy', 'Dwarf'], ['Rogue', 'Combat', 'Night Elf'], ['Paladin', 'Retribution', 'Human'], ['Hunter', 'Marksmanship', 'Dwarf'], ['Druid', 'Feral', 'Night Elf'], ['Warlock', 'Affliction', 'Gnome']]
const HORDE = [['Warrior', 'Arms', 'Orc'], ['Shaman', 'Enhancement', 'Orc'], ['Druid', 'Restoration', 'Tauren'], ['Warlock', 'Affliction', 'Undead'], ['Hunter', 'Beast Mastery', 'Troll'], ['Rogue', 'Combat', 'Undead'], ['Mage', 'Fire', 'Troll'], ['Priest', 'Shadow', 'Undead']]
const L = 'abcdefghijklmnopqrstuvwxyz'

const totals = { duels: 0, brawls: 0, evades: 0, attackerWins: 0, upsets: 0, decided: 0, draws: 0, duelSeconds: 0, palLost: 0, palEscaped: 0, alliance: 0, horde: 0, bank: 0, ms: 0 }
for (const [zone, level, seed] of [['Hillsbrad Foothills', 26, 1], ['Arathi Highlands', 36, 2], ['Stranglethorn Vale', 40, 3]]) {
  Math.random = seeded(seed + 99)
  const random = seeded(seed)
  const chars = []
  ;[ALLIANCE, HORDE].forEach((list, f) => list.forEach(([cls, spec, race], i) => {
    chars.push(new Character({ id: `id${f}${i}`, characterName: `Bal${L[f]}${L[i]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: 'DPS', characterLevel: level + (i % 3) - 1, zone }))
  }))
  const t0 = Date.UTC(2025, 0, 1)
  const start = performance.now()
  for (let h = 1; h <= HOURS; h++) {
    for (const e of worldPvp(chars, 1, t0 + h * 3600000, random)) {
      if (e.kind === 'evade') { totals.evades++; continue }
      if (e.log) { totals.logs = (totals.logs ?? 0) + 1; totals.events = (totals.events ?? 0) + e.log.length; totals.maxEvents = Math.max(totals.maxEvents ?? 0, e.log.length) }
      if (e.winner !== null) totals[e.sides[e.winner][0].faction.toLowerCase()]++
      if (e.kind === 'brawl') { totals.brawls++; continue }
      totals.duels++
      totals.duelSeconds += e.seconds
      if (e.winner === null && !e.escaped.length) totals.draws++
      const loser = e.dead[0] ?? e.escaped[0]
      if (loser) {
        totals.decided++
        if (loser === e.victim) totals.attackerWins++
        if ((loser === e.victim) !== (e.odds >= 0.5)) totals.upsets++
        if (loser.characterClass === 'Paladin' && loser.characterLevel >= 34) {
          totals.palLost++
          if (e.escaped.includes(loser)) totals.palEscaped++
        }
      }
    }
  }
  totals.ms += performance.now() - start
  totals.bank += chars.reduce((s, c) => s + c.timeBank, 0)
}
const pct = (a, b) => `${((100 * a) / Math.max(b, 1)).toFixed(1)}%`
console.log(`fights ${totals.duels + totals.brawls}: 1v1 ${totals.duels}, brawls ${totals.brawls} (${pct(totals.brawls, totals.duels + totals.brawls)}), escapes ${totals.evades}`)
console.log(`1v1: attacker wins ${pct(totals.attackerWins, totals.decided)}, upsets ${pct(totals.upsets, totals.decided)}, draws ${totals.draws}, mean length ${(totals.duelSeconds / totals.duels).toFixed(1)}s`)
console.log(`paladin (34+) lost 1v1 ${totals.palLost}, escaped ${pct(totals.palEscaped, totals.palLost)}`)
console.log(`faction wins: Alliance ${totals.alliance}, Horde ${totals.horde} (${pct(totals.alliance, totals.alliance + totals.horde)} Alliance)`)
if (totals.logs) console.log(`combat log events: mean ${(totals.events / totals.logs).toFixed(0)}, max ${totals.maxEvents}`)
console.log(`time lost to PvP: ${(-totals.bank / 3600).toFixed(1)} h total; run time ${(totals.ms / 1000).toFixed(1)}s`)
