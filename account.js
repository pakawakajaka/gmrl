import Character from './character.js'
import Guild from './guild.js'
import { MIN_LEVEL, defaultSpec } from './data.js'
import { getZone, zoneLockReason } from './zones.js'

const ID_PATTERN = /^[\w-]+$/
const MS_PER_HOUR = 3600 * 1000

export default class Account {
  // `gold` (copper) is old account-wide money from before characters kept their own; it's split evenly.
  constructor(accountName, characters = [], guilds = [], gold = 0, lastTick = Date.now()) {
    this.accountName = accountName
    this.characters = characters
    this.guilds = guilds
    for (const character of characters) character.copper += gold / characters.length
    this.lastTick = lastTick // ms timestamp up to which farming has been paid out
  }

  // All characters' money, in copper.
  get gold() {
    return this.characters.reduce((sum, c) => sum + c.copper, 0)
  }

  // Pays out farming from `lastTick` to `now`. Returns what was earned, who leveled up and new gear worn.
  tick(now = Date.now()) {
    const hours = Math.max(0, now - this.lastTick) / MS_PER_HOUR
    this.lastTick = Math.max(this.lastTick, now)
    const result = { hours, copper: 0, levelUps: [], upgrades: [] }
    for (const character of this.characters) {
      const { copper, levels, upgrades } = character.farm(hours, now)
      result.copper += copper
      if (levels > 0) result.levelUps.push(character)
      for (const item of upgrades) result.upgrades.push({ character, item })
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
        const character = new Character({ ...c, characterXp: 0, zone: null, copper: 0, spells: undefined, equipment: {}, bag: [], questsDone: [], questLog: {}, timeBank: 0, lootLog: [] })
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
    return new Account(
      String(data.accountName),
      characters,
      guilds,
      Number.isFinite(gold) && gold > 0 ? gold : 0,
      Number.isFinite(lastTick) && lastTick > 0 ? Math.min(lastTick, now) : now,
    )
  }
}
