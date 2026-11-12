export const FACTIONS = ['Alliance', 'Horde']

export const ROLES = ['Tank', 'Healer', 'DPS']

export const MIN_LEVEL = 1
export const MAX_LEVEL = 70

export const NAME_PATTERN = /^[A-Za-z]{2,12}$/

// Race/class combinations as of The Burning Crusade.
export const RACES = {
  'Human': { faction: 'Alliance', classes: ['Warrior', 'Paladin', 'Rogue', 'Priest', 'Mage', 'Warlock'] },
  'Dwarf': { faction: 'Alliance', classes: ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest'] },
  'Night Elf': { faction: 'Alliance', classes: ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Druid'] },
  'Gnome': { faction: 'Alliance', classes: ['Warrior', 'Rogue', 'Mage', 'Warlock'] },
  'Draenei': { faction: 'Alliance', classes: ['Warrior', 'Paladin', 'Hunter', 'Priest', 'Shaman', 'Mage'] },
  'Orc': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Rogue', 'Shaman', 'Warlock'] },
  'Undead': { faction: 'Horde', classes: ['Warrior', 'Rogue', 'Priest', 'Mage', 'Warlock'] },
  'Tauren': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Shaman', 'Druid'] },
  'Troll': { faction: 'Horde', classes: ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage'] },
  'Blood Elf': { faction: 'Horde', classes: ['Paladin', 'Hunter', 'Rogue', 'Priest', 'Mage', 'Warlock'] },
}

// Specs (talent trees) as of The Burning Crusade, with the raid roles each can fill.
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
