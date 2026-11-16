// Builds gear-data.js from Classic (patch 1.12) source data. Run: node tools/build-gear-data.mjs [dataDir]
//
// dataDir (default ~/gmrl-data) must contain:
//   classicdb.sql          CMaNGOS classic-db full dump (github.com/cmangos/classic-db)
//   spell.sql              CMaNGOS mangos-classic sql/base/dbc/original_data/Spell.sql
//   pfq/units.lua, pfq/quests.lua, pfq/zones.lua, pfq/enUS/zones.lua   from pfQuest (github.com/shagu/pfQuest)
//   v082/package/data/json/data.json   wow-classic-items@0.8.2 (npm), used for icons and tooltip text
//   wowsims-classic.json   wowsims/classic assets/database/db.json (MIT), used for random "of the ..." suffix stats
//                          and talent icons
//   talents/<class>.json   wowsims/classic ui/core/talents/trees/<class>.json (MIT), talent tree layouts
//   vmangos-spell.sql      the spell_template section of the vmangos world DB (github.com/brotalnia/database,
//                          world_full_14_june_2021), used for talent tooltip text
//
// Output: only equippable items that drop from open-world mobs in this game's zones or are rewarded by
// quests in those zones, their drop tables, those quests, and the player base stats per race/class/level.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { luaTable, sqlRows } from './parse.mjs'
import { ZONES } from '../zones.js'

const SRC = process.argv[2] ?? path.join(os.homedir(), 'gmrl-data')
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gear-data.js')
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8')

const sql = read('classicdb.sql')
const spells = new Map(sqlRows(read('spell.sql'), 'spell_template').map((s) => [s.Id, s]))
const itemRows = new Map(sqlRows(sql, 'item_template').map((i) => [i.entry, i]))
const creatures = new Map(sqlRows(sql, 'creature_template').map((c) => [c.Entry, c]))
const groupBy = (rows, key) => {
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], [])
    map.get(row[key]).push(row)
  }
  return map
}
const creatureLoot = groupBy(sqlRows(sql, 'creature_loot_template'), 'entry')
const referenceLoot = groupBy(sqlRows(sql, 'reference_loot_template'), 'entry')
const questRows = sqlRows(sql, 'quest_template')
const levelStats = sqlRows(sql, 'player_levelstats')
const classLevelStats = sqlRows(sql, 'player_classlevelstats')

const pfUnits = luaTable(read('pfq/units.lua'))
const pfQuests = luaTable(read('pfq/quests.lua'))
const pfZones = luaTable(read('pfq/zones.lua'))
const pfZoneNames = luaTable(read('pfq/enUS/zones.lua'))
const classicItems = new Map(JSON.parse(read('v082/package/data/json/data.json')).map((i) => [i.itemId, i]))
const randomProperties = new Map(JSON.parse(read('wowsims-classic.json')).randomSuffixes.map((s) => [s.id, s]))
const itemEnchantments = groupBy(sqlRows(sql, 'item_enchantment_template'), 'entry')

// ---- Zones: area id -> our zone name ----
const zoneById = new Map()
for (const [id, name] of Object.entries(pfZoneNames)) {
  if (ZONES.some((z) => z.name === name)) zoneById.set(Number(id), name)
}
for (const zone of ZONES) {
  if (![...zoneById.values()].includes(zone.name)) throw new Error(`No area id for ${zone.name}`)
}
const zoneOfArea = (areaId) => zoneById.get(areaId) ?? zoneById.get(pfZones[areaId]?.[0])

// ---- Items ----
const EQUIPPABLE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26])
const STAT_KEYS = { 0: 'mana', 1: 'health', 3: 'agi', 4: 'str', 5: 'int', 6: 'spi', 7: 'sta' }
const SCHOOLS = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']
const ALL_MAGIC = 126
const WEAPON_SKILLS = {
  43: 'Swords', 44: 'Axes', 45: 'Bows', 46: 'Guns', 54: 'Maces', 55: 'Two-Handed Swords', 136: 'Staves',
  160: 'Two-Handed Maces', 172: 'Two-Handed Axes', 173: 'Daggers', 176: 'Thrown', 226: 'Crossbows',
  229: 'Polearms', 473: 'Fist Weapons',
}

function isCandidate(row) {
  return (
    row &&
    EQUIPPABLE.has(row.InventoryType) &&
    (!row.RandomProperty || suffixesOf(row).length > 0) &&
    classicItems.has(row.entry) &&
    !(row.class === 2 && row.subclass === 20) // fishing poles
  )
}

// ---- Random "of the ..." suffixes (ItemRandomProperties) ----
// wowsims stat index -> [field, key]. Classic suffixes only use these.
const SUFFIX_STATS = {
  0: ['stats', 'str'], 1: ['stats', 'agi'], 2: ['stats', 'sta'], 3: ['stats', 'int'], 4: ['stats', 'spi'],
  5: ['bonus', 'spellDamage'], 6: ['bonus', 'arcaneDamage'], 7: ['bonus', 'fireDamage'], 8: ['bonus', 'frostDamage'],
  9: ['bonus', 'holyDamage'], 10: ['bonus', 'natureDamage'], 11: ['bonus', 'shadowDamage'], 12: ['bonus', 'mp5'],
  17: ['bonus', 'attackPower'], 27: ['bonus', 'rangedAttackPower'], 28: ['bonus', 'defense'], 29: ['bonus', 'block'],
  31: ['bonus', 'dodge'], 35: ['resist', 'arcane'], 36: ['resist', 'fire'], 37: ['resist', 'frost'],
  38: ['resist', 'nature'], 39: ['resist', 'shadow'], 41: ['bonus', 'healing'],
}
const suffixes = {}

function buildSuffix(source) {
  const suffix = { name: source.name }
  source.stats.forEach((value, index) => {
    if (!value) return
    if (!SUFFIX_STATS[index]) throw new Error(`Unmapped suffix stat ${index} in ${source.id} ${source.name}`)
    const [field, key] = SUFFIX_STATS[index]
    suffix[field] ??= {}
    suffix[field][key] = value
  })
  if (!suffix.stats && !suffix.bonus && !suffix.resist) return null // e.g. "of Regeneration" (health per 5) has no data
  const b = suffix.bonus ?? {}
  const effects = []
  if (b.spellDamage && b.spellDamage === b.healing) effects.push(`Equip: Increases damage and healing done by magical spells and effects by up to ${b.spellDamage}.`)
  else {
    if (b.spellDamage) effects.push(`Equip: Increases damage done by magical spells and effects by up to ${b.spellDamage}.`)
    if (b.healing) effects.push(`Equip: Increases healing done by spells and effects by up to ${b.healing}.`)
  }
  for (const school of ['holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']) {
    const value = b[`${school}Damage`]
    if (value) effects.push(`Equip: Increases damage done by ${school[0].toUpperCase()}${school.slice(1)} spells and effects by up to ${value}.`)
  }
  if (b.attackPower) effects.push(`Equip: +${b.attackPower} Attack Power.`)
  if (b.rangedAttackPower && b.rangedAttackPower !== b.attackPower) effects.push(`Equip: +${b.rangedAttackPower} ranged Attack Power.`)
  if (b.defense) effects.push(`Equip: Increased Defense +${b.defense}.`)
  if (b.block) effects.push(`Equip: Increases your chance to block attacks with a shield by ${b.block}%.`)
  if (b.dodge) effects.push(`Equip: Increases your chance to dodge an attack by ${b.dodge}%.`)
  if (b.mp5) effects.push(`Equip: Restores ${b.mp5} mana per 5 sec.`)
  if (effects.length) suffix.effects = effects
  return suffix
}

// [[suffixId, chance%], ...] an item can roll, from item_enchantment_template; only suffixes with known stats.
const suffixMemo = new Map()
function suffixesOf(row) {
  if (suffixMemo.has(row.RandomProperty)) return suffixMemo.get(row.RandomProperty)
  const list = []
  for (const { ench, chance } of itemEnchantments.get(row.RandomProperty) ?? []) {
    const source = randomProperties.get(ench)
    if (!source || chance <= 0) continue
    if (!(ench in suffixes)) suffixes[ench] = buildSuffix(source)
    if (suffixes[ench]) list.push([ench, round(chance)])
  }
  suffixMemo.set(row.RandomProperty, list)
  return list
}

