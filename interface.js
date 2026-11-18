import { cantCreateReason, renderCharacterForm } from './character-form.js'
import { renderChanges } from './changes-view.js'
import { renderCharacterSheet } from './character-sheet.js'
import { MAX_LEVEL } from './data.js'
import { el, formatChance, formatDaysAgo, formatDuration, formatNumber } from './dom.js'
import { renderFarm, updateFarm } from './farm.js'
import { getItem } from './gear.js'
import Guild from './guild.js'
import { renderGuildForm } from './guild-form.js'
import { renderRoster } from './roster.js'
import { DEFAULT_SORT } from './sort.js'
import { renderTalents } from './talents-view.js'
import { STORAGE_KEY, backupOverdue, lastBackup, loadAccount, markBackup, pickSaveFile, readSave, requestPersistentStorage, saveAccount, saveAccountToFile } from './storage.js'
import { newerBuild, registerServiceWorker, unseenChanges } from './updates.js'
import { BUILD, VERSION } from './version.js'
import { renderWorldPvp, headline } from './world-pvp.js'
import { renderDungeons, runHeadline } from './dungeons-view.js'
import { encounterRecord } from './pvp.js'
import Account, { MAX_AWAY_HOURS } from './account.js'

const APP_TITLE = 'Guild Master Raid Leader'
const TICK_MS = 1000
const SAVE_EVERY_MS = 15000
const UPDATE_CHECK_MS = 10 * 60 * 1000 // how often an open page asks the server whether there's an update
const REMIND_EVERY_MS = 24 * 3600 * 1000 // backup reminders, at most
const BUG_REPORT_URL = 'https://github.com/pakawakajaka/gmrl/issues/new'
let createReset = Account.nextCreateReset() // see gameTick
const MAX_NOTICES = 4
const MAX_UPGRADE_NOTICES = 3
const MAX_FIGHT_NOTICES = 2
const MAX_RUN_NOTICES = 2

const app = document.getElementById('app')
const goldEl = document.getElementById('gold')
const noticesEl = document.getElementById('notices')
const updateEl = document.getElementById('update')

const loaded = loadAccount()
let account = loaded.account
let selectedGuild = null // a guild id, or null for all guilds
let farmSelectedId = null
let rosterSort = DEFAULT_SORT
let farmSort = DEFAULT_SORT
let lastSave = Date.now()
let stopped = false // the save is from a newer version of the game: this page must not touch it
let ticker
let lastUpdateCheck = -Infinity
let updateFound = false
let remindedAt = -Infinity // last backup reminder

