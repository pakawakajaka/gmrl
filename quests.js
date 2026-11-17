// Questing: the character's quest log, which quests it has on the go in a zone, what it should kill next for
// them, and crediting kills and quest-item drops.
import { CLASS_BITS, DUNGEONS, DUNGEON_QUESTS, QUESTS, RACE_BITS, ZONE_QUESTS, getQuest, questRewardsFor } from './gear.js'
import { fightAgainst, questXp, respawnWait } from './combat.js'
import { talentKey } from './talents.js'
import { groundSpeed } from './spells.js'
import { grindValue, killValue, pickGrindTarget, rewardGain, worth } from './value.js'
import { ZONES, grayLevel, zoneLockReason } from './zones.js'

// Quests worked on at once in a zone. Kills count for every one of them that needs them.
export const WORKING_QUESTS = 5
// Quests held at once, zone and dungeon quests alike. Zone quests are picked up when the character starts
// working on them and kept until turned in, also after it moves on; dungeon quests on pickup trips.
export const QUEST_LOG_SIZE = 30
// Each quest: getting around the zone for it (faster mounted, see groundSpeed), and talking.
const QUEST_GROUND_SECONDS = 240
const QUEST_TALK_SECONDS = 60
export const questSeconds = (character) => QUEST_TALK_SECONDS + QUEST_GROUND_SECONDS / groundSpeed(character)
// Each objective step that isn't a mob: an object to use or loot, an item to pick up, a spell to cast on something.
export const STEP_SECONDS = 30

export const turnInSeconds = (character, questId) => questSeconds(character) + STEP_SECONDS * (QUESTS[questId].steps ?? 0)

// A quest's tracked objectives: [{ id, count, name?, sources: [mob entry], chances?: Map(entry -> %) }].
// Kill objectives are credited by any of their sources; item objectives drop from them at a chance.
const objectiveCache = new Map()
export function objectivesOf(questId) {
  if (objectiveCache.has(questId)) return objectiveCache.get(questId)
  const quest = QUESTS[questId]
  const objectives = [
    ...(quest.kills ?? []).map(([id, count, sources = [id]]) => ({ id, count, sources })),
    ...(quest.items ?? []).map(([item, count, drops]) => ({ item, count, sources: drops.map(([mob]) => mob), chances: new Map(drops) })),
  ]
  objectiveCache.set(questId, objectives)
  return objectives
}

// Count done for each objective.
export const questProgress = (character, questId) => character.questLog[questId] ?? objectivesOf(questId).map(() => 0)

export const isComplete = (character, questId) => {
  const counts = questProgress(character, questId)
  return objectivesOf(questId).every((o, i) => counts[i] >= o.count)
}

// The beatable mob that finishes objective `o` soonest, or undefined if none can be beaten. A rare spawn's
// wait counts, so it's only picked when nothing common drops what's needed.
export function bestSource(character, o) {
  let best
  let bestCost = Infinity
  for (const entry of o.sources) {
    const fight = fightAgainst(character, entry)
    if (!fight.beatable) continue
    const cost = (fight.seconds + respawnWait(entry)) / (o.chances ? o.chances.get(entry) / 100 : 1)
    if (cost < bestCost) {
      best = fight
      bestCost = cost
    }
  }
  return best
}

const doneGroupsOf = (character) => new Set(character.questsDone.map((id) => getQuest(id)?.exclusive).filter(Boolean))

function isAvailable(character, id, done, doneGroups) {
  const quest = QUESTS[id]
  if (done.has(id) || quest.minLevel > character.characterLevel) return false
  if (quest.faction && quest.faction !== character.faction) return false
  if (quest.races && !(quest.races & RACE_BITS[character.characterRace])) return false
  if (quest.classes && !(quest.classes & CLASS_BITS[character.characterClass])) return false
  if (quest.prev && !done.has(quest.prev)) return false
  if (quest.exclusive && doneGroups.has(quest.exclusive)) return false
  // Gray quests are skipped unless they give gear the character can use.
  if (quest.level <= grayLevel(character.characterLevel) && !questRewardsFor(character, quest).length) return false
  return objectivesOf(id).every((o) => bestSource(character, o))
}

// What finishing the quest from here is worth (see value.js): { value, seconds, rate (value per hour), wait }
// for the kills its objectives still need, each paying its own XP and loot, and turning it in for XP and
// reward gear. `seconds` is the character's own time; `wait` is how long rare spawns it needs take to show
// up (it farms meanwhile). Undefined if an objective has nothing beatable to kill.
export function questPlan(character, questId, w = worth(character)) {
  const quest = getQuest(questId)
  const counts = questProgress(character, questId)
  let seconds = turnInSeconds(character, questId)
  let wait = 0
  let value = rewardWorth(character, quest, w)
  for (const [i, o] of objectivesOf(questId).entries()) {
    if (counts[i] >= o.count) continue
    const fight = bestSource(character, o)
    if (!fight) return undefined
    const kills = (o.count - counts[i]) / (o.chances ? o.chances.get(fight.entry) / 100 : 1)
    seconds += kills * fight.seconds
    wait += kills * respawnWait(fight.entry)
    value += kills * killValue(character, fight, w)
  }
  return { value, seconds, rate: (value / seconds) * 3600, wait }
}

