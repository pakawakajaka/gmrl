// Dungeons: five characters of one faction clear a dungeon together for XP, money, gear and dungeon quests.
// Characters in a dungeon's level range pick up its quests on the way (errands, see nextErrand), then queue
// for it on their own (autoQueue); players can also queue them by hand. Queued characters keep farming until
// five of a faction are waiting for the same dungeon (formGroups). Dungeon quests don't count toward the
// five-quest log.
import { CLASSES, MAX_LEVEL, MIN_LEVEL, RACES, ROLES } from './data.js'
import { CLASS_BITS, DUNGEONS, DUNGEON_QUESTS, RACE_BITS, bestLoadout, canUseNow, getItem, questRewardsFor, rollMobLoot } from './gear.js'
import { getMob, killXp, mobLevelFor, questXp } from './combat.js'
import { levelPower } from './power.js'
import { QUEST_SECONDS } from './quests.js'
import { getZone } from './zones.js'

export { DUNGEONS }
export const GROUP_SIZE = 5
export const RUN_LOG_SIZE = 25
export const TRAVEL_SECONDS = 900 // to another zone's quest giver and back
const PICKUP_SECONDS = 60
const CLEAR_SHARE = 0.6 // of a dungeon's trash a run kills; the rest is skipped
const GROUP_XP = 1.4 / GROUP_SIZE // Classic's five-player group bonus, split five ways
const MIN_PACE = 0.6 // slower than this and the group wipes
const MISSING_ROLE = 0.8 // pace without a tank, and again without a healer
const LOG_QUALITY = 2 // loot of this quality and up goes in the run log

export const getDungeon = (name) => DUNGEONS.find((d) => d.name === name)

const questsByDungeon = new Map(DUNGEONS.map((d) => [d.name, []]))
for (const [id, quest] of Object.entries(DUNGEON_QUESTS)) questsByDungeon.get(quest.dungeon).push(Number(id))
export const dungeonQuestIds = (name) => questsByDungeon.get(name) ?? []
export const isDungeonQuest = (id) => Object.hasOwn(DUNGEON_QUESTS, id) && !DUNGEON_QUESTS[id].step

const fits = (character, quest) =>
  (!quest.faction || quest.faction === character.faction) &&
  (!quest.races || !!(quest.races & RACE_BITS[character.characterRace])) &&
  (!quest.classes || !!(quest.classes & CLASS_BITS[character.characterClass]))

// Whether the quest is a dungeon quest the character's faction, race and class could ever pick up.
export const canHold = (character, id) => isDungeonQuest(id) && fits(character, DUNGEON_QUESTS[id])

// Why the character can't queue for the dungeon, or ''.
export function dungeonLockReason(character, dungeon) {
  if (!dungeon) return 'Unknown dungeon'
  if (dungeon.faction && dungeon.faction !== character.faction) return `${dungeon.faction} only`
  if (character.characterLevel < dungeon.level[0]) return `Requires level ${dungeon.level[0]}`
  return ''
}
export const inRange = (character, dungeon) => !dungeonLockReason(character, dungeon) && character.characterLevel <= dungeon.level[1]

// Level of the dungeon's bosses (median), which sets how strong a group needs to be.
const bossLevels = new Map(DUNGEONS.map((d) => {
  const levels = d.bosses.map((e) => getMob(e).level[1]).sort((a, b) => a - b)
  return [d.name, levels[Math.floor(levels.length / 2)]]
}))
export const bossLevel = (dungeon) => bossLevels.get(dungeon.name)

function canTake(character, id, done, groups) {
  const quest = DUNGEON_QUESTS[id]
  if (done.has(id) || character.dungeonQuests.includes(id) || quest.minLevel > character.characterLevel || !fits(character, quest)) return false
  if (quest.prev && !done.has(quest.prev)) return false
  if (quest.exclusive && groups.has(quest.exclusive)) return false
  const zone = quest.zone && getZone(quest.zone)
  return !zone || !['Alliance', 'Horde'].includes(zone.faction) || zone.faction === character.faction
}

