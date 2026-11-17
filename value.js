// What a farming character's time is worth, so it can choose between quests, grinding, zones and dungeons.
// Below max level everything is valued in XP. Gear counts for the extra XP it would help earn while it's
// worn: its share of the character's power, over GEAR_KEEP_LEVELS levels' worth of XP. At max level XP
// stops, and everything is valued in the power that gear adds.
import { MAX_LEVEL, xpToNextLevel } from './data.js'
import { ITEMS, LOOT, LOOT_REFS, MOBS, SUFFIX_POOLS } from './gear-data.js'
import { SLOTS, canDualWield, canUseNow, fitsSlot, getItem, isTwoHand, itemScore, levelToUse, profileOf, questRewardsFor } from './gear.js'
import { combatOf, commonPool } from './combat.js'
import { scorePower } from './power.js'

// Levels a piece of leveling gear is worn before something better replaces it.
export const GEAR_KEEP_LEVELS = 5

// { xp, gear }: what a point of XP and a point of solo power are worth to the character.
export function worth(character) {
  if (character.characterLevel >= MAX_LEVEL) return { xp: 0, gear: 1 }
  return { xp: 1, gear: (GEAR_KEEP_LEVELS * xpToNextLevel(character.characterLevel)) / combatOf(character).power.solo }
}

const OTHER_SLOTS = Object.keys(SLOTS).filter((slot) => slot !== 'mainHand' && slot !== 'offHand')

// itemScore only depends on class and profile, so it's kept: Map(class|profile -> Map(item key -> { slot: score })).
const scoreTables = new Map()
function scoresOf(character) {
  const table = `${character.characterClass}|${profileOf(character)}`
  let scores = scoreTables.get(table)
  if (!scores) scoreTables.set(table, (scores = new Map()))
  return scores
}
function scoreIn(scores, character, key, slot) {
  if (!key) return 0
  let slots = scores.get(key)
  if (!slots) scores.set(key, (slots = {}))
  let score = slots[slot]
  if (score === undefined) score = slots[slot] = itemScore(character, getItem(key), slot)
  return score
}

// Item score that wearing item `key` would add over what's worn now; 0 if it's no better or can't be worn yet.
function scoreGain(character, key) {
  const item = getItem(key)
  if (!item || !canUseNow(character, item)) return 0
  return gainIn(scoresOf(character), character, key, item)
}

// The same for an item the character can wear now.
function gainIn(scores, character, key, item) {
  const worn = (slot) => scoreIn(scores, character, character.equipment[slot], slot)
  const score = (slot) => scoreIn(scores, character, key, slot)
  let best = 0
  if (fitsSlot(item, 'mainHand') || fitsSlot(item, 'offHand')) {
    const mainHand = getItem(character.equipment.mainHand)
    const now = worn('mainHand') + worn('offHand')
    if (isTwoHand(item)) best = score('mainHand') - now
    else {
      if (fitsSlot(item, 'mainHand')) best = score('mainHand') + worn('offHand') - now
      if (fitsSlot(item, 'offHand') && !(mainHand && isTwoHand(mainHand)) && (item.slot !== 13 || canDualWield(character))) {
        best = Math.max(best, worn('mainHand') + score('offHand') - now)
      }
    }
  } else {
    for (const slot of slotsOf(item)) best = Math.max(best, score(slot) - worn(slot))
  }
  return Math.max(0, best)
}

const typeSlots = new Map() // inventory type -> the slots other than weapons' it fits
function slotsOf(item) {
  let slots = typeSlots.get(item.slot)
  if (!slots) typeSlots.set(item.slot, (slots = OTHER_SLOTS.filter((slot) => fitsSlot(item, slot))))
  return slots
}

// Gear the class and race could ever wear that mobs drop: { refs, mobs } of Map(item id -> expected drops),
// `runs`: the same for kill lists (see runGear), and `levels`: Map(item id -> level the character can wear
// it at). Shared by every character of the kind.
const dropTables = new Map()
function dropsOf(character) {
  const key = `${character.characterClass}|${character.characterRace}`
  let table = dropTables.get(key)
  if (!table) dropTables.set(key, (table = { refs: new Map(), mobs: new Map(), runs: new WeakMap(), levels: new Map() }))
  return table
}

// Expected gains from one drop of each item, rebuilt when spec, role or dual wielding change. They're kept
// by place (see placeOf): { worn: what was worn there when they were worked out, items: Map(item id -> gain) },
// and a place's are dropped when what's worn there changes. Only items the character can wear now are asked
// about (see usable), so level doesn't matter otherwise.
const gainCaches = new WeakMap()
function gainsOf(character) {
  const key = `${character.characterSpec}|${character.characterRole}|${canDualWield(character)}`
  let gains = gainCaches.get(character)
  if (gains?.key !== key) gainCaches.set(character, (gains = { key, equipment: '', places: new Map() }))
  const equipment = Object.values(character.equipment).join()
  if (gains.equipment !== equipment) {
    gains.equipment = equipment
    for (const [place, cached] of gains.places) if (cached.worn !== wornIn(character, place)) gains.places.delete(place)
  }
  return gains.places
}

