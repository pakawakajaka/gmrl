import Account from './account.js'
import Character from './character.js'
import Guild from './guild.js'



const trollwarr = new Character("Trollwarrior", "Warrior", "Troll")
const paka = new Character("Pakawakajaka", "Shaman", "Tauren")
const bassor = new Character("Bassor", "Paladin", "Blood Elf")

const tymf = new Guild([trollwarr, paka])
const sbs = new Guild([bassor])

const account1 = new Account("bassor", "password", [tymf, sbs])



let characters = account1.accountGuilds[0].characters;
let characterText = ''

for(let c in characters) {
    characterText += characters[c].characterName + "\n" + characters[c].characterClass + "\n" + characters[c].characterRace + "<br>"
}

document.getElementById("characters").innerHTML = characterText






document.getElementById("accountName").innerHTML = "Account Name: " + account1.accountName