// Quests and chain steps the character can pick up now for dungeons in its level range, by where their
// giver is: Map(zone name, or null for a city -> quest ids).
const pendingCache = new WeakMap()
export function pendingQuests(character) {
  const key = `${character.characterLevel}|${character.questsDone.length}|${character.dungeonQuests.length}`
  const cached = pendingCache.get(character)
  if (cached?.key === key) return cached.byZone
  const byZone = new Map()
  const dungeons = DUNGEONS.filter((d) => inRange(character, d))
  if (dungeons.length) {
    const done = new Set(character.questsDone)
    const groups = new Set([...character.questsDone, ...character.dungeonQuests].map((id) => DUNGEON_QUESTS[id]?.exclusive).filter(Boolean))
    for (const dungeon of dungeons) {
      for (const id of dungeonQuestIds(dungeon.name)) {
        if (!canTake(character, id, done, groups)) continue
        const zone = DUNGEON_QUESTS[id].zone
        byZone.set(zone, [...(byZone.get(zone) ?? []), id])
      }
    }
  }
  pendingCache.set(character, { key, byZone })
  return byZone
}

// The next quest pickup trip for a farming character, or undefined: { errand: { zone, quests }, seconds }.
// Quests in its own zone come first, then cities, then the zone with the most to pick up.
export function nextErrand(character) {
  const byZone = pendingQuests(character)
  if (!byZone.size) return undefined
  const zones = [...byZone.keys()]
  const zone = zones.includes(character.zone) ? character.zone
    : zones.includes(null) ? null
      : zones.reduce((best, z) => (byZone.get(z).length > byZone.get(best).length ? z : best))
  const quests = byZone.get(zone)
  const seconds = (zone === character.zone ? 0 : TRAVEL_SECONDS) +
    quests.reduce((sum, id) => sum + (DUNGEON_QUESTS[id].step ? QUEST_SECONDS : PICKUP_SECONDS), 0)
  return { errand: { zone, quests }, seconds }
}

// Picks up the errand's quests and does its chain steps. Returns the steps' { xp, copper, found } and
// the dungeon quest ids picked up.
export function runErrand(character, errand) {
  let xp = 0
  let copper = 0
  const found = []
  const picked = []
  for (const id of errand.quests) {
    const quest = DUNGEON_QUESTS[id]
    if (!quest.step) {
      character.dungeonQuests.push(id)
      picked.push(id)
      continue
    }
    character.questsDone.push(id)
    xp += questXp(character.characterLevel, quest)
    copper += quest.money ?? 0
    for (const item of questRewardsFor(character, quest)) found.push({ item, source: quest.title, quest: true })
  }
  return { xp, copper, found, picked, steps: errand.quests.length - picked.length }
}

// Dungeon quests the character holds for the dungeon.
export const heldQuests = (character, name) => character.dungeonQuests.filter((id) => DUNGEON_QUESTS[id].dungeon === name)

// Dungeons a character queues for on its own: those in its level range it holds quests for or hasn't
// cleared, most quests held first.
export function autoDungeons(character) {
  return DUNGEONS
    .filter((d) => inRange(character, d))
    .map((d) => ({ name: d.name, held: heldQuests(character, d.name).length, level: d.level[0] }))
    .filter((d) => d.held || !character.dungeonClears[d.name])
    .sort((a, b) => b.held - a.held || b.level - a.level)
    .map((d) => d.name)
}

// Keeps a farming character's own queue up to date: once it has picked up every dungeon quest it can, it
// queues for every dungeon in autoDungeons. A character queued by hand stays as it is, and one taken out by
// hand stays out until it levels or picks up more quests.
export function autoQueue(character, now) {
  const queue = character.dungeonQueue
  if (queue?.manual || !getZone(character.zone)) return
  if (!queue && pendingQuests(character).size) return
  const declined = character.queueDeclined
  if (declined && declined.level === character.characterLevel && declined.quests === character.dungeonQuests.length) return
  const dungeons = autoDungeons(character)
  character.dungeonQueue = dungeons.length ? { dungeons, since: queue?.since ?? now, manual: false } : null
}

export function joinQueue(character, name, now) {
  if (dungeonLockReason(character, getDungeon(name))) return false
  character.dungeonQueue = { dungeons: [name], since: now, manual: true }
  character.queueDeclined = null
  return true
}

