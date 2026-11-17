import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { START_ZONES, LEAVE_START_LEVEL, startZone, zoneOptions, nextZone, MOVE_MARGIN } = await import(root + 'leveling.js')
const { getZone, zoneLockReason } = await import(root + 'zones.js')
const { RACES } = await import(root + 'data.js')
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { activeQuests } = await import(root + 'quests.js')
const { addTo } = await import('./helpers.mjs')
let fails = 0
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg) } }

// Every race starts in a level-1 zone of its own faction.
check(Object.keys(START_ZONES).sort().join() === Object.keys(RACES).sort().join(), 'start zones cover every race')
for (const [race, name] of Object.entries(START_ZONES)) {
  const z = getZone(name)
  check(z && z.minLevel === 1 && z.faction === RACES[race].faction, `${race} starts in ${name}`)
}

const make = (race = 'Human', cls = 'Warrior', spec = 'Arms', level = 1) => new Character({ characterName: 'T', characterClass: cls, characterSpec: spec, characterRace: race, characterRole: 'DPS', characterLevel: level })

// A new character starts farming in its starting zone without being sent.
const account = new Account('Test')
const orc = make('Orc')
addTo(account, orc, account.lastTick)
check(orc.zone === 'Durotar' && startZone(orc) === 'Durotar', `new orc starts in Durotar (${orc.zone})`)
check(!!orc.plannedAction, 'new orc has something to do')

// Idle characters stay idle.
const idle = make()
check(idle.farm(5, 0).travels.length === 0 && idle.zone === null, 'idle stays idle')
check(nextZone(idle, 'level') === undefined, 'no move while idle')

// The options: the current zone and the zones near the character's level it may enter, most worth first.
const h = make('Human', 'Warrior', 'Arms', 10)
h.zone = 'Elwynn Forest'
const options = zoneOptions(h)
check(options.some((o) => o.zone === 'Elwynn Forest'), 'current zone among the options')
check(options.every((o, i) => i === 0 || options[i - 1].value >= o.value), 'options sorted by worth')
check(options.every((o) => { const z = getZone(o.zone); return o.zone === h.zone || (!zoneLockReason(h, z) && z.maxLevel >= h.characterLevel - 3) }), 'options open and near level')
check(!options.some((o) => getZone(o.zone).faction === 'Horde'), 'no Horde zones for a human')

// Leveling up out of a starting zone: it stays until LEAVE_START_LEVEL, then moves on once another zone is
// worth enough more, for a reason.
const leveler = make()
leveler.zone = 'Elwynn Forest'
const moves = []
while (leveler.characterLevel < 14) {
  const travels = leveler.farm(0.25, 0).travels
  check(leveler.characterLevel >= LEAVE_START_LEVEL || leveler.zone === 'Elwynn Forest', `left Elwynn at ${leveler.characterLevel}`)
  moves.push(...travels)
}
check(leveler.zone !== 'Elwynn Forest', `left Elwynn by 14 (${leveler.zone})`)
check(moves.length > 0 && moves.every((m) => ['level', 'quests', 'stuck'].includes(m.reason)), `move reasons ${JSON.stringify(moves)}`)
check(moves.every((m) => getZone(m.to).faction !== 'Horde'), 'moves stay open to the faction')

// Sent to another race's starting zone below LEAVE_START_LEVEL, it stays there rather than going home.
const troll = make('Troll')
troll.zone = 'Mulgore'
const trollMoves = []
while (troll.characterLevel < LEAVE_START_LEVEL) trollMoves.push(...troll.farm(0.25, 0).travels)
check(trollMoves.length === 0 && troll.zone === 'Mulgore', `troll kept in Mulgore ${JSON.stringify(trollMoves)}`)

// A move only happens for a margin: the chosen zone beats the current one by MOVE_MARGIN.
const move = nextZone(h, 'level')
if (move) {
  const opts = zoneOptions(h)
  const here = opts.find((o) => o.zone === h.zone).value
  check(opts.find((o) => o.zone === move.zone).value > here * MOVE_MARGIN && move.seconds > 0, 'move beats staying by the margin')
}

// Sending a character somewhere by hand lasts until it next looks: farming without a level-up keeps it there
// unless it runs out of quests.
const sent = make('Human', 'Warrior', 'Arms', 12)
sent.zone = 'Westfall'
const kept = sent.farm(0.1, 0).travels
check(kept.every((m) => m.reason === 'quests'), `sent character kept through farming ${JSON.stringify(kept)}`)

// Running out of quests: it looks again, and goes to the best zone if that beats staying by the margin.
const n = make('Night Elf', 'Hunter', 'Beast Mastery', 12)
n.zone = 'Teldrassil'
for (let i = 0; i < 200 && activeQuests(n, 'Teldrassil').length; i++) n.questsDone.push(...activeQuests(n, 'Teldrassil'))
const run = nextZone(n, 'quests')
const [best] = zoneOptions(n)
const stay = zoneOptions(n).find((o) => o.zone === 'Teldrassil')
check((run?.zone ?? 'Teldrassil') === (best.value > stay.value * MOVE_MARGIN ? best.zone : 'Teldrassil') && (!run || run.reason === 'quests'), `run-out looks again ${JSON.stringify(run)}`)

// Stuck: a character that can't beat anything where it is goes where it can farm.
const lost = make('Orc', 'Warrior', 'Arms', 5)
lost.zone = 'Burning Steppes'
const rescue = lost.farm(0.25, 0).travels
check(rescue.length === 1 && rescue[0].reason === 'stuck' && getZone(lost.zone).minLevel <= 5, `stuck character moves ${JSON.stringify(rescue)}`)
console.log(fails ? `${fails} FAIL` : 'ok')
if (fails) process.exitCode = 1
