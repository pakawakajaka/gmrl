import { CLASSES, MAX_LEVEL, MIN_LEVEL, NAME_PATTERN, RACES, ROLES, classIcon, xpToNextLevel } from './data.js'
import { getZone, xpPerHour } from './zones.js'
import { KILLS_PER_HOUR, QUEST_HOURS, SLOTS, bestLoadout, getItem, getQuest, levelToUse, nextQuest, rollKills } from './gear.js'

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined)
const BAG_SIZE = 16
const LOG_SIZE = 20

export default class Character {
  constructor({ id = crypto.randomUUID(), characterName, characterClass, characterSpec, characterRace, characterRole, characterLevel = MIN_LEVEL, characterXp = 0, zone = null, equipment = {}, bag = [], questsDone = [], questProgress = 0, killProgress = 0, lootLog = [] }) {
    this.id = id
    this.characterName = Character.formatName(characterName)
    this.characterClass = characterClass
    this.characterSpec = characterSpec
    this.characterRace = characterRace
    this.characterRole = characterRole
    this.characterLevel = Number(characterLevel)
    this.characterXp = characterXp // progress toward the next level
    this.zone = zone // name of the zone being farmed, or null when idle
    this.equipment = equipment // { slot: itemId }
    this.bag = bag // item ids kept until the character is high enough level to wear them
    this.questsDone = questsDone // quest ids
    this.questProgress = questProgress // hours spent toward the next quest in the current zone
    this.killProgress = killProgress // fraction of the next kill
    this.lootLog = lootLog // newest first: { item, source, at, equipped }
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

  // The quest the character is working on in its current zone, if any.
  get currentQuest() {
    return this.zone ? nextQuest(this, this.zone, new Set(this.questsDone)) : undefined
  }

  // Farms for `hours`, leveling up as XP fills (the XP rate is re-checked after each level). Mobs drop
  // loot and zone quests complete at the level the character was when it happened.
  // Returns the copper earned, levels gained and newly equipped item ids.
  farm(hours, now = Date.now()) {
    const zone = getZone(this.zone)
    if (!zone || hours <= 0) return { copper: 0, levels: 0, upgrades: [] }

    let remaining = hours
    let levels = 0
    const acquired = []
    while (remaining > 0) {
      const rate = this.characterLevel < MAX_LEVEL ? xpPerHour(this, zone) : 0
      const hoursToLevel = rate > 0 ? (this.xpToNextLevel - this.characterXp) / rate : Infinity
      const segment = Math.min(remaining, hoursToLevel)
      this.#adventure(zone.name, segment, acquired)
      remaining -= segment
      if (segment < hoursToLevel) {
        this.characterXp += rate * segment
        break
      }
      this.characterLevel += 1
      this.characterXp = 0
      levels += 1
    }
    const upgrades = this.equipBest(acquired.map((a) => a.item))
    this.#log(acquired, upgrades, now)
    return { copper: zone.copperPerHour * hours, levels, upgrades }
  }

  #adventure(zoneName, hours, acquired) {
    this.killProgress += hours * KILLS_PER_HOUR
    const kills = Math.floor(this.killProgress)
    this.killProgress -= kills
    for (const item of rollKills(zoneName, this.characterLevel, kills)) {
      if (levelToUse(this, getItem(item)) < Infinity) acquired.push({ item, source: 'Drop' })
    }

    this.questProgress += hours
    while (this.questProgress >= QUEST_HOURS) {
      const next = nextQuest(this, zoneName, new Set(this.questsDone))
      if (!next) {
        this.questProgress = 0
        break
      }
      this.questProgress -= QUEST_HOURS
      this.questsDone.push(next.id)
      for (const item of next.rewards) acquired.push({ item, source: next.quest.title })
    }
  }

  // Puts on the best gear from what's worn, the bag and `newItems`. Keeps items that need a higher level
  // in the bag; the rest is vendored. Returns the item ids that were newly put on.
  equipBest(newItems = []) {
    const before = new Set(Object.values(this.equipment))
    const owned = [...Object.values(this.equipment), ...this.bag, ...newItems]
    const { equipment, leftovers } = bestLoadout(this, owned)
    this.equipment = Object.fromEntries(Object.keys(SLOTS).filter((s) => equipment[s]).map((s) => [s, equipment[s]]))
    const worn = new Set(Object.values(this.equipment))
    const waiting = (id) => !worn.has(id) && levelToUse(this, getItem(id)) > this.characterLevel && levelToUse(this, getItem(id)) < Infinity
    this.bag = [...new Set(leftovers.filter(waiting))]
      .sort((a, b) => getItem(b).itemLevel - getItem(a).itemLevel)
      .slice(0, BAG_SIZE)
    return [...worn].filter((id) => !before.has(id))
  }

  #log(acquired, upgrades, now) {
    const notable = acquired.filter(({ item, source }) => source !== 'Drop' || getItem(item).quality >= 2 || upgrades.includes(item))
    const entries = notable.map(({ item, source }) => ({ item, source, at: now, equipped: upgrades.includes(item) }))
    this.lootLog = [...entries.reverse(), ...this.lootLog].slice(0, LOG_SIZE)
  }

  // Restores gear fields from untrusted saved data, dropping anything that doesn't exist.
  restoreGear(data) {
    const ids = (list) => (Array.isArray(list) ? list.map(Number).filter((id) => getItem(id)) : [])
    const fraction = (value, max) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), 0), max) : 0)
    const equipped = data.equipment && typeof data.equipment === 'object' ? Object.values(data.equipment) : []
    this.questsDone = [...new Set(Array.isArray(data.questsDone) ? data.questsDone.map(Number).filter((id) => getQuest(id)) : [])]
    this.questProgress = fraction(data.questProgress, QUEST_HOURS)
    this.killProgress = fraction(data.killProgress, 1)
    this.lootLog = (Array.isArray(data.lootLog) ? data.lootLog : [])
      .filter((e) => e && getItem(Number(e.item)) && typeof e.source === 'string' && Number.isFinite(Number(e.at)))
      .slice(0, LOG_SIZE)
      .map((e) => ({ item: Number(e.item), source: e.source.slice(0, 100), at: Number(e.at), equipped: e.equipped === true }))
    this.equipment = {}
    this.bag = []
    this.equipBest([...ids(equipped), ...ids(data.bag)])
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
