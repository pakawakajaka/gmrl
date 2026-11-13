// World PvP. Characters of opposite factions farming the same contested zone now and then come across
// each other. Whoever notices first sizes the other up from what a player can see (level and numbers,
// nothing else), through a haze of bravado: it attacks, or if the other is higher level it runs or hides.
// A fight draws in others farming the zone, friend and foe, up to five a side; at five on five it's
// locked and plays out to the last one standing. A player takes part in at most four fights an hour: for
// a quarter of an hour after one it neither spots nor is spotted.
// One-on-one fights are worked out like mob fights, with expected values, both players simulated
// together; that gives both kill times and how much they can swing, and one roll at those odds picks the
// winner. The fight is then played out blow by blow, each player's luck nudged just enough that it ends
// the way the roll went. Once others join it's a brawl, everyone simulated together, each with a roll for
// how well it plays. Paladins bubble and hearth out of a lost fight.
// The data has no mounts, stealth or Divine Shield, so levels and classes stand in for them; Travel Form
// comes from the druid's trained spells.
import { combatOf, restSeconds } from './combat.js'
import { CLASSES, MAX_LEVEL, MIN_LEVEL, RACES } from './data.js'
import { HEARTH_SECONDS, MAX_FIGHT_SECONDS, brawl, duelSim, variantsFor } from './sim.js'
import { effectValue, getSpell, knownAbilities } from './spells.js'
import { getZone, grayLevel } from './zones.js'

const HOUR_MS = 3600 * 1000
export const MEETS_PER_HOUR = 0.5 // how often two enemies farming the same zone come across each other
export const FIGHTS_PER_HOUR = 4 // the most fights a player is in: after one, it's out of it for a while
const COOLDOWN_MS = HOUR_MS / FIGHTS_PER_HOUR
const MUTUAL = 0.5 // the chance the other one has noticed too
const REACTIONS = [0.5, 1, 1.5, 2, 2.5] // a jumped player's delay before fighting back, evenly likely
const CLOSE_SECONDS = 25 / 7 // a melee player running 25 yards at a ranged attacker
const UNMODELED = 0.1 // kill-time swing from what the sim leaves out: stuns, fears, kiting, latency
export const CORPSE_RUN_SECONDS = 120
const REVIVE_SHARE = 0.5 // health and mana after reviving at the corpse
const LOG_SIZE = 20

// Encounter records (see encounterRecord).
export const LOG_KINDS = ['hit', 'heal', 'immune', 'cast']
const LOG_EVENTS = 2000 // the most combat log entries kept for one fight
const MAX_ABILITIES = 200
const MAX_AMOUNT = 1e7

// The spotter's guess at its chance to win, in log-odds. It sees levels only: no gear, no talents.
const PER_LEVEL = 0.4 // each level of difference
const BRAVADO = 0.8 // a fair fight looks like 69% to a bloodthirsty player
const DRUNK = 1 // noise in the guess
const ATTACK_AT = 0.4 // attacks when the guess is at least this
const MAX_LEVELS_UP = 2 // never attacks an enemy more than this many levels above it

// Getting away from a higher-level enemy, by hiding or running, whichever looks safer.
const HIDE_SEEN = 0.4 // the chance an enemy who noticed spots a hiding player anyway
const STEALTH_SEEN = 0.1 // ... a stealthed one (rogues, druids, night elves)
const MOUNTED_SPOT = 1.5 // a fast enemy covers more ground and notices more
const CATCH = { faster: 0.9, even: 0.3, slower: 0.05 } // the chance a chaser catches a runner
const EVADE_SECONDS = 60 // farming lost getting away
const MOUNT_LEVEL = 40
const MOUNT_SPEED = 1.6
const TRAVEL_FORMS = { Shaman: ['Ghost Wolf', 20, 1.4], Hunter: ['Aspect of the Cheetah', 20, 1.3] } // name, level, speed

