// Classic (1.12) character stats from base stats, level, race and worn gear. Formulas follow CMaNGOS
// StatSystem.cpp / Player.cpp / Unit.cpp. Talents and buffs aren't modeled.
import { BASE_HEALTH_MANA, BASE_STATS, PARRY_LEVEL, canBlock, getItem } from './gear.js'

export const STAT_NAMES = { str: 'Strength', agi: 'Agility', sta: 'Stamina', int: 'Intellect', spi: 'Spirit' }
export const SCHOOLS = ['arcane', 'fire', 'nature', 'frost', 'shadow']

// Racial passives that show on the character sheet.
const RACIALS = {
  'Human': { spiPct: 5, skills: { 43: 5, 55: 5, 54: 5, 160: 5 } },
  'Orc': { skills: { 44: 5, 172: 5 } },
  'Dwarf': { resist: { frost: 10 }, skills: { 46: 5 } },
  'Night Elf': { resist: { nature: 10 }, dodge: 1 },
  'Undead': { resist: { shadow: 10 } },
  'Tauren': { resist: { nature: 10 }, healthPct: 5 },
  'Gnome': { resist: { arcane: 10 }, intPct: 5 },
  'Troll': { skills: { 45: 5, 176: 5 } },
}

// Weapon subclass -> weapon skill id.
const WEAPON_SKILL = { 0: 44, 1: 172, 2: 45, 3: 46, 4: 54, 5: 160, 6: 229, 7: 43, 8: 55, 10: 136, 13: 473, 15: 173, 16: 176, 18: 226 }

// [level 1, level 60] agility per 1% melee crit and per 1% dodge, interpolated by level.
const CRIT_PER_AGI = {
  Paladin: [4.6, 20], Shaman: [4.6, 20], Druid: [4.6, 20], Mage: [12.9, 20], Rogue: [2.2, 29],
  Hunter: [3.5, 53], Priest: [11, 20], Warlock: [8.4, 20], Warrior: [3.9, 20],
}
const DODGE_PER_AGI = { ...CRIT_PER_AGI, Rogue: [1.1, 14.5], Hunter: [1.8, 26.5] }
const BASE_DODGE = { Warrior: 0, Paladin: 0.75, Hunter: 0.64, Rogue: 0, Priest: 3, Shaman: 1.75, Mage: 3.25, Warlock: 2, Druid: 0.75 }
// Spell crit = base + Int / (rate0 + rate1 * level)
const SPELL_CRIT = {
  Paladin: [3.7, 14.77, 0.65], Priest: [2.97, 10.03, 0.82], Shaman: [3.54, 11.51, 0.8],
  Mage: [3.7, 14.77, 0.65], Warlock: [3.18, 11.3, 0.82], Druid: [3.33, 12.41, 0.79],
}
const BASE_ATTACK_TIME = 2
const UNARMED_DAMAGE = [1, 2]

const perLevel = ([at1, at60], level) => (at1 * (60 - level)) / 59 + (at60 * (level - 1)) / 59
const healthFromStamina = (sta) => Math.min(sta, 20) + Math.max(0, sta - 20) * 10
const manaFromIntellect = (int) => Math.min(int, 20) + Math.max(0, int - 20) * 15

function meleeAttackPower(cls, level, str, agi) {
  switch (cls) {
    case 'Warrior': case 'Paladin': case 'Druid': return level * 3 + str * 2 - 20
    case 'Rogue': case 'Hunter': return level * 2 + str + agi - 20
    case 'Shaman': return level * 2 + str * 2 - 20
    default: return str - 10
  }
}
function rangedAttackPower(cls, level, agi) {
  switch (cls) {
    case 'Hunter': return level * 2 + agi * 2 - 10
    case 'Rogue': case 'Warrior': return level + agi - 10
    default: return agi - 10
  }
}
function manaRegenPerSecond(cls, spi) {
  switch (cls) {
    case 'Druid': case 'Hunter': case 'Paladin': case 'Warlock': return (spi / 5 + 15) / 2
    case 'Mage': case 'Priest': return (spi / 4 + 12.5) / 2
    case 'Shaman': return (spi / 5 + 17) / 2
    default: return 0
  }
}

export function equippedItems(character) {
  return Object.entries(character.equipment)
    .map(([slot, id]) => [slot, getItem(id)])
    .filter(([, item]) => item)
}

