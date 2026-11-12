export const FACTIONS = ['Alliance', 'Horde']

export const ROLES = ['Tank', 'Healer', 'DPS']

export const MIN_LEVEL = 1
export const MAX_LEVEL = 60

export const NAME_PATTERN = /^[A-Za-z]{2,12}$/

// Race/class combinations in Classic (Paladins are Alliance-only, Shamans Horde-only).
export const RACES = {
  'Human': { faction: 'Alliance', classes: ['Warrior', 'Paladin', 'Rogue', 'Priest', 'Mage', 'Warlock'] },
  'Dwarf': { faction: 'Alliance', classes: ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest'] },
  'Night Elf': { faction: 'Alliance', classes: ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Druid'] },
  'Gnome': { faction: 'Alliance', classes: ['Warrior', 'Rogue', 'Mage', 'Warlock'] },
  'Orc': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Rogue', 'Shaman', 'Warlock'] },
  'Undead': { faction: 'Horde', classes: ['Warrior', 'Rogue', 'Priest', 'Mage', 'Warlock'] },
  'Tauren': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Shaman', 'Druid'] },
  'Troll': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage'] },
}

// Classic talent trees, with the raid roles each can fill.
export const CLASSES = {
  Druid: { color: '#FF7C0A', specs: { 'Balance': ['DPS'], 'Feral Combat': ['Tank', 'DPS'], 'Restoration': ['Healer'] } },
  Hunter: { color: '#AAD372', specs: { 'Beast Mastery': ['DPS'], 'Marksmanship': ['DPS'], 'Survival': ['DPS'] } },
  Mage: { color: '#3FC7EB', specs: { 'Arcane': ['DPS'], 'Fire': ['DPS'], 'Frost': ['DPS'] } },
  Paladin: { color: '#F48CBA', specs: { 'Holy': ['Healer'], 'Protection': ['Tank'], 'Retribution': ['DPS'] } },
  Priest: { color: '#FFFFFF', specs: { 'Discipline': ['Healer'], 'Holy': ['Healer'], 'Shadow': ['DPS'] } },
  Rogue: { color: '#FFF468', specs: { 'Assassination': ['DPS'], 'Combat': ['DPS'], 'Subtlety': ['DPS'] } },
  Shaman: { color: '#0070DD', specs: { 'Elemental': ['DPS'], 'Enhancement': ['DPS'], 'Restoration': ['Healer'] } },
  Warlock: { color: '#8788EE', specs: { 'Affliction': ['DPS'], 'Demonology': ['DPS'], 'Destruction': ['DPS'] } },
  Warrior: { color: '#C69B6D', specs: { 'Arms': ['DPS'], 'Fury': ['DPS'], 'Protection': ['Tank'] } },
}

for (const cls of Object.values(CLASSES)) {
  cls.roles = ROLES.filter((role) => Object.values(cls.specs).some((roles) => roles.includes(role)))
}

// First spec of the class that can fill the role; used to upgrade data saved before specs existed.
export function defaultSpec(characterClass, characterRole) {
  const specs = Object.hasOwn(CLASSES, characterClass) ? CLASSES[characterClass].specs : {}
  return Object.keys(specs).find((spec) => specs[spec].includes(characterRole)) ?? ''
}

export const classIcon = (characterClass) => `icons/${characterClass.toLowerCase()}.jpg`

// XP needed to go from each level to the next (Classic values, levels 1-59).
const XP_TO_LEVEL = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600,
  8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200,
  25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400,
  50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700,
  95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500,
  153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800,
]

// Returns 0 at max level.
export const xpToNextLevel = (level) => (level >= MIN_LEVEL && level < MAX_LEVEL ? XP_TO_LEVEL[level - 1] : 0)