// Whether the character can get on with the quest now: it's done, or an objective left has a common mob.
export function workable(character, questId) {
  const counts = questProgress(character, questId)
  return objectivesOf(questId).every((o, i) => counts[i] >= o.count) ||
    objectivesOf(questId).some((o, i) => {
      const fight = counts[i] < o.count && bestSource(character, o)
      return fight && !respawnWait(fight.entry)
    })
}

// The kills finishing the quest from here still takes: [[mob entry, count]].
export function questKills(character, questId) {
  const counts = questProgress(character, questId)
  const kills = []
  for (const [i, o] of objectivesOf(questId).entries()) {
    const fight = counts[i] < o.count && bestSource(character, o)
    if (fight) kills.push([fight.entry, (o.count - counts[i]) / (o.chances ? o.chances.get(fight.entry) / 100 : 1)])
  }
  return kills
}

// What the quest's turn-in is worth to the character (see value.js): its XP and the reward gear it would wear.
export const rewardWorth = (character, quest, w = worth(character)) =>
  questXp(character.characterLevel, quest) * w.xp + rewardGain(character, quest) * w.gear

// Quest ids in the character's log: zone quests, then dungeon quests.
export const questLogIds = (character) => [...Object.keys(character.questLog).map(Number), ...character.dungeonQuests]
const holds = (character, id) => Object.hasOwn(character.questLog, id) || character.dungeonQuests.includes(id)

const zoneQuestSets = new Map()
export function zoneQuestSet(zoneName) {
  let set = zoneQuestSets.get(zoneName)
  if (!set) zoneQuestSets.set(zoneName, (set = new Set(Object.hasOwn(ZONE_QUESTS, zoneName) ? ZONE_QUESTS[zoneName] : [])))
  return set
}

// The zone a zone quest is done in.
const questZones = new Map()
for (const [zone, ids] of Object.entries(ZONE_QUESTS)) for (const id of ids) if (!questZones.has(id)) questZones.set(id, zone)
export const questZone = (id) => questZones.get(Number(id))

// The held quest outside `keep` (id -> true to keep) worth the least, or undefined.
function cheapestHeld(character, keep, w = worth(character)) {
  let cheapest
  let least = Infinity
  for (const id of questLogIds(character)) {
    if (keep(id)) continue
    const value = rewardWorth(character, getQuest(id), w)
    if (value < least) [cheapest, least] = [id, value]
  }
  return cheapest
}

export function dropQuest(character, id) {
  delete character.questLog[id]
  if (character.dungeonQuests.includes(id)) character.dungeonQuests = character.dungeonQuests.filter((q) => q !== id)
}

// Room for new quests: returns take(id), true if quest `id` gets a slot (and it's then used up). A free slot
// goes to anything; in a full log a new quest takes the place of a held one outside `keep` worth no more
// than it (rewardWorth), cheapest first; only less with `ties` false. makeRoom drops them in the same order.
export function logRoom(character, keep, w = worth(character), ties = true) {
  const held = questLogIds(character)
  let free = QUEST_LOG_SIZE - held.length
  let spare
  let next = 0
  return (id) => {
    if (free > 0) {
      free -= 1
      return true
    }
    spare ??= held.filter((q) => !keep(q)).map((q) => rewardWorth(character, getQuest(q), w)).sort((a, b) => a - b)
    const value = rewardWorth(character, getQuest(id), w)
    if (next >= spare.length || spare[next] > value || (!ties && spare[next] === value)) return false
    next += 1
    return true
  }
}

// Frees a slot in a full log for a new quest (see logRoom).
export function makeRoom(character, keep) {
  if (questLogIds(character).length < QUEST_LOG_SIZE) return
  const id = cheapestHeld(character, keep)
  if (id !== undefined) dropQuest(character, id)
}

// Quest ids the character works on in the zone: up to WORKING_QUESTS of the quests it can do there that are
// worth more than grinding the zone, most worth per hour first, those waiting on rare spawns last. Ones it
// doesn't hold need room in its log (logRoom; the zone's own quests are kept). Recomputed when level,
// gear, talents, quests, mount or the wanted item change.
const activeCache = new WeakMap()
export function activeQuests(character, zoneName) {
  const key = `${character.characterLevel}|${character.characterSpec}|${character.characterRole}|${Object.values(character.equipment).join()}|${character.questsDone.length}|${talentKey(character)}|${questLogIds(character).join()}|${character.wanted}|${character.mount}`
  let cached = activeCache.get(character)
  if (cached?.key !== key) activeCache.set(character, (cached = { key, zones: new Map() }))
  if (cached.zones.has(zoneName)) return cached.zones.get(zoneName)
  const done = new Set(character.questsDone)
  const doneGroups = doneGroupsOf(character)
  const w = worth(character)
  const grind = grindValue(character, zoneName)
  const plans = []
  for (const id of zoneQuestSet(zoneName)) {
    if (!isAvailable(character, id, done, doneGroups)) continue
    const plan = questPlan(character, id, w)
    if (plan.rate > grind) plans.push({ id, rate: plan.rate, rare: plan.wait > 0 })
  }
  const here = zoneQuestSet(zoneName)
  const take = logRoom(character, (id) => here.has(id), w)
  const ids = []
  for (const { id } of plans.sort((a, b) => a.rare - b.rare || b.rate - a.rate)) {
    if (ids.length >= WORKING_QUESTS) break
    if (Object.hasOwn(character.questLog, id) || take(id)) ids.push(id)
  }
  cached.zones.set(zoneName, ids)
  return ids
}

