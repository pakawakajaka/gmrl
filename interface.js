import { renderCharacterForm } from './character-form.js'
import { renderCharacterSheet } from './character-sheet.js'
import { MAX_LEVEL } from './data.js'
import { el, formatChance, formatDuration, formatMoney, formatNumber, money } from './dom.js'
import { renderFarm, updateFarm } from './farm.js'
import { getItem } from './gear.js'
import { renderRoster } from './roster.js'
import { DEFAULT_SORT } from './sort.js'
import { renderTalents } from './talents-view.js'
import { STORAGE_KEY, createDefaultAccount, loadAccount, saveAccount, saveAccountToFile } from './storage.js'
import { renderWorldPvp, headline } from './world-pvp.js'
import { renderDungeons, runHeadline } from './dungeons-view.js'
import { encounterRecord } from './pvp.js'

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
let selectedGuild = null
let farmSelectedId = null
let rosterSort = DEFAULT_SORT
let farmSort = DEFAULT_SORT
let lastSave = Date.now()

function currentView() {
  const [view, id, sub] = location.hash.replace(/^#\/?/, '').split('/')
  return { view, id, sub }
}

function render() {
  const { view, id, sub } = currentView()
  const character = view === 'character' ? account.getCharacter(id) : undefined
  const focusKey = document.activeElement?.dataset?.focusKey

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
    app.replaceChildren(renderCharacterForm({ account, onSave: handleSave }))
  } else if (view === 'farm') {
    app.replaceChildren(renderFarm({
      account,
      selectedId: farmSelectedId,
      sortKey: farmSort,
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
      onReset: handleReset,
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

// One notice per character, for its latest move along its leveling path.
function reportTravels(travels) {
  const latest = new Map()
  for (const t of travels) latest.set(t.character, { ...t, count: (latest.get(t.character)?.count ?? 0) + 1 })
  for (const { character, from, to, reason, level, count } of latest.values()) {
    const name = el('a', { href: `#/character/${character.id}` }, character.characterName)
    const why = count > 1 ? ` followed its leveling path through ${count} zones` : reason === 'level' ? ` reached level ${level}` : ` finished the quests in ${from}`
    notify(name, `${why} and moved on to ${to}.`)
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

function gameTick() {
  const { levelUps, upgrades, fights, travels, errands, runs } = account.tick()
  reportLevelUps(levelUps)
  reportTravels(travels)
  reportUpgrades(upgrades)
  reportFights(fights)
  reportRuns(runs)
  if (levelUps.length || upgrades.length || fights.length || travels.length || errands.length || runs.length) {
    if (!app.querySelector('dialog[open]')) render() // don't close an open modal; the next render catches up
    save()
  } else if (currentView().view === 'farm') {
    updateFarm(app, account)
  }
  updateGold()
  if (Date.now() - lastSave >= SAVE_EVERY_MS) save()
}

function handleSave(character, guildNames) {
  account.addCharacter(character, guildNames)
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
if (away.hours >= 1 / 60 && (away.copper >= 1 || away.levelUps.length || away.fights.length || away.runs.length)) {
  reportFights(away.fights)
  reportRuns(away.runs)
  reportUpgrades(away.upgrades)
  reportTravels(away.travels)
  reportLevelUps(away.levelUps)
  const battles = away.fights.filter((f) => f.kind !== 'evade')
  const kills = battles.reduce((sum, f) => sum + f.honor, 0)
  const honor = battles.reduce((sum, f) => sum + f.points, 0)
  const fought = battles.length ? ` Your characters fought ${battles.length} time${battles.length === 1 ? '' : 's'} in contested zones (${kills} honorable kill${kills === 1 ? '' : 's'}${kills ? `, ${formatNumber(Math.floor(honor))} honor` : ''}).` : ''
  const cleared = away.runs.filter((r) => r.success).length
  const dungeons = away.runs.length ? ` They ran ${away.runs.length} dungeon${away.runs.length === 1 ? '' : 's'} (${cleared} cleared).` : ''
  notify(`Welcome back! While you were away for ${formatDuration(away.hours)}, your characters earned ${formatMoney(away.copper)}${away.upgrades.length ? ` and equipped ${away.upgrades.length} new item${away.upgrades.length === 1 ? '' : 's'}` : ''}.${fought}${dungeons}`)
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
// Another tab saved: take its state, so open tabs don't keep overwriting each other's runs and fights.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return
  account = loadAccount().account
  if (!app.querySelector('dialog[open]')) render()
})
setInterval(gameTick, TICK_MS)
render()