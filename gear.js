// Classic gear rules: who can use what, where it goes, how good it is for a spec, and loot/quest rolls.
import { BASE_HEALTH_MANA, BASE_STATS, ITEMS, LOOT, LOOT_REFS, MOBS, QUESTS, QUEST_ITEMS, SUFFIXES, SUFFIX_POOLS, ZONE_QUESTS } from './gear-data.js'
import { CLASSES } from './data.js'

export { BASE_HEALTH_MANA, BASE_STATS, QUESTS, QUEST_ITEMS, ZONE_QUESTS }

// Owned items are keyed by item id (number), or "itemId:suffixId" (string) for random "of the ..." items.
const suffixedItems = new Map()
export function getItem(key) {
  if (typeof key === 'number') return Object.hasOwn(ITEMS, key) ? ITEMS[key] : undefined
  if (suffixedItems.has(key)) return suffixedItems.get(key)
  const [id, suffixId] = String(key).split(':').map(Number)
  const base = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined
  const pool = base?.suffixes && SUFFIX_POOLS[base.suffixes]
  if (!pool?.some(([s]) => s === suffixId)) return undefined
  const item = withSuffix(base, SUFFIXES[suffixId])
  suffixedItems.set(key, item)
  return item
}

function withSuffix(base, suffix) {
  const item = { ...base, name: `${base.name} ${suffix.name}` }
  delete item.suffixes
  for (const field of ['stats', 'resist', 'bonus']) {
    if (!suffix[field]) continue
    item[field] = { ...base[field] }
    for (const [key, value] of Object.entries(suffix[field])) item[field][key] = (item[field][key] ?? 0) + value
  }
  if (suffix.effects) item.effects = [...(base.effects ?? []), ...suffix.effects]
  return Object.freeze(item)
}

// Validates an item key from saved data. Returns the normalized key or undefined.
export function itemKey(raw) {
  if (typeof raw === 'number' || /^\d+$/.test(raw)) return getItem(Number(raw)) ? Number(raw) : undefined
  return typeof raw === 'string' && /^\d+:\d+$/.test(raw) && getItem(raw) ? raw : undefined
}

const baseId = (key) => Number(String(key).split(':')[0])

// Gives a random-suffix item its suffix (weighted by the real Classic chances); other items are unchanged.
export function rollSuffix(id, random = Math.random) {
  const pool = ITEMS[id]?.suffixes && SUFFIX_POOLS[ITEMS[id].suffixes]
  if (!pool) return id
  let roll = random() * pool.reduce((sum, [, chance]) => sum + chance, 0)
  for (const [suffixId, chance] of pool) {
    if (roll < chance) return `${id}:${suffixId}`
    roll -= chance
  }
  return `${id}:${pool.at(-1)[0]}`
}

export const getQuest = (id) => (Object.hasOwn(QUESTS, id) ? QUESTS[id] : undefined)

export const QUALITIES = ['poor', 'common', 'uncommon', 'rare', 'epic']

// Paper-doll slots in Classic character-sheet order.
export const SLOTS = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulder', back: 'Back', chest: 'Chest', shirt: 'Shirt', tabard: 'Tabard', wrist: 'Wrist',
  hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet', finger1: 'Finger', finger2: 'Finger', trinket1: 'Trinket', trinket2: 'Trinket',
  mainHand: 'Main Hand', offHand: 'Off Hand', ranged: 'Ranged',
}