// Fights drawing others in.
const SIDE_LIMIT = 5
const BATTLE_VISIBILITY = 10 // how much easier a fight is to notice than a player going about its farming
const NOTICE_PER_SECOND = (MEETS_PER_HOUR * BATTLE_VISIBILITY) / 3600 // per fighter, per player around
const NUMBERS = 1 // log-odds a joiner puts on numbers: (allies + 1) / enemies
const JOIN_YARDS = 100
const YARDS_PER_SECOND = 7
const BATTLE_SECONDS = 600 // nobody keeps at it past this
const LUCK = 0.15 // how far a player's play swings in a brawl (log-normal spread of its damage)
const MAX_SHIFT = 3.2 // the most a one-on-one's luck is nudged to end as rolled (log scale, each side)

// Paladins bubble and hearth out of a fight they're losing.
const HEARTH_MS = HOUR_MS
const HEARTH_RETURN_SECONDS = 600 // flying back from the inn

const isMelee = (v) => v.pull === 'melee'

// Normal CDF (Abramowitz and Stegun 7.1.26).
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

// How a fight goes when `attacker` jumps `victim`: { variants, odds, draw, seconds, rest, death }.
// `variants` are the rotations both sides use; `odds` is the attacker's true chance to win; `seconds`
// how long the fight lasts; `rest[i]` and `death[i]` the
// seconds side i (0 = attacker) then spends recovering if it survives or dies. A draw is when neither
// can kill the other within the fight time limit; both walk away.
// Every pairing of the two sides' rotations is fought out. The attacker commits to the rotation whose
// worst pairing is best for it; the victim sees it coming and answers with the one best against it.
export function duel(attacker, victim) {
  const ctxs = [combatOf(attacker), combatOf(victim)]
  const key = `${victim.id}|${ctxs[1].key}`
  const cached = ctxs[0].duels.get(key)
  if (cached) return cached

  const kits = ctxs.map((c) => c.kit)
  const [mine, theirs] = kits.map(variantsFor)
  const worst = (row) => row.reduce((w, f) => (f.odds < w.odds ? f : w))
  const table = mine.map((a) => theirs.map((b) => fightOut(kits, [a, b])))
  const fight = worst(table.reduce((best, row) => (worst(row).odds > worst(best).odds ? row : best)))
  const rest = fight.states.map((r, i) => restAfter(ctxs[i], r))
  const death = ctxs.map(deathSeconds)
  const result = { variants: fight.variants, odds: fight.odds, draw: fight.draw, seconds: fight.seconds, rest, death }
  ctxs[0].duels.set(key, result)
  return result
}

// Rest after surviving a fight that left `result` (a fighter's result).
function restAfter(ctx, result) {
  return restSeconds(ctx, { ...result, hpLost: Math.min(ctx.kit.stats.health * 0.95, result.hpLost) })
}

// Running back to the corpse and resting up after reviving.
function deathSeconds(ctx) {
  const { health, mana } = ctx.kit.stats
  const revived = { seconds: 0, hpLost: health * (1 - REVIVE_SHARE), manaLost: mana * (1 - REVIVE_SHARE), charges: { lightningShield: 0, innerFire: 0 }, petDied: !!ctx.kit.pet, petLost: 0 }
  return CORPSE_RUN_SECONDS + restSeconds(ctx, revived)
}

// One pairing of rotations: { odds, draw, seconds, states } with `states` both sides' results when the
// first one fell. The attacker strikes first; the victim reacts late, and later still if it has to run
// in. Who heals or bursts first can flip on a fraction of a second, so the pairing is fought once per
// reaction time and averaged. Each side's kill time also swings with how few and how lumpy its blows
// are, plus what the sim leaves out.
function fightOut(kits, variants) {
  const melee = variants.map(isMelee)
  const runs = REACTIONS.map((reaction) => {
    const { downAt, atDown, end } = duelSim(kits, variants, [0, reaction + (melee[1] && !melee[0] ? CLOSE_SECONDS : 0)])
    const times = [downAt[1] ?? Infinity, downAt[0] ?? Infinity] // when side i has killed the other
    const killers = [(atDown[1] ?? end)[0], (atDown[0] ?? end)[1]]
    const sigmas = killers.map((r, i) => times[i] * Math.sqrt((r.hits > 0 ? r.spread / r.hits : 0) + UNMODELED ** 2))
    const draw = times[0] === Infinity && times[1] === Infinity
    let odds = 0.5
    if (times[1] === Infinity) odds = draw ? 0.5 : 1
    else if (times[0] === Infinity) odds = 0
    else odds = normalCdf((times[1] - times[0]) / Math.hypot(sigmas[0], sigmas[1]))
    const first = times[0] <= times[1] ? 1 : 0
    return { odds, draw, seconds: draw ? MAX_FIGHT_SECONDS : Math.min(...times), states: atDown[first] ?? end }
  })
  const mean = (key) => runs.reduce((sum, r) => sum + r[key], 0) / runs.length
  return { variants, odds: mean('odds'), draw: runs.every((r) => r.draw), seconds: mean('seconds'), states: runs[runs.length >> 1].states }
}

