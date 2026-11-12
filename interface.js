import { renderCharacterForm } from './character-form.js'
import { MAX_LEVEL } from './data.js'
import { el, formatDuration, formatMoney, money } from './dom.js'
import { renderFarm, updateFarm } from './farm.js'
import { renderRoster } from './roster.js'
import { createDefaultAccount, loadAccount, saveAccount, saveAccountToFile } from './storage.js'

const APP_TITLE = 'Guild Master Raid Leader'
const TICK_MS = 1000
const SAVE_EVERY_MS = 15000
const MAX_NOTICES = 4

const app = document.getElementById('app')
const goldEl = document.getElementById('gold')
const noticesEl = document.getElementById('notices')

const loaded = loadAccount()
let account = loaded.account
let selectedGuild = null
let farmSelectedId = null
let lastSave = Date.now()

function currentView() {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/')
  return { view, id }
}

function render() {
  const { view, id } = currentView()
  const character = view === 'edit' ? account.getCharacter(id) : undefined
  const focusKey = document.activeElement?.dataset?.focusKey

  document.getElementById('accountName').textContent = account.accountName

  if (view === 'create' || character) {
    app.replaceChildren(renderCharacterForm({ account, character, onSave: handleSave }))
  } else if (view === 'farm') {
    app.replaceChildren(renderFarm({
      account,
      selectedId: farmSelectedId,
      onSelect: handleFarmSelect,
      onSend: handleSend,
      onRecall: handleRecall,
    }))
  } else {
    app.replaceChildren(renderRoster({
      account,
      selectedGuild,
      onSelectGuild: handleSelectGuild,
      onDelete: handleDelete,
      onReset: handleReset,
      onSaveToFile: handleSaveToFile,
    }))
  }

  for (const link of document.querySelectorAll('.site-nav a')) {
    const active = link.dataset.view === (view === 'farm' ? 'farm' : 'roster')
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  updateGold()
  document.title = `${app.querySelector('#view-title').textContent} · ${APP_TITLE}`

  // Keep keyboard focus on the same control after a re-render (e.g. Send becomes Recall).
  const refocus = focusKey && [...app.querySelectorAll('[data-focus-key]')].find((e) => e.dataset.focusKey === focusKey)
  if (refocus) refocus.focus()
  else app.querySelector('[data-autofocus]')?.focus()
}

function updateGold() {
  goldEl.replaceChildren(money(account.gold))
}

function save() {
  saveAccount(account)
  lastSave = Date.now()
}

function notify(...content) {
  const notice = el('li', { class: 'notice' },
    el('p', {}, content),
    el('button', { type: 'button', class: 'notice-close', 'aria-label': 'Dismiss', onclick: () => notice.remove() }, '×'),
  )
  noticesEl.prepend(notice)
  while (noticesEl.children.length > MAX_NOTICES) noticesEl.lastElementChild.remove()
}

function reportLevelUps(levelUps) {
  for (const c of levelUps) {
    notify(`${c.characterName} reached level ${c.characterLevel}!`)
    if (c.zone && c.xpPerHour === 0 && c.characterLevel < MAX_LEVEL) {
      notify(`${c.characterName} has outleveled ${c.zone} and no longer gains XP there.`)
    }
  }
}

function gameTick() {
  const { levelUps } = account.tick()
  reportLevelUps(levelUps)
  if (levelUps.length) {
    render()
    save()
  } else if (currentView().view === 'farm') {
    updateFarm(app, account)
  }
  updateGold()
  if (Date.now() - lastSave >= SAVE_EVERY_MS) save()
}

function handleSave(character, guildNames) {
  account.saveCharacter(character, guildNames)
  save()
  location.hash = '#/roster'
}

function handleSelectGuild(guildName) {
  selectedGuild = guildName
  render()
  app.querySelector('.chip[aria-pressed="true"]')?.focus()
}

function handleFarmSelect(characterId) {
  farmSelectedId = characterId
  render()
}

function handleSend(characterId, zoneName) {
  if (account.sendToZone(characterId, zoneName)) save()
  render()
}

function handleRecall(characterId) {
  account.recall(characterId)
  save()
  render()
}

function handleDelete(character) {
  if (!confirm(`Delete ${character.characterName}? This can't be undone.`)) return
  account.deleteCharacter(character.id)
  save()
  render()
}

async function handleSaveToFile(event) {
  const button = event.currentTarget
  button.disabled = true
  save()
  try {
    const file = await saveAccountToFile(account)
    notify(`Saved to ${file} in the project folder.`)
  } catch (error) {
    console.error(error)
    notify(`Could not save to file: ${error.message} Start the app with "npm start" so the save endpoint is available.`)
  } finally {
    button.disabled = false
  }
}

function handleReset() {
  if (!confirm('Replace all characters, guilds and gold with the default data?')) return
  account = createDefaultAccount()
  selectedGuild = null
  farmSelectedId = null
  save()
  render()
}

// Pay out anything earned while the page was closed.
const away = account.tick()
if (away.hours >= 1 / 60 && (away.copper >= 1 || away.levelUps.length)) {
  notify(`Welcome back! While you were away for ${formatDuration(away.hours)}, your characters earned ${formatMoney(away.copper)}.`)
  reportLevelUps(away.levelUps)
  save()
}
if (loaded.dropped > 0) {
  notify(`${loaded.dropped} saved character${loaded.dropped === 1 ? '' : 's'} used non-Classic races, classes or levels and ${loaded.dropped === 1 ? 'was' : 'were'} removed. Use "Reset to default data" on the Roster to restore the starting characters.`)
  save()
}

window.addEventListener('hashchange', () => {
  render()
  window.scrollTo(0, 0)
})
window.addEventListener('pagehide', save)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save()
})
setInterval(gameTick, TICK_MS)
render()