// Equip-effect bonuses from an item's "Equip:" spells, keyed like the stats panel uses them.
function equipBonuses(row) {
  const bonus = {}
  const add = (key, value) => (bonus[key] = (bonus[key] ?? 0) + value)
  for (let k = 1; k <= 5; k++) {
    if (row[`spellid_${k}`] === 0 || row[`spelltrigger_${k}`] !== 1) continue
    const spell = spells.get(row[`spellid_${k}`])
    if (!spell) continue
    for (let e = 1; e <= 3; e++) {
      const aura = spell[`EffectApplyAuraName${e}`]
      const misc = spell[`EffectMiscValue${e}`]
      const value = spell[`EffectBasePoints${e}`] + spell[`EffectBaseDice${e}`]
      switch (aura) {
        case 13: // damage done; healing is a separate aura
          if ((misc & ALL_MAGIC) === ALL_MAGIC) add('spellDamage', value)
          else for (let s = 1; s < 7; s++) if (misc & (1 << s)) add(`${SCHOOLS[s]}Damage`, value)
          break
        case 135: add('healing', value); break
        case 99: add('attackPower', value); break
        case 124: add('rangedAttackPower', value); break
        case 52: add('crit', value); break
        case 54: add('hit', value); break
        case 57: add('spellCrit', value); break
        case 71: if ((misc & ALL_MAGIC) === ALL_MAGIC) add('spellCrit', value); break
        case 55: add('spellHit', value); break
        case 49: add('dodge', value); break
        case 47: add('parry', value); break
        case 51: add('block', value); break
        case 158: add('blockValue', value); break
        case 85: if (misc === 0) add('mp5', value); break
        case 84: add('hp5', value); break
        case 34: add('health', value); break
        case 22: case 83:
          for (let s = 0; s < 7; s++) if (misc & (1 << s)) add(s === 0 ? 'armor' : `${SCHOOLS[s]}Resistance`, value)
          break
        case 29:
          for (const [index, key] of ['str', 'agi', 'sta', 'int', 'spi'].entries()) if (misc === -1 || misc === index) add(key, value)
          break
        case 30:
          if (misc === 95) add('defense', value)
          else if (WEAPON_SKILLS[misc]) add(`skill${misc}`, value)
          break
        case 123: add('spellPenetration', -value); break
      }
    }
  }
  return bonus
}

const SPECIAL_LINE = /^(Equip|Use|Chance on hit): /
function buildItem(row) {
  const source = classicItems.get(row.entry)
  const item = {
    name: row.name,
    icon: source.icon,
    quality: row.Quality,
    slot: row.InventoryType,
    class: row.class,
    subclass: row.subclass,
    itemLevel: row.ItemLevel,
  }
  if (row.RequiredLevel > 1) item.requiredLevel = row.RequiredLevel
  if (row.AllowableClass > 0 && (row.AllowableClass & 0x5df) !== 0x5df) item.classes = row.AllowableClass
  if (row.AllowableRace > 0 && (row.AllowableRace & 0xff) !== 0xff) item.races = row.AllowableRace
  if (row.bonding) item.binds = row.bonding
  if (row.maxcount === 1) item.unique = true
  if (row.armor) item.armor = row.armor
  if (row.block) item.block = row.block
  const stats = {}
  for (let k = 1; k <= 10; k++) {
    const key = STAT_KEYS[row[`stat_type${k}`]]
    if (key && row[`stat_value${k}`]) stats[key] = (stats[key] ?? 0) + row[`stat_value${k}`]
  }
  if (Object.keys(stats).length) item.stats = stats
  const resist = {}
  for (const school of SCHOOLS.slice(1)) if (row[`${school}_res`]) resist[school] = row[`${school}_res`]
  if (Object.keys(resist).length) item.resist = resist
  if (row.dmg_max1 > 0) {
    item.damage = [[row.dmg_min1, row.dmg_max1, row.dmg_type1]]
    if (row.dmg_max2 > 0) item.damage.push([row.dmg_min2, row.dmg_max2, row.dmg_type2])
    item.speed = row.delay / 1000
  }
  const bonus = equipBonuses(row)
  if (Object.keys(bonus).length) item.bonus = bonus
  const lines = source.tooltip.map((t) => t.label).filter((label) => SPECIAL_LINE.test(label))
  if (lines.length) item.effects = lines
  if (row.description) item.description = row.description
  if (row.RandomProperty) item.suffixes = row.RandomProperty // key into SUFFIX_POOLS
  return item
}

// ---- Loot tables ----
// A loot list is an array of entries, each either
//   [itemId, chancePercent]                      independent roll
//   [-refId, chancePercent, rolls]               independent reference (rolled `rolls` times)
//   { group: [[itemId|-refId, chancePercent], ...] }  at most one entry of the group drops per roll
// Only entries that can lead to a kept item are emitted.
const keptItems = new Set()
const refs = {}
const refMemo = new Map()

function compileLoot(rows) {
  const out = []
  const groups = new Map()
  for (const row of rows) {
    if (row.ChanceOrQuestChance < 0) continue // quest-only drop
    const isRef = row.mincountOrRef < 0
    let id = null // null: can't lead to a kept item, but still takes its share of a group roll
    if (isRef) {
      if (compileRef(-row.mincountOrRef)) id = row.mincountOrRef
    } else if (isCandidate(itemRows.get(row.item))) id = row.item
    if (row.groupid) {
      if (!groups.has(row.groupid)) groups.set(row.groupid, [])
      groups.get(row.groupid).push({ row, id })
    } else if (id !== null && row.ChanceOrQuestChance > 0) {
      out.push(isRef ? [id, row.ChanceOrQuestChance, row.maxcount || 1] : [id, row.ChanceOrQuestChance])
      if (!isRef) keptItems.add(id)
    }
  }
  for (const members of groups.values()) {
    const explicit = members.reduce((sum, m) => sum + m.row.ChanceOrQuestChance, 0)
    const equal = members.filter((m) => m.row.ChanceOrQuestChance === 0).length
    const share = equal ? Math.max(0, 100 - explicit) / equal : 0
    const group = members
      .filter((m) => m.id !== null)
      .map((m) => [m.id, round(m.row.ChanceOrQuestChance || share)])
      .filter(([, chance]) => chance > 0)
    for (const [id] of group) if (id > 0) keptItems.add(id)
    if (group.length) out.push({ group })
  }
  return out
}

function compileRef(refId) {
  if (refMemo.has(refId)) return refMemo.get(refId)
  refMemo.set(refId, false) // guards against cycles
  const loot = compileLoot(referenceLoot.get(refId) ?? [])
  const ok = loot.length > 0
  refMemo.set(refId, ok)
  if (ok) refs[refId] = loot
  return ok
}

const round = (n) => Math.round(n * 10000) / 10000

// Expected vendor value in copper of everything a loot list drops (quest items aside). Characters sell
// whatever they don't wear, so this is the loot's share of gold per kill.
const valueMemo = new Map()
function lootValue(rows) {
  let value = 0
  const groups = new Map()
  for (const row of rows) {
    if (row.ChanceOrQuestChance < 0) continue
    const each = row.mincountOrRef < 0
      ? refValue(-row.mincountOrRef) * (row.maxcount || 1)
      : (itemRows.get(row.item)?.SellPrice ?? 0) * (row.mincountOrRef + row.maxcount) / 2
    if (row.groupid) {
      if (!groups.has(row.groupid)) groups.set(row.groupid, [])
      groups.get(row.groupid).push({ chance: row.ChanceOrQuestChance, each })
    } else value += (row.ChanceOrQuestChance / 100) * each
  }
  for (const members of groups.values()) {
    const explicit = members.reduce((sum, m) => sum + m.chance, 0)
    const equal = members.filter((m) => m.chance === 0).length
    const share = equal ? Math.max(0, 100 - explicit) / equal : 0
    for (const m of members) value += ((m.chance || share) / 100) * m.each
  }
  return value
}
function refValue(refId) {
  if (valueMemo.has(refId)) return valueMemo.get(refId)
  valueMemo.set(refId, 0) // guards against cycles
  const value = lootValue(referenceLoot.get(refId) ?? [])
  valueMemo.set(refId, value)
  return value
}

