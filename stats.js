// Classic (1.12) character stats from base stats, level, race, worn gear and passive talents. Formulas
// follow CMaNGOS StatSystem.cpp / Player.cpp / Unit.cpp. Buffs are up to the caller.
import { BASE_HEALTH_MANA, BASE_STATS, PARRY_LEVEL, canBlock, getItem } from './gear.js'
import { talentEffects } from './talents.js'

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
// Out-of-combat health regen from spirit (CMaNGOS OCTRegenHPPerSpirit, per 2-second tick).
function healthRegenPerSecond(cls, spi) {
  const perTick = {
    Druid: spi * 0.11 + 1, Hunter: spi * 0.43 - 5.5, Mage: spi * 0.11 + 1, Paladin: spi * 0.25, Priest: spi * 0.15 + 1.4,
    Rogue: spi * 0.84 - 13, Shaman: spi * 0.28 - 3.6, Warlock: spi * 0.12 + 1.5, Warrior: spi * 1.26 - 22.6,
  }[cls] ?? 0
  return Math.max(0, perTick) / 2
}

export function equippedItems(character) {
  return Object.entries(character.equipment)
    .map(([slot, id]) => [slot, getItem(id)])
    .filter(([, item]) => item)
}

// All sheet values for the character. Percentages are in percent (e.g. 5.2 = 5.2%). `buffs` adds flat amounts
// from the character's own buffs: str, agi, sta, int, spi, armor, attackPower, rangedAttackPower.
export function characterStats(character, buffs = {}) {
  const { characterClass: cls, characterRace: race, characterLevel: level } = character
  const racial = RACIALS[race] ?? {}
  const worn = Object.fromEntries(equippedItems(character))

  // Passive talent auras (see talentEffects). Ones limited to a weapon type count when it's worn; ones
  // limited to shapeshift forms only count in the sim's forms (formCrit).
  const auras = talentEffects(character).auras
  const fits = (a, item) => !a.item || (item?.class === a.item[0] && (a.item[1] & (1 << item.subclass)) !== 0)
  const talent = (aura, filter = () => true) => auras.filter((a) => a.aura === aura && !a.forms && filter(a))
  const sum = (list) => list.reduce((total, a) => total + a.value, 0)
  const product = (list) => list.reduce((total, a) => total * (1 + a.value / 100), 1)
  const bySchool = (aura) => {
    const out = {}
    for (const a of talent(aura)) for (let school = 1; school < 7; school++) if (a.misc & (1 << school)) out[school] = (out[school] ?? 0) + a.value
    return out
  }

  const gear = { str: 0, agi: 0, sta: 0, int: 0, spi: 0, health: 0, mana: 0, armor: 0 }
  const bonus = {}
  const resist = Object.fromEntries(SCHOOLS.map((s) => [s, racial.resist?.[s] ?? 0]))
  for (const item of Object.values(worn)) {
    for (const [key, value] of Object.entries(item.stats ?? {})) gear[key] += value
    gear.armor += item.armor ?? 0
    for (const [school, value] of Object.entries(item.resist ?? {})) if (school in resist) resist[school] += value
    for (const [key, value] of Object.entries(item.bonus ?? {})) bonus[key] = (bonus[key] ?? 0) + value
  }
  for (const key of ['str', 'agi', 'sta', 'int', 'spi', 'health', 'armor']) gear[key] += (bonus[key] ?? 0) + (buffs[key] ?? 0)
  for (const school of SCHOOLS) resist[school] += bonus[`${school}Resistance`] ?? 0
  for (const a of [...talent(98), ...talent(30)]) {
    const key = a.misc === 95 ? 'defense' : `skill${a.misc}`
    bonus[key] = (bonus[key] ?? 0) + a.value
  }

  const base = BASE_STATS[race][cls][level - 1]
  const pct = { int: racial.intPct ?? 0, spi: racial.spiPct ?? 0 }
  const statKeys = ['str', 'agi', 'sta', 'int', 'spi']
  for (const a of talent(137)) for (const [i, key] of statKeys.entries()) if (a.misc === -1 || a.misc === i) pct[key] = (pct[key] ?? 0) + a.value
  const stats = {}
  for (const [i, key] of statKeys.entries()) {
    stats[key] = { base: base[i], total: Math.trunc((base[i] + gear[key]) * (1 + (pct[key] ?? 0) / 100)) }
  }
  const { str, agi, sta, int, spi } = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.total]))

  const [baseHealth, baseMana] = BASE_HEALTH_MANA[cls][level - 1]
  const health = Math.trunc((baseHealth + gear.health + healthFromStamina(sta)) * (1 + (racial.healthPct ?? 0) / 100) * product(talent(133)))
  const mana = baseMana > 0 ? Math.trunc((baseMana + gear.mana + manaFromIntellect(int)) * product(talent(132))) : 0
  const armor = Math.trunc(gear.armor * product(talent(142)) + agi * 2 + (int * sum(talent(182))) / 100)

  const skillBonus = (item) => {
    const skill = item?.class === 2 ? WEAPON_SKILL[item.subclass] : undefined
    return skill ? (bonus[`skill${skill}`] ?? 0) + (racial.skills?.[skill] ?? 0) : 0
  }
  const powerPct = product(talent(166))
  const attackPower = (Math.max(0, Math.trunc(meleeAttackPower(cls, level, str, agi))) + (bonus.attackPower ?? 0) + (buffs.attackPower ?? 0)) * powerPct
  const rangedPower = (Math.max(0, Math.trunc(rangedAttackPower(cls, level, agi))) + (bonus.rangedAttackPower ?? 0) + (buffs.rangedAttackPower ?? 0)) * powerPct
  const agiCrit = agi / perLevel(CRIT_PER_AGI[cls], level)
  const anyCrit = sum(talent(52, (a) => !a.item))
  const anyHit = sum(talent(54, (a) => !a.item))
  const physical = (item) => product(talent(79, (a) => (a.misc & 1) !== 0 && fits(a, item)))

  const weaponDamage = (item, power, scale = 1) => {
    const speed = item?.speed ?? BASE_ATTACK_TIME
    const [min, max] = item?.damage?.[0] ?? UNARMED_DAMAGE
    const fromPower = (power / 14) * speed
    return { min: (min + fromPower) * scale, max: (max + fromPower) * scale, speed, base: [min, max], school: item?.damage?.[0]?.[2] ?? 0, subclass: item?.subclass }
  }
  const mainHand = worn.mainHand
  const offHand = worn.offHand?.class === 2 ? worn.offHand : undefined
  const weapon = mainHand?.class === 2 ? mainHand : undefined
  const melee = {
    mainHand: weaponDamage(weapon, attackPower),
    offHand: offHand && weaponDamage(offHand, attackPower, 0.5 * product(talent(122))),
    attackPower,
    crit: agiCrit + (bonus.crit ?? 0) + skillBonus(mainHand) * 0.04 + sum(talent(52, (a) => fits(a, weapon))),
    baseCrit: agiCrit + (bonus.crit ?? 0) + anyCrit,
    formCrit: sum(auras.filter((a) => a.aura === 52 && a.forms)), // extra crit in druid forms
    skill: level * 5 + skillBonus(mainHand),
    twoHand: mainHand?.slot === 17,
    hit: (bonus.hit ?? 0) + sum(talent(54, (a) => fits(a, weapon))),
    damageMult: physical(weapon), // physical damage done with the worn weapon
    formDamageMult: product(talent(79, (a) => (a.misc & 1) !== 0 && !a.item)),
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
      crit: agiCrit + (bonus.crit ?? 0) + skillBonus(rangedItem) * 0.04 + sum(talent(52, (a) => fits(a, rangedItem))),
      baseCrit: agiCrit + (bonus.crit ?? 0) + anyCrit,
      skill: level * 5 + skillBonus(rangedItem),
      hit: (bonus.hit ?? 0) + sum(talent(54, (a) => fits(a, rangedItem))),
      damageMult: isWand ? product(talent(79, (a) => (a.misc & (1 << damage.school)) !== 0 && fits(a, rangedItem))) : physical(rangedItem),
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
    dodge: BASE_DODGE[cls] + agi / perLevel(DODGE_PER_AGI[cls], level) + (bonus.dodge ?? 0) + (racial.dodge ?? 0) + fromDefense + sum(talent(49)),
    parry: level >= (PARRY_LEVEL[cls] ?? Infinity) ? 5 + (bonus.parry ?? 0) + fromDefense + sum(talent(47)) : 0,
    block: blocks ? 5 + (bonus.block ?? 0) + fromDefense + sum(talent(51)) : 0,
    blockValue: blocks ? Math.max(0, Math.trunc(((shield.block ?? 0) + (bonus.blockValue ?? 0) + str / 20 - 1) * product(talent(150)))) : 0,
  }

  const [critBase, rate0, rate1] = SPELL_CRIT[cls] ?? [0, 0, 10]
  const spell = {
    damage: (bonus.spellDamage ?? 0) + Math.trunc((spi * sum(talent(174))) / 100),
    schoolDamage: Object.fromEntries(SCHOOLS.map((s) => [s, bonus[`${s}Damage`] ?? 0]).filter(([, v]) => v)),
    healing: (bonus.healing ?? 0) + Math.trunc((spi * sum(talent(175))) / 100),
    crit: (SPELL_CRIT[cls] ? critBase + int / (rate0 + rate1 * level) : 0) + (bonus.spellCrit ?? 0) + sum(talent(57)),
    schoolCrit: bySchool(71), // { school index: extra crit }
    hit: bonus.spellHit ?? 0,
    schoolHit: bySchool(55),
    regen: manaRegenPerSecond(cls, spi) * 5,
    castingRegen: sum(talent(134)), // % of regen kept while casting
    mp5: bonus.mp5 ?? 0,
  }

  const energy = 100 + sum(talent(35, (a) => a.misc === 3))
  return { stats, baseHealth, baseMana, health, mana, energy, melee, ranged, defenses, spell, resist, hp5: bonus.hp5 ?? 0, healthRegen: healthRegenPerSecond(cls, spi) * 5 }
}