// Items' places, and the slots whose gear decides what wearing an item of the place would add.
const itemPlaces = new Map()
const placeSlots = new Map()
function placeOfId(id) {
  let place = itemPlaces.get(id)
  if (place === undefined) {
    place = placeOf(ITEMS[id])
    itemPlaces.set(id, place)
    if (place !== undefined && !placeSlots.has(place)) placeSlots.set(place, place === 'weapons' ? ['mainHand', 'offHand'] : OTHER_SLOTS.filter((slot) => fitsSlot(ITEMS[id], slot)))
  }
  return place
}
const wornIn = (character, place) => placeSlots.get(place).map((slot) => character.equipment[slot] ?? '').join()

// Expected item score gain from one drop of item `id` (one the character can wear now), averaged over its
// random suffixes.
const suffixKeys = new Map() // item id -> [[key, chance]]
function dropScore(character, places, id) {
  const place = placeOfId(id)
  let cached = places.get(place)
  if (!cached) places.set(place, (cached = { worn: wornIn(character, place), items: new Map() }))
  let gain = cached.items.get(id)
  if (gain !== undefined) return gain
  const scores = scoresOf(character)
  const pool = ITEMS[id].suffixes && SUFFIX_POOLS[ITEMS[id].suffixes]
  if (pool) {
    let keys = suffixKeys.get(id)
    if (!keys) suffixKeys.set(id, (keys = pool.map(([suffix, chance]) => [`${id}:${suffix}`, chance])))
    let total = 0
    gain = 0
    for (const [key, chance] of keys) {
      total += chance
      gain += chance * gainIn(scores, character, key, getItem(key))
    }
    gain /= total
  } else gain = gainIn(scores, character, id, ITEMS[id])
  cached.items.set(id, gain)
  return gain
}

// The gear in a loot list (see rollMobLoot in gear.js) the character's class and race could ever wear:
// Map(item id -> expected drops per roll of the list). Given `refs`, the list's references to shared lists
// go there instead (Map(ref -> expected rolls)).
function listDrops(character, table, entries, refs) {
  const drops = new Map()
  const add = (id, n) => {
    if (id > 0) {
      if (!table.levels.has(id)) {
        const item = Object.hasOwn(ITEMS, id) && placeOfId(id) !== undefined ? ITEMS[id] : undefined
        table.levels.set(id, item ? levelToUse(character, item) : Infinity)
      }
      if (table.levels.get(id) < Infinity) drops.set(id, (drops.get(id) ?? 0) + n)
    } else if (refs) {
      refs.set(-id, (refs.get(-id) ?? 0) + n)
    } else {
      for (const [item, m] of refDrops(character, table, -id)) drops.set(item, (drops.get(item) ?? 0) + n * m)
    }
  }
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const [id, chance, rolls = 1] = entry
      if (chance > 0) add(id, (rolls * chance) / 100)
    } else {
      for (const [id, chance] of entry.group) if (chance > 0) add(id, chance / 100)
    }
  }
  return drops
}

function refDrops(character, table, ref) {
  let drops = table.refs.get(ref)
  if (!drops) table.refs.set(ref, (drops = listDrops(character, table, LOOT_REFS[ref] ?? [])))
  return drops
}

// Gear one kill of mob `entry` drops that the class and race could ever wear: { items: Map(item id ->
// expected count), refs: Map(shared list -> expected rolls) }. Shared lists (world drops) are scored once
// rather than for every mob that rolls them.
function mobDrops(character, table, entry) {
  let drops = table.mobs.get(entry)
  if (!drops) {
    const lootId = MOBS[entry]?.loot
    const refs = new Map()
    const items = listDrops(character, table, lootId && Object.hasOwn(LOOT, lootId) ? LOOT[lootId] : [], refs)
    table.mobs.set(entry, (drops = { items, refs }))
  }
  return drops
}

// The drops (from mobDrops or runGear) the character can wear at its level: [[item id, expected count]].
const usableLists = new WeakMap() // drops -> Map(level -> list)
function usable(character, table, drops) {
  let byLevel = usableLists.get(drops)
  if (!byLevel) usableLists.set(drops, (byLevel = new Map()))
  const level = character.characterLevel
  let list = byLevel.get(level)
  if (!list) byLevel.set(level, (list = [...drops].filter(([id]) => table.levels.get(id) <= level)))
  return list
}

// Per-mob loot gains and per-zone grind values, kept as long as the character's fight numbers (see combatOf).
const valueCaches = new WeakMap()
function valuesOf(character) {
  const ctx = combatOf(character)
  const key = `${character.characterSpec}|${character.characterRole}`
  let values = valueCaches.get(ctx)
  if (values?.key !== key) valueCaches.set(ctx, (values = { key, mobs: new Map(), refs: new Map(), zones: new Map() }))
  return values
}