// Picks up the quests the character works on in its zone (activeQuests) that it doesn't hold yet.
export function pickUpQuests(character, zoneName) {
  const here = zoneQuestSet(zoneName)
  for (const id of activeQuests(character, zoneName)) {
    if (Object.hasOwn(character.questLog, id)) continue
    makeRoom(character, (q) => here.has(q))
    if (questLogIds(character).length >= QUEST_LOG_SIZE) break
    character.questLog[id] = objectivesOf(id).map(() => 0)
  }
}

// Abandons held quests the character has no more use for: zone quests it can no longer do (gray without gear
// for it, or nothing it can beat), and dungeon quests for dungeons below its level or gray without gear for
// it. Then, for logs over QUEST_LOG_SIZE (older saves), the ones worth the least.
const dungeonTop = new Map(DUNGEONS.map((d) => [d.name, d.level[1]]))
export function tidyQuestLog(character) {
  const done = new Set(character.questsDone)
  const doneGroups = doneGroupsOf(character)
  const gray = grayLevel(character.characterLevel)
  for (const id of Object.keys(character.questLog).map(Number)) {
    if (!isAvailable(character, id, done, doneGroups)) delete character.questLog[id]
  }
  character.dungeonQuests = character.dungeonQuests.filter((id) => {
    const quest = DUNGEON_QUESTS[id]
    return character.characterLevel <= dungeonTop.get(quest.dungeon) && (quest.level > gray || questRewardsFor(character, quest).length > 0)
  })
  while (questLogIds(character).length > QUEST_LOG_SIZE) dropQuest(character, cheapestHeld(character, () => false))
}

// Quests the character could pick up now, the ones whose turn-in is worth the most first (rewardWorth):
// [{ id, worth, zone }] for zone quests it can do in zones open to it, not counting those it holds. Dungeon
// quests come from dungeons.js.
export function zoneQuestOffers(character) {
  const done = new Set(character.questsDone)
  const doneGroups = doneGroupsOf(character)
  const w = worth(character)
  const offers = []
  for (const zone of ZONES) {
    if (zoneLockReason(character, zone)) continue
    for (const id of zoneQuestSet(zone.name)) {
      if (holds(character, id) || !isAvailable(character, id, done, doneGroups)) continue
      offers.push({ id, worth: rewardWorth(character, QUESTS[id], w), zone: zone.name })
    }
  }
  return offers.sort((a, b) => b.worth - a.worth)
}

// What the character does next in the zone:
//   { questId, seconds }          turn in a finished quest (errands with nothing to kill finish right away)
//   { fight, questId? }           kill a mob for a quest objective
//   { fight, seconds }            or grind one (see pickGrindTarget in value.js), searching included
// or undefined when nothing in reach can be beaten. A rare spawn a quest needs is fought only when it shows
// up, which it does about once per respawnWait of the character's time.
export function nextAction(character, zoneName, random = Math.random) {
  const active = activeQuests(character, zoneName)
  for (const questId of active) {
    if (isComplete(character, questId)) return { questId, seconds: turnInSeconds(character, questId) }
  }
  let rare
  let action
  for (const questId of active) {
    const counts = questProgress(character, questId)
    for (const [i, o] of objectivesOf(questId).entries()) {
      if (counts[i] >= o.count) continue
      const fight = bestSource(character, o)
      if (!fight) continue
      if (respawnWait(fight.entry)) rare ??= { fight, questId }
      else action ??= { fight, questId }
    }
  }
  if (!action) action = pickGrindTarget(character, zoneName, random)
  if (action && rare && random() < action.fight.seconds / respawnWait(rare.fight.entry)) return rare
  return action
}

// Credits a kill of mob `entry` to every active quest that needs it, rolling quest-item drops.
export function creditKill(character, zoneName, entry, random = Math.random) {
  for (const questId of activeQuests(character, zoneName)) {
    const objectives = objectivesOf(questId)
    let counts
    for (const [i, o] of objectives.entries()) {
      if (!o.sources.includes(entry)) continue
      counts ??= [...questProgress(character, questId)]
      if (counts[i] >= o.count) continue
      if (!o.chances || random() * 100 < o.chances.get(entry)) counts[i] += 1
    }
    if (counts) character.questLog[questId] = counts
  }
}
