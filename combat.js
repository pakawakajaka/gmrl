// Fights against real mobs: how long a kill takes, how much health and mana it costs (and the eating and
// drinking after), and what it's worth. Each fight is simulated with the character's trained spells, gear
// and best rotation (see sim.js).
import { MAX_LEVEL } from './data.js'
import { MOBS, ZONE_MOBS } from './gear-data.js'
import { characterPower } from './power.js'
import { MAX_FIGHT_SECONDS, buildKit, foeFor, manaCost, simulate, variantsFor } from './sim.js'
import { grayLevel, zeroDifference } from './zones.js'

export const getMob = (entry) => (Object.hasOwn(MOBS, entry) ? MOBS[entry] : undefined)

// Finding, pulling and looting the next mob. Health and mana regen during it.
const OVERHEAD_SECONDS = 12
// Classic's five-second rule: no spirit mana regen until 5 seconds after the last cast.
const FIVE_SECOND_RULE = 5
// Sitting to eat raises spirit health regen by half.
const SITTING_REGEN = 1.5
// Pets out of combat heal 13% of their health every 2 seconds; a dead one is resummoned or revived.
const PET_REGEN_PER_SECOND = 0.065
const PET_REVIVE_SECONDS = 10

// Vendor food and water, free at every level: the best a character's level can use.
const FOOD = [
  { level: 1, name: 'Tough Jerky', health: 61.2, seconds: 18 },
  { level: 5, name: 'Haunch of Meat', health: 243.6, seconds: 21 },
  { level: 15, name: 'Mutton Chop', health: 552, seconds: 24 },
  { level: 25, name: 'Wild Hog Shank', health: 874.8, seconds: 27 },
  { level: 35, name: 'Cured Ham Steak', health: 1392, seconds: 30 },
  { level: 45, name: 'Roasted Quail', health: 2148, seconds: 30 },
]
const DRINK = [
  { level: 1, name: 'Refreshing Spring Water', mana: 151, seconds: 18 },
  { level: 5, name: 'Ice Cold Milk', mana: 437, seconds: 21 },
  { level: 15, name: 'Melon Juice', mana: 835, seconds: 24 },
  { level: 25, name: 'Sweet Nectar', mana: 1345, seconds: 27 },
  { level: 35, name: 'Moonberry Juice', mana: 1992, seconds: 30 },
  { level: 45, name: 'Morning Glory Dew', mana: 2934, seconds: 30 },
]
const bestFor = (list, level) => list.findLast((f) => f.level <= level)
export const foodFor = (level) => bestFor(FOOD, level)
export const drinkFor = (level) => bestFor(DRINK, level)

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

// The mob's level when the character fights it: as close to the character's as the mob comes.
export const mobLevelFor = (mob, level) => clamp(level, mob.level[0], mob.level[1])

export function mobHealth(mob, level) {
  const [lo, hi] = mob.level
  return hi > lo ? Math.round(mob.hp[0] + ((mob.hp[1] - mob.hp[0]) * (level - lo)) / (hi - lo)) : mob.hp[0]
}

// Kill and quest XP are Classic's times this, so leveling takes days rather than weeks of farming.
export const XP_RATE = 2

// Classic kill XP (CMaNGOS BaseGain): +5% per level the mob is above you (up to +4), falling off to
// nothing at gray. Elites give double. No XP at max level.
export function killXp(level, mobLevel, mob) {
  if (level >= MAX_LEVEL) return 0
  let xp
  if (mobLevel >= level) xp = ((level * 5 + 45) * (20 + Math.min(4, mobLevel - level))) / 10 / 2 + 0.5
  else if (mobLevel > grayLevel(level)) {
    const zd = zeroDifference(level)
    xp = ((level * 5 + 45) * (zd + mobLevel - level)) / zd
  } else return 0
  return Math.round(xp * (mob.elite ? 2 : 1) * (mob.xp ?? 1) * XP_RATE)
}

// Classic quest XP: full until you're 6 levels above the quest, then 80/60/40/20%, then 10%.
const QUEST_XP_FALLOFF = [1, 0.8, 0.6, 0.4, 0.2]
export function questXp(level, quest) {
  if (level >= MAX_LEVEL || !quest.xp) return 0
  const over = level - quest.level - 5
  return Math.round(quest.xp * (over <= 0 ? 1 : (QUEST_XP_FALLOFF[over] ?? 0.1)) * XP_RATE)
}

