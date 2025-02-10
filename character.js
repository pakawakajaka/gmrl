export default class Character {
    constructor(characterName, characterClass, characterRace) {
        this.characterName = characterName
        this.characterClass = characterClass;
        this.characterRace = characterRace;
        this.characterLevel = 1;
        this.classIcon = `icons/${this.characterClass.toLowerCase()}.jpg`
      }
}
