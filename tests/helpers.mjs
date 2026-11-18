// Shared test helpers for the Account -> Guild -> Character structure.
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Account } = await import(root + 'account.js')
const { default: Guild } = await import(root + 'guild.js')
const { default: Character } = await import(root + 'character.js')

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// A small account: <TYMF> (Horde) with Trollwarrior and Pakawakajaka, <South Bank Satellites> (Alliance) with Bassor.
export function sampleAccount() {
  const trollwarr = new Character({ characterName: 'Trollwarrior', characterClass: 'Warrior', characterSpec: 'Protection', characterRace: 'Troll', characterRole: 'Tank' })
  const paka = new Character({ characterName: 'Pakawakajaka', characterClass: 'Shaman', characterSpec: 'Restoration', characterRace: 'Tauren', characterRole: 'Healer' })
  const bassor = new Character({ characterName: 'Bassor', characterClass: 'Paladin', characterSpec: 'Retribution', characterRace: 'Human', characterRole: 'DPS' })
  return new Account('bassor', [
    new Guild({ guildName: 'TYMF', faction: 'Horde', characters: [trollwarr, paka] }),
    new Guild({ guildName: 'South Bank Satellites', faction: 'Alliance', characters: [bassor] }),
  ])
}

// An account holding `characters` in their given order: each run of same-faction characters becomes a guild.
export function accountOf(name, characters = [], lastTick = Date.now()) {
  const guilds = []
  for (const c of characters) {
    const last = guilds.at(-1)
    if (last?.faction === c.faction) last.characters.push(c)
    else guilds.push(new Guild({ guildName: `Test ${c.faction} ${LETTERS[guilds.length]}`, faction: c.faction, characters: [c] }))
  }
  return new Account(name, guilds, lastTick)
}

// Adds the character to the account's first guild of its faction, making one if needed.
export function addTo(account, character, now) {
  let guild = account.guilds.find((g) => g.faction === character.faction)
  if (!guild) {
    guild = new Guild({ guildName: `Test ${character.faction}`, faction: character.faction })
    account.addGuild(guild)
  }
  return account.addCharacter(character, guild.id, now)
}

// The characters in saved (JSON) account data, as the same objects, so tests can tamper with them.
export const savedCharacters = (data) => data.guilds.flatMap((g) => g.characters)
