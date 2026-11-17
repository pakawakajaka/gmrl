import { renderCharacterForm } from './character-form.js'
import { renderCharacterSheet } from './character-sheet.js'
import { MAX_LEVEL } from './data.js'
import { el, formatChance, formatDuration, formatNumber } from './dom.js'
import { renderFarm, updateFarm } from './farm.js'
import { getItem } from './gear.js'
import Guild from './guild.js'
import { renderGuildForm } from './guild-form.js'
import { renderRoster } from './roster.js'
import { DEFAULT_SORT } from './sort.js'
import { renderTalents } from './talents-view.js'
import { STORAGE_KEY, loadAccount, saveAccount, saveAccountToFile } from './storage.js'
import { renderWorldPvp, headline } from './world-pvp.js'
import { renderDungeons, runHeadline } from './dungeons-view.js'
import { encounterRecord } from './pvp.js'
import { MAX_AWAY_HOURS } from './account.js'

const APP_TITLE = 'Guild Master Raid Leader'
const TICK_MS = 1000
const SAVE_EVERY_MS = 15000
const MAX_NOTICES = 4
const MAX_UPGRADE_NOTICES = 3
const MAX_FIGHT_NOTICES = 2
const MAX_RUN_NOTICES = 2

const app = document.getElementById('app')
const goldEl = document.getElementById('gold')
const noticesEl = document.getElementById('notices')

const loaded = loadAccount()
let account = loaded.account
let selectedGuild = null // a guild id, or null for all guilds
let farmSelectedId = null
let rosterSort = DEFAULT_SORT
let farmSort = DEFAULT_SORT
let lastSave = Date.now()
let stopped = false // the save is from a newer version of the game: this page must not touch it
let ticker

function currentView() {
  const [view, id, sub] = location.hash.replace(/^#\/?/, '').split('/')
  return { view, id, sub }
}

function render() {
  if (stopped) return
  const { view, id, sub } = currentView()
  const character = view === 'character' ? account.getCharacter(id) : undefined
  const focusKey = document.activeElement?.dataset?.focusKey
  // Scrolled lists keep their place over a re-render.
  const scrolled = new Map([...app.querySelectorAll('[data-scroll-key]')].map((e) => [e.dataset.scrollKey, e.scrollTop]))

  document.getElementById('accountName').textContent = account.accountName

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
    }))
  } else if (view === 'create') {
    app.replaceChildren(renderCharacterForm({ account, guildId: id, onSave: handleSave }))
  } else if (view === 'create-guild') {
    app.replaceChildren(renderGuildForm({ account, onSave: handleCreateGuild }))
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
  } else {
    app.replaceChildren(renderRoster({
      account,
      selectedGuild,
      sortKey: rosterSort,
      onSelectGuild: handleSelectGuild,
      onSort: (key) => { rosterSort = key; render() },
      onSaveToFile: handleSaveToFile,
    }))
  }

  for (const link of document.querySelectorAll('.site-nav a')) {
    const active = link.dataset.view === (['farm', 'pvp', 'dungeons'].includes(view) ? view : 'roster')
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
  goldEl.replaceChildren(...account.guilds.map((g) =>
    el('span', { class: `guild-gold faction-${g.faction.toLowerCase()}` }, ' · ', el('strong', {}, g.guildName), ' ',
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

function gameTick() {
  if (stopped) return
  const { levelUps, upgrades, fights, travels, errands, runs, ranks } = account.tick()
  reportLevelUps(levelUps)
  reportTravels(travels)
  reportUpgrades(upgrades)
  reportFights(fights)
  reportRuns(runs)
  reportRanks(ranks)
  if (levelUps.length || upgrades.length || fights.length || travels.length || errands.length || runs.length || ranks.length) {
    if (!app.querySelector('dialog[open]')) render() // don't close an open modal; the next render catches up
    save()
  } else if (currentView().view === 'farm') {
    updateFarm(app, account)
  }
  updateGold()
  if (Date.now() - lastSave >= SAVE_EVERY_MS) save()
}

function handleSave(character, guildId) {
  if (!account.addCharacter(character, guildId)) return
  save()
  location.hash = '#/roster'
}

function handleCreateGuild({ guildName, faction }) {
  const guild = new Guild({ guildName, faction })
  if (!account.addGuild(guild)) return
  selectedGuild = guild.id
  save()
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

function handleDelete(character) {
  account.deleteCharacter(character.id)
  save()
  notify(`${character.characterName} was deleted.`)
  location.hash = '#/roster'
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

// Pay out anything earned while the page was closed. Saves record time to the last tick, so a second is the
// shortest time away we can tell.
function welcomeBack() {
  const away = account.tick()
  if (away.awayHours * 3600 >= TICK_MS / 1000) {
    reportFights(away.fights)
    reportRuns(away.runs)
    reportUpgrades(away.upgrades)
    reportTravels(away.travels)
    reportLevelUps(away.levelUps)
    reportRanks(away.ranks)
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
  if (loaded.dropped > 0) {
    notify(`${loaded.dropped} saved character${loaded.dropped === 1 ? '' : 's'} ${loaded.dropped === 1 ? 'was' : 'were'} invalid (non-Classic, or no guild of ${loaded.dropped === 1 ? 'its' : 'their'} faction) and removed.`)
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
})
// Another tab saved: take its state, so open tabs don't keep overwriting each other's runs and fights.
window.addEventListener('storage', (event) => {
  if (stopped || event.key !== STORAGE_KEY || !event.newValue) return
  const next = loadAccount()
  if (next.newer) return showNewerSave()
  account = next.account
  if (!app.querySelector('dialog[open]')) render()
})

if (loaded.newer) {
  showNewerSave()
} else {
  welcomeBack()
  ticker = setInterval(gameTick, TICK_MS)
  render()
}