// ---- Mobs ----
// Hostile, soloable (normal, rare, rare elite) creatures that can be attacked, weighted per zone by how often
// they can be killed: each normal spawn point counts 1 (per 5-minute respawn); a rare counts once at its
// respawn rate. Critters are left out.
const NORMAL_RESPAWN = 300
const UNATTACKABLE = 0x2 | 0x100 | 0x2000000 // non-attackable, immune to players, not selectable
const CRITTER = 8
const DEFAULT_RUN = 1.14286 // creature run speed multiplier of 7 yards per second
const lootIds = {}
const mobs = {}
const zoneMobs = Object.fromEntries(ZONES.map((z) => [z.name, new Map()]))
const mobZones = new Map() // entry -> Set of zones

function buildMob(c) {
  const attack = (c.MeleeBaseAttackTime || 2000) / 1000
  const hit = ((c.MinMeleeDmg + c.MaxMeleeDmg) / 2 + (c.MeleeAttackPower / 14) * attack) * (c.DamageMultiplier || 1)
  const mob = {
    name: c.Name,
    level: [c.MinLevel, c.MaxLevel],
    hp: [c.MinLevelHealth, c.MaxLevelHealth],
    dps: round(hit / attack),
    armor: c.Armor,
  }
  if (attack !== 2) mob.speed = attack
  if (c.SpeedRun && Math.abs(c.SpeedRun - DEFAULT_RUN) > 0.001) mob.run = round(c.SpeedRun)
  const resist = {}
  for (const school of ['Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane']) {
    if (c[`Resistance${school}`] > 0) resist[school.toLowerCase()] = c[`Resistance${school}`]
  }
  if (Object.keys(resist).length) mob.resist = resist
  const coin = (c.MinLootGold + c.MaxLootGold) / 2
  const value = c.LootId ? lootValue(creatureLoot.get(c.LootId) ?? []) : 0
  if (coin) mob.coin = Math.round(coin)
  if (value >= 1) mob.value = Math.round(value)
  if (c.Rank === 2) mob.elite = true
  if (c.ExperienceMultiplier !== 1) mob.xp = c.ExperienceMultiplier
  if (c.LootId) {
    if (!(c.LootId in lootIds)) {
      const loot = compileLoot(creatureLoot.get(c.LootId) ?? [])
      lootIds[c.LootId] = loot.length ? loot : null
    }
    if (lootIds[c.LootId]) mob.loot = c.LootId
  }
  return mob
}

for (const [entry, unit] of Object.entries(pfUnits)) {
  if (unit.fac || !unit.coords) continue // friendly to a faction
  const creature = creatures.get(Number(entry))
  if (!creature || ![0, 2, 4].includes(creature.Rank) || creature.CreatureType === CRITTER) continue
  if (creature.UnitFlags & UNATTACKABLE || creature.NpcFlags || creature.MinLevelHealth <= 0) continue
  if (creature.MinLevel < 1 || creature.MaxLevel > 63) continue
  const perZone = new Map()
  for (const coord of Object.values(unit.coords)) {
    const zone = zoneById.get(coord[2])
    if (!zone) continue
    // pfQuest lists border spawns on every zone map they show up on; keep mobs near the zone's level range.
    const { minLevel, maxLevel } = ZONES.find((z) => z.name === zone)
    if (creature.MinLevel > maxLevel + 5 || creature.MaxLevel < minLevel - 5) continue
    const z = perZone.get(zone) ?? { points: 0, respawn: 0 }
    z.points += 1
    z.respawn += coord[3] || NORMAL_RESPAWN
    perZone.set(zone, z)
  }
  if (!perZone.size) continue
  mobs[creature.Entry] = buildMob(creature)
  const rare = creature.Rank !== 0
  for (const [zone, { points, respawn }] of perZone) {
    const avgRespawn = Math.max(NORMAL_RESPAWN, respawn / points)
    const weight = rare ? NORMAL_RESPAWN / avgRespawn : points * (NORMAL_RESPAWN / avgRespawn)
    zoneMobs[zone].set(creature.Entry, round(weight))
    if (!mobZones.has(creature.Entry)) mobZones.set(creature.Entry, new Set())
    mobZones.get(creature.Entry).add(zone)
  }
}

// Quest objective sources. Kill credit: a kill of `entry` counts for its own id and its KillCredit ids.
const creditSources = new Map() // credited id -> [entry, ...]
for (const entry of Object.keys(mobs).map(Number)) {
  const c = creatures.get(entry)
  for (const id of [entry, c.KillCredit1, c.KillCredit2]) {
    if (!id) continue
    if (!creditSources.has(id)) creditSources.set(id, [])
    creditSources.get(id).push(entry)
  }
}
// Item -> loot ids that drop it (quest drops and normal drops).
const itemLootIds = new Map()
for (const [lootId, rows] of creatureLoot) {
  for (const row of rows) {
    if (row.mincountOrRef < 0 || !row.item) continue
    if (!itemLootIds.has(row.item)) itemLootIds.set(row.item, [])
    itemLootIds.get(row.item).push([lootId, Math.abs(row.ChanceOrQuestChance)])
  }
}
const creaturesByLoot = groupBy([...creatures.values()].filter((c) => c.LootId), 'LootId')

// ---- Quests ----
const RACE_ALLIANCE = 1 | 4 | 8 | 64
const RACE_HORDE = 2 | 16 | 32 | 128
const BAD_TITLE = /^<|\b(UNUSED|NYI|TEST|DEPRECATED|OLD)\b|\[DEP\]/i
function questFaction(row, pf) {
  const races = row.RequiredRaces & 0xff
  if (races && !(races & RACE_HORDE)) return 'Alliance'
  if (races && !(races & RACE_ALLIANCE)) return 'Horde'
  const starters = pf.start?.U ?? []
  const factions = new Set(starters.map((id) => pfUnits[id]?.fac ?? 'AH'))
  if (factions.size === 1) {
    const fac = [...factions][0]
    if (fac === 'A') return 'Alliance'
    if (fac === 'H') return 'Horde'
  }
  return null
}

// Kill objectives: [creditId, count, sourceEntries?]. Sources are left out when it's just the creature itself.
// Returns null if a target can't be soloed in the zone (elite, or not there).
function killObjectives(row, zone) {
  const out = []
  for (let k = 1; k <= 4; k++) {
    const id = row[`ReqCreatureOrGOId${k}`]
    const count = row[`ReqCreatureOrGOCount${k}`]
    if (id <= 0 || count <= 0 || row[`ReqSpellCast${k}`]) continue // game objects and spell casts are errand steps
    const sources = (creditSources.get(id) ?? []).filter((entry) => zoneMobs[zone].has(entry))
    if (!sources.length) return null
    out.push(sources.length === 1 && sources[0] === id ? [id, count] : [id, count, sources])
  }
  return out
}

// Item objectives that drop from mobs: [itemId, count, [[mobEntry, chance%], ...]]. Items that don't drop from
// any creature (picked up from objects, given by NPCs) are errand steps. Returns null if the item only drops
// from creatures that can't be soloed in the zone.
const questItems = {}
function itemObjectives(row, zone) {
  const out = []
  for (let k = 1; k <= 4; k++) {
    const id = row[`ReqItemId${k}`]
    const count = row[`ReqItemCount${k}`]
    if (!id || count <= 0) continue
    const drops = itemLootIds.get(id) ?? []
    if (!drops.length) continue
    const sources = []
    for (const [lootId, chance] of drops) {
      for (const c of creaturesByLoot.get(lootId) ?? []) {
        if (zoneMobs[zone].has(c.Entry) && chance > 0) sources.push([c.Entry, round(chance)])
      }
    }
    if (!sources.length) return null
    out.push([id, count, sources])
    questItems[id] = itemRows.get(id)?.name ?? `Item ${id}`
  }
  return out
}

// Objective steps that aren't mob kills or mob drops, each costing a little travel and a click: game objects to
// use, spells to cast on something, and items looted from objects in the world (crates, plants, chests). Items
// that come from neither mobs nor objects (handed over by NPCs, crafted, bought, quest rewards) cost nothing extra.
// Item -> most of it one object gives (average of its loot count range).
const objectYield = new Map()
for (const r of sqlRows(sql, 'gameobject_loot_template')) {
  if (r.mincountOrRef <= 0) continue
  objectYield.set(r.item, Math.max(objectYield.get(r.item) ?? 0, (r.mincountOrRef + Math.max(r.mincountOrRef, r.maxcount)) / 2))
}
function errandSteps(row) {
  let steps = 0
  for (let k = 1; k <= 4; k++) {
    const target = row[`ReqCreatureOrGOId${k}`]
    if (target && (target < 0 || row[`ReqSpellCast${k}`])) steps += row[`ReqCreatureOrGOCount${k}`]
    const item = row[`ReqItemId${k}`]
    if (item && !itemLootIds.has(item) && objectYield.has(item)) steps += Math.ceil(row[`ReqItemCount${k}`] / objectYield.get(item))
  }
  return steps
}