// A standard normal draw.
function gaussian(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
}

// The spotter's drunk guess at its chance to beat `enemy`.
export function guessOdds(spotter, enemy, random = Math.random) {
  const logit = PER_LEVEL * (spotter.characterLevel - enemy.characterLevel) + BRAVADO + DRUNK * gaussian(random)
  return 1 / (1 + Math.exp(-logit))
}

// Number of events in a Poisson process with mean `mean`.
function poisson(mean, random) {
  const limit = Math.exp(-mean)
  let n = 0
  for (let p = random(); p > limit; p *= random()) n += 1
  return n
}

// Waiting time to the next event of a Poisson process at `rate` per second.
function exponential(rate, random) {
  return -Math.log(1 - random()) / rate
}

const pick = (list, random) => list[Math.floor(random() * list.length)]
const ready = (c, at) => (c.pvpReadyAt ?? 0) <= at

// How `c` gets around faster than on foot: { name, speed } or null. A riding mount from level 40; before
// that a trained Travel Form, Ghost Wolf or Aspect of the Cheetah.
export function mountOf(c) {
  if (c.characterLevel >= MOUNT_LEVEL) return { name: 'Riding', speed: MOUNT_SPEED }
  const travel = c.characterClass === 'Druid' && knownAbilities(c)['Travel Form']
  if (travel) {
    const passive = getSpell(getSpell(travel).passive)
    const e = passive.effects.find((x) => x.aura === 31)
    return { name: 'Travel Form', speed: 1 + effectValue(passive, e, c.characterLevel) / 100 }
  }
  const form = TRAVEL_FORMS[c.characterClass]
  return form && c.characterLevel >= form[1] ? { name: form[0], speed: form[2] } : null
}

const speedOf = (c) => mountOf(c)?.speed ?? 1

// Stealth, Prowl or Shadowmeld.
const stealthy = (c) => c.characterClass === 'Rogue' || c.characterRace === 'Night Elf' || (c.characterClass === 'Druid' && c.characterLevel >= 20)

const travelSeconds = (c) => JOIN_YARDS / (YARDS_PER_SECOND * speedOf(c))

// A paladin's Divine Shield seconds if it can bubble and hearth out at `at`, else 0.
function bubbleHearth(c, at) {
  if (c.characterClass !== 'Paladin' || c.characterLevel < 34 || (c.hearthReadyAt ?? 0) > at) return 0
  return c.characterLevel >= 50 ? 12 : 10
}

// The spotter's guess at beating `enemy`, if it's enough to attack; else null.
function attackGuess(spotter, enemy, random) {
  if (enemy.characterLevel > spotter.characterLevel + MAX_LEVELS_UP) return null
  const guess = guessOdds(spotter, enemy, random)
  return guess >= ATTACK_AT ? guess : null
}

// Whether `c` joins the players `fighting`: like attacking, but it also counts heads.
function wantsIn(c, fighting, random) {
  const enemies = fighting.filter((f) => f.faction !== c.faction)
  if (!enemies.length || enemies.some((e) => e.characterLevel > c.characterLevel + MAX_LEVELS_UP)) return false
  const level = enemies.reduce((sum, e) => sum + e.characterLevel, 0) / enemies.length
  const allies = fighting.length - enemies.length
  const logit = PER_LEVEL * (c.characterLevel - level) + NUMBERS * Math.log((allies + 1) / enemies.length) + BRAVADO + DRUNK * gaussian(random)
  return 1 / (1 + Math.exp(-logit)) >= ATTACK_AT
}

