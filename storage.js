import Account from './account.js'
import Character from './character.js'
import Guild from './guild.js'

const STORAGE_KEY = 'gmrl.account'

export function createDefaultAccount() {
  const trollwarr = new Character({ characterName: 'Trollwarrior', characterClass: 'Warrior', characterSpec: 'Protection', characterRace: 'Troll', characterRole: 'Tank' })
  const paka = new Character({ characterName: 'Pakawakajaka', characterClass: 'Shaman', characterSpec: 'Restoration', characterRace: 'Tauren', characterRole: 'Healer' })
  const bassor = new Character({ characterName: 'Bassor', characterClass: 'Paladin', characterSpec: 'Retribution', characterRace: 'Human', characterRole: 'DPS' })

  return new Account('bassor', [trollwarr, paka, bassor], [
    new Guild('TYMF', [trollwarr.id, paka.id, bassor.id]),
    new Guild('South Bank Satellites', [bassor.id]),
  ])
}

// Returns the saved account (or the defaults) and how many saved characters were invalid and dropped,
// e.g. ones made before the game became Classic-only.
export function loadAccount() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      const account = Account.fromJSON(data)
      return { account, dropped: data.characters.length - account.characters.length }
    }
  } catch (error) {
    console.warn('Saved data could not be read; using defaults.', error)
  }
  return { account: createDefaultAccount(), dropped: 0 }
}

export function saveAccount(account) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  } catch (error) {
    console.error('Could not save changes to localStorage.', error)
  }
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