const quests = {}
const zoneQuests = Object.fromEntries(ZONES.map((z) => [z.name, []]))
for (const row of questRows) {
  if (row.ZoneOrSort <= 0 || BAD_TITLE.test(row.Title) || [62, 81].includes(row.Type)) continue
  const pf = pfQuests[row.entry]
  if (!pf) continue
  const zone = zoneOfArea(row.ZoneOrSort)
  if (!zone) continue
  const keep = (ids) => ids.filter((id) => id && isCandidate(itemRows.get(id)))
  const choice = keep([1, 2, 3, 4, 5, 6].map((k) => row[`RewChoiceItemId${k}`]))
  const reward = keep([1, 2, 3, 4].map((k) => row[`RewItemId${k}`]))
  const xp = row.QuestLevel > 0 && row.QuestLevel <= 60 ? Math.round(row.RewMoneyMaxLevel / 0.6) : 0
  const money = Math.max(0, row.RewOrReqMoney)
  if (!choice.length && !reward.length && !xp && !money) continue
  const kills = killObjectives(row, zone)
  const items = itemObjectives(row, zone)
  if (!kills || !items) continue // needs a group or mobs from elsewhere
  for (const id of [...choice, ...reward]) keptItems.add(id)
  const quest = { title: row.Title, zone, level: row.QuestLevel, minLevel: Math.max(1, row.MinLevel) }
  const faction = questFaction(row, pf)
  if (faction) quest.faction = faction
  if (row.RequiredRaces & 0xff && (row.RequiredRaces & 0xff) !== 0xff) quest.races = row.RequiredRaces
  if (row.RequiredClasses) quest.classes = row.RequiredClasses
  if (row.PrevQuestId) quest.prev = Math.abs(row.PrevQuestId)
  if (row.ExclusiveGroup > 0) quest.exclusive = row.ExclusiveGroup
  if (xp) quest.xp = xp
  if (money) quest.money = money
  if (kills.length) quest.kills = kills
  if (items.length) quest.items = items
  const steps = errandSteps(row)
  if (steps) quest.steps = steps
  if (choice.length) quest.choice = choice
  if (reward.length) quest.reward = reward
  quests[row.entry] = quest
  zoneQuests[zone].push(row.entry)
}
// Prerequisites outside this data set are treated as done.
for (const quest of Object.values(quests)) if (quest.prev && !quests[quest.prev]) delete quest.prev

// ---- Dungeons ----
// 5-player dungeons (no raids, and Lower Blackrock Spire without the upper half): [name, map id, quest area ids,
// level range, faction that can enter (by its capital), minutes for a clear at the right level, bosses in kill
// order]. Trash is every other hostile creature spawned in the map.
const DUNGEON_LIST = [
  ['Ragefire Chasm', 389, [2437], 13, 18, 'Horde', 30, ['Oggleflint', 'Taragaman the Hungerer', 'Jergosh the Invoker', 'Bazzalan']],
  ['Wailing Caverns', 43, [718], 17, 24, null, 60, ['Lady Anacondra', 'Lord Cobrahn', 'Kresh', 'Lord Pythas', 'Skum', 'Lord Serpentis', 'Verdan the Everliving', 'Mutanus the Devourer', 'Deviate Faerie Dragon']],
  ['The Deadmines', 36, [1581], 17, 26, null, 60, ["Rhahk'Zor", 'Miner Johnson', "Sneed's Shredder", 'Sneed', 'Gilnid', 'Mr. Smite', 'Captain Greenskin', 'Edwin VanCleef', 'Cookie']],
  ['Shadowfang Keep', 33, [209, 236], 22, 30, null, 50, ['Rethilgore', 'Razorclaw the Butcher', 'Baron Silverlaine', 'Commander Springvale', 'Odo the Blindwatcher', 'Deathsworn Captain', 'Fenrus the Devourer', 'Wolf Master Nandos', 'Archmage Arugal']],
  ['Blackfathom Deeps', 48, [719, 2797], 24, 32, null, 60, ['Ghamoo-ra', 'Lady Sarevess', 'Gelihast', 'Lorgus Jett', 'Baron Aquanis', 'Twilight Lord Kelris', "Old Serra'kis", "Aku'mai"]],
  ['The Stockade', 34, [717], 24, 32, 'Alliance', 35, ['Targorr the Dread', 'Kam Deepfury', 'Hamhock', 'Bazil Thredd', 'Dextren Ward', 'Bruegal Ironknuckle']],
  ['Gnomeregan', 90, [133, 721], 29, 38, null, 80, ['Grubbis', 'Viscous Fallout', 'Electrocutioner 6000', 'Crowd Pummeler 9-60', 'Dark Iron Ambassador', 'Mekgineer Thermaplugg']],
  ['Razorfen Kraul', 47, [491, 1717], 30, 40, null, 60, ['Roogug', 'Aggem Thorncurse', 'Death Speaker Jargba', 'Overlord Ramtusk', 'Agathelos the Raging', 'Blind Hunter', 'Charlga Razorflank', 'Earthcaller Halmgar']],
  ['Scarlet Monastery', 189, [796], 28, 45, null, 150, ['Interrogator Vishas', 'Bloodmage Thalnos', 'Ironspine', 'Azshir the Sleepless', 'Fallen Champion', 'Houndmaster Loksey', 'Arcanist Doan', 'Herod', 'Scarlet Commander Mograine', 'High Inquisitor Whitemane']],
  ['Razorfen Downs', 129, [722, 1316], 37, 46, null, 60, ["Tuten'kash", 'Mordresh Fire Eye', 'Glutton', 'Ragglesnout', 'Amnennar the Coldbringer', 'Plaguemaw the Rotting']],
  ['Uldaman', 70, [1337, 1517], 41, 51, null, 80, ['Revelosh', 'Baelog', 'Ironaya', 'Obsidian Sentinel', 'Ancient Stone Keeper', 'Galgann Firehammer', 'Grimlok', 'Archaedas']],
  ["Zul'Farrak", 209, [1176, 978], 44, 54, null, 75, ["Antu'sul", 'Theka the Martyr', "Witch Doctor Zum'rah", 'Nekrum Gutchewer', "Shadowpriest Sezz'ziz", 'Sergeant Bly', 'Hydromancer Velratha', "Gahz'rilla", 'Chief Ukorz Sandscalp', 'Ruuzlu', 'Zerillis', 'Sandarr Dunereaver']],
  ['Maraudon', 349, [2100], 46, 55, null, 100, ['Noxxion', 'Razorlash', 'Lord Vyletongue', 'Meshlok the Harvester', 'Celebras the Cursed', 'Landslide', 'Tinkerer Gizlock', 'Rotgrip', 'Princess Theradras']],
  ['Sunken Temple', 109, [1477, 1417], 50, 56, null, 90, ["Atal'alarion", 'Dreamscythe', 'Weaver', "Jammal'an the Prophet", 'Ogom the Wretched', 'Morphaz', 'Hazzas', 'Shade of Eranikus', 'Avatar of Hakkar']],
  ['Blackrock Depths', 230, [1584], 52, 60, null, 180, ['High Interrogator Gerstahn', 'Lord Roccor', 'Houndmaster Grebmar', 'Pyromancer Loregrain', 'Lord Incendius', 'Warder Stilgiss', 'Verek', 'Fineous Darkvire', "Bael'Gar", 'General Angerforge', 'Golem Lord Argelmach', 'Hurley Blackbreath', 'Phalanx', 'Ribbly Screwspigot', 'Plugger Spazzring', 'Ambassador Flamelash', 'Magmus', 'Emperor Dagran Thaurissan']],
  ['Lower Blackrock Spire', 229, [1583], 55, 60, null, 90, ['Highlord Omokk', 'Spirestone Butcher', 'Spirestone Battle Lord', 'Spirestone Lord Magus', "Shadow Hunter Vosh'gajin", 'War Master Voone', 'Mother Smolderweb', 'Crystal Fang', 'Urok Doomhowl', 'Bannok Grimaxe', 'Quartermaster Zigris', 'Halycon', 'Gizrul the Slavener', 'Ghok Bashguud', 'Burning Felguard', 'Overlord Wyrmthalak']],
  ['Dire Maul', 429, [2557, 2577], 55, 60, null, 180, ['Pusillin', 'Zevrim Thornhoof', 'Hydrospawn', 'Lethtendris', 'Alzzin the Wildshaper', 'Tendris Warpwood', 'Illyanna Ravenoak', 'Magister Kalendris', "Immol'thar", 'Prince Tortheldrin', "Tsu'zee", "Guard Mol'dar", 'Stomper Kreeg', 'Guard Fengus', "Guard Slip'kik", 'Captain Kromcrush', "Cho'Rush the Observer", 'King Gordok']],
  ['Stratholme', 329, [2017, 2279], 58, 60, null, 150, ['The Unforgiven', 'Timmy the Cruel', 'Malor the Zealous', 'Cannon Master Willey', 'Archivist Galford', 'Balnazzar', 'Hearthsinger Forresten', 'Skul', 'Magistrate Barthilas', 'Stonespine', "Nerub'enkan", 'Baroness Anastari', 'Maleki the Pallid', 'Ramstein the Gorger', 'Baron Rivendare']],
  ['Scholomance', 289, [2057], 58, 60, null, 120, ['Kirtonos the Herald', 'Jandice Barov', 'Rattlegore', 'Marduk Blackpool', 'Vectus', 'Ras Frostwhisper', 'Instructor Malicia', 'Doctor Theolen Krastinov', 'Lorekeeper Polkelt', 'The Ravenian', 'Lord Alexei Barov', 'Lady Illucia Barov', 'Darkmaster Gandling']],
]
// Upper Blackrock Spire shares Lower's map.
const UPPER_SPIRE = /^(Rage Talon|Blackhand|Chromatic|Rookery|Pyroguard Emberseer|Solakar Flamewreath|Warchief Rend Blackhand|Gyth|The Beast|General Drakkisath|Goraluk Anvilcrack|Jed Runewatcher|Lord Valthalak)/
const TOTEM = 11
// Spawn points with entry 0 pick one of several creatures (creature_spawn_entry, or their creature spawn group's
// entries); each gets an even share.
const spawnEntries = groupBy(sqlRows(sql, 'creature_spawn_entry'), 'guid')
const creatureGroups = new Set(sqlRows(sql, 'spawn_group').filter((g) => g.Type === 0).map((g) => g.Id))
const groupEntries = groupBy(sqlRows(sql, 'spawn_group_entry'), 'Id')
const spawnGroupOf = new Map(sqlRows(sql, 'spawn_group_spawn').filter((s) => creatureGroups.has(s.Id)).map((s) => [s.Guid, s.Id]))
const spawnsByMap = new Map() // map -> Map(entry -> spawn points)
for (const s of sqlRows(sql, 'creature')) {
  if (!spawnsByMap.has(s.map)) spawnsByMap.set(s.map, new Map())
  const counts = spawnsByMap.get(s.map)
  const entries = s.id ? [s.id]
    : spawnEntries.has(s.guid) ? spawnEntries.get(s.guid).map((r) => r.entry)
      : (groupEntries.get(spawnGroupOf.get(s.guid)) ?? []).map((r) => r.Entry)
  for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1 / entries.length)
}
for (const counts of spawnsByMap.values()) for (const [entry, n] of counts) counts.set(entry, Math.max(1, Math.round(n)))
const creaturesByName = groupBy([...creatures.values()], 'Name')
const isDungeonFoe = (c, min) => c && !pfUnits[c.Entry]?.fac && !(c.UnitFlags & UNATTACKABLE) && !c.NpcFlags && !c.Civilian &&
  ![CRITTER, TOTEM].includes(c.CreatureType) && c.MinLevelHealth > 0 && c.Rank !== 3 && c.MaxLevel >= min - 5 && c.MaxLevel <= 63 &&
  !UPPER_SPIRE.test(c.Name) && !/trigger|\[DND\]/i.test(c.Name)
