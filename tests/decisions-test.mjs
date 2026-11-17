// How farming characters weigh their time: XP until max level, gear after. Run: node tests/decisions-test.mjs
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { worth, grindValue, killGear } = await import(root + 'value.js')
const { activeQuests, questPlan } = await import(root + 'quests.js')
const { zoneOptions } = await import(root + 'leveling.js')
const D = await import(root + 'dungeons.js')
const { ZONE_MOBS } = await import(root + 'gear-data.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const make = (level, zone, [cls, spec, race, role] = ['Warrior', 'Arms', 'Orc', 'DPS']) =>
  new Character({ characterName: 'Dee', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, zone })

// Worth: XP below max level, with gear counted for the XP it helps earn; only gear at max level.
const leveler = make(20, 'The Barrens')
const capped = make(60, 'Eastern Plaguelands')
check('below 60: XP counts, gear counts for XP', worth(leveler).xp === 1 && worth(leveler).gear > 0, JSON.stringify(worth(leveler)))
check('at 60: only gear counts', worth(capped).xp === 0 && worth(capped).gear === 1)

// Gear from kills: a naked character gains from drops; one wearing better gear gains less.
const entry = Number(ZONE_MOBS['The Barrens'].find(([e]) => killGear(leveler, Number(e)) > 0)?.[0])
check('naked character values mob drops', entry > 0)
const before = killGear(leveler, entry)
leveler.farm(3, 0)
const naked = make(leveler.characterLevel, 'The Barrens')
check('better gear values the same drops less', killGear(leveler, entry) <= killGear(naked, entry), `${before.toFixed(3)} -> ${killGear(leveler, entry).toFixed(3)}`)

// Quests: only those worth more per hour than grinding the zone are taken.
const quester = make(14, 'The Barrens')
const grind = grindValue(quester, 'The Barrens')
const taken = activeQuests(quester, 'The Barrens')
check('quests taken', taken.length > 0 && taken.length <= 5, String(taken.length))
check('taken quests beat grinding', taken.every((id) => questPlan(quester, id).rate > grind))

// Zones: values are per hour, in XP below 60 and in power at 60; a max-level character still has somewhere
// worth farming for gear.
check('leveler zone values in XP', zoneOptions(quester)[0].value > 1000)
const capOptions = zoneOptions(capped)
check('level 60 has somewhere worth farming for gear', capOptions.length > 1 && capOptions[0].value > 0, JSON.stringify(capOptions[0]))

// A level 60 farms for gear: it gets better over a few hours, and never moves for a level.
Math.random = seeded(4)
const power = capped.power.solo
const { travels } = capped.farm(6, 0)
check('level 60 gets stronger farming', capped.power.solo > power, `${power.toFixed(0)} -> ${capped.power.solo.toFixed(0)}`)
check('level 60 moves for gear, quests or when stuck', travels.every((t) => ['gear', 'quests', 'stuck'].includes(t.reason)), JSON.stringify(travels.map((t) => t.reason)))

// Dungeons: worth something when the character can clear them, nothing when it'd wipe, and less once their
// quests are done.
Math.random = seeded(5)
const tank = make(18, 'The Barrens', ['Warrior', 'Protection', 'Orc', 'Tank'])
const wc = D.getDungeon('Wailing Caverns')
check('naked tank guesses it would wipe', D.dungeonValue(tank, wc) === 0)
tank.farm(4, 0)
const withQuests = D.dungeonValue(tank, wc)
check('geared tank values the dungeon', withQuests > 0, `level ${tank.characterLevel}: ${withQuests.toFixed(0)}`)
tank.questsDone.push(...D.dungeonQuestIds('Wailing Caverns'))
tank.dungeonQuests = tank.dungeonQuests.filter((id) => !D.dungeonQuestIds('Wailing Caverns').includes(id))
check('its quests add worth', D.dungeonValue(tank, wc) < withQuests, `${withQuests.toFixed(0)} -> ${D.dungeonValue(tank, wc).toFixed(0)}`)
const wanted = D.autoDungeons(tank)
check('auto dungeons most worth first', wanted.length > 0 && wanted.every((d, i) => i === 0 || wanted[i - 1].value >= d.value), JSON.stringify(wanted.map((d) => d.name)))

console.log(fails ? `${fails} FAILED` : 'ALL PASS')
if (fails) process.exitCode = 1
