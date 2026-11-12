import { CLASSES, MAX_LEVEL, MIN_LEVEL, NAME_PATTERN, RACES, ROLES, classIcon, xpToNextLevel } from './data.js'
import { getZone } from './zones.js'
import { averageItemLevel, characterPower } from './power.js'
import { SLOTS, bestLoadout, getItem, getQuest, itemKey, levelToUse, questRewardsFor, rollMobLoot } from './gear.js'
import { farmRates, questXp } from './combat.js'
import { activeQuests, creditKill, nextAction, objectivesOf } from './quests.js'

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined)
const BAG_SIZE = 16
const LOG_SIZE = 20

export default class Character {
  #planned = null // the next action in the current zone, kept until there's time to do it

  constructor({ id = crypto.randomUUID(), characterName, characterClass, characterSpec, characterRace, characterRole, characterLevel = MIN_LEVEL, characterXp = 0, zone = null, equipment = {}, bag = [], questsDone = [], questLog = {}, timeBank = 0, lootLog = [] }) {
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
    this.questLog = questLog // { questId: [count per objective] } for quests with progress
    this.timeBank = timeBank // farmed seconds not yet spent on a kill or quest
    this.lootLog = lootLog // newest first: { item, source, at, equipped, quest? }
  }

  get xpToNextLevel() {
    return xpToNextLevel(this.characterLevel)
  }

  // { solo, party }: see power.js. The UI calls solo power "power level".
  get power() {
    return characterPower(this)
  }

  get itemLevel() {
    return averageItemLevel(this)
  }

  // Hourly grinding rates in the current zone (see farmRates), or undefined when idle.
  get rates() {
    const zone = getZone(this.zone)
    return zone ? farmRates(this, zone) : undefined
  }

  get xpPerHour() {
    return this.rates?.xpPerHour ?? 0
  }

  get copperPerHour() {
    return this.rates?.copperPerHour ?? 0
  }

  // Hours until the next level at the current zone's rate, or Infinity if not gaining XP.
  get hoursToLevel() {
    const rate = this.xpPerHour
    return rate > 0 ? (this.xpToNextLevel - this.characterXp) / rate : Infinity
  }

  // Quest ids being worked on in the current zone.
  get activeQuests() {
    return this.zone ? activeQuests(this, this.zone) : []
  }

  // What the character does next in its zone (see nextAction in quests.js), or undefined.
  get plannedAction() {
    if (!this.zone) return undefined
    if (this.#planned?.zone !== this.zone) this.#planned = { zone: this.zone, action: nextAction(this, this.zone) }
    return this.#planned.action
  }

  // Farms for `hours`: one fight or quest turn-in after another, each taking its own time. Leftover time
  // carries over to the next call. Kills and quests pay XP, money and gear at the character's level when
  // they happen. Returns the copper earned, levels gained and newly equipped item ids.
  farm(hours, now = Date.now()) {
    const zone = getZone(this.zone)
    if (!zone || hours <= 0) return { copper: 0, levels: 0, upgrades: [] }

    const wornBefore = new Set(Object.values(this.equipment))
    let levels = 0
    let copper = 0
    const acquired = []
    this.timeBank += hours * 3600
    for (;;) {
      const action = this.plannedAction
      if (!action) {
        this.timeBank = 0 // nothing here the character can beat
        break
      }
      const seconds = action.fight ? action.fight.seconds : action.seconds
      if (seconds > this.timeBank) break
      this.timeBank -= seconds
      this.#planned = null

      const found = []
      let xp
      if (action.fight) {
        const { entry, mob } = action.fight
        creditKill(this, zone.name, entry)
        xp = action.fight.xp
        copper += action.fight.copper
        for (const item of rollMobLoot(entry)) {
          if (levelToUse(this, getItem(item)) < Infinity) found.push({ item, source: mob.name })
        }
      } else {
        const quest = getQuest(action.questId)
        this.questsDone.push(action.questId)
        delete this.questLog[action.questId]
        xp = questXp(this.characterLevel, quest)
        copper += quest.money ?? 0
        for (const item of questRewardsFor(this, quest)) found.push({ item, source: quest.title, quest: true })
      }
      const gained = this.#gainXp(xp)
      levels += gained
      if (found.length || gained) this.equipBest(found.map((a) => a.item))
      acquired.push(...found)
    }
    const upgrades = [...new Set(Object.values(this.equipment))].filter((id) => !wornBefore.has(id))
    this.#log(acquired, upgrades, now)
    return { copper, levels, upgrades }
  }

  // Adds XP, leveling up as many times as it covers. Returns the levels gained.
  #gainXp(xp) {
    if (!xp || this.characterLevel >= MAX_LEVEL) return 0
    this.characterXp += xp
    let levels = 0
    while (this.characterLevel < MAX_LEVEL && this.characterXp >= this.xpToNextLevel) {
      this.characterXp -= this.xpToNextLevel
      this.characterLevel += 1
      levels += 1
    }
    if (this.characterLevel >= MAX_LEVEL) this.characterXp = 0
    return levels
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
    const notable = acquired.filter(({ item, quest }) => quest || getItem(item).quality >= 2 || upgrades.includes(item))
    const entries = notable.map(({ item, source, quest }) => ({ item, source, at: now, equipped: upgrades.includes(item), ...(quest && { quest }) }))
    this.lootLog = [...entries.reverse(), ...this.lootLog].slice(0, LOG_SIZE)
  }

  // Restores gear fields from untrusted saved data, dropping anything that doesn't exist.
  restoreGear(data) {
    const ids = (list) => (Array.isArray(list) ? list.map(itemKey).filter((key) => key !== undefined) : [])
    const fraction = (value, max) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), 0), max) : 0)
    const equipped = data.equipment && typeof data.equipment === 'object' ? Object.values(data.equipment) : []
    this.questsDone = [...new Set(Array.isArray(data.questsDone) ? data.questsDone.map(Number).filter((id) => getQuest(id)) : [])]
    const done = new Set(this.questsDone)
    this.questLog = {}
    for (const [key, counts] of Object.entries(data.questLog && typeof data.questLog === 'object' ? data.questLog : {})) {
      const id = Number(key)
      if (!getQuest(id) || done.has(id) || !Array.isArray(counts)) continue
      const objectives = objectivesOf(id)
      if (counts.length === objectives.length) this.questLog[id] = objectives.map((o, i) => Math.floor(fraction(counts[i], o.count)))
    }
    this.timeBank = fraction(data.timeBank, 3600)
    this.lootLog = (Array.isArray(data.lootLog) ? data.lootLog : [])
      .filter((e) => e && itemKey(e.item) !== undefined && typeof e.source === 'string' && Number.isFinite(Number(e.at)))
      .slice(0, LOG_SIZE)
      .map((e) => ({ item: itemKey(e.item), source: e.source.slice(0, 100), at: Number(e.at), equipped: e.equipped === true, ...(e.quest === true && { quest: true }) }))
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
