// Where farming characters go. A new character starts in its race's starting zone and stays in a starting
// zone (its own, or another it was sent to) until LEAVE_START_LEVEL. After that it weighs
// every zone it can farm near its level by what its time there is worth (see value.js): the quests worth
// doing there, then grinding, over the next PLAN_HOURS, less the trip. It looks again when it levels up,
// runs out of quests worth doing, or can't beat anything where it is, and moves when another zone is worth
// MOVE_MARGIN more. Sending a character somewhere by hand lasts until it next looks.
import { grindPool } from './combat.js'
import { activeQuests, questPlan } from './quests.js'
import { grindValue, worth } from './value.js'
import { ZONES, getZone, zoneLockReason } from './zones.js'

export const START_ZONES = {
  'Human': 'Elwynn Forest',
  'Dwarf': 'Dun Morogh',
  'Gnome': 'Dun Morogh',
  'Night Elf': 'Teldrassil',
  'Orc': 'Durotar',
  'Troll': 'Durotar',
  'Undead': 'Tirisfal Glades',
  'Tauren': 'Mulgore',
}
export const startZone = (character) => (Object.hasOwn(START_ZONES, character.characterRace) ? START_ZONES[character.characterRace] : null)
// Below this level a character in any race's starting zone stays there unless it can't beat anything.
export const LEAVE_START_LEVEL = 10
const startZoneNames = new Set(Object.values(START_ZONES))

const PLAN_HOURS = 2
export const MOVE_MARGIN = 1.15
// Flying to another zone, and to another continent.
export const ZONE_TRAVEL_SECONDS = 900
const CONTINENT_TRAVEL_SECONDS = 1800
// Zones are weighed while their top level is no more than this far below the character's.
const LEVELS_BELOW = 3

export const travelSeconds = (from, to) => (!from || from === to ? 0 : from.continent === to.continent ? ZONE_TRAVEL_SECONDS : CONTINENT_TRAVEL_SECONDS)

// Worth per hour of farming the zone after `travel` seconds getting there: its quests worth doing (see
// activeQuests), and grinding for the rest of PLAN_HOURS.
export function zoneValue(character, zoneName, travel = 0) {
  const w = worth(character)
  let value = 0
  let seconds = 0
  for (const id of activeQuests(character, zoneName)) {
    const plan = questPlan(character, id, w)
    value += plan.value
    seconds += plan.seconds
  }
  const horizon = PLAN_HOURS * 3600
  if (seconds < horizon) {
    value += (grindValue(character, zoneName) * (horizon - seconds)) / 3600
    seconds = horizon
  }
  return (value / (seconds + travel)) * 3600
}

// The zones the character weighs, most worth first: [{ zone, value (per hour, counting the trip) }]. Its
// current zone is always among them.
export function zoneOptions(character) {
  const here = getZone(character.zone)
  const low = character.characterLevel - LEVELS_BELOW
  return ZONES
    .filter((z) => z === here || (!zoneLockReason(character, z) && z.maxLevel >= low))
    .map((z) => ({ zone: z.name, value: zoneValue(character, z.name, travelSeconds(here, z)) }))
    .sort((a, b) => b.value - a.value)
}

// Where a farming character moves when it looks again, or undefined to stay: { zone, reason, seconds }
// with `reason` 'level', 'gear', 'quests' or 'stuck'. A stuck character goes to the best zone it can farm.
// Between level-ups other zones only get less worth (better gear gains less from their loot), so while its
// zone still beats the best other zone as it was last weighed, it stays without weighing them again. Over a
// level-up they change little, so it weighs them again every RIVAL_LEVELS levels, or sooner when its zone
// falls behind.
const RIVAL_LEVELS = 2
const rivals = new WeakMap() // character -> { zone, level, value: the best other zone's worth }
export function nextZone(character, reason) {
  const here = getZone(character.zone)
  if (!here) return undefined
  const stuck = reason === 'stuck'
  if (!stuck && character.characterLevel < LEAVE_START_LEVEL && startZoneNames.has(here.name)) return undefined
  const last = rivals.get(character)
  const since = character.characterLevel - (last?.level ?? -Infinity)
  if (!stuck && last?.zone === here.name && since >= 0 && since < (reason === 'level' ? RIVAL_LEVELS : 1) &&
    last.value <= zoneValue(character, here.name) * MOVE_MARGIN) return undefined
  const options = zoneOptions(character)
  const others = options.filter((o) => o.zone !== here.name)
  rivals.set(character, { zone: here.name, level: character.characterLevel, value: others[0]?.value ?? 0 })
  const best = stuck ? others.find((o) => canFarm(character, o.zone)) : options[0]
  if (!best || best.zone === here.name) return undefined
  if (!stuck && best.value <= options.find((o) => o.zone === here.name).value * MOVE_MARGIN) return undefined
  return { zone: best.zone, reason, seconds: travelSeconds(here, getZone(best.zone)) }
}

const canFarm = (character, zoneName) => grindPool(character, zoneName).total > 0 || activeQuests(character, zoneName).length > 0