// All sheet values for the character. Percentages are in percent (e.g. 5.2 = 5.2%).
export function characterStats(character) {
  const { characterClass: cls, characterRace: race, characterLevel: level } = character
  const racial = RACIALS[race] ?? {}
  const worn = Object.fromEntries(equippedItems(character))

  const gear = { str: 0, agi: 0, sta: 0, int: 0, spi: 0, health: 0, mana: 0, armor: 0 }
  const bonus = {}
  const resist = Object.fromEntries(SCHOOLS.map((s) => [s, racial.resist?.[s] ?? 0]))
  for (const item of Object.values(worn)) {
    for (const [key, value] of Object.entries(item.stats ?? {})) gear[key] += value
    gear.armor += item.armor ?? 0
    for (const [school, value] of Object.entries(item.resist ?? {})) if (school in resist) resist[school] += value
    for (const [key, value] of Object.entries(item.bonus ?? {})) bonus[key] = (bonus[key] ?? 0) + value
  }
  for (const key of ['str', 'agi', 'sta', 'int', 'spi', 'health', 'armor']) gear[key] += bonus[key] ?? 0
  for (const school of SCHOOLS) resist[school] += bonus[`${school}Resistance`] ?? 0

  const base = BASE_STATS[race][cls][level - 1]
  const pct = { int: racial.intPct ?? 0, spi: racial.spiPct ?? 0 }
  const stats = {}
  for (const [i, key] of ['str', 'agi', 'sta', 'int', 'spi'].entries()) {
    stats[key] = { base: base[i], total: Math.trunc((base[i] + gear[key]) * (1 + (pct[key] ?? 0) / 100)) }
  }
  const { str, agi, sta, int, spi } = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.total]))

  const [baseHealth, baseMana] = BASE_HEALTH_MANA[cls][level - 1]
  const health = Math.trunc((baseHealth + gear.health + healthFromStamina(sta)) * (1 + (racial.healthPct ?? 0) / 100))
  const mana = baseMana > 0 ? baseMana + gear.mana + manaFromIntellect(int) : 0
  const armor = gear.armor + agi * 2

  const skillBonus = (item) => {
    const skill = item?.class === 2 ? WEAPON_SKILL[item.subclass] : undefined
    return skill ? (bonus[`skill${skill}`] ?? 0) + (racial.skills?.[skill] ?? 0) : 0
  }
  const attackPower = Math.max(0, Math.trunc(meleeAttackPower(cls, level, str, agi))) + (bonus.attackPower ?? 0)
  const rangedPower = Math.max(0, Math.trunc(rangedAttackPower(cls, level, agi))) + (bonus.rangedAttackPower ?? 0)
  const agiCrit = agi / perLevel(CRIT_PER_AGI[cls], level)

  const weaponDamage = (item, power, scale = 1) => {
    const speed = item?.speed ?? BASE_ATTACK_TIME
    const [min, max] = item?.damage?.[0] ?? UNARMED_DAMAGE
    const fromPower = (power / 14) * speed
    return { min: (min + fromPower) * scale, max: (max + fromPower) * scale, speed }
  }
  const mainHand = worn.mainHand
  const offHand = worn.offHand?.class === 2 ? worn.offHand : undefined
  const melee = {
    mainHand: weaponDamage(mainHand?.class === 2 ? mainHand : undefined, attackPower),
    offHand: offHand && weaponDamage(offHand, attackPower, 0.5),
    attackPower,
    crit: agiCrit + (bonus.crit ?? 0) + skillBonus(mainHand) * 0.04,
    hit: bonus.hit ?? 0,
  }
  melee.dps = [melee.mainHand, melee.offHand].filter(Boolean).reduce((sum, d) => sum + (d.min + d.max) / 2 / d.speed, 0)

  const rangedItem = worn.ranged
  const isWand = rangedItem?.subclass === 19
  let ranged = null
  if (rangedItem?.damage) {
    const damage = weaponDamage(rangedItem, isWand ? 0 : rangedPower)
    ranged = {
      ...damage,
      dps: (damage.min + damage.max) / 2 / damage.speed,
      attackPower: rangedPower,
      crit: agiCrit + (bonus.crit ?? 0) + skillBonus(rangedItem) * 0.04,
      isWand,
    }
  }

  const defense = level * 5 + (bonus.defense ?? 0)
  const fromDefense = (bonus.defense ?? 0) * 0.04
  const shield = worn.offHand?.class === 4 && worn.offHand.subclass === 6 ? worn.offHand : undefined
  const blocks = shield && canBlock(cls)
  const defenses = {
    armor,
    defense,
    dodge: BASE_DODGE[cls] + agi / perLevel(DODGE_PER_AGI[cls], level) + (bonus.dodge ?? 0) + (racial.dodge ?? 0) + fromDefense,
    parry: level >= (PARRY_LEVEL[cls] ?? Infinity) ? 5 + (bonus.parry ?? 0) + fromDefense : 0,
    block: blocks ? 5 + (bonus.block ?? 0) + fromDefense : 0,
    blockValue: blocks ? Math.max(0, Math.trunc((shield.block ?? 0) + (bonus.blockValue ?? 0) + str / 20 - 1)) : 0,
  }

  const [critBase, rate0, rate1] = SPELL_CRIT[cls] ?? [0, 0, 10]
  const spell = {
    damage: bonus.spellDamage ?? 0,
    schoolDamage: Object.fromEntries(SCHOOLS.map((s) => [s, bonus[`${s}Damage`] ?? 0]).filter(([, v]) => v)),
    healing: bonus.healing ?? 0,
    crit: (SPELL_CRIT[cls] ? critBase + int / (rate0 + rate1 * level) : 0) + (bonus.spellCrit ?? 0),
    hit: bonus.spellHit ?? 0,
    regen: manaRegenPerSecond(cls, spi) * 5,
    mp5: bonus.mp5 ?? 0,
  }

  return { stats, health, mana, melee, ranged, defenses, spell, resist, hp5: bonus.hp5 ?? 0 }
}
