// Items a player can set a character to go after (see Character.wanted), and where they come from. A mob
// drops what its own loot list rolls, including shared lists rolled in fewer than WORLD_PLACES zones and
// dungeons (its kind's own loot); shared lists rolled in more are world drops, which any mob around their
// level may drop.
import { DUNGEONS, DUNGEON_QUESTS, ITEMS, LOOT, LOOT_REFS, MOBS, QUESTS, ZONE_MOBS } from './gear-data.js'
import { CLASS_BITS, RACE_BITS, SLOTS, baseId, fitsSlot, levelToUse } from './gear.js'
import { getZone } from './zones.js'

const WORLD_PLACES = 3
export const SEARCH_RESULTS = 20
export const SEARCH_MIN_LENGTH = 2

// Built on first use: { places: Map(mob entry -> zone and dungeon names), placeMobs: Map(place -> mob
// entries), mobs: Map(item id -> Map(mob entry -> expected drops per kill)), quests: Map(item id -> quest
// ids giving it), world: Set(item ids in world drops) }.
let index
function sourceIndex() {
  if (index) return index
  const places = new Map()
  const placeMobs = new Map()
  const add = (entry, place) => {
    if (!places.has(entry)) places.set(entry, [])
    if (!places.get(entry).includes(place)) places.get(entry).push(place)
    if (!placeMobs.has(place)) placeMobs.set(place, [])
    if (!placeMobs.get(place).includes(entry)) placeMobs.get(place).push(entry)
  }
  for (const [zone, mobs] of Object.entries(ZONE_MOBS)) for (const [entry] of mobs) add(entry, zone)
  for (const d of DUNGEONS) for (const entry of [...d.bosses, ...d.trash.map(([e]) => e)]) add(entry, d.name)

  const lootOf = (entry) => {
    const id = MOBS[entry]?.loot
    return id && Object.hasOwn(LOOT, id) ? LOOT[id] : []
  }
  // [[id, chance in %]] for a loot list's entries, `rolls` counted in.
  const rolled = (entries) => entries.flatMap((e) => (Array.isArray(e) ? [[e[0], e[1] * (e[2] ?? 1)]] : e.group))
  const refPlaces = new Map()
  for (const [entry, names] of places) {
    for (const [id] of rolled(lootOf(entry))) {
      if (id >= 0) continue
      if (!refPlaces.has(-id)) refPlaces.set(-id, new Set())
      for (const name of names) refPlaces.get(-id).add(name)
    }
  }
  const worldRefs = new Set([...refPlaces].filter(([, names]) => names.size >= WORLD_PLACES).map(([ref]) => ref))

  const world = new Set()
  const markWorld = (entries, seen = new Set()) => {
    for (const [id] of rolled(entries)) {
      if (id > 0) world.add(id)
      else if (!seen.has(-id)) {
        seen.add(-id)
        markWorld(LOOT_REFS[-id] ?? [], seen)
      }
    }
  }
  for (const ref of worldRefs) markWorld(LOOT_REFS[ref] ?? [])

  const mobs = new Map()
  const expand = (entries, scale, entry, depth = 0) => {
    for (const [id, chance] of rolled(entries)) {
      if (!(chance > 0)) continue
      const n = (scale * chance) / 100
      if (id > 0) {
        if (!mobs.has(id)) mobs.set(id, new Map())
        mobs.get(id).set(entry, (mobs.get(id).get(entry) ?? 0) + n)
      } else if (!worldRefs.has(-id) && depth < 4) expand(LOOT_REFS[-id] ?? [], n, entry, depth + 1)
    }
  }
  for (const entry of places.keys()) expand(lootOf(entry), 1, entry)

  const quests = new Map()
  for (const table of [QUESTS, DUNGEON_QUESTS]) {
    for (const [key, quest] of Object.entries(table)) {
      for (const id of [...(quest.reward ?? []), ...(quest.choice ?? [])]) {
        if (!quests.has(id)) quests.set(id, [])
        quests.get(id).push(Number(key))
      }
    }
  }
  index = { places, placeMobs, mobs, quests, world }
  return index
}

const isGear = (item) => Object.keys(SLOTS).some((slot) => fitsSlot(item, slot))

// Whether the character's faction can go to the zone or dungeon.
function canGo(character, place) {
  const zone = getZone(place)
  const faction = zone ? zone.faction : DUNGEONS.find((d) => d.name === place)?.faction
  return !['Alliance', 'Horde'].includes(faction) || faction === character.faction
}

const canDo = (character, quest) =>
  (!quest.faction || quest.faction === character.faction) &&
  (!quest.races || !!(quest.races & RACE_BITS[character.characterRace])) &&
  (!quest.classes || !!(quest.classes & CLASS_BITS[character.characterClass]))