// Meetings and fights among `characters` over the `hours` up to `now`. Fight and recovery time comes out
// of each character's time bank (it can go below zero: farming waits). Returns what happened: fights
// ({ kind: 'duel' | 'brawl' }, see battle) and getaways ({ kind: 'evade' }, see evade).
export function worldPvp(characters, hours, now = Date.now(), random = Math.random) {
  const zones = new Map()
  for (const c of characters) {
    if (getZone(c.zone)?.faction !== 'Contested') continue
    if (!zones.has(c.zone)) zones.set(c.zone, [])
    zones.get(c.zone).push(c)
  }
  const from = now - hours * HOUR_MS
  const meetings = []
  for (const here of zones.values()) {
    here.forEach((a, i) => {
      for (const b of here.slice(i + 1)) {
        if (a.faction === b.faction) continue
        for (let n = poisson(MEETS_PER_HOUR * hours, random); n > 0; n--) meetings.push({ at: from + random() * hours * HOUR_MS, pair: [a, b], here })
      }
    })
  }
  meetings.sort((a, b) => a.at - b.at)
  const events = []
  for (const { at, pair, here } of meetings) {
    if (!pair.every((c) => ready(c, at))) continue
    const event = meet(pair, at, here, random)
    if (event) events.push(event)
  }
  return events
}

// Two enemies come across each other: one notices first, and maybe the other too.
function meet(pair, at, here, random) {
  const [first, second] = random() < 0.5 ? pair : [pair[1], pair[0]]
  return react(first, second, at, here, random) ?? (random() < MUTUAL ? react(second, first, at, here, random) : null)
}

// `spotter` has noticed `enemy`: it attacks, gets away from a higher-level one, or lets it be (null).
function react(spotter, enemy, at, here, random) {
  const guess = attackGuess(spotter, enemy, random)
  if (guess !== null) return battle(spotter, enemy, guess, at, here, random)
  if (enemy.characterLevel > spotter.characterLevel) return evade(spotter, enemy, at, here, random)
  return null
}

// `runner` won't take on `chaser`: it hides or runs, whichever is less likely to get it caught. The
// chaser may have noticed; a fast one notices more. A hider it notices is found; a runner it may catch.
// Getting away costs the runner farming time but doesn't count as a fight.
function evade(runner, chaser, at, here, random) {
  const fast = speedOf(chaser)
  const ratio = fast / speedOf(runner)
  const outrun = ratio > 1.05 ? CATCH.faster : ratio > 0.95 ? CATCH.even : CATCH.slower
  const hidden = stealthy(runner) ? STEALTH_SEEN : HIDE_SEEN
  const how = hidden <= outrun ? 'hid' : 'ran'
  const seen = random() < Math.min(1, MUTUAL * (fast > 1 ? MOUNTED_SPOT : 1)) * (how === 'hid' ? hidden : 1)
  const guess = seen ? attackGuess(chaser, runner, random) : null
  if (guess !== null && (how === 'hid' || random() < outrun)) return battle(chaser, runner, guess, at, here, random, how)
  runner.timeBank -= EVADE_SECONDS
  log(runner, chaser, at, { attacked: false, won: null, fled: how })
  return { kind: 'evade', runner, chaser, how, zone: runner.zone, at }
}