function addDungeonMob(c) {
  mobs[c.Entry] ??= buildMob(c)
  if (c.Rank >= 1) mobs[c.Entry].elite = true
}
const dungeons = []
const dungeonOfArea = new Map()
const dungeonFoes = new Map() // dungeon name -> Set of creature entries
for (const [name, map, areas, min, max, faction, minutes, bossNames] of DUNGEON_LIST) {
  const spawned = spawnsByMap.get(map) ?? new Map()
  const bosses = []
  for (const bossName of bossNames) {
    const options = creaturesByName.get(bossName) ?? []
    const c = options.find((o) => spawned.has(o.Entry)) ?? options.find((o) => o.Rank >= 1 && o.MaxLevel >= min - 3 && o.MinLevel <= max + 3)
    if (!c) {
      console.warn(`${name}: no creature named ${bossName}`)
      continue
    }
    bosses.push(c.Entry)
    addDungeonMob(c)
  }
  const trash = []
  for (const [entry, count] of spawned) {
    const c = creatures.get(entry)
    if (bosses.includes(entry) || !isDungeonFoe(c, min)) continue
    trash.push([entry, count])
    addDungeonMob(c)
  }
  trash.sort(([a], [b]) => a - b)
  const dungeon = { name, level: [min, max], minutes, bosses, trash }
  if (faction) dungeon.faction = faction
  dungeons.push(dungeon)
  for (const area of areas) dungeonOfArea.set(area, name)
  dungeonFoes.set(name, new Set([...bosses, ...trash.map(([entry]) => entry)]))
}

// Dungeon quests: the quests for each dungeon (by quest area) whose kills and mob drops are all inside it, picked
// up from a quest giver. `zone` is where the giver stands, or null for a city or anywhere outside this game's
// zones. Prerequisites that aren't quests here already become `step`s of the chain: quests done by visiting
// their zone. Quest-log limits don't apply to either.
const questById = new Map(questRows.map((row) => [row.entry, row]))
// Creatures with no spawn point anywhere are summoned by scripts; ones of the dungeon's level count as inside it.
const spawnedAnywhere = new Set([...spawnsByMap.values()].flatMap((counts) => [...counts.keys()]))
function objectivesInside(row, foes, [min, max]) {
  const inside = (c) => foes.has(c.Entry) || (!spawnedAnywhere.has(c.Entry) && c.MaxLevel >= min - 5 && c.MinLevel <= max + 5)
  for (let k = 1; k <= 4; k++) {
    const id = row[`ReqCreatureOrGOId${k}`]
    if (id > 0 && !row[`ReqSpellCast${k}`] && ![...creatures.values()].some((c) => (c.Entry === id || c.KillCredit1 === id || c.KillCredit2 === id) && inside(c))) return false
    const item = row[`ReqItemId${k}`]
    const drops = item ? itemLootIds.get(item) ?? [] : []
    if (drops.length && !drops.some(([lootId]) => (creaturesByLoot.get(lootId) ?? []).some(inside))) return false
  }
  return true
}
const giverZone = (pf) => (pf.start?.U ?? []).flatMap((u) => Object.values(pfUnits[u]?.coords ?? {})).map((c) => zoneById.get(c[2])).find(Boolean) ?? null
function questFields(row, pf) {
  const keep = (ids) => ids.filter((id) => id && isCandidate(itemRows.get(id)))
  const choice = keep([1, 2, 3, 4, 5, 6].map((k) => row[`RewChoiceItemId${k}`]))
  const reward = keep([1, 2, 3, 4].map((k) => row[`RewItemId${k}`]))
  for (const id of [...choice, ...reward]) keptItems.add(id)
  const level = row.QuestLevel > 0 ? Math.min(row.QuestLevel, 60) : Math.max(1, row.MinLevel)
  const quest = { title: row.Title, level, minLevel: Math.max(1, row.MinLevel) }
  const faction = questFaction(row, pf)
  if (faction) quest.faction = faction
  if (row.RequiredRaces & 0xff && (row.RequiredRaces & 0xff) !== 0xff) quest.races = row.RequiredRaces
  if (row.RequiredClasses) quest.classes = row.RequiredClasses
  if (row.PrevQuestId) quest.prev = Math.abs(row.PrevQuestId)
  if (row.ExclusiveGroup > 0) quest.exclusive = row.ExclusiveGroup
  const xp = row.QuestLevel > 0 && row.QuestLevel <= 60 ? Math.round(row.RewMoneyMaxLevel / 0.6) : 0
  if (xp) quest.xp = xp
  if (row.RewOrReqMoney > 0) quest.money = row.RewOrReqMoney
  if (choice.length) quest.choice = choice
  if (reward.length) quest.reward = reward
  return quest
}
const dungeonQuests = {}
for (const row of questRows) {
  const dungeon = dungeonOfArea.get(row.ZoneOrSort)
  const pf = pfQuests[row.entry]
  if (!dungeon || !pf?.start?.U?.length || BAD_TITLE.test(row.Title) || row.Type === 62 || quests[row.entry]) continue
  if (!objectivesInside(row, dungeonFoes.get(dungeon), dungeons.find((d) => d.name === dungeon).level)) {
    if (process.env.DEBUG_Q) console.warn(`${dungeon}: ${row.entry} ${row.Title} has objectives outside`)
    continue
  }
  const quest = { ...questFields(row, pf), dungeon, zone: giverZone(pf) }
  if (!quest.xp && !quest.money && !quest.choice && !quest.reward) continue
  dungeonQuests[row.entry] = quest
}
const MAX_CHAIN = 6
function chainStep(id, dungeon, depth) {
  if (quests[id] || dungeonQuests[id]) return true
  const row = questById.get(id)
  const pf = pfQuests[id]
  if (!row || !pf?.start?.U?.length || depth > MAX_CHAIN || BAD_TITLE.test(row.Title)) return false
  const step = { ...questFields(row, pf), dungeon, step: true, zone: giverZone(pf) ?? zoneOfArea(row.ZoneOrSort) ?? null }
  dungeonQuests[id] = step
  if (step.prev && !chainStep(step.prev, dungeon, depth + 1)) delete step.prev
  return true
}
for (const [id, quest] of Object.entries(dungeonQuests)) {
  if (!quest.step && quest.prev && !chainStep(quest.prev, quest.dungeon, 1)) delete quest.prev
}

