// World PvP checks. Run: node tests/pvp-test.mjs
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window

const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { getZone } = await import(root + 'zones.js')
const { duel, worldPvp } = await import(root + 'pvp.js')

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`)
  if (!ok) failures++
}
// Seeded random (mulberry32).
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const SPECS = [
  ['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS'], ['Priest', 'Holy', 'Dwarf', 'Healer'],
  ['Rogue', 'Combat', 'Night Elf', 'DPS'], ['Paladin', 'Retribution', 'Human', 'DPS'],
  ['Warrior', 'Arms', 'Orc', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'], ['Hunter', 'Beast Mastery', 'Troll', 'DPS'],
]
const make = ([cls, spec, race, role], level, zone, i) =>
  new Character({ id: `c${i}`, characterName: `${cls}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, zone })
const HOUR = 3600 * 1000
const now = Date.UTC(2025, 0, 1)
function account(zone = 'Hillsbrad Foothills', level = 25, hours = 10) {
  return accountOf('Test', SPECS.map((s, i) => make(s, level, zone, i)), now - hours * HOUR)
}
const summary = (fights) => fights.map((f) => f.kind === 'evade' ? `${f.runner.id}~${f.chaser.id}:${f.how}` : `${f.kind}:${f.sides.map((s) => s.map((c) => c.id).join('+')).join('v')}:${f.winner}:${f.dead.map((c) => c.id)}`).join()

check('Hillsbrad Foothills is contested', getZone('Hillsbrad Foothills').faction === 'Contested')
const factions = account().characters.map((c) => c.faction)
check('5 Alliance and 5 Horde', factions.filter((f) => f === 'Alliance').length === 5 && factions.filter((f) => f === 'Horde').length === 5, factions.join())

// Loot rolls use Math.random; seed it too so whole ticks repeat.
const run = (seed, level, hours) => {
  Math.random = seeded(seed + 1000)
  const acc = account(undefined, level, hours)
  acc.characters.forEach((c, i) => { c.dungeonQueue = { dungeons: [`none${i}`], since: 0, manual: true } }) // no dungeon runs
  return { acc, ...acc.tick(now, seeded(seed)) }
}
const t0 = performance.now()
const { acc: a, fights: events, travels: moved } = run(1)
const travelers = new Set(moved.map((t) => t.character.id)) // moved to another zone mid-run
const ms = performance.now() - t0
const fights = events.filter((f) => f.kind !== 'evade')
check('fights happen over 10 hours', fights.length > 0, `${fights.length} fights (${fights.filter((f) => f.kind === 'brawl').length} brawls) in ${ms.toFixed(0)} ms`)
// The most time away that pays out (MAX_AWAY_HOURS). A returning player can wait up to 40s; shared CI machines
// run 2-3x slower than a desktop.
{
  const t = performance.now()
  run(1, undefined, 30)
  const slow = performance.now() - t
  check('30 hours of PvP and farming for 10 characters < 40s', slow < 40000, `${slow.toFixed(0)} ms`)
}
check('only cross-faction fights', fights.every((f) => f.sides.every((s, i) => s.every((c) => c.faction === f.sides[i][0].faction && (travelers.has(c.id) || c.zone === f.zone))) && f.sides[0][0].faction !== f.sides[1][0].faction))
check('same seed, same fights', summary(run(1).fights) === summary(events))
check('another seed, other fights', summary(run(2).fights) !== summary(events))

const sum = (key) => a.characters.reduce((s, c) => s + c[key], 0)
const deaths = fights.reduce((s, f) => s + f.dead.length, 0)
check('deaths match fights, every death credited', sum('pvpDeaths') === deaths && sum('pvpKills') >= deaths && deaths > 0, `${sum('pvpKills')}/${sum('pvpDeaths')}/${deaths}`)
check('honorable kills counted', sum('honorableKills') === fights.reduce((s, f) => s + f.honor, 0) && sum('honorableKills') > 0)
check('attackers thought they had a chance', fights.every((f) => f.guess >= 0.4))
check('nobody attacks more than 2 levels up', fights.every((f) => f.levels[1] <= f.levels[0] + 2))
check('at most 5 a side', fights.every((f) => f.sides.every((s) => s.length <= 5)))
const inIt = (c) => fights.filter((f) => f.sides.some((s) => s.includes(c)))
check('at most 4 fights an hour, 15 minutes apart', a.characters.every((c) => inIt(c).every((f, i, list) => i === 0 || f.at - list[i - 1].at >= 15 * 60 * 1000)))
{
  const crowd = Array.from({ length: 24 }, (_, i) => make(SPECS[i % 2 ? 5 : 0], 25, 'Hillsbrad Foothills', i))
  const benched = crowd.filter((_, i) => i % 4 < 2)
  for (const c of benched) c.pvpReadyAt = now + 100 * HOUR
  const crowdFights = worldPvp(crowd, 20, now, seeded(11)).filter((f) => f.kind !== 'evade')
  check('players on cooldown never join', crowdFights.some((f) => f.kind === 'brawl') && !crowdFights.some((f) => f.sides.flat().some((c) => benched.includes(c))), `${crowdFights.length} fights`)
}
const logged = (c) => inIt(c).length + events.filter((e) => e.kind === 'evade' && e.runner === c).length
check('logs have everyone in each fight', a.characters.every((c) => c.pvpLog.length === Math.min(20, logged(c))))
check('logs capped at 20', a.characters.every((c) => c.pvpLog.length <= 20))
const entry = a.characters.flatMap((c) => c.pvpLog).find((e) => e.attacked && e.odds !== undefined)
check('attacker log entry has guess and real odds', entry && entry.guess >= 0.4 && entry.odds >= 0 && entry.odds <= 1, JSON.stringify(entry))
const joined = a.characters.flatMap((c) => c.pvpLog).find((e) => e.joined)
check('joiners logged with sizes', !fights.some((f) => f.kind === 'brawl') || (joined && joined.size.length === 2 && Number.isInteger(joined.kills)), JSON.stringify(joined))

