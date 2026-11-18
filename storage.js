import Account, { SAVE_VERSION } from './account.js'

export const STORAGE_KEY = 'gmrl.account'
export const SAVE_FILE = 'gmrl-save.json'

// How many characters the save data holds, in either save format (see Account.fromJSON).
function savedCharacterCount(data) {
  if (Array.isArray(data.characters)) return data.characters.length
  const guilds = Array.isArray(data.guilds) ? data.guilds : []
  return guilds.reduce((sum, g) => sum + (Array.isArray(g?.characters) ? g.characters.length : 0), 0)
}

// Returns the saved account (or a new one with no guilds) and how many saved characters were invalid and dropped,
// e.g. ones made before the game became Classic-only. A save from a newer version of the game (say, an old
// cached copy of the page) gives `newer: true` and no account: loading it would drop what this version
// doesn't know about.
export function loadAccount() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return readSave(saved)
  } catch (error) {
    console.warn('Saved data could not be read; starting a new account.', error)
  }
  return { account: new Account(''), dropped: 0, newer: false }
}

// Reads save data from JSON text, as loadAccount returns it. Throws if the text isn't a save.
export function readSave(text) {
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || (!Array.isArray(data.guilds) && !Array.isArray(data.characters))) throw new Error('Not a save.')
  if (Number(data.saveVersion) > SAVE_VERSION) return { account: null, dropped: 0, newer: true }
  const account = Account.fromJSON(data)
  return { account, dropped: savedCharacterCount(data) - account.characters.length, newer: false }
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

// Save and load file pickers share an id, so the browser opens each in the folder used last time (by either).
const PICKER = { id: 'gmrl-save', types: [{ description: 'Save file', accept: { 'application/json': ['.json'] } }] }
const cancelled = (error) => error?.name === 'AbortError'

// Writes the save data to a file. Where the browser has file pickers (Chrome, Edge), the player picks where;
// elsewhere it's downloaded as SAVE_FILE. Resolves to { name, picked }, or null if the player cancelled.
export async function saveAccountToFile(account) {
  const json = JSON.stringify(account, null, 2)
  if (window.showSaveFilePicker) {
    let handle
    try {
      handle = await window.showSaveFilePicker({ ...PICKER, suggestedName: SAVE_FILE })
    } catch (error) {
      if (cancelled(error)) return null
      throw error
    }
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return { name: handle.name, picked: true }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: SAVE_FILE })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url))
  return { name: SAVE_FILE, picked: false }
}

// Lets the player pick a save file. Resolves to { name, text }, or null if the player cancelled.
export async function pickSaveFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker(PICKER)
      const file = await handle.getFile()
      return { name: file.name, text: await file.text() }
    } catch (error) {
      if (cancelled(error)) return null
      throw error
    }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
    input.addEventListener('change', async () => {
      const file = input.files[0]
      resolve(file ? { name: file.name, text: await file.text() } : null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
