// Power: how strong a character is, from level, equipped gear, class and role.
//   power = (level power x LEVEL_SHARE + gear power) x class and role factors
// Gear power is the sum of what each worn item adds: its stats, weapon damage and armor, valued with the
// same spec weights used to pick gear (itemScore), times GEAR_POWER. Better items add more power at any level.
import { SLOTS, getItem, isTwoHand, itemScore, profileOf } from './gear.js'

// Raw power of a level, before gear and class. Grows faster than level, like Classic mob health.
export const levelPower = (level) => (level * (level + 20)) / 2

// Share of a level's power a character has with no gear: spells, talents and base stats.
// Melee lives and dies by its weapon; casters lean on their spells.
const LEVEL_SHARE = { melee: 0.4, tank: 0.4, ranged: 0.5, caster: 0.6, healer: 0.6 }
// Power per point of item score. Spec weights put item scores on different scales (a caster's spell damage
// scores far lower than a warrior's weapon DPS), so this evens them out: gear found while leveling makes
// up roughly the rest of a level's power.
const GEAR_POWER = { melee: 1.15, tank: 1.35, ranged: 1.55, caster: 3.6, healer: 3.6 }

// Solo: hunters and warlocks (pets) are the classic fast levelers; warriors have the most downtime.
// Tanks and healers kill slowly alone. In a group, they're what make it work.
const CLASS_SOLO = { Hunter: 1.15, Warlock: 1.15, Mage: 1.1, Druid: 1.05, Rogue: 1, Shaman: 1, Paladin: 0.95, Priest: 0.95, Warrior: 0.9 }
const ROLE_SOLO = { Tank: 0.75, Healer: 0.65, DPS: 1 }
const ROLE_PARTY = { Tank: 1.5, Healer: 1.5, DPS: 1 }

// Power the character's worn items add.
export function gearPower(character) {
  const score = Object.entries(character.equipment).reduce((sum, [slot, id]) => sum + itemScore(character, getItem(id), slot), 0)
  return score * GEAR_POWER[profileOf(character)]
}

// { solo, party }. Solo power ("power level" in the UI) decides farming speed; party power is for future
// dungeon and raid grouping.
export function characterPower(character) {
  const base = levelPower(character.characterLevel) * LEVEL_SHARE[profileOf(character)] + gearPower(character)
  return {
    solo: base * CLASS_SOLO[character.characterClass] * ROLE_SOLO[character.characterRole],
    party: base * ROLE_PARTY[character.characterRole],
  }
}

// Average item level of worn gear. Display only: it tells players how good their gear is and doesn't feed
// into power. Every slot but shirt and tabard counts, empty ones as 0; a two-hander counts for both hands.
const ITEM_LEVEL_SLOTS = Object.keys(SLOTS).filter((slot) => slot !== 'shirt' && slot !== 'tabard')
export function averageItemLevel(character) {
  const levelIn = (slot) => {
    const item = getItem(character.equipment[slot])
    if (item) return item.itemLevel
    const mainHand = getItem(character.equipment.mainHand)
    return slot === 'offHand' && mainHand && isTwoHand(mainHand) ? mainHand.itemLevel : 0
  }
  return ITEM_LEVEL_SLOTS.reduce((sum, slot) => sum + levelIn(slot), 0) / ITEM_LEVEL_SLOTS.length
}
