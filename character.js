import { CLASSES, MAX_LEVEL, MIN_LEVEL, NAME_PATTERN, RACES, ROLES, classIcon, xpToNextLevel } from './data.js'
import { getZone, xpPerHour } from './zones.js'

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined)

export default class Character {
  constructor({ id = crypto.randomUUID(), characterName, characterClass, characterSpec, characterRace, characterRole, characterLevel = MIN_LEVEL, characterXp = 0, zone = null }) {
    this.id = id
    this.characterName = Character.formatName(characterName)
    this.characterClass = characterClass
    this.characterSpec = characterSpec
    this.characterRace = characterRace
    this.characterRole = characterRole
    this.characterLevel = Number(characterLevel)
    this.characterXp = characterXp // progress toward the next level
    this.zone = zone // name of the zone being farmed, or null when idle
  }

  get xpToNextLevel() {
    return xpToNextLevel(this.characterLevel)
  }

  get xpPerHour() {
    const zone = getZone(this.zone)
    return zone ? xpPerHour(this, zone) : 0
  }

  get copperPerHour() {
    return getZone(this.zone)?.copperPerHour ?? 0
  }

  // Hours until the next level at the current zone's rate, or Infinity if not gaining XP.
  get hoursToLevel() {
    const rate = this.xpPerHour
    return rate > 0 ? (this.xpToNextLevel - this.characterXp) / rate : Infinity
  }

  // Farms for `hours`, leveling up as XP fills (the XP rate is re-checked after each level).
  // Returns the copper earned and how many levels were gained.
  farm(hours) {
    const zone = getZone(this.zone)
    if (!zone || hours <= 0) return { copper: 0, levels: 0 }

    let remaining = hours
    let levels = 0
    while (remaining > 0 && this.characterLevel < MAX_LEVEL) {
      const rate = xpPerHour(this, zone)
      if (rate <= 0) break
      const hoursToLevel = (this.xpToNextLevel - this.characterXp) / rate
      if (hoursToLevel > remaining) {
        this.characterXp += rate * remaining
        break
      }
      remaining -= hoursToLevel
      this.characterLevel += 1
      this.characterXp = 0
      levels += 1
    }
    return { copper: zone.copperPerHour * hours, levels }
  }

  get faction() {
    return RACES[this.characterRace].faction
  }

  get classColor() {
    return CLASSES[this.characterClass].color
  }

  get classIcon() {
    return classIcon(this.characterClass)
  }

  static formatName(name) {
    const trimmed = String(name ?? '').trim()
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }

  // Returns { field: message } for each invalid field; empty object when valid.
  static validate({ characterName, characterRace, characterClass, characterSpec, characterRole, characterLevel }) {
    const errors = {}
    const race = lookup(RACES, characterRace)
    const cls = lookup(CLASSES, characterClass)
    const level = Number(characterLevel)

    if (!NAME_PATTERN.test(String(characterName ?? '').trim())) {
      errors.characterName = 'Name must be 2 to 12 letters (A to Z only).'
    }
    if (!race) errors.characterRace = 'Choose a race.'
    if (!cls) errors.characterClass = 'Choose a class.'
    else if (race && !race.classes.includes(characterClass)) {
      errors.characterClass = `${characterRace} can't be a ${characterClass}.`
    }
    if (!ROLES.includes(characterRole)) errors.characterRole = 'Choose a role.'
    else if (cls && !cls.roles.includes(characterRole)) {
      errors.characterRole = `${characterClass} can't fill the ${characterRole} role.`
    }
    if (cls) {
      const specRoles = lookup(cls.specs, characterSpec)
      if (!characterSpec) errors.characterSpec = 'Choose a spec.'
      else if (!specRoles) errors.characterSpec = `${characterClass} has no ${characterSpec} spec.`
      else if (!errors.characterRole && !specRoles.includes(characterRole)) {
        errors.characterSpec = `${characterSpec} ${characterClass} can't fill the ${characterRole} role.`
      }
    }
    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      errors.characterLevel = `Level must be a whole number from ${MIN_LEVEL} to ${MAX_LEVEL}.`
    }
    return errors
  }
}