export function leaveQueue(character) {
  character.dungeonQueue = null
  character.queueDeclined = { level: character.characterLevel, quests: character.dungeonQuests.length }
}

export const isQueuedFor = (character, name) => !!character.dungeonQueue?.dungeons.includes(name)

// Starts runs while five characters of a faction are queued for the same dungeon: the dungeon the most are
// queued for (the higher one on ties), with its five longest-waiting. Characters still owed time from their
// last run (negative timeBank) wait. Returns the runs.
export function formGroups(characters, now, random = Math.random) {
  const runs = []
  for (const faction of ['Alliance', 'Horde']) {
    let ready = characters
      .filter((c) => c.dungeonQueue && c.faction === faction && c.timeBank >= 0)
      .sort((a, b) => a.dungeonQueue.since - b.dungeonQueue.since)
    for (;;) {
      let best
      let most = GROUP_SIZE - 1
      for (const dungeon of DUNGEONS) {
        const n = ready.filter((c) => isQueuedFor(c, dungeon.name)).length
        if (n > most || (n === most && best)) {
          best = dungeon
          most = n
        }
      }
      if (!best) break
      const group = ready.filter((c) => isQueuedFor(c, best.name)).slice(0, GROUP_SIZE)
      ready = ready.filter((c) => !group.includes(c))
      runs.push(runDungeon(group, best, now, random))
    }
  }
  return runs
}

// How fast the group clears: its party power against five characters of the bosses' level, slower without a
// tank or a healer. 1 is a clear in the dungeon's listed time.
export function groupPace(members, dungeon) {
  const power = members.reduce((sum, c) => sum + c.power.party, 0)
  let pace = power / (GROUP_SIZE * levelPower(bossLevel(dungeon)))
  if (!members.some((c) => c.characterRole === 'Tank')) pace *= MISSING_ROLE
  if (!members.some((c) => c.characterRole === 'Healer')) pace *= MISSING_ROLE
  return pace
}

// Whether the character would wear the item over what it has on now.
function wouldEquip(character, key) {
  const item = getItem(key)
  if (!item || !canUseNow(character, item)) return false
  return Object.values(bestLoadout(character, [...Object.values(character.equipment), key]).equipment).includes(key)
}

// One dungeon run. Every kill pays each member its share of the XP and money; every drop is rolled for:
// members who'd wear it right away roll Need, otherwise everyone rolls Greed. A group too weak for the dungeon
// gets part way and wipes, with no quest credit, and doesn't queue again on its own until it levels or picks
// up quests. Members finish by turning in the dungeon's quests.
// Returns { record, members, results } with each member's { levels, upgrades, travel }.
export function runDungeon(members, dungeon, now, random = Math.random) {
  const pace = groupPace(members, dungeon)
  const success = pace >= MIN_PACE
  const progress = success ? 1 : Math.max(0.1, pace / MIN_PACE) * 0.9
  const seconds = Math.round(dungeon.minutes * 60 * (success ? Math.min(3, Math.max(0.5, pace ** -1.5)) : progress))
  const bossKills = success ? dungeon.bosses.length : Math.floor(dungeon.bosses.length * progress)
  const kills = [
    ...dungeon.bosses.slice(0, bossKills).map((entry) => [entry, 1]),
    ...dungeon.trash.map(([entry, count]) => [entry, Math.round(count * CLEAR_SHARE * progress)]).filter(([, n]) => n > 0),
  ]
  const wornBefore = members.map((c) => new Set(Object.values(c.equipment)))
  const shares = members.map(() => ({ xp: 0, copper: 0, found: [] }))
  const loot = []
  let trash = 0
  for (const [entry, count] of kills) {
    const mob = getMob(entry)
    if (!dungeon.bosses.includes(entry)) trash += count
    members.forEach((c, i) => {
      shares[i].xp += killXp(c.characterLevel, mobLevelFor(mob, c.characterLevel), mob) * GROUP_XP * count
      shares[i].copper += ((mob.coin ?? 0) + (mob.value ?? 0)) * count / GROUP_SIZE
    })
    for (let k = 0; k < count; k++) {
      for (const item of rollMobLoot(entry, random)) {
        const needers = members.filter((c) => wouldEquip(c, item))
        const pool = needers.length ? needers : members
        const winner = pool[Math.floor(random() * pool.length)]
        const index = members.indexOf(winner)
        winner.equipBest([item])
        shares[index].found.push({ item, source: mob.name })
        if (getItem(item).quality >= LOG_QUALITY || needers.length) loot.push({ item, to: index, need: needers.length > 0, from: mob.name })
      }
    }
  }
  const results = members.map((c, i) => {
    const quests = success ? heldQuests(c, dungeon.name) : []
    const level = c.characterLevel
    const outcome = c.finishDungeon({ ...shares[i], xp: Math.round(shares[i].xp), copper: Math.round(shares[i].copper), quests, wornBefore: wornBefore[i] }, now)
    c.timeBank -= seconds
    c.dungeonQueue = null
    if (success) c.dungeonClears[dungeon.name] = (c.dungeonClears[dungeon.name] ?? 0) + 1
    else leaveQueue(c)
    return { ...outcome, level, quests, share: shares[i] }
  })
  const record = {
    id: crypto.randomUUID(),
    at: now,
    dungeon: dungeon.name,
    faction: members[0].faction,
    seconds,
    success,
    bosses: bossKills,
    trash,
    ...(!success && { wipedOn: getMob(dungeon.bosses[bossKills])?.name ?? null }),
    members: members.map((c, i) => ({
      id: c.id,
      name: c.characterName,
      class: c.characterClass,
      race: c.characterRace,
      spec: c.characterSpec,
      role: c.characterRole,
      level: results[i].level,
      xp: results[i].xp,
      copper: Math.round(shares[i].copper + results[i].questCopper),
      quests: results[i].quests,
    })),
    loot,
  }
  return { record, members, results }
}

