import Character from './character.js'
import Guild from './guild.js'
import { defaultSpec } from './data.js'

const ID_PATTERN = /^[\w-]+$/

export default class Account {
  constructor(accountName, characters = [], guilds = []) {
    this.accountName = accountName
    this.characters = characters
    this.guilds = guilds
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

  isNameTaken(name, exceptId) {
    const wanted = name.trim().toLowerCase()
    return this.characters.some((c) => c.id !== exceptId && c.characterName.toLowerCase() === wanted)
  }

  // Adds or replaces the character and sets its guild memberships to exactly `guildNames`.
  saveCharacter(character, guildNames) {
    const index = this.characters.findIndex((c) => c.id === character.id)
    if (index === -1) this.characters.push(character)
    else this.characters[index] = character

    for (const guild of this.guilds) {
      if (guildNames.includes(guild.guildName)) guild.add(character.id)
      else guild.remove(character.id)
    }
  }

  deleteCharacter(id) {
    this.characters = this.characters.filter((c) => c.id !== id)
    for (const guild of this.guilds) guild.remove(id)
  }

  // Rebuilds an Account from untrusted saved data, dropping anything invalid.
  static fromJSON(data) {
    const characters = data.characters
      .filter((c) => typeof c.id === 'string' && ID_PATTERN.test(c.id))
      .map((c) => ({ ...c, characterSpec: c.characterSpec ?? defaultSpec(c.characterClass, c.characterRole) }))
      .filter((c) => Object.keys(Character.validate(c)).length === 0)
      .map((c) => new Character(c))
    const ids = new Set(characters.map((c) => c.id))
    const guilds = data.guilds.map(
      (g) => new Guild(String(g.guildName), g.characterIds.filter((id) => ids.has(id))),
    )
    return new Account(String(data.accountName), characters, guilds)
  }
}