// Expected item score gain from one kill's loot.
function lootScore(character, table, gains, items) {
  let score = 0
  for (const [id, n] of usable(character, table, items)) score += n * dropScore(character, gains, id)
  return score
}

// Solo power the loot of one kill of mob `entry` is expected to add.
export function killGear(character, entry) {
  return gearIn(valuesOf(character), character, entry)
}

function gearIn(values, character, entry) {
  const { mobs } = values
  let gear = mobs.get(entry)
  if (gear === undefined) {
    const gains = gainsOf(character)
    const table = dropsOf(character)
    const { items, refs } = mobDrops(character, table, entry)
    let score = lootScore(character, table, gains, items)
    for (const [ref, n] of refs) score += n * refScore(values, character, table, gains, ref)
    mobs.set(entry, (gear = scorePower(character, score)))
  }
  return gear
}

// Expected item score gain from one roll of shared loot list `ref`.
function refScore({ refs }, character, table, gains, ref) {
  let score = refs.get(ref)
  if (score === undefined) refs.set(ref, (score = lootScore(character, table, gains, refDrops(character, table, ref))))
  return score
}

// Items that compete for the same place: weapons, or one other slot (rings and trinkets share theirs).
function placeOf(item) {
  if (fitsSlot(item, 'mainHand') || fitsSlot(item, 'offHand')) return 'weapons'
  return OTHER_SLOTS.find((slot) => fitsSlot(item, slot))
}

// Solo power the loot of `kills` ([mob entry, count], kept as is between calls) is expected to add, when the
// character gets `share` of the upgrades that drop. Only the best upgrade for each place counts, since one
// replaces the other.
export function runGear(character, kills, share = 1) {
  const table = dropsOf(character)
  let drops = table.runs.get(kills)
  if (!drops) {
    drops = new Map()
    for (const [entry, count] of kills) {
      const { items, refs } = mobDrops(character, table, entry)
      for (const [id, n] of items) drops.set(id, (drops.get(id) ?? 0) + n * count)
      for (const [ref, m] of refs) {
        for (const [id, n] of refDrops(character, table, ref)) drops.set(id, (drops.get(id) ?? 0) + m * n * count)
      }
    }
    table.runs.set(kills, drops)
  }
  return scorePower(character, bestUpgrades(character, gainsOf(character), usable(character, table, drops), share))
}

// Expected item score from drops ([[item id, expected count]]) when the character gets `share` of them and
// only the best upgrade for each place counts.
function bestUpgrades(character, gains, drops, share = 1) {
  const places = new Map()
  for (const [id, n] of drops) {
    const gain = dropScore(character, gains, id)
    if (gain <= 0) continue
    const place = placeOfId(id)
    const option = { gain, chance: share * (1 - Math.exp(-n)) }
    if (places.has(place)) places.get(place).push(option)
    else places.set(place, [option])
  }
  let score = 0
  for (const options of places.values()) {
    let none = 1 // chance nothing better dropped
    for (const { gain, chance } of options.sort((a, b) => b.gain - a.gain)) {
      score += gain * chance * none
      none *= 1 - chance
    }
  }
  return score
}

// Solo power that wearing the item now would add.
export function itemGain(character, key) {
  return scorePower(character, scoreGain(character, key))
}

// Solo power the quest's reward gear would add.
export const rewardGain = (character, quest) => questRewardsFor(character, quest).reduce((sum, id) => sum + itemGain(character, id), 0)

// Worth of one kill (see fightAgainst in combat.js): its XP and expected loot.
export function killValue(character, fight, w = worth(character)) {
  return fight.xp * w.xp + killGear(character, fight.entry) * w.gear
}

// Worth per hour of grinding the zone's mobs, judged by its common ones (see commonPool); 0 if there's
// nothing to beat. Of the gear their own loot lists drop in an hour, only the best upgrade for each place
// counts; shared lists (world drops) are rare enough per item to add up.
export function grindValue(character, zoneName) {
  const values = valuesOf(character)
  const { zones } = values
  if (zones.has(zoneName)) return zones.get(zoneName)
  const { total, weighted } = commonPool(character, zoneName)
  let rate = 0
  if (total) {
    const w = worth(character)
    let xp = 0
    let seconds = 0
    for (const { fight, weight } of weighted) {
      xp += weight * fight.xp
      seconds += weight * fight.seconds
    }
    const kills = (3600 * total) / seconds
    const table = dropsOf(character)
    const gains = gainsOf(character)
    const drops = new Map()
    let score = 0
    for (const { fight, weight } of weighted) {
      const share = (kills * weight) / total
      const { items, refs } = mobDrops(character, table, fight.entry)
      for (const [id, n] of usable(character, table, items)) drops.set(id, (drops.get(id) ?? 0) + n * share)
      for (const [ref, n] of refs) score += n * share * refScore(values, character, table, gains, ref)
    }
    score += bestUpgrades(character, gains, drops)
    rate = (xp / seconds) * 3600 * w.xp + scorePower(character, score) * w.gear
  }
  zones.set(zoneName, rate)
  return rate
}
