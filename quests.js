// Questing: which quests a character has on the go in a zone, what it should kill next for them, and
// crediting kills and quest-item drops.
import { CLASS_BITS, QUESTS, RACE_BITS, ZONE_QUESTS, getQuest, questRewardsFor } from './gear.js'
import { fightAgainst, pickGrindTarget, questXp } from './combat.js'
import { talentKey } from './talents.js'
import { grindValue, killValue, rewardGain, worth } from './value.js'
import { grayLevel } from './zones.js'

// Quests worked on at once. Kills count for every quest in the log that needs them.
export const QUEST_LOG_SIZE = 5
// Travel and talking for each quest.
export const QUEST_SECONDS = 300
// Each objective step that isn't a mob: an object to use or loot, an item to pick up, a spell to cast on something.
export const STEP_SECONDS = 30

export const turnInSeconds = (questId) => QUEST_SECONDS + STEP_SECONDS * (QUESTS[questId].steps ?? 0)

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

// The fastest beatable mob to kill for objective `o`, or undefined if none can be beaten.
export function bestSource(character, o) {
  let best
  let bestCost = Infinity
  for (const entry of o.sources) {
    const fight = fightAgainst(character, entry)
    if (!fight.beatable) continue
    const cost = fight.seconds / (o.chances ? o.chances.get(entry) / 100 : 1)
    if (cost < bestCost) {
      best = fight
      bestCost = cost
    }
  }
  return best
}

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

// What finishing the quest from here is worth (see value.js): { value, seconds, rate (value per hour) } for
// the kills its objectives still need, each paying its own XP and loot, and turning it in for XP and reward
// gear. Undefined if an objective has nothing beatable to kill.
export function questPlan(character, questId, w = worth(character)) {
  const quest = getQuest(questId)
  const counts = questProgress(character, questId)
  let seconds = turnInSeconds(questId)
  let value = questXp(character.characterLevel, quest) * w.xp + rewardGain(character, quest) * w.gear
  for (const [i, o] of objectivesOf(questId).entries()) {
    if (counts[i] >= o.count) continue
    const fight = bestSource(character, o)
    if (!fight) return undefined
    const kills = (o.count - counts[i]) / (o.chances ? o.chances.get(fight.entry) / 100 : 1)
    seconds += kills * fight.seconds
    value += kills * killValue(character, fight, w)
  }
  return { value, seconds, rate: (value / seconds) * 3600 }
}

// Quest ids the character works on in the zone, most worth per hour first: up to QUEST_LOG_SIZE of the
// quests it can do there that are worth more than grinding the zone. Recomputed when level, gear, talents or
// completed quests change.
const activeCache = new WeakMap()
export function activeQuests(character, zoneName) {
  const key = `${character.characterLevel}|${character.characterSpec}|${character.characterRole}|${Object.values(character.equipment).join()}|${character.questsDone.length}|${talentKey(character)}`
  let cached = activeCache.get(character)
  if (cached?.key !== key) activeCache.set(character, (cached = { key, zones: new Map() }))
  if (cached.zones.has(zoneName)) return cached.zones.get(zoneName)
  const done = new Set(character.questsDone)
  const doneGroups = new Set(character.questsDone.map((id) => getQuest(id)?.exclusive).filter(Boolean))
  const w = worth(character)
  const grind = grindValue(character, zoneName)
  const plans = []
  for (const id of Object.hasOwn(ZONE_QUESTS, zoneName) ? ZONE_QUESTS[zoneName] : []) {
    if (!isAvailable(character, id, done, doneGroups)) continue
    const plan = questPlan(character, id, w)
    if (plan.rate > grind) plans.push({ id, rate: plan.rate })
  }
  const ids = plans.sort((a, b) => b.rate - a.rate).slice(0, QUEST_LOG_SIZE).map((p) => p.id)
  cached.zones.set(zoneName, ids)
  return ids
}

// What the character does next in the zone:
//   { questId, seconds }          turn in a finished quest (errands with nothing to kill finish right away)
//   { fight, questId? }           kill a mob, for a quest objective or else from the zone's grind pool
// or undefined when nothing in reach can be beaten.
export function nextAction(character, zoneName, random = Math.random) {
  const active = activeQuests(character, zoneName)
  for (const questId of active) {
    if (isComplete(character, questId)) return { questId, seconds: turnInSeconds(questId) }
  }
  for (const questId of active) {
    const counts = questProgress(character, questId)
    for (const [i, o] of objectivesOf(questId).entries()) {
      if (counts[i] >= o.count) continue
      const fight = bestSource(character, o)
      if (fight) return { fight, questId }
    }
  }
  const fight = pickGrindTarget(character, zoneName, random)
  return fight ? { fight } : undefined
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
