export default class Guild {
  constructor(guildName, characterIds = []) {
    this.guildName = guildName
    this.characterIds = characterIds
  }

  has(characterId) {
    return this.characterIds.includes(characterId)
  }

  add(characterId) {
    if (!this.has(characterId)) this.characterIds.push(characterId)
  }

  remove(characterId) {
    this.characterIds = this.characterIds.filter((id) => id !== characterId)
  }
}