function currentView() {
  const [view, id, sub] = location.hash.replace(/^#\/?/, '').split('/')
  return { view, id, sub }
}

// A form being filled in or an open modal. Background updates don't re-render over them, which would wipe the
// input or close the modal; the next render catches up.
function busy() {
  return app.querySelector('form, dialog[open]')
}

function render() {
  if (stopped) return
  // A new account has no guilds, so it starts on the create-guild screen.
  if (account.guilds.length === 0 && !['create-guild', 'changes'].includes(currentView().view)) window.history.replaceState(null, '', '#/create-guild')
  const { view, id, sub } = currentView()
  const character = view === 'character' ? account.getCharacter(id) : undefined
  const focusKey = document.activeElement?.dataset?.focusKey
  // Scrolled lists keep their place over a re-render.
  const scrolled = new Map([...app.querySelectorAll('[data-scroll-key]')].map((e) => [e.dataset.scrollKey, e.scrollTop]))

  document.getElementById('accountName').textContent = account.accountName
  document.getElementById('accountLabel').hidden = !account.accountName

  if (character && sub === 'talents') {
    const change = (fn) => { fn(); save(); render() }
    app.replaceChildren(renderTalents({
      character,
      onLearn: (key) => change(() => character.learnTalent(key)),
      onUnlearn: (key) => change(() => character.unlearnTalent(key)),
      onReset: () => change(() => character.resetTalents()),
      onDefault: () => change(() => character.useDefaultTalents()),
      onSpec: ({ spec, role }) => change(() => character.changeSpec(spec, role)),
    }))
  } else if (character) {
    app.replaceChildren(renderCharacterSheet({
      character,
      onDelete: handleDelete,
      onQueue: (name) => handleQueue(character.id, name),
      onLeaveQueue: () => handleLeaveQueue(character.id),
      onWant: (id) => handleWant(character.id, id),
    }))
  } else if (view === 'create') {
    app.replaceChildren(renderCharacterForm({ account, guildId: id, onSave: handleSave }))
  } else if (view === 'create-guild') {
    app.replaceChildren(renderGuildForm({ account, onSave: handleCreateGuild, onLoadFromFile: handleLoadFromFile }))
  } else if (view === 'farm') {
    app.replaceChildren(renderFarm({
      account,
      selectedGuild,
      selectedId: farmSelectedId,
      sortKey: farmSort,
      onSelectGuild: handleSelectGuild,
      onSelect: handleFarmSelect,
      onSort: (key) => { farmSort = key; render() },
      onSend: handleSend,
      onRecall: handleRecall,
    }))
  } else if (view === 'pvp') {
    app.replaceChildren(renderWorldPvp({ account, encounterId: id }))
  } else if (view === 'dungeons') {
    app.replaceChildren(renderDungeons({ account, runId: id }))
  } else if (view === 'changes') {
    app.replaceChildren(renderChanges())
  } else {
    app.replaceChildren(renderRoster({
      account,
      selectedGuild,
      sortKey: rosterSort,
      backup: { at: lastBackup(), overdue: backupOverdue(account) },
      onSelectGuild: handleSelectGuild,
      onSort: (key) => { rosterSort = key; render() },
      onSaveToFile: handleSaveToFile,
      onLoadFromFile: handleLoadFromFile,
    }))
  }

  for (const link of document.querySelectorAll('.site-nav a')) {
    const active = view !== 'changes' && link.dataset.view === (['farm', 'pvp', 'dungeons'].includes(view) ? view : 'roster')
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  updateGold()
  document.title = `${app.querySelector('#view-title').textContent} · ${APP_TITLE}`

  // Keep keyboard focus on the same control after a re-render (e.g. Send becomes Recall).
  const refocus = focusKey && [...app.querySelectorAll('[data-focus-key]')].find((e) => e.dataset.focusKey === focusKey)
  if (refocus) refocus.focus()
  else app.querySelector('[data-autofocus]')?.focus()
  for (const e of app.querySelectorAll('[data-scroll-key]')) if (scrolled.has(e.dataset.scrollKey)) e.scrollTop = scrolled.get(e.dataset.scrollKey)
}

// Each guild's gold, whole gold only, in its faction's color. There is no account-wide total.
function updateGold() {
  goldEl.replaceChildren(...account.guilds.map((g, i) =>
    el('span', { class: `guild-gold faction-${g.faction.toLowerCase()}` }, (i > 0 || account.accountName) && ' · ', el('strong', {}, g.guildName), ' ',
      el('span', { class: 'money' }, el('span', { class: 'coin coin-gold' }, `${formatNumber(g.totalGold() / 10000)}g`)))))
}

function save() {
  if (stopped) return
  if (!saveAccount(account)) return showNewerSave()
  lastSave = Date.now()
}

// Stops the game without saving and asks the player to reload, which loads the newer version.
function showNewerSave() {
  stopped = true
  clearInterval(ticker)
  noticesEl.replaceChildren()
  goldEl.replaceChildren()
  document.title = `Update available · ${APP_TITLE}`
  app.replaceChildren(el('section', { class: 'update-needed', 'aria-labelledby': 'view-title' },
    el('h2', { id: 'view-title' }, 'Update available'),
    el('p', {}, 'Your save was made by a newer version of the game. Reload the page to continue.'),
    el('button', { type: 'button', class: 'button primary', 'data-autofocus': true, onclick: () => location.reload() }, 'Reload'),
  ))
  app.querySelector('[data-autofocus]').focus()
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

function reportUpgrades(upgrades) {
  for (const { character, item } of upgrades.slice(0, MAX_UPGRADE_NOTICES)) {
    notify(`${character.characterName} equipped `, el('a', { href: `#/character/${character.id}` }, `[${getItem(item).name}]`), '.')
  }
  const more = upgrades.length - MAX_UPGRADE_NOTICES
  if (more > 0) notify(`…and ${more} more gear upgrade${more === 1 ? '' : 's'}. Open a character page to see them.`)
}

function reportFights(fights) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const points = (f) => `${formatNumber(Math.floor(f.points))} honor`
  for (const f of fights.slice(0, MAX_FIGHT_NOTICES)) {
    const e = encounterRecord(f, f.id)
    const who = (m) => [account.getCharacter(m.id) ? el('a', { href: `#/character/${m.id}` }, m.name) : m.name, ` (${m.level} ${m.class})`]
    const view = [' ', el('a', { href: `#/pvp/${f.id}` }, 'View')]
    if (f.kind === 'evade') {
      notify(...headline(e, who), ` in ${f.zone}.`, ...view)
      continue
    }
    const odds = ` Sized it up at ${formatChance(f.guess)}; really ${formatChance(f.odds)}.`
    if (f.kind === 'duel') {
      notify(...headline(e, who), ` in ${f.zone}.${f.honor ? ` Honorable kill, ${points(f)}.` : ''}${odds}`, ...view)
    } else {
      const sizes = f.sides.map((s) => s.length).join('v')
      const result = f.winner === null ? 'nobody won' : `the ${f.sides[f.winner][0].faction} won`
      const tolls = [f.dead.length && plural(f.dead.length, 'death'), f.honor && `${plural(f.honor, 'honorable kill')} for ${points(f)}`].filter(Boolean)
      notify(...headline(e, who), ` in ${f.zone}. It turned into a ${sizes} brawl and ${result}${tolls.length ? ` (${tolls.join(', ')})` : ''}.`, ...view)
    }
  }
  const more = fights.length - MAX_FIGHT_NOTICES
  if (more > 0) notify(`…and ${more} more world PvP encounter${more === 1 ? '' : 's'}. See them on `, el('a', { href: '#/pvp' }, 'World PvP'), '.')
}

// One notice per character, for its latest move.
const MOVE_REASONS = {
  level: (t) => ` reached level ${t.level}`,
  quests: (t) => ` ran out of quests worth doing in ${t.from}`,
  gear: (t) => ` found ${t.from} worth less after its upgrades`,
  stuck: (t) => ` couldn't beat anything in ${t.from}`,
  wanted: () => ' set out after the item it wants',
  unwanted: () => ' stopped going after an item',
  found: () => ' got the item it wanted',
}
function reportTravels(travels) {
  const latest = new Map()
  for (const t of travels) latest.set(t.character, { ...t, count: (latest.get(t.character)?.count ?? 0) + 1 })
  for (const t of latest.values()) {
    const name = el('a', { href: `#/character/${t.character.id}` }, t.character.characterName)
    const why = t.count > 1 ? ` moved through ${t.count} zones` : MOVE_REASONS[t.reason]?.(t) ?? ' moved on'
    notify(name, `${why} and went to ${t.to}.`)
  }
}

// One notice per dungeon run.
function reportRuns(runs) {
  for (const run of runs.slice(0, MAX_RUN_NOTICES)) {
    const who = run.members.flatMap((m, i) => [i ? ', ' : '', account.getCharacter(m.id) ? el('a', { href: `#/character/${m.id}` }, m.name) : m.name])
    const quests = run.members.reduce((n, m) => n + m.quests.length, 0)
    notify(...who, `: ${runHeadline(run).replace(/^./, (c) => c.toLowerCase())}${quests ? ` and turned in ${quests} quest${quests === 1 ? '' : 's'}` : ''}. `, el('a', { href: `#/dungeons/${run.id}` }, 'View'))
  }
  const more = runs.length - MAX_RUN_NOTICES
  if (more > 0) notify(`…and ${more} more dungeon run${more === 1 ? '' : 's'}. See them on `, el('a', { href: '#/dungeons' }, 'Dungeons'), '.')
}

// One notice per character whose PvP rank changed at the honor reset.
function reportRanks(ranks) {
  for (const { character, from, to } of ranks) {
    const name = el('a', { href: `#/character/${character.id}` }, character.characterName)
    notify(name, to > 0 ? ` ${to > from ? 'rose' : 'fell'} to ${character.rankTitle} (Rank ${to}).` : ' lost its PvP rank.')
  }
}

// One notice per character that got the item it wanted.
function reportWanted(wanted) {
  for (const { character, item } of wanted) {
    notify(el('a', { href: `#/character/${character.id}` }, character.characterName), ` got the item it wanted: [${getItem(item).name}].`)
  }
}

function gameTick() {
  if (stopped) return
  const { levelUps, upgrades, fights, travels, errands, runs, ranks, wanted } = account.tick()
  reportLevelUps(levelUps)
  reportTravels(travels)
  reportWanted(wanted)
  reportUpgrades(upgrades)
  reportFights(fights)
  reportRuns(runs)
  reportRanks(ranks)
  if (levelUps.length || upgrades.length || fights.length || travels.length || errands.length || runs.length || ranks.length || wanted.length) {
    if (!busy()) render()
    save()
  } else if (currentView().view === 'farm') {
    updateFarm(app, account)
  }
  // At the midnight reset more characters can be created; refresh screens that say so.
  if (Date.now() >= createReset) {
    createReset = Account.nextCreateReset()
    if (!busy()) render()
  }
  updateGold()
  if (Date.now() - lastSave >= SAVE_EVERY_MS) save()
  checkForUpdate()
  remindBackup()
}

// Asks the server whether a newer version is deployed, at most every `gap` ms, until there is one.
function checkForUpdate(gap = UPDATE_CHECK_MS) {
  if (updateFound || stopped || Date.now() - lastUpdateCheck < gap) return
  lastUpdateCheck = Date.now()
  newerBuild().then((live) => { if (live && !updateFound && !stopped) showUpdate(live.version) })
}

// A banner under the header until the player reloads. The game keeps running meanwhile.
function showUpdate(version) {
  updateFound = true
  updateEl.replaceChildren(
    el('p', {}, version && version !== VERSION ? `Version ${version} is out.` : 'An update is out.', ' Reload to get it. Your progress is saved.'),
    el('button', { type: 'button', class: 'button primary small', onclick: () => { save(); location.reload() } }, 'Reload'),
  )
  updateEl.hidden = false
}

// Browsers can clear a site's data, so every BACKUP_EVERY_DAYS remind the player to save to a file (once a day).
function remindBackup() {
  if (stopped || Date.now() - remindedAt < REMIND_EVERY_MS || !backupOverdue(account)) return
  remindedAt = Date.now()
  const at = lastBackup()
  notify(at ? `Your last backup was ${formatDaysAgo(at)}.` : "You haven't saved a backup yet.",
    ' Browsers sometimes clear saved games, so keep a copy. ',
    el('button', { type: 'button', class: 'button small', onclick: (event) => { event.target.closest('.notice').remove(); handleSaveToFile() } }, 'Save to file'))
}

// The form checked the account it was drawn with. Another tab may have changed it since (see the storage
// listener), so check again.
function handleSave(character, guildId) {
  const guild = account.getGuild(guildId)
  if (account.isNameTaken(character.characterName)) return notify(`You already have a character named ${character.characterName}.`)
  if (!account.addCharacter(character, guildId)) return notify((guild && cantCreateReason(account, guild)) || `${character.characterName} could not be created.`)
  save()
  location.hash = '#/roster'
}

function handleCreateGuild({ guildName, faction }) {
  const guild = new Guild({ guildName, faction })
  if (!account.addGuild(guild)) return notify(account.canFoundGuild(faction) ? `You already have a guild named ${Guild.formatName(guildName)}.` : `You already have a ${faction} guild.`)
  selectedGuild = guild.id
  save()
  requestPersistentStorage()
  notify(`${guild.guildName} (${faction}) was founded.`)
  location.hash = '#/roster'
}

function handleSelectGuild(guildId) {
  selectedGuild = guildId
  render()
  app.querySelector('.chip[aria-pressed="true"]')?.focus()
}

function handleFarmSelect(characterId) {
  farmSelectedId = characterId
  render()
  // On a phone the zones are far below the character cards.
  if (window.matchMedia?.('(max-width: 640px)').matches) app.querySelector('.zone-tables')?.scrollIntoView({ block: 'start' })
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

function handleQueue(characterId, dungeonName) {
  if (account.queueDungeon(characterId, dungeonName)) save()
  render()
}

function handleLeaveQueue(characterId) {
  account.leaveDungeonQueue(characterId)
  save()
  render()
}

function handleWant(characterId, id) {
  if (account.wantItem(characterId, id)) save()
  render()
}

function handleDelete(character) {
  account.deleteCharacter(character.id)
  save()
  notify(`${character.characterName} was deleted.`)
  location.hash = '#/roster'
}

async function handleSaveToFile() {
  save()
  let file
  try {
    file = await saveAccountToFile(account)
  } catch (error) {
    console.error('Could not write the save file.', error)
    return notify('The save file could not be written.')
  }
  if (file) {
    markBackup()
    requestPersistentStorage()
    notify(file.picked ? `Saved ${file.name}.` : `Saved ${file.name} to your downloads.`)
    if (!busy()) render() // the roster says when you last saved one
  }
}

async function handleLoadFromFile() {
  let file
  try {
    file = await pickSaveFile()
  } catch (error) {
    console.error('Could not read the save file.', error)
    return notify('The file could not be read.')
  }
  if (!file || stopped) return
  let backup
  try {
    backup = readSave(file.text)
  } catch {
    return notify(`${file.name} isn't a save file.`)
  }
  if (backup.newer) return notify(`${file.name} was made by a newer version of the game. Reload the page to update, then load it again.`)
  if (account.guilds.length === 0) useBackup(file.name, backup)
  else confirmLoad(file.name, backup)
}

// e.g. "3 characters in <TYMF> and <South Bank Satellites>"
function describeAccount(a) {
  if (a.guilds.length === 0) return 'no guilds'
  const n = a.characters.length
  return `${n} character${n === 1 ? '' : 's'} in ${a.guilds.map((g) => `<${g.guildName}>`).join(' and ')}`
}

function confirmLoad(name, backup) {
  const played = new Date(backup.account.lastTick).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'load-title', 'aria-describedby': 'load-text', onclose: () => dialog.remove() },
    el('h3', { id: 'load-title' }, `Load ${name}?`),
    el('p', { id: 'load-text' }, `It has ${describeAccount(backup.account)}, last played ${played}. It replaces your ${describeAccount(account)}. This can't be undone, so save to file first if you want to keep them.`),
    el('div', { class: 'modal-actions' },
      el('button', { type: 'button', class: 'button', autofocus: true, onclick: () => dialog.close() }, 'Cancel'),
      el('button', { type: 'button', class: 'button danger', onclick: () => { dialog.close(); useBackup(name, backup) } }, 'Load save'),
    ),
  )
  app.append(dialog)
  dialog.showModal()
}

// Replaces the account with a loaded save. Time since the save was last played pays out as time away.
function useBackup(name, backup) {
  account = backup.account
  selectedGuild = null
  farmSelectedId = null
  save()
  markBackup()
  requestPersistentStorage()
  welcomeBack(backup.dropped)
  notify(`Loaded ${name}.`)
  if (location.hash === '#/roster') render()
  else location.hash = '#/roster'
}

// Pay out anything earned while the page was closed. Saves record time to the last tick, so a second is the
// shortest time away we can tell.
function welcomeBack(dropped = loaded.dropped) {
  const away = account.tick()
  if (away.awayHours * 3600 >= TICK_MS / 1000) {
    reportFights(away.fights)
    reportRuns(away.runs)
    reportUpgrades(away.upgrades)
    reportTravels(away.travels)
    reportLevelUps(away.levelUps)
    reportRanks(away.ranks)
    reportWanted(away.wanted)
    const battles = away.fights.filter((f) => f.kind !== 'evade')
    const kills = battles.reduce((sum, f) => sum + f.honor, 0)
    const honor = battles.reduce((sum, f) => sum + f.points, 0)
    const fought = battles.length ? ` Your characters fought ${battles.length} time${battles.length === 1 ? '' : 's'} in contested zones (${kills} honorable kill${kills === 1 ? '' : 's'}${kills ? `, ${formatNumber(Math.floor(honor))} honor` : ''}).` : ''
    const cleared = away.runs.filter((r) => r.success).length
    const dungeons = away.runs.length ? ` They ran ${away.runs.length} dungeon${away.runs.length === 1 ? '' : 's'} (${cleared} cleared).` : ''
    const equipped = away.upgrades.length ? ` Your characters equipped ${away.upgrades.length} new item${away.upgrades.length === 1 ? '' : 's'}.` : ''
    const duration = away.awayHours < 1 / 60 ? `${Math.floor(away.awayHours * 3600)}s` : formatDuration(away.awayHours)
    const capped = away.hours < away.awayHours ? ` Your characters worked for the last ${MAX_AWAY_HOURS} hours of it, the most they can.` : ''
    notify(`Welcome back! You were away for ${duration}.${capped}${equipped}${fought}${dungeons}`)
    save()
  }
  if (dropped > 0) {
    notify(`${dropped} saved character${dropped === 1 ? '' : 's'} ${dropped === 1 ? 'was' : 'were'} invalid (non-Classic, or no guild of ${dropped === 1 ? 'its' : 'their'} faction) and removed.`)
    save()
  }
}

window.addEventListener('hashchange', () => {
  render()
  window.scrollTo(0, 0)
})
window.addEventListener('pagehide', save)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save()
  else checkForUpdate(60 * 1000) // back to the tab: check soon, maybe after days away
})
// Another tab saved: take its state, so open tabs don't keep overwriting each other's runs and fights.
window.addEventListener('storage', (event) => {
  if (stopped || event.key !== STORAGE_KEY || !event.newValue) return
  const next = loadAccount()
  if (next.newer) return showNewerSave()
  account = next.account
  if (!busy()) render()
})

document.getElementById('version').textContent = `v${VERSION}`
document.getElementById('report').href = `${BUG_REPORT_URL}?${new URLSearchParams({
  body: `Version: v${VERSION} (${BUILD})\nBrowser: ${navigator.userAgent}\n\nWhat happened?\n\n\nWhat did you expect to happen?\n`,
})}`
registerServiceWorker()

if (loaded.newer) {
  showNewerSave()
} else {
  welcomeBack()
  if (unseenChanges().length) notify(`Updated to v${VERSION}. `, el('a', { href: '#/changes' }, "See what's new"), '.')
  remindBackup()
  ticker = setInterval(gameTick, TICK_MS)
  render()
}