// Rebuilds a run record from untrusted saved data, or null if it isn't one.
export function restoreRun(run) {
  if (!run || typeof run !== 'object' || !Array.isArray(run.members) || !Array.isArray(run.loot)) return null
  const dungeon = getDungeon(run.dungeon)
  if (!dungeon || typeof run.id !== 'string' || !/^[\w-]{1,64}$/.test(run.id) || !Number.isFinite(Number(run.at))) return null
  const amount = (v) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Math.round(Number(v)), 0), 1e9) : 0)
  const members = run.members.slice(0, GROUP_SIZE).map((m) => {
    if (!m || typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id) || typeof m.name !== 'string' || typeof m.spec !== 'string') return null
    if (!Object.hasOwn(RACES, m.race) || !Object.hasOwn(CLASSES, m.class) || !ROLES.includes(m.role)) return null
    if (!Number.isInteger(m.level) || m.level < MIN_LEVEL || m.level > MAX_LEVEL) return null
    const quests = Array.isArray(m.quests) ? m.quests.filter((id) => isDungeonQuest(id)) : []
    return { id: m.id, name: m.name.slice(0, 12), class: m.class, race: m.race, spec: m.spec.slice(0, 30), role: m.role, level: m.level, xp: amount(m.xp), copper: amount(m.copper), quests }
  })
  if (!members.length || members.some((m) => !m)) return null
  const loot = run.loot
    .filter((l) => l && (typeof l.item === 'string' || Number.isInteger(l.item)) && getItem(l.item) && Number.isInteger(l.to) && l.to >= 0 && l.to < members.length)
    .map((l) => ({ item: l.item, to: l.to, need: l.need === true, from: typeof l.from === 'string' ? l.from.slice(0, 60) : '' }))
  const success = run.success === true
  const bosses = Number.isInteger(run.bosses) ? Math.min(Math.max(run.bosses, 0), dungeon.bosses.length) : 0
  return {
    id: run.id,
    at: Number(run.at),
    dungeon: dungeon.name,
    faction: ['Alliance', 'Horde'].includes(run.faction) ? run.faction : RACES[members[0].race].faction,
    seconds: amount(run.seconds),
    success,
    bosses,
    trash: amount(run.trash),
    ...(!success && { wipedOn: getMob(dungeon.bosses[bosses])?.name ?? null }),
    members,
    loot,
  }
}