// Per-character fight numbers, rebuilt when level, gear or trained spells change.
const contexts = new WeakMap()
export function combatOf(character) {
  const key = `${character.characterLevel}|${Object.values(character.equipment).join()}|${character.spells.length}`
  let ctx = contexts.get(character)
  if (ctx?.key === key) return ctx
  const kit = buildKit(character)
  const { stats } = kit
  const level = character.characterLevel
  const food = foodFor(level)
  const drink = drinkFor(level)
  // Per second: standing regen, and while sitting to eat or drink.
  const healthRegen = (stats.healthRegen + stats.hp5) / 5 + kit.regen
  const manaRegen = stats.spell.regen / 5
  const mp5 = stats.spell.mp5 / 5
  // Mana per second that long self-buffs cost to keep up; charge-based ones are paid per charge used.
  const timed = kit.upkeep.filter((s) => s.power !== 'rage' && !s.charges && s.duration > 0)
  const charged = Object.fromEntries(kit.upkeep.filter((s) => s.charges).map((s) => [s.name, manaCost(kit, s) / s.charges]))
  if (kit.lightningShield) charged['Lightning Shield'] = manaCost(kit, kit.lightningShield.spell) / kit.lightningShield.spell.charges
  ctx = {
    key,
    kit,
    power: characterPower(character),
    health: stats.health,
    lifeTap: !!kit.abilities['Life Tap'],
    upkeepPerSecond: timed.reduce((sum, s) => sum + manaCost(kit, s) / (s.duration / 1000), 0),
    perCharge: { lightningShield: charged['Lightning Shield'] ?? 0, innerFire: charged['Inner Fire'] ?? 0 },
    healthBack: { standing: healthRegen, eating: (stats.healthRegen * SITTING_REGEN + stats.hp5) / 5 + kit.regen + food.health / food.seconds },
    manaBack: { overhead: mp5 * OVERHEAD_SECONDS + manaRegen * Math.max(0, OVERHEAD_SECONDS - FIVE_SECOND_RULE), drinking: manaRegen + mp5 + drink.mana / drink.seconds },
    fights: new Map(),
    pools: new Map(),
    duels: new Map(), // see pvp.js
  }
  contexts.set(character, ctx)
  return ctx
}

// Seconds of eating and drinking after a simulated fight. Food and drink go down together; warlocks Life
// Tap spare health into mana first.
export function restSeconds(ctx, result) {
  const health = Math.max(0, result.hpLost - ctx.healthBack.standing * OVERHEAD_SECONDS)
  const charges = result.charges.lightningShield * ctx.perCharge.lightningShield + result.charges.innerFire * ctx.perCharge.innerFire
  const upkeep = ctx.upkeepPerSecond
  // Buff upkeep runs through the whole cycle, drinking included.
  let mana = Math.max(0, result.manaLost + charges + upkeep * (result.seconds + OVERHEAD_SECONDS) - ctx.manaBack.overhead)
  const hr = ctx.healthBack.eating
  const mr = ctx.manaBack.drinking - upkeep
  let extraHealth = 0
  if (ctx.lifeTap && mana > 0) {
    const tap = clamp((mana * hr - health * mr) / (hr + mr), 0, mana)
    mana -= tap
    extraHealth = tap
  }
  const pet = result.petDied ? PET_REVIVE_SECONDS + 1 / PET_REGEN_PER_SECOND : Math.max(0, result.petLost / PET_REGEN_PER_SECOND - OVERHEAD_SECONDS)
  return Math.max((health + extraHealth) / hr, mr > 0 ? mana / mr : mana > 0 ? Infinity : 0, pet)
}

// The fastest cycle (fight, rest, next pull) among the class's rotation variants, or null if every
// variant dies or times out.
function bestCycle(ctx, foe) {
  let best = null
  for (const variant of variantsFor(ctx.kit)) {
    let result = simulate(ctx.kit, foe, variant)
    let rest = restSeconds(ctx, result)
    // Warriors' Bloodrage and Battle Shout outlast a fight; spread them over the real cycle.
    if (ctx.kit.cls === 'Warrior' && !result.died) {
      result = simulate(ctx.kit, foe, { ...variant, cycle: result.seconds + rest + OVERHEAD_SECONDS })
      rest = restSeconds(ctx, result)
    }
    if (result.died || !Number.isFinite(rest)) continue
    const seconds = result.seconds + rest + OVERHEAD_SECONDS
    if (!best || seconds < best.seconds) best = { result, rest, seconds, variant }
  }
  return best
}