// ---- Base stats ----
const RACE_NAMES = { 1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll' }
const CLASS_NAMES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' }
const baseStats = {}
for (const r of levelStats) {
  const race = RACE_NAMES[r.race]
  const cls = CLASS_NAMES[r.class]
  if (!race || !cls || r.level > 60) continue
  baseStats[race] ??= {}
  baseStats[race][cls] ??= []
  baseStats[race][cls][r.level - 1] = [r.str, r.agi, r.sta, r.inte, r.spi]
}
const baseHealthMana = {}
for (const r of classLevelStats) {
  const cls = CLASS_NAMES[r.class]
  if (!cls || r.level > 60) continue
  baseHealthMana[cls] ??= []
  baseHealthMana[cls][r.level - 1] = [r.basehp, r.basemana]
}

// ---- Class spells ----
// The trainer abilities each class fights with, every rank with its trainer level and cost, plus the spells
// they trigger. Effect values follow CMaNGOS SpellEntry::CalculateSimpleValue and Unit::CalculateSpellDamage.
const ROTATION_SPELLS = {
  Warrior: ['Heroic Strike', 'Battle Shout', 'Rend', 'Charge', 'Overpower', 'Bloodrage', 'Execute'],
  Rogue: ['Sinister Strike', 'Eviscerate', 'Slice and Dice'],
  Hunter: ['Auto Shot', 'Raptor Strike', "Hunter's Mark", 'Serpent Sting', 'Arcane Shot', 'Aspect of the Hawk'],
  Mage: ['Fireball', 'Frostbolt', 'Fire Blast', 'Arcane Missiles', 'Arcane Intellect', 'Frost Armor', 'Ice Armor'],
  Priest: ['Smite', 'Lesser Heal', 'Shadow Word: Pain', 'Power Word: Shield', 'Power Word: Fortitude', 'Mind Blast', 'Inner Fire', 'Renew', 'Heal', 'Greater Heal'],
  Warlock: ['Shadow Bolt', 'Immolate', 'Corruption', 'Curse of Agony', 'Life Tap', 'Drain Life', 'Demon Skin', 'Demon Armor'],
  Paladin: ['Seal of Righteousness', 'Holy Light', 'Devotion Aura', 'Blessing of Might', 'Judgement'],
  Shaman: ['Lightning Bolt', 'Healing Wave', 'Earth Shock', 'Lightning Shield', 'Flame Shock'],
  Druid: ['Wrath', 'Healing Touch', 'Mark of the Wild', 'Moonfire', 'Rejuvenation', 'Thorns', 'Cat Form', 'Claw', 'Rake', 'Rip', 'Ferocious Bite', 'Bear Form', 'Maul', 'Dire Bear Form', 'Aquatic Form', 'Travel Form'],
}
// Spells class quests teach rather than trainers, with Maul rank 1 coming along with Bear Form: id -> level.
const QUEST_TAUGHT = { Druid: { 5487: 10, 6807: 10, 1066: 16 } } // Bear Form, Maul, Aquatic Form
// Druid forms' passives, which CMaNGOS applies from code (Unit::HandleShapeshiftBoosts).
const FORM_PASSIVES = { 768: 3025, 5487: 1178, 9634: 9635, 1066: 5421, 783: 5419 }
// SpellCastTimes.dbc and SpellDuration.dbc entries the rotation spells use (ms; -1 = until cancelled).
const CAST_MS = { 1: 0, 4: 1000, 5: 2000, 6: 5000, 7: 10000, 14: 3000, 16: 1500, 18: 0, 19: 2500, 20: 2500, 21: 2600, 22: 3500, 23: 1800, 24: 2200, 90: 1700, 91: 2800, 171: 6000 }
const DURATION_MS = {
  0: 0, 1: 10000, 3: 60000, 4: 120000, 5: 300000, 6: 600000, 8: 15000, 9: 30000, 18: 20000, 21: -1, 22: 45000, 27: 3000, 28: 5000, 29: 12000,
  30: 1800000, 31: 8000, 32: 6000, 35: 4000, 36: 1000, 39: 2000, 64: 40000, 85: 18000, 86: 21000, 105: 9000, 106: 24000, 125: 35000,
  165: 7000, 245: 50000, 265: 55000,
}
// Durations that grow with combo points: [1 point, 5 points].
const COMBO_DURATION_MS = { 185: [9000, 21000], 553: [8000, 16000] }
// Spells CMaNGOS triggers from scripts rather than spell data.
const LIGHTNING_SHIELD_PROC = { 324: 26364, 325: 26365, 905: 26366, 945: 26367, 8134: 26369, 10431: 26370, 10432: 26363 }
const RIGHTEOUSNESS_PROC = { 20154: 25742, 21084: 25741, 20287: 25740, 20288: 25739, 20289: 25738, 20290: 25737, 20291: 25736, 20292: 25735, 20293: 25713 }
const HOLY_LIGHT_HEAL = 19968
const POWER = { 0: 'mana', 1: 'rage', 3: 'energy', 4294967294: 'health' }

const trainers = sqlRows(sql, 'npc_trainer_template')
const trainerSpells = groupBy([...trainers, ...sqlRows(sql, 'npc_trainer')], 'entry')
const createSpells = sqlRows(sql, 'playercreateinfo_spell')

const spellData = {}
function buildSpell(id) {
  if (id in spellData) return
  const s = spells.get(id)
  if (!s) throw new Error(`No spell ${id}`)
  if (!(s.CastingTimeIndex in CAST_MS)) throw new Error(`Unknown cast time index ${s.CastingTimeIndex} (${s.SpellName})`)
  if (!(s.DurationIndex in DURATION_MS) && !(s.DurationIndex in COMBO_DURATION_MS)) {
    throw new Error(`Unknown duration index ${s.DurationIndex} (${s.SpellName})`)
  }
  const spell = { name: s.SpellName, school: s.School }
  spellData[id] = spell
  const rank = Number(/Rank (\d+)/.exec(s.Rank1)?.[1])
  if (rank) spell.rank = rank
  if (s.SpellLevel) spell.spellLevel = s.SpellLevel
  if (s.BaseLevel) spell.baseLevel = s.BaseLevel
  if (s.MaxLevel) spell.maxLevel = s.MaxLevel
  const power = POWER[s.PowerType]
  if (power && power !== 'mana') spell.power = power
  if (s.ManaCost) spell.cost = power === 'rage' ? s.ManaCost / 10 : s.ManaCost
  if (s.ManaCostPercentage) spell.costPct = s.ManaCostPercentage
  if (CAST_MS[s.CastingTimeIndex]) spell.cast = CAST_MS[s.CastingTimeIndex]
  const cooldown = Math.max(s.RecoveryTime, s.CategoryRecoveryTime)
  if (cooldown) spell.cooldown = cooldown
  if (s.CategoryRecoveryTime && s.Category) spell.category = s.Category
  if (s.StartRecoveryTime) spell.gcd = s.StartRecoveryTime
  if (s.DurationIndex in COMBO_DURATION_MS) spell.comboDuration = COMBO_DURATION_MS[s.DurationIndex]
  else if (DURATION_MS[s.DurationIndex]) spell.duration = DURATION_MS[s.DurationIndex]
  if (s.DmgClass) spell.dmgClass = s.DmgClass // 1 magic, 2 melee, 3 ranged
  if (s.RangeIndex === 2) spell.melee = true
  if (s.Attributes & 0x4) spell.nextSwing = true
  if (s.AttributesEx & (0x4 | 0x40)) spell.channel = true
  if (s.InterruptFlags & 0x2) spell.pushback = true
  if (s.CasterAuraState) spell.casterState = s.CasterAuraState
  if (s.TargetAuraState) spell.targetState = s.TargetAuraState
  if (s.ProcCharges) spell.charges = s.ProcCharges
  const effects = []
  for (let k = 1; k <= 3; k++) {
    if (!s[`Effect${k}`]) continue
    const e = { type: s[`Effect${k}`] }
    const set = (key, value) => {
      if (value && value !== -1) e[key] = value
    }
    set('aura', s[`EffectApplyAuraName${k}`])
    e.base = s[`EffectBasePoints${k}`]
    set('dice', s[`EffectBaseDice${k}`])
    set('sides', s[`EffectDieSides${k}`])
    set('perLevel', s[`EffectRealPointsPerLevel${k}`])
    set('dicePerLevel', s[`EffectDicePerLevel${k}`])
    set('perCombo', s[`EffectPointsPerComboPoint${k}`])
    set('period', s[`EffectAmplitude${k}`])
    set('misc', s[`EffectMiscValue${k}`])
    set('trigger', s[`EffectTriggerSpell${k}`])
    set('mechanic', s[`EffectMechanic${k}`])
    set('coef', s[`EffectBonusCoefficient${k}`])
    set('apCoef', s[`EffectBonusCoefficientFromAP${k}`])
    if (s[`DmgMultiplier${k}`] !== 1) set('mult', round(s[`DmgMultiplier${k}`]))
    effects.push(e)
  }
  spell.effects = effects
  for (const e of effects) if (e.trigger) buildSpell(e.trigger)
  if (FORM_PASSIVES[id]) {
    spell.passive = FORM_PASSIVES[id]
    buildSpell(spell.passive)
  }
  const proc = LIGHTNING_SHIELD_PROC[id] ?? RIGHTEOUSNESS_PROC[id] ?? (s.SpellIconID === 70 && s.SpellFamilyName === 10 && id !== HOLY_LIGHT_HEAL ? HOLY_LIGHT_HEAL : 0)
  if (proc) {
    spell.proc = proc
    buildSpell(proc)
  }
}

const classSpells = {}
const startingSpells = {}
for (const [cls, names] of Object.entries(ROTATION_SPELLS)) {
  const classId = Number(Object.keys(CLASS_NAMES).find((k) => CLASS_NAMES[k] === cls))
  const ranks = new Map() // learned spell id -> { level, cost }
  for (const c of creatures.values()) {
    if (c.TrainerType !== 0 || c.TrainerClass !== classId) continue
    for (const row of [...(trainerSpells.get(c.TrainerTemplateId) ?? []), ...(trainerSpells.get(c.Entry) ?? [])]) {
      const teach = spells.get(row.spell)
      const learned = [1, 2, 3].map((k) => teach?.[`Effect${k}`] === 36 && teach[`EffectTriggerSpell${k}`]).find(Boolean) || row.spell
      const prev = ranks.get(learned)
      if (!prev || prev.cost > row.spellcost) ranks.set(learned, { level: row.reqlevel, cost: row.spellcost })
    }
  }
  const starting = [...new Set(createSpells.filter((r) => r.class === classId).map((r) => r.Spell))]
  for (const id of starting) ranks.set(id, { level: 1, cost: 0 })
  for (const [id, level] of Object.entries(QUEST_TAUGHT[cls] ?? {})) ranks.set(Number(id), { level, cost: 0 })
  classSpells[cls] = {}
  for (const name of names) {
    const list = [...ranks].filter(([id]) => spells.get(id)?.SpellName === name)
    if (!list.length) throw new Error(`${cls} can't learn ${name}`)
    list.sort(([a, x], [b, y]) => x.level - y.level || a - b)
    classSpells[cls][name] = list.map(([id, { level, cost }]) => {
      buildSpell(id)
      return cost ? [id, level, cost] : [id, level]
    })
  }
  startingSpells[cls] = starting.filter((id) => id in spellData)
}
// Judgement of Righteousness ranks, in Seal of Righteousness rank order (Judgement casts the seal's).
const judgements = [...spells.values()].filter((s) => s.SpellName === 'Judgement of Righteousness')
  .sort((a, b) => a.SpellLevel - b.SpellLevel || a.Id - b.Id)
classSpells.Paladin['Seal of Righteousness'].forEach(([sealId], i) => {
  spellData[sealId].judgement = judgements[i].Id
  buildSpell(judgements[i].Id)
})

// ---- Pets ----
// Per level 1-60: hunter pet (CMaNGOS pet_levelstats entry 1), Imp and Voidwalker. Warlock pet melee damage
// comes from creature_template_classlevelstats like Pet::InitStatsForLevel.
const petLevels = groupBy(sqlRows(sql, 'pet_levelstats'), 'creature_entry')
const creatureClassStats = sqlRows(sql, 'creature_template_classlevelstats')
function buildPet(entry, template) {
  const levels = [...petLevels.get(entry)].sort((a, b) => a.level - b.level).slice(0, 60)
  return levels.map((r) => {
    const row = [r.hp, r.mana, r.armor, r.str, r.agi, r.sta, r.inte, r.spi]
    if (template) {
      const cls = creatureClassStats.find((c) => c.Level === r.level && c.Class === template.UnitClass)
      const attack = template.MeleeBaseAttackTime / 1000
      row.push(round((cls.BaseDamageExp0 * template.DamageVariance + (cls.BaseMeleeAttackPower / 14) * attack) * template.DamageMultiplier))
    }
    return row
  })
}
const pets = {
  Hunter: { speed: 2, levels: buildPet(1) },
  Imp: { speed: creatures.get(416).MeleeBaseAttackTime / 1000, levels: buildPet(416, creatures.get(416)), spell: 3110 },
  Voidwalker: { speed: creatures.get(1860).MeleeBaseAttackTime / 1000, levels: buildPet(1860, creatures.get(1860)) },
}
buildSpell(3110)

// ---- Talents ----
// Trees from wowsims, rank spells from Spell.sql, tooltip text from the vmangos spell_template (best build <= 5875).
const SPELL_FAMILY = { Mage: 3, Warrior: 4, Warlock: 5, Priest: 6, Druid: 7, Rogue: 8, Hunter: 9, Paladin: 10, Shaman: 11 }
const spellIcons = new Map(JSON.parse(read('wowsims-classic.json')).spellIcons.map((s) => [s.id, s.icon]))
const spellAffect = new Map(sqlRows(sql, 'spell_affect').map((r) => [`${r.entry}:${r.effectId}`, r.SpellFamilyMask]))
const vmangos = new Map()
for (const row of sqlRows(read('vmangos-spell.sql'), 'spell_template')) {
  if (row.build <= 5875 && !(vmangos.get(row.entry)?.build > row.build)) vmangos.set(row.entry, row)
}
const RADIUS_YARDS = { 9: 20, 10: 30, 11: 45, 13: 10 }
const TEXT_DURATION_MS = { ...DURATION_MS, 25: 180000, 65: 1500 }
const split64 = (n) => [n % 2 ** 32, Math.floor(n / 2 ** 32)]
const num = (n) => String(Math.round(n * 100) / 100)
function describe(id) {
  const own = vmangos.get(id)
  if (!own) throw new Error(`No vmangos text for ${id}`)
  const durationOf = (s) => {
    const ms = TEXT_DURATION_MS[s.durationIndex]
    if (ms === undefined) throw new Error(`Unknown duration index ${s.durationIndex} in ${id}`)
    return ms
  }
  const time = (ms) => (ms >= 60000 ? `${num(ms / 60000)} min` : `${num(ms / 1000)} sec`)
  const text = own.description.replace(/\$(?:([*/])(\d+);)?(\d*)([a-zA-Z])(\d?)/g, (token, op, by, ref, letter, k) => {
    const s = ref ? vmangos.get(Number(ref)) : own
    if (!s) throw new Error(`No vmangos text for ${ref} in ${id}`)
    const value = (n) => s[`effectBasePoints${n}`] + s[`effectBaseDice${n}`]
    let v
    switch (letter.toLowerCase()) {
      case 's': case 'm': v = Math.abs(value(k || 1)); break
      case 'd': return time(durationOf(s))
      case 'h': v = s.procChance; break
      case 'n': v = s.procCharges; break
      case 'u': v = s.stackAmount; break
      case 'o': v = Math.abs(value(k || 1)) * (durationOf(s) / s[`effectAmplitude${k || 1}`]); break
      case 't': v = s[`effectAmplitude${k || 1}`] / 1000; break
      case 'b': v = s[`effectPointsPerComboPoint${k || 1}`]; break
      case 'a': {
        v = RADIUS_YARDS[s[`effectRadiusIndex${k || 1}`]]
        if (v === undefined) throw new Error(`Unknown radius index in ${id}`)
        break
      }
      case 'l': return token // plural, handled below
      default: throw new Error(`Unknown token ${token} in ${id}`)
    }
    if (op === '/') v /= Number(by)
    if (op === '*') v *= Number(by)
    return num(v)
  })
  return text.replace(/\$l([^:;]*):([^;]*);/g, (_, one, many, at, whole) => {
    const before = /(\d+(?:\.\d+)?)\D*$/.exec(whole.slice(0, at))
    return before && Number(before[1]) === 1 ? one : many
  })
}
const talents = {}
for (const cls of Object.values(CLASS_NAMES)) {
  const trees = JSON.parse(read(`talents/${cls.toLowerCase()}.json`))
  const keys = new Set()
  talents[cls] = trees.map((tree) => ({
    name: tree.name,
    talents: tree.talents.map((t) => {
      if (keys.has(t.fieldName)) throw new Error(`Duplicate talent ${cls} ${t.fieldName}`)
      keys.add(t.fieldName)
      const first = spells.get(t.spellIds[0])
      if (!first) throw new Error(`No spell ${t.spellIds[0]} for ${cls} ${t.fieldName}`)
      const talent = {
        key: t.fieldName, name: first.SpellName, icon: spellIcons.get(t.spellIds[0]) ?? 'inv_misc_questionmark',
        row: t.location.rowIdx, col: t.location.colIdx, max: t.maxPoints,
      }
      if (t.prereqLocation) talent.prereq = [t.prereqLocation.rowIdx, t.prereqLocation.colIdx]
      if (!(first.Attributes & 0x40)) talent.active = true
      if (first.EquippedItemClass >= 0) talent.item = [first.EquippedItemClass, first.EquippedItemSubClassMask]
      if (first.Stances) talent.forms = first.Stances
      // wowsims lists fewer ids than ranks when the rest follow on from the last one.
      const ids = [...t.spellIds]
      while (ids.length < t.maxPoints) ids.push(ids.at(-1) + 1)
      talent.ranks = ids.slice(0, t.maxPoints).map((id) => {
        const s = spells.get(id)
        if (!s) throw new Error(`No spell ${id} for ${cls} ${t.fieldName}`)
        const effects = []
        for (let k = 1; k <= 3; k++) {
          if (!s[`Effect${k}`]) continue
          const e = { type: s[`Effect${k}`], value: s[`EffectBasePoints${k}`] + s[`EffectBaseDice${k}`] }
          if (s[`EffectApplyAuraName${k}`]) e.aura = s[`EffectApplyAuraName${k}`]
          if (s[`EffectMiscValue${k}`]) e.misc = s[`EffectMiscValue${k}`]
          if (s[`EffectTriggerSpell${k}`]) e.trigger = s[`EffectTriggerSpell${k}`]
          if (e.aura === 107 || e.aura === 108) {
            const mask = spellAffect.get(`${id}:${k - 1}`) ?? s[`EffectItemType${k}`]
            e.mask = [s.SpellFamilyName || SPELL_FAMILY[cls], ...split64(mask)]
          }
          effects.push(e)
        }
        return { id, desc: describe(id), effects }
      })
      return talent
    }),
  }))
}
// Spell family masks so talent spell mods can find the spells they change.
for (const [id, spell] of Object.entries(spellData)) {
  const s = spells.get(Number(id))
  if (s.SpellFamilyName && s.SpellFamilyFlags) spell.family = [s.SpellFamilyName, ...split64(s.SpellFamilyFlags)]
}

// ---- Output ----
const items = {}
for (const id of [...keptItems].sort((a, b) => a - b)) items[id] = buildItem(itemRows.get(id))
const zoneMobList = {}
for (const [zone, map] of Object.entries(zoneMobs)) {
  zoneMobList[zone] = [...map].sort(([a], [b]) => mobs[a].level[0] - mobs[b].level[0] || a - b)
}
const loot = Object.fromEntries(Object.entries(lootIds).filter(([, v]) => v))
for (const list of Object.values(zoneQuests)) list.sort((a, b) => quests[a].level - quests[b].level || a - b)
const suffixPools = {}
for (const id of keptItems) {
  const row = itemRows.get(id)
  if (row.RandomProperty) suffixPools[row.RandomProperty] = suffixesOf(row)
}
const usedSuffixes = new Set(Object.values(suffixPools).flatMap((pool) => pool.map(([id]) => id)))
const suffixData = Object.fromEntries(Object.entries(suffixes).filter(([id]) => usedSuffixes.has(Number(id))))

const json = (value) => JSON.stringify(value)
const out = `// Generated by tools/build-gear-data.mjs. Do not edit.
// Source: CMaNGOS classic-db and mangos-classic (patch 1.12, GPL-2.0), pfQuest (MIT), wow-classic-items (MIT),
// wowsims/classic random suffix stats and talent trees (MIT), vmangos talent text (GPL-2.0).
export const ITEMS = ${json(items)}
export const SUFFIXES = ${json(suffixData)}
export const SUFFIX_POOLS = ${json(suffixPools)}
export const LOOT = ${json(loot)}
export const LOOT_REFS = ${json(refs)}
export const MOBS = ${json(mobs)}
export const ZONE_MOBS = ${json(zoneMobList)}
export const QUESTS = ${json(quests)}
export const ZONE_QUESTS = ${json(zoneQuests)}
export const QUEST_ITEMS = ${json(questItems)}
export const BASE_STATS = ${json(baseStats)}
export const BASE_HEALTH_MANA = ${json(baseHealthMana)}
export const SPELLS = ${json(spellData)}
export const CLASS_SPELLS = ${json(classSpells)}
export const STARTING_SPELLS = ${json(startingSpells)}
export const PETS = ${json(pets)}
export const TALENTS = ${json(talents)}
export const DUNGEONS = ${json(dungeons)}
export const DUNGEON_QUESTS = ${json(dungeonQuests)}
`
fs.writeFileSync(OUT, out)
for (const d of dungeons) {
  const list = Object.values(dungeonQuests).filter((q) => q.dungeon === d.name)
  console.log(`${d.name}: ${d.bosses.length} bosses, ${d.trash.length} trash kinds (${d.trash.reduce((n, [, c]) => n + c, 0)} spawns), ${list.filter((q) => !q.step).length} quests + ${list.filter((q) => q.step).length} chain steps`)
}
console.log(
  `items ${Object.keys(items).length} (${Object.values(items).filter((i) => i.suffixes).length} random-suffix), suffixes ${Object.keys(suffixData).length},`,
  `loot tables ${Object.keys(loot).length}, refs ${Object.keys(refs).length},`,
  `mobs ${Object.keys(mobs).length}, quests ${Object.keys(quests).length}, spells ${Object.keys(spellData).length}, size ${(out.length / 1024).toFixed(0)} KB`,
)
for (const zone of ZONES) {
  const ids = zoneQuests[zone.name]
  const errands = ids.filter((id) => !quests[id].kills && !quests[id].items).length
  console.log(zone.name.padEnd(22), 'mobs', String(zoneMobList[zone.name].length).padStart(4), 'quests', String(ids.length).padStart(3), 'errands', errands)
}
