import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { ROUTES, routeOf, routeZone, routeTravel } = await import(root + 'leveling.js')
const { getZone } = await import(root + 'zones.js')
const { RACES } = await import(root + 'data.js')
const { default: Character } = await import(root + 'character.js')
const { activeQuests } = await import(root + 'quests.js')
let fails = 0
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg) } }

check(Object.keys(ROUTES).sort().join() === Object.keys(RACES).sort().join(), 'routes cover every race')
for (const [race, steps] of Object.entries(ROUTES)) {
  check(steps[0][0] === 1, `${race} starts at 1`)
  steps.forEach(([lv, name], i) => {
    const z = getZone(name)
    check(z, `${race} zone ${name} exists`)
    if (!z) return
    check(z.faction === 'Contested' || z.faction === RACES[race].faction, `${race} ${name} faction ${z.faction}`)
    check(lv >= z.minLevel, `${race} ${name} step ${lv} >= min ${z.minLevel}`)
    if (i) check(lv > steps[i - 1][0], `${race} ascending at ${name}`)
  })
}
check(JSON.stringify(ROUTES.Orc) !== JSON.stringify(ROUTES.Troll), 'orc and troll differ')
check(JSON.stringify(ROUTES.Dwarf) !== JSON.stringify(ROUTES.Gnome), 'dwarf and gnome differ')

const make = (race = 'Human', cls = 'Warrior', spec = 'Arms') => new Character({ characterName: 'T', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: 'DPS' })

// Idle characters stay idle.
const idle = make()
check(idle.farm(5, 0).travels.length === 0 && idle.zone === null, 'idle stays idle')
check(routeTravel(idle, 1, true) === undefined, 'no travel while idle')

// Breakpoint: reaching level 10 in Elwynn moves on to Westfall.
const h = make()
h.zone = 'Elwynn Forest'
let moves = []
while (h.characterLevel < 10) moves.push(...h.farm(0.25, 0).travels)
check(moves.length === 1 && moves[0].to === 'Westfall' && moves[0].reason === 'level' && h.zone === 'Westfall', `breakpoint move ${JSON.stringify(moves)}`)
check(routeZone(h) === 'Westfall', 'route zone at 10')

// Manual override lasts until the next breakpoint (16, Redridge) when it still has quests.
h.zone = 'Elwynn Forest'
moves = []
while (h.characterLevel < 11) moves.push(...h.farm(0.25, 0).travels)
check(moves.every((m) => m.reason === 'quests'), `override kept through a level-up without a breakpoint ${JSON.stringify(moves)}`)
check(routeTravel(h, h.characterLevel - 1, false) === undefined, 'no move on a level-up without a breakpoint')

// Running out of quests moves on to the next path zone with quests.
const g = make('Gnome', 'Mage', 'Frost')
g.zone = 'Dun Morogh'
moves = []
while (g.characterLevel < 10 && moves.length === 0) moves.push(...g.farm(0.25, 0).travels)
const outOfQuests = moves.find((m) => m.reason === 'quests')
if (outOfQuests) {
  check(outOfQuests.from === 'Dun Morogh', 'quests move from Dun Morogh')
  check(activeQuests(g, g.zone).length > 0, 'moved somewhere with quests')
}
// Force a run-out: complete every available quest in the current zone by hand, then ask.
const n = make('Night Elf', 'Hunter', 'Beast Mastery')
n.zone = 'Teldrassil'
while (n.characterLevel < 12) n.farm(0.25, 0)
n.zone = 'Teldrassil'
for (let i = 0; i < 200 && activeQuests(n, 'Teldrassil').length; i++) n.questsDone.push(...activeQuests(n, 'Teldrassil'))
const run = routeTravel(n, undefined, true)
check(run && run.reason === 'quests' && run.zone === 'Darkshore', `run-out goes to Darkshore ${JSON.stringify(run)}`)

// Breakpoint ignores the manual zone: an Orc sent to Westfall... (locked) - use Stranglethorn at 30 -> step 31 Arathi.
const o = make('Orc')
o.zone = 'Durotar'
while (o.characterLevel < 10) o.farm(0.25, 0)
check(o.zone === 'The Barrens', `orc in Barrens at 10 (${o.zone})`)
check(routeOf(o).length === ROUTES.Orc.length, 'routeOf')
console.log(fails ? `${fails} FAIL` : 'ok')
if (fails) process.exitCode = 1