// InventoryType -> tooltip slot name.
export const INVENTORY_TYPES = {
  1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
  11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Off Hand', 15: 'Ranged', 16: 'Back', 17: 'Two-Hand', 19: 'Tabard',
  20: 'Chest', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 25: 'Thrown', 26: 'Ranged',
}
const ARMOR_TYPES = { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield' }
const WEAPON_TYPES = {
  0: 'Axe', 1: 'Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: 'Mace', 6: 'Polearm', 7: 'Sword', 8: 'Sword', 10: 'Staff',
  13: 'Fist Weapon', 14: 'Miscellaneous', 15: 'Dagger', 16: 'Thrown', 17: 'Spear', 18: 'Crossbow', 19: 'Wand',
}
export function itemTypeName(item) {
  if (item.class === 2) return WEAPON_TYPES[item.subclass] ?? ''
  if (item.class === 4 && item.slot !== 16) return ARMOR_TYPES[item.subclass] ?? ''
  return ''
}

const SLOTS_BY_INVENTORY_TYPE = {
  1: ['head'], 2: ['neck'], 3: ['shoulder'], 4: ['shirt'], 5: ['chest'], 20: ['chest'], 6: ['waist'], 7: ['legs'], 8: ['feet'],
  9: ['wrist'], 10: ['hands'], 11: ['finger1', 'finger2'], 12: ['trinket1', 'trinket2'], 16: ['back'], 19: ['tabard'],
  13: ['mainHand', 'offHand'], 21: ['mainHand'], 17: ['mainHand'], 14: ['offHand'], 22: ['offHand'], 23: ['offHand'],
  15: ['ranged'], 25: ['ranged'], 26: ['ranged'],
}
export const fitsSlot = (item, slot) => SLOTS_BY_INVENTORY_TYPE[item.slot]?.includes(slot) ?? false
export const isTwoHand = (item) => item?.slot === 17

export const CLASS_BITS = { Warrior: 1, Paladin: 2, Hunter: 4, Rogue: 8, Priest: 16, Shaman: 64, Mage: 128, Warlock: 256, Druid: 1024 }
export const RACE_BITS = { 'Human': 1, 'Orc': 2, 'Dwarf': 4, 'Night Elf': 8, 'Undead': 16, 'Tauren': 32, 'Gnome': 64, 'Troll': 128 }

// Weapon subclasses each class can train in Classic.
const WEAPON_SKILLS = {
  Warrior: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18],
  Paladin: [0, 1, 4, 5, 6, 7, 8],
  Hunter: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  Rogue: [2, 3, 4, 7, 13, 15, 16, 18],
  Priest: [4, 10, 15, 19],
  Shaman: [0, 1, 4, 5, 10, 13, 15],
  Mage: [7, 10, 15, 19],
  Warlock: [7, 10, 15, 19],
  Druid: [4, 5, 10, 13, 15],
}
// Armor: [subclass, level learned]. Cloth (1) and Miscellaneous (0) are for everyone.
const ARMOR_SKILLS = {
  Warrior: [[2, 1], [3, 1], [4, 40], [6, 1]],
  Paladin: [[2, 1], [3, 1], [4, 40], [6, 1]],
  Hunter: [[2, 1], [3, 40]],
  Rogue: [[2, 1]],
  Shaman: [[2, 1], [3, 40], [6, 1]],
  Druid: [[2, 1]],
  Priest: [], Mage: [], Warlock: [],
}
const DUAL_WIELD_LEVEL = { Rogue: 10, Warrior: 20, Hunter: 20 }
export const PARRY_LEVEL = { Warrior: 6, Paladin: 8, Hunter: 8, Rogue: 12 }
export const canBlock = (characterClass) => ['Warrior', 'Paladin', 'Shaman'].includes(characterClass)
export const canDualWield = (c) => c.characterLevel >= (DUAL_WIELD_LEVEL[c.characterClass] ?? Infinity)

// Whether the character's class/race could ever use the item (ignores level requirements).
export function canEverUse(character, item) {
  const cls = character.characterClass
  if (item.classes && !(item.classes & CLASS_BITS[cls])) return false
  if (item.races && !(item.races & RACE_BITS[character.characterRace])) return false
  if (item.class === 2 && !WEAPON_SKILLS[cls].includes(item.subclass)) return false
  if (item.class === 4 && item.subclass > 1 && !ARMOR_SKILLS[cls].some(([sub]) => sub === item.subclass)) return false
  if (item.slot === 22 && !DUAL_WIELD_LEVEL[cls]) return false
  return true
}

// Level at which the character can first equip the item (Infinity if never).
export function levelToUse(character, item) {
  if (!canEverUse(character, item)) return Infinity
  let level = item.requiredLevel ?? 1
  const armor = ARMOR_SKILLS[character.characterClass].find(([sub]) => sub === item.subclass)
  if (item.class === 4 && armor) level = Math.max(level, armor[1])
  if (item.slot === 22) level = Math.max(level, DUAL_WIELD_LEVEL[character.characterClass])
  return level
}
export const canUseNow = (character, item) => levelToUse(character, item) <= character.characterLevel