// Where the character could get item `id` (a base id): { mobs: [{ entry, name, n, places }], quests: [quest
// ids], world }. `mobs` are the ones whose own loot drops it (n per kill, most first) in zones and dungeons
// its faction can go, `quests` the ones its faction, race and class can do, and `world` whether it's a
// world drop.
export function itemSources(character, id) {
  const { places, mobs, quests, world } = sourceIndex()
  const droppers = [...(mobs.get(id) ?? [])]
    .map(([entry, n]) => ({ entry, name: MOBS[entry]?.name ?? 'Unknown', n, places: places.get(entry).filter((p) => canGo(character, p)) }))
    .filter((m) => m.places.length)
    .sort((a, b) => b.n - a.n)
  return { mobs: droppers, quests: (quests.get(id) ?? []).filter((q) => canDo(character, QUESTS[q] ?? DUNGEON_QUESTS[q])), world: world.has(id) }
}

// The base id of the item if the character could be set to go after it, else undefined: gear its class and
// race can wear at some level that it can get somewhere (see itemSources).
export function wantable(character, key) {
  const id = baseId(key)
  const item = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined
  if (!item || !isGear(item) || levelToUse(character, item) === Infinity) return undefined
  const { mobs, quests, world } = itemSources(character, id)
  return mobs.length || quests.length || world ? id : undefined
}

// Whether the character has the item on or in its bag (any suffix).
export const owns = (character, id) =>
  [...Object.values(character.equipment), ...character.bag, ...(character.kept ?? [])].some((key) => baseId(key) === id)

// Whether the item is a world drop (in shared loot lists rolled in WORLD_PLACES or more places).
export const isWorldDrop = (key) => sourceIndex().world.has(baseId(key))

// Zones and dungeons where the character's wanted item drops from mobs or is a quest reward: { zones: Set,
// dungeons: Set } (empty when it wants nothing).
export function wantedPlaces(character) {
  const zones = new Set()
  const dungeons = new Set()
  if (!character.wanted) return { zones, dungeons }
  const { mobs, quests } = itemSources(character, character.wanted)
  for (const { places } of mobs) for (const p of places) (getZone(p) ? zones : dungeons).add(p)
  for (const id of quests) {
    if (DUNGEON_QUESTS[id]) dungeons.add(DUNGEON_QUESTS[id].dungeon)
    else if (QUESTS[id].zone && getZone(QUESTS[id].zone)) zones.add(QUESTS[id].zone)
  }
  return { zones, dungeons }
}

// Every piece of gear the character's class and race could ever wear that the zone's or dungeon's mobs drop
// from their own loot: [{ id, entry: the mob that drops the most, n: per kill }], best quality and highest
// level first. Kept per class, race and place (all it depends on).
const dropCache = new Map()
export function placeDrops(character, place) {
  const key = `${character.characterClass}|${character.characterRace}|${place}`
  if (!dropCache.has(key)) dropCache.set(key, findDrops(character, place))
  return dropCache.get(key)
}

function findDrops(character, place) {
  const { placeMobs, mobs } = sourceIndex()
  const here = new Set(placeMobs.get(place) ?? [])
  const drops = []
  for (const [id, byMob] of mobs) {
    let best
    for (const [entry, n] of byMob) if (here.has(entry) && (!best || n > best.n)) best = { entry, n }
    if (!best) continue
    const item = ITEMS[id]
    if (!item || !isGear(item) || levelToUse(character, item) === Infinity) continue
    drops.push({ id, ...best })
  }
  const level = (d) => levelToUse(character, ITEMS[d.id])
  return drops.sort((a, b) => ITEMS[b.id].quality - ITEMS[a.id].quality || level(b) - level(a) || ITEMS[a.id].name.localeCompare(ITEMS[b.id].name))
}

// Gear named like `text` (at least SEARCH_MIN_LENGTH letters) the character could go after (see wantable):
// names starting with it first, then best quality and highest level. At most SEARCH_RESULTS.
let names
export function searchItems(character, text) {
  const query = text.trim().toLowerCase()
  if (query.length < SEARCH_MIN_LENGTH) return []
  names ??= Object.entries(ITEMS).map(([id, item]) => [Number(id), item.name.toLowerCase()])
  const found = []
  for (const [id, name] of names) {
    const at = name.indexOf(query)
    if (at >= 0 && wantable(character, id) !== undefined) found.push({ id, starts: at === 0 })
  }
  return found
    .sort((a, b) => b.starts - a.starts || ITEMS[b.id].quality - ITEMS[a.id].quality || (ITEMS[b.id].requiredLevel ?? 0) - (ITEMS[a.id].requiredLevel ?? 0))
    .slice(0, SEARCH_RESULTS)
    .map((f) => f.id)
}
