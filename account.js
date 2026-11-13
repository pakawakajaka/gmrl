import Character from './character.js'
import Guild from './guild.js'
import { MIN_LEVEL, defaultSpec } from './data.js'
import { getZone, zoneLockReason } from './zones.js'
import { encounterRecord, restoreEncounter, worldPvp } from './pvp.js'

const ID_PATTERN = /^[\w-]+$/
const MS_PER_HOUR = 3600 * 1000
const SLICE_HOURS = 1 // long catch-ups run in slices so PvP sees levels change along the way
export const ENCOUNTER_LOG_SIZE = 200
export const ENCOUNTER_DETAIL_SIZE = 20 // the newest encounters that keep their combat log

// Drops the combat log from all but the newest encounters.
function trimLogs(encounters) {
  for (const e of encounters.slice(ENCOUNTER_DETAIL_SIZE)) e.log = null
}

export default class Account {
  // `gold` (copper) is old account-wide money from before characters kept their own; it's split evenly.
  constructor(accountName, characters = [], guilds = [], gold = 0, lastTick = Date.now(), encounters = []) {
    this.accountName = accountName
    this.characters = characters
    this.guilds = guilds
    for (const character of characters) character.copper += gold / characters.length
    this.lastTick = lastTick // ms timestamp up to which farming has been paid out
    this.encounters = encounters // world PvP, newest first: see encounterRecord in pvp.js
  }

  // All characters' money, in copper.
  get gold() {
    return this.characters.reduce((sum, c) => sum + c.copper, 0)
  }

  // Pays out farming from `lastTick` to `now`, with world PvP in contested zones along the way. Returns
  // what was earned, who leveled up, new gear still worn, the PvP fights (each with the `id` of its
  // encounter record) and moves along leveling paths ({ character, from, to, reason, level }).
  tick(now = Date.now(), random = Math.random) {
    const hours = Math.max(0, now - this.lastTick) / MS_PER_HOUR
    const start = Math.min(this.lastTick, now)
    this.lastTick = Math.max(this.lastTick, now)
    const result = { hours, copper: 0, levelUps: [], upgrades: [], fights: [], travels: [] }
    const leveled = new Set()
    const upgraded = new Map(this.characters.map((c) => [c, new Set()]))
    for (let done = 0; done < hours; done += SLICE_HOURS) {
      const slice = Math.min(SLICE_HOURS, hours - done)
      const fights = worldPvp(this.characters, slice, start + (done + slice) * MS_PER_HOUR, random)
      for (const fight of fights) {
        fight.id = crypto.randomUUID()
        this.encounters.unshift(encounterRecord(fight, fight.id))
      }
      result.fights.push(...fights)
      for (const character of this.characters) {
        const { copper, levels, upgrades, travels } = character.farm(slice, now)
        result.copper += copper
        if (levels > 0) leveled.add(character)
        for (const item of upgrades) upgraded.get(character).add(item)
        for (const travel of travels) result.travels.push({ character, ...travel })
      }
    }
    result.levelUps = [...leveled]
    if (this.encounters.length > ENCOUNTER_LOG_SIZE) this.encounters.length = ENCOUNTER_LOG_SIZE
    trimLogs(this.encounters)
    for (const [character, items] of upgraded) {
      const worn = new Set(Object.values(character.equipment))
      for (const item of items) if (worn.has(item)) result.upgrades.push({ character, item })
    }
    return result
  }

  sendToZone(characterId, zoneName, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character || zoneLockReason(character, getZone(zoneName))) return false
    this.tick(now)
    character.zone = zoneName
    return true
  }

  recall(characterId, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character) return
    this.tick(now)
    character.zone = null
    character.timeBank = 0
  }

  getCharacter(id) {
    return this.characters.find((c) => c.id === id)
  }

  getGuild(guildName) {
    return this.guilds.find((g) => g.guildName === guildName)
  }

  guildsOf(characterId) {
    return this.guilds.filter((g) => g.has(characterId))
  }

  isNameTaken(name) {
    const wanted = name.trim().toLowerCase()
    return this.characters.some((c) => c.characterName.toLowerCase() === wanted)
  }

  // Adds a new character and puts it in exactly `guildNames`. New characters always start at level 1
  // with no XP or gear. Characters can't be edited after creation.
  addCharacter(character, guildNames, now = Date.now()) {
    this.tick(now)
    character.characterLevel = MIN_LEVEL
    character.characterXp = 0
    character.talents = {}
    character.zone = null
    this.characters.push(character)

    for (const guild of this.guilds) {
      if (guildNames.includes(guild.guildName)) guild.add(character.id)
    }
  }

  deleteCharacter(id) {
    this.characters = this.characters.filter((c) => c.id !== id)
    for (const guild of this.guilds) guild.remove(id)
  }

  // Rebuilds an Account from untrusted saved data, dropping anything invalid.
  static fromJSON(data, now = Date.now()) {
    const characters = data.characters
      .filter((c) => typeof c.id === 'string' && ID_PATTERN.test(c.id))
      .map((c) => ({ ...c, characterSpec: c.characterSpec ?? defaultSpec(c.characterClass, c.characterRole) }))
      .filter((c) => Object.keys(Character.validate(c)).length === 0)
      .map((c) => {
        const character = new Character({ ...c, characterXp: 0, zone: null, copper: 0, spells: undefined, talents: {}, equipment: {}, bag: [], questsDone: [], questLog: {}, timeBank: 0, lootLog: [], honorableKills: 0, honor: 0, honorToday: null, pvpKills: 0, pvpDeaths: 0, pvpLog: [], pvpReadyAt: 0, hearthReadyAt: 0 })
        const xp = Number(c.characterXp)
        if (Number.isFinite(xp) && xp > 0 && xp < character.xpToNextLevel) character.characterXp = xp
        if (!zoneLockReason(character, getZone(c.zone))) character.zone = c.zone
        character.restoreGear(c)
        return character
      })
    const ids = new Set(characters.map((c) => c.id))
    const guilds = data.guilds.map(
      (g) => new Guild(String(g.guildName), g.characterIds.filter((id) => ids.has(id))),
    )
    // Saves from before characters kept their own money have account-wide gold instead.
    const gold = data.characters.some((c) => c?.copper !== undefined) ? 0 : Number(data.gold)
    const lastTick = Number(data.lastTick)
    const encounters = (Array.isArray(data.encounters) ? data.encounters.slice(0, ENCOUNTER_LOG_SIZE) : []).map(restoreEncounter).filter(Boolean)
    trimLogs(encounters)
    return new Account(
      String(data.accountName),
      characters,
      guilds,
      Number.isFinite(gold) && gold > 0 ? gold : 0,
      Number.isFinite(lastTick) && lastTick > 0 ? Math.min(lastTick, now) : now,
      encounters,
    )
  }
}
