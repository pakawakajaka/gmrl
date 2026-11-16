// World PvP saturation: N characters per faction farming one contested zone.
// Run: node tools/pvp-sat.mjs [hours]
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
const { default: Character } = await import(root + 'character.js')
const { worldPvp } = await import(root + 'pvp.js')

const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ALLIANCE = [['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS'], ['Priest', 'Holy', 'Dwarf', 'Healer'], ['Rogue', 'Combat', 'Night Elf', 'DPS'], ['Paladin', 'Retribution', 'Human', 'DPS'], ['Hunter', 'Marksmanship', 'Dwarf', 'DPS'], ['Druid', 'Feral', 'Night Elf', 'DPS'], ['Warlock', 'Affliction', 'Gnome', 'DPS']]
const HORDE = [['Warrior', 'Arms', 'Orc', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'], ['Warlock', 'Affliction', 'Undead', 'DPS'], ['Hunter', 'Beast Mastery', 'Troll', 'DPS'], ['Rogue', 'Combat', 'Undead', 'DPS'], ['Mage', 'Fire', 'Troll', 'DPS'], ['Priest', 'Shadow', 'Undead', 'DPS']]
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const name = (i) => `Sat${LETTERS[Math.floor(i / 26) % 26]}${LETTERS[i % 26]}`

const HOURS = Number(process.argv[2] ?? 20)
const HOUR = 3600 * 1000
const start = Date.UTC(2025, 0, 1)

function scenario(label, zone, n, levelOf, seed) {
  Math.random = seeded(seed + 99)
  const random = seeded(seed)
  const chars = []
  for (let i = 0; i < n; i++) {
    for (const [list, f] of [[ALLIANCE, 0], [HORDE, 1]]) {
      const [cls, spec, race, role] = list[i % list.length]
      const k = chars.length
      chars.push(new Character({ id: `c${k}`, characterName: name(k), characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: levelOf(i, f, random), zone }))
    }
  }
  const t0 = performance.now()
  const events = []
  for (let h = 1; h <= HOURS; h++) events.push(...worldPvp(chars, 1, start + h * HOUR, random))
  const ms = performance.now() - t0
  const fights = events.filter((e) => e.kind !== 'evade')
  const evades = events.filter((e) => e.kind === 'evade')
  const brawls = fights.filter((f) => f.kind === 'brawl')
  const sizes = fights.map((f) => f.sides[0].length + f.sides[1].length)
  const charHours = chars.length * HOURS
  const busy = chars.map((c) => fights.filter((f) => f.sides.some((s) => s.includes(c))).length / HOURS)
  const lost = -chars.reduce((s, c) => s + c.timeBank, 0) / (charHours * 3600)
  const by = (f) => f.sides.map((s) => s.length).sort((a, b) => b - a).join('v')
  const shapes = {}
  for (const f of brawls) shapes[by(f)] = (shapes[by(f)] ?? 0) + 1
  const top = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ')
  return {
    label,
    n,
    'fights/h': (fights.length / HOURS).toFixed(1),
    'combat/char/h': (busy.reduce((a, b) => a + b, 0) / chars.length).toFixed(2),
    'max/char/h': Math.max(...busy).toFixed(2),
    'brawl %': fights.length ? ((100 * brawls.length) / fights.length).toFixed(0) : '-',
    'avg size': sizes.length ? (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2) : '-',
    max: sizes.length ? Math.max(...sizes) : 0,
    '5v5': fights.filter((f) => f.sides.every((s) => s.length === 5)).length,
    'evade/char/h': (evades.length / charHours).toFixed(2),
    caught: fights.filter((f) => f.caught).length,
    hearths: fights.reduce((s, f) => s + f.escaped.length, 0),
    'deaths/char/h': (fights.reduce((s, f) => s + f.dead.length, 0) / charHours).toFixed(2),
    'HK/char/h': (fights.reduce((s, f) => s + f.honor, 0) / charHours).toFixed(2),
    'time lost %': (100 * lost).toFixed(1),
    top,
    ms: ms.toFixed(0),
  }
}

const rows = []
for (const n of [1, 2, 4, 6, 8, 12, 16, 20]) rows.push(scenario('even 25', 'Hillsbrad Foothills', n, () => 25, n))
for (const n of [4, 12, 20]) rows.push(scenario('mixed 22-30', 'Hillsbrad Foothills', n, (i, f, r) => 22 + Math.floor(r() * 9), 100 + n))
for (const n of [4, 12, 20]) rows.push(scenario('mixed 38-46', 'Arathi Highlands', n, (i, f, r) => 38 + Math.floor(r() * 9), 200 + n))
console.table(rows)