// `attacker` jumps `victim` at `at`; `caught` is how the victim tried to get away ('ran' or 'hid'), if
// it did. Others farming the zone may notice and come in on either side. If nobody does it's a duel,
// decided by one roll at the true odds; otherwise a brawl. Returns { kind, attacker, victim, levels, zone,
// at, guess, odds, seconds, sides, winner, dead, escaped, honor, caught }: `sides` everyone in it (side 0
// is the attacker's), `winner` the side left standing (or null), `honor` the honorable kills earned.
function battle(attacker, victim, guess, at, here, random, caught = null) {
  const d = duel(attacker, victim)
  const pair = [attacker, victim]
  const sideOf = (c) => (c.faction === attacker.faction ? 0 : 1)
  const counts = [1, 1] // everyone who's joined each side or is on the way
  const pending = here.filter((c) => !pair.includes(c) && ready(c, at))
  const open = () => pending.filter((c) => counts[sideOf(c)] < SIDE_LIMIT)
  // One of the players `around` notices the fight among `fighting` and makes up its mind, once.
  function decide(around, fighting) {
    const c = pick(around, random)
    pending.splice(pending.indexOf(c), 1)
    if (!wantsIn(c, fighting, random)) return null
    counts[sideOf(c)] += 1
    return c
  }
  const base = { attacker, victim, levels: pair.map((c) => c.characterLevel), zone: attacker.zone, at, guess, odds: d.odds, caught }
  const melee = d.variants.map(isMelee)
  const reaction = () => pick(REACTIONS, random) + (melee[1] && !melee[0] ? CLOSE_SECONDS : 0)
  const spec = (c, variant, delay = 0) => ({ kit: combatOf(c).kit, variant, delay, luck: Math.exp(LUCK * gaussian(random)), hearth: bubbleHearth(c, at) })

  // One on one: rolled at the true odds and fought out to match...
  const roll = d.draw ? null : random() < d.odds ? 0 : 1
  const one = replay([spec(attacker, d.variants[0]), spec(victim, d.variants[1], reaction())], roll)

  // ...unless someone gets there before it's over.
  let clock = 0
  let first = null
  for (let around = open(); around.length && !first; around = open()) {
    clock += exponential(NOTICE_PER_SECOND * 2 * around.length, random)
    if (clock >= one.time) break
    const c = decide(around, pair)
    if (c && clock + travelSeconds(c) < one.time) first = { c, at: clock + travelSeconds(c) }
  }
  if (!first) {
    const parts = one.members.map((m, i) => {
      const how = m.out?.how ?? null
      const recovery = how === 'died' ? d.death[i] : how === 'escaped' ? HEARTH_RETURN_SECONDS : restAfter(combatOf(pair[i]), m.handle.result())
      return { c: pair[i], side: i, foe: pair[1 - i], joined: 0, travel: 0, left: m.out?.at ?? one.time, how, recovery, odds: i === 0 ? d.odds : 1 - d.odds, ...healthOf(m) }
    })
    // Bubbling out of a lost fight leaves it without a winner.
    const winner = parts.findIndex((p) => !p.how && parts[1 - p.side].how === 'died')
    return settle(parts, winner < 0 ? null : winner, one.time, base, one.log)
  }

  // A brawl: everyone fought out together, each with a roll for how well it plays.
  const b = brawl([spec(attacker, d.variants[0]), spec(victim, d.variants[1], reaction())])
  const chars = [...pair]
  const travel = [0, 0]
  const arrivals = [{ ...first, travel: travelSeconds(first.c) }]
  while (!b.over && b.time < BATTLE_SECONDS) {
    const fighting = b.members.filter((m) => !m.out).map((m) => chars[m.index])
    const around = open()
    const noticeAt = around.length ? b.time + exponential(NOTICE_PER_SECOND * fighting.length * around.length, random) : Infinity
    const next = arrivals.reduce((n, a) => (a.at < n.at ? a : n), { at: Infinity })
    const until = Math.min(noticeAt, next.at, BATTLE_SECONDS)
    if (b.run(until)) continue // someone's out: things have changed
    if (until === next.at) {
      arrivals.splice(arrivals.indexOf(next), 1)
      const side = sideOf(next.c)
      const m = b.add(spec(next.c, duel(next.c, pair[1 - side]).variants[0]), side)
      chars[m.index] = next.c
      travel[m.index] = next.travel
    } else if (until === noticeAt) {
      const c = decide(around, fighting)
      if (c) arrivals.push({ c, at: b.time + travelSeconds(c), travel: travelSeconds(c) })
    }
  }
  const standing = [0, 1].map((s) => b.alive(s).length)
  const winner = standing[0] && !standing[1] ? 0 : standing[1] && !standing[0] ? 1 : null
  const parts = b.members.map((m) => {
    const c = chars[m.index]
    const how = m.out?.how ?? null
    const ctx = combatOf(c)
    const recovery = how === 'died' ? deathSeconds(ctx) : how === 'escaped' ? HEARTH_RETURN_SECONDS : restAfter(ctx, m.handle.result())
    return { c, side: m.side, foe: chars[m.first.index], joined: m.offset, travel: travel[m.index], left: m.out?.at ?? b.time, how, recovery, ...healthOf(m) }
  })
  return settle(parts, winner, b.time, base, b.log)
}

