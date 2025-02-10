export default class Character {
    constructor(characterName, characterClass, characterRace) {
        this.characterName = characterName
        this.characterClass = characterClass;
        this.characterRace = characterRace;
        this.characterLevel = 1;
        this.classIcon = `icons/${this.characterClass.toLowerCase()}.jpg`
      }

    characterElements() {
      const iconEle = document.createElement('img')
      iconEle.setAttribute('src', this.classIcon)

      const textEle = document.createElement('p')
      const text = this.characterName + "\n Level " + this.characterLevel + " " +  this.characterRace + " " + this.characterClass
      textEle.innerText = text

      return [ iconEle, textEle]
    }
    
}
