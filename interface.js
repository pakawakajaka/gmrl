import Account from './account.js'
import Character from './character.js'
import Guild from './guild.js'



const trollwarr = new Character("Trollwarrior", "Warrior", "Troll")
const paka = new Character("Pakawakajaka", "Shaman", "Tauren")
const bassor = new Character("Bassor", "Paladin", "Blood Elf")

const tymf = new Guild("TYMF", [trollwarr, paka])
const sbs = new Guild("South Bank Satellites", [bassor])

const account1 = new Account("bassor", "password", [tymf, sbs])

let characters = account1.accountGuilds[0].characters;


document.getElementById("charactersTitle").innerText = "Characters: \n"

document.getElementById("guild").innerHTML = "Guild: " + account1.accountGuilds[0].guildName

document.getElementById("accountName").innerHTML = "Account: " + account1.accountName



for (let c in characters) {
  const charElements = characters[c].characterElements()
  for (let e in charElements) {
    document.getElementById('characters').appendChild(charElements[e])
  }
}