// A brawl member's health when it ended: { hp, maxHp }.
const healthOf = (m) => ({ hp: Math.round(Math.min(Math.max(m.handle.hp, 0), m.handle.maxHp)), maxHp: Math.round(m.handle.maxHp) })

// Fights out a one-on-one between `specs` (attacker, victim) so it ends the way `roll` went: side 0 or 1
// winning, or (null) nobody going down. Both play with their roll for luck; if that ends otherwise, the
// winner's luck goes up and the loser's down (for a draw, both down) by the least that does it. Returns
// the finished brawl.
function replay(specs, roll) {
  const fight = (shift) => {
    const lucks = specs.map((s, i) => (roll === null ? Math.exp(-shift) : s.luck * Math.exp(i === roll ? shift : -shift)))
    const b = brawl(specs.map((s, i) => ({ ...s, luck: lucks[i] })))
    b.run(MAX_FIGHT_SECONDS)
    return b
  }
  const ends = (b) => (roll === null ? !b.over : !!b.members[1 - roll].out && !b.members[roll].out)
  let best = fight(0)
  if (ends(best)) return best
  let lo = 0
  let hi = 0.1
  for (best = fight(hi); !ends(best); best = fight(hi)) {
    if (hi >= MAX_SHIFT) return best
    lo = hi
    hi *= 2
  }
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2
    const b = fight(mid)
    if (ends(b)) {
      hi = mid
      best = b
    } else lo = mid
  }
  return best
}

// Books a fight's outcome for everyone in it (`parts`, attacker then victim then joiners). Each player
// killed gives a kill to every enemy there when it fell. `combatLog` is the brawl's (see brawl).
function settle(parts, winner, seconds, base, combatLog) {
  const { at, guess, caught } = base
  const group = parts.length > 2
  const size = [0, 1].map((s) => parts.filter((p) => p.side === s).length)
  const kills = parts.map(() => 0)
  const hks = parts.map(() => 0)
  for (const dead of parts) {
    if (dead.how !== 'died') continue
    parts.forEach((p, i) => {
      if (p.side === dead.side || p.joined > dead.left || (p.how && p.left < dead.left)) return
      kills[i] += 1
      if (dead.c.characterLevel > grayLevel(p.c.characterLevel)) hks[i] += 1
    })
  }
  parts.forEach((p, i) => {
    const { c } = p
    const won = p.how === 'died' ? false : p.how === 'escaped' || winner === null ? null : winner === p.side
    c.timeBank -= p.travel + p.left - p.joined + p.recovery
    c.pvpReadyAt = Math.max(at + p.joined * 1000 + COOLDOWN_MS, at + (p.left + p.recovery) * 1000)
    if (p.how === 'escaped') c.hearthReadyAt = at + p.left * 1000 + HEARTH_MS
    if (p.how === 'died') c.pvpDeaths += 1
    c.pvpKills += kills[i]
    c.honorableKills += hks[i]
    const fled = p.how === 'escaped' ? 'hearth' : i === 1 ? caught : null
    log(c, p.foe, at, {
      attacked: i === 0,
      ...(i >= 2 && { joined: true }),
      won,
      ...(p.odds !== undefined && { odds: p.odds }),
      ...(i === 0 && { guess }),
      ...(group && { size: [size[p.side], size[1 - p.side]], kills: kills[i] }),
      ...(hks[i] > 0 && { honor: true }),
      ...(fled && { fled }),
      ...(i === 1 && caught && { caught: true }),
    })
  })
  const who = (test) => parts.filter(test).map((p) => p.c)
  return {
    kind: group ? 'brawl' : 'duel',
    ...base,
    seconds,
    sides: [0, 1].map((s) => who((p) => p.side === s)),
    winner,
    dead: who((p) => p.how === 'died'),
    escaped: who((p) => p.how === 'escaped'),
    honor: hks.reduce((a, b) => a + b, 0),
    members: parts.map((p, i) => ({ c: p.c, side: p.side, joined: p.joined, left: p.left, out: p.how, kills: kills[i], honor: hks[i], hp: p.hp, maxHp: p.maxHp })),
    log: combatLog,
  }
}