// ---- Valuing gear for a spec ----
// Rough per-point stat weights by playstyle, used only to decide what a character puts on.
const PROFILES = {
  tank: { sta: 1.5, armor: 0.1, defense: 1.5, dodge: 15, parry: 12, block: 6, blockValue: 0.5, str: 0.8, agi: 1, attackPower: 0.3, hit: 5, health: 0.1, mainHandDps: 3, offHandDps: 1, rangedDps: 0.3 },
  melee: { str: 2, agi: 1.5, attackPower: 1, crit: 20, hit: 15, sta: 0.5, armor: 0.02, int: 0.1, mainHandDps: 14, offHandDps: 6, rangedDps: 0.5 },
  ranged: { agi: 2, rangedAttackPower: 1, attackPower: 0.3, crit: 20, hit: 15, sta: 0.5, int: 0.3, str: 0.1, armor: 0.02, rangedDps: 14, mainHandDps: 1, offHandDps: 0.5 },
  caster: { int: 0.9, spellDamage: 1.2, spellCrit: 12, spellHit: 12, sta: 0.5, spi: 0.3, mp5: 1, armor: 0.01, rangedDps: 0.5 },
  healer: { int: 1, healing: 1, mp5: 2, spi: 0.8, sta: 0.4, spellCrit: 8, armor: 0.01, rangedDps: 0.2 },
}
const CASTER_SCHOOLS = {
  Mage: ['fire', 'frost', 'arcane'], Warlock: ['shadow', 'fire'], Priest: ['shadow'], Shaman: ['nature', 'fire'], Druid: ['nature', 'arcane'],
}

export function profileOf(character) {
  const { characterClass: cls, characterSpec: spec, characterRole: role } = character
  if (role === 'Tank') return 'tank'
  if (role === 'Healer') return 'healer'
  if (cls === 'Hunter') return 'ranged'
  if (['Mage', 'Warlock'].includes(cls) || ['Shadow', 'Elemental', 'Balance'].includes(spec)) return 'caster'
  return 'melee'
}

function itemDps(item) {
  if (!item.damage) return 0
  const [min, max] = item.damage.reduce(([a, b], [lo, hi]) => [a + lo, b + hi], [0, 0])
  return (min + max) / 2 / item.speed
}

// Value of `item` worn in `slot` for this character's spec. Higher is better; empty slots are worth 0.
export function itemScore(character, item, slot) {
  if (!item) return 0
  const profile = profileOf(character)
  const w = PROFILES[profile]
  let score = 0
  for (const [stat, value] of Object.entries(item.stats ?? {})) score += (w[stat] ?? 0) * value
  for (const [key, value] of Object.entries(item.bonus ?? {})) {
    let weight = w[key] ?? 0
    if (key.endsWith('Damage') && key !== 'spellDamage' && profile === 'caster') {
      weight = CASTER_SCHOOLS[character.characterClass]?.includes(key.replace('Damage', '')) ? w.spellDamage * 0.8 : 0
    }
    score += weight * value
  }
  score += (w.armor ?? 0) * (item.armor ?? 0)
  if (item.block && canBlock(character.characterClass)) score += (w.blockValue ?? 0) * item.block
  const dps = itemDps(item)
  if (dps) {
    const isWand = item.class === 2 && item.subclass === 19
    const dpsWeight = slot === 'ranged' ? w.rangedDps : slot === 'offHand' ? w.offHandDps : w.mainHandDps
    score += dps * (dpsWeight ?? 0) * (isWand && profile !== 'caster' && profile !== 'healer' ? 0 : 1)
  }
  // A tiny tie-breaker so better-quality, higher-level items win when stats are equal.
  return score + item.itemLevel * 0.01 + item.quality * 0.001
}

