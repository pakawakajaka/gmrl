// Builds gear-data.js from Classic (patch 1.12) source data. Run: node tools/build-gear-data.mjs [dataDir]
//
// dataDir (default /tmp/gmrl-data) must contain:
//   classicdb.sql          CMaNGOS classic-db full dump (github.com/cmangos/classic-db)
//   spell.sql              CMaNGOS mangos-classic sql/base/dbc/original_data/Spell.sql
//   pfq/units.lua, pfq/quests.lua, pfq/zones.lua, pfq/enUS/zones.lua   from pfQuest (github.com/shagu/pfQuest)
//   v082/package/data/json/data.json   wow-classic-items@0.8.2 (npm), used for icons and tooltip text
//   wowsims-classic.json   wowsims/classic assets/database/db.json (MIT), used for random "of the ..." suffix stats
//
// Output: only equippable items that drop from open-world mobs in this game's zones or are rewarded by
// quests in those zones, their drop tables, those quests, and the player base stats per race/class/level.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { luaTable, sqlRows } from './parse.mjs'
import { ZONES } from '../zones.js'

const SRC = process.argv[2] ?? '/tmp/gmrl-data'
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

// ---- Mobs per zone ----
// Hostile, non-elite (normal, rare, rare elite) creatures with a loot table, weighted by how often they can
// be killed: each normal spawn point counts 1 (per 5-minute respawn); a rare counts once at its respawn rate.
const NORMAL_RESPAWN = 300
const lootIds = {}
const zoneMobs = Object.fromEntries(ZONES.map((z) => [z.name, new Map()]))
for (const [entry, unit] of Object.entries(pfUnits)) {
  if (unit.fac || !unit.coords) continue // friendly to a faction
  const creature = creatures.get(Number(entry))
  if (!creature || !creature.LootId || ![0, 2, 4].includes(creature.Rank)) continue
  if (creature.MinLevel < 1 || creature.MaxLevel > 63) continue
  const perZone = new Map()
  for (const coord of Object.values(unit.coords)) {
    const zone = zoneById.get(coord[2])
    if (!zone) continue
    const z = perZone.get(zone) ?? { points: 0, respawn: 0 }
    z.points += 1
    z.respawn += coord[3] || NORMAL_RESPAWN
    perZone.set(zone, z)
  }
  if (!perZone.size) continue
  if (!(creature.LootId in lootIds)) {
    const loot = compileLoot(creatureLoot.get(creature.LootId) ?? [])
    lootIds[creature.LootId] = loot.length ? loot : null
  }
  if (!lootIds[creature.LootId]) continue
  const rare = creature.Rank !== 0
  for (const [zone, { points, respawn }] of perZone) {
    const avgRespawn = Math.max(NORMAL_RESPAWN, respawn / points)
    const weight = rare ? NORMAL_RESPAWN / avgRespawn : points * (NORMAL_RESPAWN / avgRespawn)
    const key = `${creature.MinLevel}-${creature.MaxLevel}-${creature.LootId}`
    const mobs = zoneMobs[zone]
    const existing = mobs.get(key)
    if (existing) existing[2] = round(existing[2] + weight)
    else mobs.set(key, [creature.MinLevel, creature.MaxLevel, round(weight), creature.LootId])
  }
}

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
  if (!choice.length && !reward.length) continue
  for (const id of [...choice, ...reward]) keptItems.add(id)
  const quest = { title: row.Title, zone, level: row.QuestLevel, minLevel: Math.max(1, row.MinLevel) }
  const faction = questFaction(row, pf)
  if (faction) quest.faction = faction
  if (row.RequiredRaces & 0xff && (row.RequiredRaces & 0xff) !== 0xff) quest.races = row.RequiredRaces
  if (row.RequiredClasses) quest.classes = row.RequiredClasses
  if (row.PrevQuestId) quest.prev = Math.abs(row.PrevQuestId)
  if (row.ExclusiveGroup > 0) quest.exclusive = row.ExclusiveGroup
  if (choice.length) quest.choice = choice
  if (reward.length) quest.reward = reward
  quests[row.entry] = quest
  zoneQuests[zone].push(row.entry)
}
// Prerequisites outside this data set (quests without gear rewards) are treated as done.
for (const quest of Object.values(quests)) if (quest.prev && !quests[quest.prev]) delete quest.prev

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

// ---- Output ----
const items = {}
for (const id of [...keptItems].sort((a, b) => a - b)) items[id] = buildItem(itemRows.get(id))
const mobs = {}
for (const [zone, map] of Object.entries(zoneMobs)) mobs[zone] = [...map.values()].sort((a, b) => a[0] - b[0] || a[3] - b[3])
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
// wowsims/classic random suffix stats (MIT).
export const ITEMS = ${json(items)}
export const SUFFIXES = ${json(suffixData)}
export const SUFFIX_POOLS = ${json(suffixPools)}
export const LOOT = ${json(loot)}
export const LOOT_REFS = ${json(refs)}
export const ZONE_MOBS = ${json(mobs)}
export const QUESTS = ${json(quests)}
export const ZONE_QUESTS = ${json(zoneQuests)}
export const BASE_STATS = ${json(baseStats)}
export const BASE_HEALTH_MANA = ${json(baseHealthMana)}
`
fs.writeFileSync(OUT, out)
console.log(
  `items ${Object.keys(items).length} (${Object.values(items).filter((i) => i.suffixes).length} random-suffix), suffixes ${Object.keys(suffixData).length},`,
  `loot tables ${Object.keys(loot).length}, refs ${Object.keys(refs).length},`,
  `quests ${Object.keys(quests).length}, size ${(out.length / 1024).toFixed(0)} KB`,
)
for (const zone of ZONES) console.log(zone.name.padEnd(22), 'mobs', String(mobs[zone.name].length).padStart(4), 'quests', zoneQuests[zone.name].length)
