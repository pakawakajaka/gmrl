import { renderCharacterForm } from './character-form.js'
import { renderRoster } from './roster.js'
import { createDefaultAccount, loadAccount, saveAccount } from './storage.js'

const APP_TITLE = 'Guild Master Raid Leader'
const app = document.getElementById('app')

let account = loadAccount()
let selectedGuild = null

function render() {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/')
  const character = view === 'edit' ? account.getCharacter(id) : undefined

  document.getElementById('accountName').textContent = account.accountName

  if (view === 'create' || character) {
    app.replaceChildren(renderCharacterForm({ account, character, onSave: handleSave }))
  } else {
    app.replaceChildren(renderRoster({
      account,
      selectedGuild,
      onSelectGuild: handleSelectGuild,
      onDelete: handleDelete,
      onReset: handleReset,
    }))
  }

  document.title = `${app.querySelector('#view-title').textContent} · ${APP_TITLE}`
  app.querySelector('[data-autofocus]')?.focus()
}

function handleSave(character, guildNames) {
  account.saveCharacter(character, guildNames)
  saveAccount(account)
  location.hash = '#/roster'
}

function handleSelectGuild(guildName) {
  selectedGuild = guildName
  render()
  app.querySelector('.chip[aria-pressed="true"]')?.focus()
}

function handleDelete(character) {
  if (!confirm(`Delete ${character.characterName}? This can't be undone.`)) return
  account.deleteCharacter(character.id)
  saveAccount(account)
  render()
}

function handleReset() {
  if (!confirm('Replace all characters and guilds with the default data?')) return
  account = createDefaultAccount()
  selectedGuild = null
  saveAccount(account)
  render()
}

window.addEventListener('hashchange', () => {
  render()
  window.scrollTo(0, 0)
})
render()