import Account from './account.js'
import Character from './character.js'
import Guild from './guild.js'

const STORAGE_KEY = 'gmrl.account'

export function createDefaultAccount() {
  const trollwarr = new Character({ characterName: 'Trollwarrior', characterClass: 'Warrior', characterSpec: 'Protection', characterRace: 'Troll', characterRole: 'Tank' })
  const paka = new Character({ characterName: 'Pakawakajaka', characterClass: 'Shaman', characterSpec: 'Restoration', characterRace: 'Tauren', characterRole: 'Healer' })
  const bassor = new Character({ characterName: 'Bassor', characterClass: 'Paladin', characterSpec: 'Retribution', characterRace: 'Blood Elf', characterRole: 'DPS' })

  return new Account('bassor', [trollwarr, paka, bassor], [
    new Guild('TYMF', [trollwarr.id, paka.id, bassor.id]),
    new Guild('South Bank Satellites', [bassor.id]),
  ])
}

export function loadAccount() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return Account.fromJSON(JSON.parse(saved))
  } catch (error) {
    console.warn('Saved data could not be read; using defaults.', error)
  }
  return createDefaultAccount()
}

export function saveAccount(account) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  } catch (error) {
    console.error('Could not save changes to localStorage.', error)
  }
}