// How a fight against mob `entry` goes. Unbeatable mobs would kill the character before dying.
export function fightAgainst(character, entry) {
  const ctx = combatOf(character)
  let fight = ctx.fights.get(entry)
  if (fight) return fight
  const mob = MOBS[entry]
  const level = mobLevelFor(mob, character.characterLevel)
  const best = bestCycle(ctx, foeFor(mob, level))
  fight = {
    entry,
    mob,
    level,
    fightSeconds: best ? best.result.seconds : MAX_FIGHT_SECONDS,
    damageShare: best ? best.result.hpLost / ctx.health : 1,
    eatSeconds: best ? best.rest : 0,
    seconds: best ? best.seconds : Infinity,
    beatable: !!best,
    dps: best ? best.result.dps : 0,
    variant: best?.variant,
    xp: killXp(character.characterLevel, level, mob),
    copper: (mob.coin ?? 0) + (mob.value ?? 0),
  }
  ctx.fights.set(entry, fight)
  return fight
}

// Mobs a character of `level` grinds in the zone: green to orange con. When that's only a few spawns,
// the zone's common mobs nearest the character's level instead. Rare spawns (under one spawn point)
// aren't ground; quests can still send characters after them.
const MIN_BAND_SPAWNS = 20
const COMMON_SPAWNS = 5
const bandCache = new Map()
function levelBand(zoneName, level) {
  const key = `${zoneName}|${level}`
  if (bandCache.has(key)) return bandCache.get(key)
  const mobs = (Object.hasOwn(ZONE_MOBS, zoneName) ? ZONE_MOBS[zoneName] : []).filter(([, weight]) => weight >= 1)
  const range = ([entry]) => MOBS[entry].level
  let band = mobs.filter((m) => range(m)[0] <= level + 2 && range(m)[1] >= level - 5)
  if (band.reduce((sum, [, weight]) => sum + weight, 0) < MIN_BAND_SPAWNS) {
    const common = mobs.filter(([, weight]) => weight >= COMMON_SPAWNS)
    const pool = common.length ? common : mobs
    const distance = (m) => Math.max(0, range(m)[0] - level, level - range(m)[1])
    const nearest = Math.min(...pool.map(distance))
    band = pool.filter((m) => distance(m) <= nearest + 3)
  }
  bandCache.set(key, band)
  return band
}

// The beatable mobs a character grinds in the zone, weighted by how often they're around.
// { total, weighted: [{ fight, weight, upTo }] }
export function grindPool(character, zoneName) {
  const ctx = combatOf(character)
  let pool = ctx.pools.get(zoneName)
  if (pool) return pool
  let total = 0
  const weighted = []
  for (const [entry, weight] of levelBand(zoneName, character.characterLevel)) {
    const fight = fightAgainst(character, entry)
    if (fight.beatable) weighted.push({ fight, weight, upTo: (total += weight) })
  }
  pool = { total, weighted }
  ctx.pools.set(zoneName, pool)
  return pool
}

export function pickGrindTarget(character, zoneName, random = Math.random) {
  const { total, weighted } = grindPool(character, zoneName)
  if (!total) return undefined
  const pick = random() * total
  return (weighted.find((m) => pick < m.upTo) ?? weighted.at(-1)).fight
}

// Expected rates from grinding the zone's mobs (quest rewards come on top). `beatable` is false when every
// mob in the character's range is too strong for it.
export function farmRates(character, zone) {
  const power = combatOf(character).power
  const { total, weighted } = grindPool(character, zone.name)
  if (!total) {
    return { power, beatable: false, killsPerHour: 0, xpPerHour: 0, copperPerHour: 0, fightSeconds: 0, eatSeconds: 0, dps: 0, mobLevels: null }
  }
  const avg = (key) => weighted.reduce((sum, m) => sum + m.fight[key] * m.weight, 0) / total
  const seconds = avg('seconds')
  const killsPerHour = 3600 / seconds
  const levels = weighted.map((m) => m.fight.level)
  return {
    power,
    beatable: true,
    killsPerHour,
    xpPerHour: avg('xp') * killsPerHour,
    copperPerHour: avg('copper') * killsPerHour,
    fightSeconds: avg('fightSeconds'),
    eatSeconds: avg('eatSeconds'),
    dps: avg('dps'),
    mobLevels: [Math.min(...levels), Math.max(...levels)],
  }
}