// A fight or getaway as kept in the account's encounter log, with everyone as they were at the time.
// Side 0 is the attacker's (for a getaway, the runner's). `joined` and `left` are seconds into the fight;
// `out` is 'died', 'escaped' or null. `abilities` names what was used and `schools` gives each one's spell
// school (0 physical to 6 arcane); each member's `damage` and
// `healing` are [ability, amount, hits] rows, most first, `taken` its damage taken, and `hp` and `maxHp`
// its health when the fight ended (null for getaways). `log` is the
// combat log, [tenths of a second, kind (see LOG_KINDS), from, to, ability, amount, extra, hp] with
// `from` and `to` member indexes (see brawl), or null if it isn't kept.
export function encounterRecord(event, id) {
  const player = (c) => ({ id: c.id, name: c.characterName, level: c.characterLevel, race: c.characterRace, class: c.characterClass, spec: c.characterSpec })
  const evade = event.kind === 'evade'
  const events = evade ? [] : event.log ?? []
  const abilities = []
  const schools = []
  const named = new Map()
  const ability = (e) => {
    const key = `${e.ability}|${e.school}`
    if (!named.has(key)) {
      named.set(key, abilities.push(e.ability) - 1)
      schools.push(e.school)
    }
    return named.get(key)
  }
  const sums = (evade ? [0, 1] : event.members).map(() => ({ damage: new Map(), healing: new Map(), taken: 0 }))
  const add = (rows, a, amount) => {
    const row = rows.get(a) ?? [a, 0, 0]
    row[1] += amount
    row[2] += 1
    rows.set(a, row)
  }
  for (const e of events) {
    if (e.kind === 'hit') {
      add(sums[e.from].damage, ability(e), e.amount)
      sums[e.to].taken += e.amount
    } else if (e.kind === 'heal') add(sums[e.from].healing, ability(e), e.amount)
    else ability(e)
  }
  const rows = (map) => [...map.values()].map(([a, amount, hits]) => [a, Math.round(amount), hits]).sort((x, y) => y[1] - x[1])
  const detail = (i) => ({ damage: rows(sums[i].damage), healing: rows(sums[i].healing), taken: Math.round(sums[i].taken) })
  const members = evade
    ? [event.runner, event.chaser].map((c, side) => ({ ...player(c), side, joined: 0, left: 0, out: null, kills: 0, honor: 0, ...detail(side), hp: null, maxHp: null }))
    : event.members.map((m, i) => ({ ...player(m.c), side: m.side, joined: m.joined, left: m.left, out: m.out, kills: m.kills, honor: m.honor, ...detail(i), hp: m.hp, maxHp: m.maxHp }))
  return {
    id,
    kind: event.kind,
    at: event.at,
    zone: event.zone,
    seconds: evade ? 0 : event.seconds,
    winner: evade ? null : event.winner,
    guess: evade ? null : event.guess,
    odds: evade ? null : event.odds,
    caught: evade ? null : event.caught,
    how: evade ? event.how : null,
    members,
    abilities,
    schools,
    log: evade || !event.log ? null : events.slice(0, LOG_EVENTS).map((e) => [Math.round(e.t * 10), LOG_KINDS.indexOf(e.kind), e.from, e.to, named.get(`${e.ability}|${e.school}`), Math.round(e.amount), Math.round(e.extra), Math.round(e.hp)]),
  }
}

