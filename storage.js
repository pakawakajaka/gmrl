import Account, { SAVE_VERSION } from './account.js'
import Character from './character.js'
import Guild from './guild.js'

export const STORAGE_KEY = 'gmrl.account'

export function createDefaultAccount() {
  const trollwarr = new Character({ characterName: 'Trollwarrior', characterClass: 'Warrior', characterSpec: 'Protection', characterRace: 'Troll', characterRole: 'Tank' })
  const paka = new Character({ characterName: 'Pakawakajaka', characterClass: 'Shaman', characterSpec: 'Restoration', characterRace: 'Tauren', characterRole: 'Healer' })
  const bassor = new Character({ characterName: 'Bassor', characterClass: 'Paladin', characterSpec: 'Retribution', characterRace: 'Human', characterRole: 'DPS' })

  return new Account('bassor', [
    new Guild({ guildName: 'TYMF', faction: 'Horde', characters: [trollwarr, paka] }),
    new Guild({ guildName: 'South Bank Satellites', faction: 'Alliance', characters: [bassor] }),
  ])
}

// How many characters the save data holds, in either save format (see Account.fromJSON).
function savedCharacterCount(data) {
  if (Array.isArray(data.characters)) return data.characters.length
  const guilds = Array.isArray(data.guilds) ? data.guilds : []
  return guilds.reduce((sum, g) => sum + (Array.isArray(g?.characters) ? g.characters.length : 0), 0)
}

// Returns the saved account (or the defaults) and how many saved characters were invalid and dropped,
// e.g. ones made before the game became Classic-only. A save from a newer version of the game (say, an old
// cached copy of the page) gives `newer: true` and no account: loading it would drop what this version
// doesn't know about.
export function loadAccount() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      if (Number(data.saveVersion) > SAVE_VERSION) return { account: null, dropped: 0, newer: true }
      const account = Account.fromJSON(data)
      return { account, dropped: savedCharacterCount(data) - account.characters.length, newer: false }
    }
  } catch (error) {
    console.warn('Saved data could not be read; using defaults.', error)
  }
  return { account: createDefaultAccount(), dropped: 0, newer: false }
}

// The version of stored save data, from the start of the JSON (Account.toJSON writes it first); 0 if none.
function storedVersion(json) {
  return Number(json?.match(/^\{"saveVersion":(\d+)/)?.[1] ?? 0)
}

// Returns false, without saving, if the stored save is from a newer version of the game (another tab may
// have loaded the update).
export function saveAccount(account) {
  try {
    if (storedVersion(localStorage.getItem(STORAGE_KEY)) > SAVE_VERSION) return false
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  } catch (error) {
    console.error('Could not save changes to localStorage.', error)
  }
  return true
}

// Asks the dev server (dev-server.js) to write the save data into the project folder. Returns the file name.
export async function saveAccountToFile(account) {
  const response = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? `Server responded ${response.status}.`)
  return result.file
}
