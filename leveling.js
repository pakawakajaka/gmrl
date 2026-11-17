// Where farming characters go. A new character starts in its race's starting zone and stays in a starting
// zone (its own, or another it was sent to) until LEAVE_START_LEVEL. After that it weighs
// every zone it can farm near its level by what its time there is worth (see value.js): the quests worth
// doing there, then grinding, over the next PLAN_HOURS, less the trip. It looks again when it levels up,
// runs out of quests worth doing, or can't beat anything where it is, and moves when another zone is worth
// MOVE_MARGIN more. Sending a character somewhere by hand lasts until it next looks. It also looks when a
// player sets it to go after an item (see Character.wanted) and when it gets it.
import { grindPool } from './combat.js'
import { activeQuests, questPlan } from './quests.js'
import { groundSpeed } from './spells.js'
import { grindValue, worth } from './value.js'
import { wantedPlaces } from './wanted.js'
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
// Getting to another zone: riding to the flight master and from where it lands to the farming (faster
// mounted, see groundSpeed), and the flight, longer to another continent.
export const GROUND_TRAVEL_SECONDS = 300
export const FLIGHT_SECONDS = 600
const CONTINENT_FLIGHT_SECONDS = 1500
// Zones are weighed while their top level is no more than this far below the character's.
const LEVELS_BELOW = 3

export const travelSeconds = (character, from, to) => (!from || from === to ? 0
  : GROUND_TRAVEL_SECONDS / groundSpeed(character) + (from.continent === to.continent ? FLIGHT_SECONDS : CONTINENT_FLIGHT_SECONDS))

// Worth per hour of farming the zone after `travel` seconds getting there: its quests worth doing (see
// activeQuests), and grinding for the rest of PLAN_HOURS.
export function zoneValue(character, zoneName, travel = 0) {
  const w = worth(character)
  const horizon = PLAN_HOURS * 3600
  let value = 0
  let seconds = 0
  for (const id of activeQuests(character, zoneName)) {
    const plan = questPlan(character, id, w)
    const odds = plan.wait > horizon ? horizon / plan.wait : 1 // rare spawns may not show up in time
    value += plan.value * odds
    seconds += plan.seconds * odds
  }
  if (seconds < horizon) {
    value += (grindValue(character, zoneName) * (horizon - seconds)) / 3600
    seconds = horizon
  }
  return (value / (seconds + travel)) * 3600
}

// The zones the character weighs, most worth first: [{ zone, value (per hour, counting the trip) }]. Its
// current zone and the ones its wanted item comes from are always among them.
export function zoneOptions(character) {
  const here = getZone(character.zone)
  const low = character.characterLevel - LEVELS_BELOW
  const wanted = wantedPlaces(character).zones
  return ZONES
    .filter((z) => z === here || (!zoneLockReason(character, z) && (z.maxLevel >= low || wanted.has(z.name))))
    .map((z) => ({ zone: z.name, value: zoneValue(character, z.name, travelSeconds(character, here, z)) }))
    .sort((a, b) => b.value - a.value)
}

// Where a farming character moves when it looks again, or undefined to stay: { zone, reason, seconds }
// with `reason` 'level', 'gear', 'quests', 'wanted' (set to go after an item), 'found' (got it) or 'stuck'.
// A stuck character goes to the best zone it can farm. One set to go after an item may leave a starting
// zone early.
// Between level-ups other zones only get less worth (better gear gains less from their loot), so while its
// zone still beats the best other zone as it was last weighed, it stays without weighing them again. Over a
// level-up they change little, so it weighs them again every RIVAL_LEVELS levels, or sooner when its zone
// falls behind or its wanted item changes.
const RIVAL_LEVELS = 2
const rivals = new WeakMap() // character -> { zone, level, wanted, value: the best other zone's worth }
export function nextZone(character, reason) {
  const here = getZone(character.zone)
  if (!here) return undefined
  const stuck = reason === 'stuck'
  if (!stuck && reason !== 'wanted' && character.characterLevel < LEAVE_START_LEVEL && startZoneNames.has(here.name)) return undefined
  const last = rivals.get(character)
  const since = character.characterLevel - (last?.level ?? -Infinity)
  const wanted = character.wanted ?? null
  if (!stuck && last?.zone === here.name && last.wanted === wanted && since >= 0 && since < (reason === 'level' ? RIVAL_LEVELS : 1) &&
    last.value <= zoneValue(character, here.name) * MOVE_MARGIN) return undefined
  const options = zoneOptions(character)
  const others = options.filter((o) => o.zone !== here.name)
  rivals.set(character, { zone: here.name, level: character.characterLevel, wanted, value: others[0]?.value ?? 0 })
  const best = stuck ? others.find((o) => canFarm(character, o.zone)) : options[0]
  if (!best || best.zone === here.name) return undefined
  if (!stuck && best.value <= options.find((o) => o.zone === here.name).value * MOVE_MARGIN) return undefined
  return { zone: best.zone, reason, seconds: travelSeconds(character, here, getZone(best.zone)) }
}

const canFarm = (character, zoneName) => grindPool(character, zoneName).total > 0 || activeQuests(character, zoneName).length > 0