// Rebuilds an encounter record from untrusted saved data, or null if it isn't one.
export function restoreEncounter(e) {
  if (!e || typeof e !== 'object' || !Array.isArray(e.members)) return null
  const kinds = ['duel', 'brawl', 'evade']
  const ways = ['ran', 'hid']
  const seconds = (v) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), 0), BATTLE_SECONDS + HEARTH_SECONDS) : 0)
  const chance = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(Math.max(Number(v), 0), 1))
  const count = (v) => (Number.isInteger(v) && v >= 0 && v <= SIDE_LIMIT ? v : 0)
  const amount = (v) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Math.round(Number(v)), 0), MAX_AMOUNT) : 0)
  const index = (v, n) => Number.isInteger(v) && v >= 0 && v < n
  const abilities = Array.isArray(e.abilities) ? e.abilities.slice(0, MAX_ABILITIES).map((a) => (typeof a === 'string' ? a.slice(0, 40) : '')) : []
  const rows = (list) =>
    (Array.isArray(list) ? list.slice(0, abilities.length) : [])
      .filter((r) => Array.isArray(r) && index(r[0], abilities.length) && Number.isInteger(r[2]) && r[2] >= 0)
      .map((r) => [r[0], amount(r[1]), Math.min(r[2], MAX_AMOUNT)])
  const members = e.members.map((m) => {
    if (!m || typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id) || typeof m.name !== 'string' || typeof m.spec !== 'string') return null
    if (!Object.hasOwn(RACES, m.race) || !Object.hasOwn(CLASSES, m.class) || ![0, 1].includes(m.side)) return null
    const level = Number(m.level)
    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) return null
    const maxHp = amount(m.maxHp) || null
    return {
      id: m.id,
      name: m.name.slice(0, 12),
      level,
      race: m.race,
      class: m.class,
      spec: m.spec.slice(0, 30),
      side: m.side,
      joined: seconds(m.joined),
      left: seconds(m.left),
      out: ['died', 'escaped'].includes(m.out) ? m.out : null,
      kills: count(m.kills),
      honor: count(m.honor),
      damage: rows(m.damage),
      healing: rows(m.healing),
      taken: amount(m.taken),
      hp: maxHp && Math.min(amount(m.hp), maxHp),
      maxHp,
    }
  })
  const sizes = [0, 1].map((s) => members.filter((m) => m?.side === s).length)
  if (members.some((m) => !m) || sizes.some((n) => n < 1 || n > SIDE_LIMIT)) return null
  if (typeof e.id !== 'string' || !/^[\w-]{1,64}$/.test(e.id) || !kinds.includes(e.kind) || !Number.isFinite(Number(e.at)) || typeof e.zone !== 'string') return null
  const tenths = (BATTLE_SECONDS + HEARTH_SECONDS) * 10
  const entry = (r) =>
    Array.isArray(r) && Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= tenths && index(r[1], LOG_KINDS.length) && index(r[2], members.length) && index(r[3], members.length) && index(r[4], abilities.length)
  return {
    id: e.id,
    kind: e.kind,
    at: Number(e.at),
    zone: e.zone.slice(0, 100),
    seconds: seconds(e.seconds),
    winner: [0, 1].includes(e.winner) ? e.winner : null,
    guess: chance(e.guess),
    odds: chance(e.odds),
    caught: ways.includes(e.caught) ? e.caught : null,
    how: ways.includes(e.how) ? e.how : null,
    members,
    abilities,
    schools: abilities.map((_, i) => (Array.isArray(e.schools) && Number.isInteger(e.schools[i]) && e.schools[i] >= 0 && e.schools[i] <= 6 ? e.schools[i] : null)),
    log: Array.isArray(e.log) ? e.log.slice(0, LOG_EVENTS).filter(entry).map((r) => [r[0], r[1], r[2], r[3], r[4], amount(r[5]), amount(r[6]), amount(r[7])]) : null,
  }
}

function log(c, foe, at, fields) {
  const entry = { at, foe: foe.characterName, foeLevel: foe.characterLevel, foeClass: foe.characterClass, foeRace: foe.characterRace, zone: c.zone, ...fields }
  c.pvpLog = [entry, ...c.pvpLog].slice(0, LOG_SIZE)
}
