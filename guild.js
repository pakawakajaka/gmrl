import { FACTIONS } from './data.js'

const NAME_PATTERN = /^[A-Za-z]+( [A-Za-z]+)*$/
export const GUILD_NAME_MAX = 24
export const GUILD_SIZE = 10 // most characters a guild can have; see Account.addCharacter

// A guild of one faction. It owns its characters; every character is in exactly one guild.
export default class Guild {
  constructor({ id = crypto.randomUUID(), guildName, faction, characters = [] }) {
    this.id = id
    this.guildName = guildName
    this.faction = faction // 'Alliance' or 'Horde'; only that faction's characters can join
    this.characters = characters
  }

  has(characterId) {
    return this.characters.some((c) => c.id === characterId)
  }

  // No room for a new character. Saves from before the cap may hold more; they keep them.
  get isFull() {
    return this.characters.length >= GUILD_SIZE
  }

  // The guild's money: its characters' gold added up, in copper. Worked out on each call; the guild stores none.
  totalGold() {
    return this.characters.reduce((sum, c) => sum + c.copper, 0)
  }

  // Adds the character if it's of the guild's faction. Returns whether it was added.
  add(character) {
    if (character.faction !== this.faction) return false
    if (!this.has(character.id)) this.characters.push(character)
    return true
  }

  remove(characterId) {
    this.characters = this.characters.filter((c) => c.id !== characterId)
  }

  // Trims and collapses runs of spaces.
  static formatName(name) {
    return String(name ?? '').trim().replace(/\s+/g, ' ')
  }

  // Returns { field: message } for each invalid field; empty object when valid.
  static validate({ guildName, faction }) {
    const errors = {}
    const name = Guild.formatName(guildName)
    if (name.length < 2 || name.length > GUILD_NAME_MAX || !NAME_PATTERN.test(name)) {
      errors.guildName = `Name must be 2 to ${GUILD_NAME_MAX} letters (A to Z) and single spaces.`
    }
    if (!FACTIONS.includes(faction)) errors.faction = 'Choose a faction.'
    return errors
  }
}