// Picks the best set of usable items from `owned` (item ids). Returns { equipment: {slot: id}, leftovers: [id] }.
export function bestLoadout(character, owned) {
  const pool = owned.map((id) => ({ id, item: getItem(id) })).filter(({ item }) => item && canUseNow(character, item))
  const unused = new Set(pool.map((_, i) => i))
  const equipment = {}
  const take = (slot, filter) => {
    let best = -1
    let bestScore = -Infinity
    for (const i of unused) {
      const { item } = pool[i]
      if (!fitsSlot(item, slot) || (filter && !filter(pool[i]))) continue
      const score = itemScore(character, item, slot)
      if (score > bestScore) {
        best = i
        bestScore = score
      }
    }
    if (best === -1) return null
    unused.delete(best)
    equipment[slot] = pool[best].id
    return pool[best]
  }

  for (const slot of ['head', 'neck', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist', 'hands', 'waist', 'legs', 'feet', 'ranged']) take(slot)
  for (const pair of [['finger1', 'finger2'], ['trinket1', 'trinket2']]) {
    const first = take(pair[0])
    take(pair[1], (entry) => !(first?.item.unique && baseId(first.id) === baseId(entry.id)))
  }

  // Weapons: compare the best two-hander against the best one-hand + off-hand pair.
  const dualWield = canDualWield(character)
  const candidates = [...unused].map((i) => pool[i])
  const score = (entry, slot) => (entry ? itemScore(character, entry.item, slot) : 0)
  const bestFor = (slot, filter, exclude) => candidates
    .filter((e) => e !== exclude && fitsSlot(e.item, slot) && filter(e.item) && (slot !== 'offHand' || e.item.slot !== 13 || dualWield))
    .reduce((best, e) => (score(e, slot) > score(best, slot) ? e : best), null)
  const twoHand = bestFor('mainHand', isTwoHand)
  const mainHand = bestFor('mainHand', (item) => !isTwoHand(item))
  const offHand = bestFor('offHand', () => true, mainHand)
  if (twoHand && score(twoHand, 'mainHand') > score(mainHand, 'mainHand') + score(offHand, 'offHand')) {
    equipment.mainHand = twoHand.id
  } else {
    if (mainHand) equipment.mainHand = mainHand.id
    if (offHand) equipment.offHand = offHand.id
  }

  const used = Object.values(equipment)
  const leftovers = [...owned]
  for (const id of used) leftovers.splice(leftovers.indexOf(id), 1)
  return { equipment, leftovers }
}

// Every spec and role the class can play, e.g. Feral Combat as both Tank and DPS.
export const specOptions = (characterClass) => Object.entries(Object.hasOwn(CLASSES, characterClass) ? CLASSES[characterClass].specs : {})
  .flatMap(([spec, roles]) => roles.map((role) => ({ spec, role, label: roles.length > 1 ? `${spec} (${role})` : spec })))

// The best gear in `owned` for the character's other specs: { item id: [spec labels] } for each item another
// spec's best set would wear. Specs that value gear the same way as the character's own are skipped.
export function offSpecGear(character, owned) {
  const own = profileOf(character)
  const sets = new Map() // profile -> worn ids
  const kept = new Map()
  for (const option of specOptions(character.characterClass)) {
    const as = { ...pick(character), characterSpec: option.spec, characterRole: option.role }
    const profile = profileOf(as)
    if (profile === own) continue
    if (!sets.has(profile)) sets.set(profile, new Set(Object.values(bestLoadout(as, owned).equipment)))
    for (const id of sets.get(profile)) kept.set(id, [...(kept.get(id) ?? []), option.label])
  }
  return kept
}
const pick = ({ characterClass, characterRace, characterLevel }) => ({ characterClass, characterRace, characterLevel })

// ---- Loot ----
function rollLootList(entries, out, random) {
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const [id, chance, rolls = 1] = entry
      for (let r = 0; r < rolls; r++) {
        if (random() * 100 >= chance) continue
        if (id > 0) out.push(rollSuffix(id, random))
        else rollLootList(LOOT_REFS[-id], out, random)
      }
    } else {
      let roll = random() * 100
      for (const [id, chance] of entry.group) {
        if (roll < chance) {
          if (id > 0) out.push(rollSuffix(id, random))
          else rollLootList(LOOT_REFS[-id], out, random)
          break
        }
        roll -= chance
      }
    }
  }
}

// Gear item ids dropped by one kill of mob `entry`.
export function rollMobLoot(entry, random = Math.random) {
  const drops = []
  const lootId = MOBS[entry]?.loot
  if (lootId && Object.hasOwn(LOOT, lootId)) rollLootList(LOOT[lootId], drops, random)
  return drops
}

// ---- Quests ----
// Gear a quest gives this character: every usable fixed reward plus its pick of the choices.
export function questRewardsFor(character, quest) {
  const usable = (id) => levelToUse(character, getItem(id)) < Infinity
  const rewards = (quest.reward ?? []).filter(usable)
  const choices = (quest.choice ?? []).filter(usable)
  if (choices.length) {
    const value = (id) => {
      const item = getItem(id)
      return Math.max(...SLOTS_BY_INVENTORY_TYPE[item.slot].map((slot) => itemScore(character, item, slot)))
    }
    rewards.push(choices.reduce((best, id) => (value(id) > value(best) ? id : best)))
  }
  return rewards
}