// Fights cost farming time: the same 10 hours earn less than without fights. Loot luck swings one run by
// more than the fights cost, so it's summed over a few seeds. Level 60s, who don't level up mid-run.
const earned = (acc) => acc.characters.reduce((s, c) => s + c.copper, 0)
let fought = 0
let farmed = 0
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const loud = run(seed, 60)
  fought += earned(loud.acc)
  const quiet = account(undefined, 60)
  Math.random = seeded(seed + 1000)
  for (const c of quiet.characters) c.farm(10, now)
  farmed += earned(quiet)
}
check('fighting costs farming income', fought < farmed, `${fought.toFixed(0)} < ${farmed.toFixed(0)}`)

// Saved and loaded.
const loaded = Account.fromJSON(JSON.parse(JSON.stringify(a)), now)
const same = loaded.characters.length === 10 && a.characters.every((o) => {
  const c = loaded.getCharacter(o.id)
  return c.honorableKills === o.honorableKills && c.pvpKills === o.pvpKills && c.pvpDeaths === o.pvpDeaths && JSON.stringify(c.pvpLog) === JSON.stringify(o.pvpLog) && c.pvpReadyAt === o.pvpReadyAt && c.hearthReadyAt === o.hearthReadyAt
})
check('PvP record survives save and load', same)
const tampered = JSON.parse(JSON.stringify(a))
const tc = savedCharacters(tampered)[0]
tc.honorableKills = -5
tc.pvpLog = [{ at: 'x' }, null, ...tc.pvpLog]
tc.timeBank = -1e9
tc.pvpReadyAt = 1e300
tc.hearthReadyAt = 'x'
const fixed = Account.fromJSON(tampered, now).getCharacter(tc.id)
check('bad PvP data dropped, time bank clamped', fixed.honorableKills === 0 && fixed.pvpLog.every((e) => e && Number.isFinite(e.at)) && fixed.timeBank >= -43200 && fixed.pvpReadyAt <= Date.now() + 86400000 && fixed.hearthReadyAt === 0, `${fixed.timeBank}`)

// No PvP outside contested zones.
const safe = SPECS.map((s, i) => make(s, 25, 'Westfall', i))
check('no fights outside contested zones', worldPvp(safe, 100, now, seeded(3)).length === 0)

// Duels: sane numbers; ten levels up wins.
const low = make(SPECS[0], 25, 'Hillsbrad Foothills', 20)
const high = make(SPECS[5], 35, 'Hillsbrad Foothills', 21)
const even = duel(make(SPECS[0], 25, null, 22), make(SPECS[5], 25, null, 23))
check('even duel numbers are sane', even.odds > 0.2 && even.odds < 0.8 && even.seconds > 0 && even.rest.every(Number.isFinite) && even.death.every((d) => d >= 120), JSON.stringify(even))
check('ten levels up wins', duel(high, low).odds > 0.95 && duel(low, high).odds < 0.05)

// Lower levels get away from higher ones; nobody fights more than 2 levels up.
const mixed = SPECS.map((s, i) => make(s, i < 5 ? 22 : 30, 'Hillsbrad Foothills', i))
const mixedEvents = worldPvp(mixed, 20, now, seeded(5))
const evades = mixedEvents.filter((e) => e.kind === 'evade')
check('lower levels run or hide', evades.length > 0 && evades.every((e) => e.runner.characterLevel < e.chaser.characterLevel), `${evades.length} getaways: ${evades.filter((e) => e.how === 'hid').length} hid`)
check('rogue and night elves hide', evades.filter((e) => e.runner.characterRace === 'Night Elf').every((e) => e.how === 'hid'))
const mixedFights = mixedEvents.filter((e) => e.kind !== 'evade')
check('the caught are caught by higher levels', mixedFights.filter((f) => f.caught).every((f) => f.levels[0] > f.levels[1]), `${mixedFights.filter((f) => f.caught).length} caught`)

// Paladins bubble and hearth.
const pally = make(SPECS[4], 40, 'Arathi Highlands', 0)
const orcs = [5, 6, 8].map((k, i) => make(SPECS[k], 42, 'Arathi Highlands', i + 1))
const hearthEvents = worldPvp([pally, ...orcs], 40, now, seeded(7)).filter((e) => e.kind !== 'evade')
const hearths = hearthEvents.filter((f) => f.escaped.includes(pally))
check('paladin bubble hearths out of lost fights', hearths.length > 0 && pally.hearthReadyAt > 0, `${hearths.length} of ${hearthEvents.length}`)
check('hearth once an hour', hearths.every((f, i) => i === 0 || f.at - hearths[i - 1].at >= 3600000))

// Brawl engine: two beat one.
const { brawl } = await import(root + 'sim.js')
const { combatOf } = await import(root + 'combat.js')
const w = [0, 1, 2].map((i) => make(SPECS[i ? 5 : 0], 30, null, 30 + i))
const vs = duel(w[0], w[1])
const b = brawl([{ kit: combatOf(w[0]).kit, variant: vs.variants[0] }, { kit: combatOf(w[1]).kit, variant: vs.variants[1] }])
b.add({ kit: combatOf(w[2]).kit, variant: vs.variants[1] }, 1)
while (!b.over && b.time < 600) b.run(600)
check('2v1 of even warriors: the pair wins', b.alive(1).length > 0 && b.alive(0).length === 0, `${b.time.toFixed(1)} s`)

console.log(failures ? `${failures} FAILED` : 'All passed')
process.exit(failures ? 1 : 0)
