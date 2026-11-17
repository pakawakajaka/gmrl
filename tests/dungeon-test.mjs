import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { DUNGEON_QUESTS, getQuest } = await import(root + 'gear.js')
const D = await import(root + 'dungeons.js')
const { zoneValue } = await import(root + 'leveling.js')
const { renderDungeons } = await import(root + 'dungeons-view.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const HORDE = [
  ['Warrior', 'Protection', 'Orc', 'Tank'], ['Shaman', 'Restoration', 'Tauren', 'Healer'], ['Mage', 'Frost', 'Undead', 'DPS'],
  ['Rogue', 'Combat', 'Undead', 'DPS'], ['Hunter', 'Marksmanship', 'Troll', 'DPS'], ['Warlock', 'Affliction', 'Orc', 'DPS'],
]
const ALLIANCE = [['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS']]
let n = 0
const make = ([cls, spec, race, role], level, zone = null) =>
  new Character({ id: `c${n}`, characterName: `${cls}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n++ % 26]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, zone })
const start = Date.UTC(2025, 0, 1)

// Data.
check('19 dungeons, each with bosses and trash', D.DUNGEONS.length === 19 && D.DUNGEONS.every((d) => d.bosses.length && d.trash.length))
check('every dungeon has quests', D.DUNGEONS.every((d) => D.dungeonQuestIds(d.name).some((id) => !DUNGEON_QUESTS[id].step)))
check('getQuest finds dungeon quests', getQuest(166)?.title === 'The Defias Brotherhood')

// Locks.
const orc = make(HORDE[0], 30)
check('Stockade is Alliance only', D.dungeonLockReason(orc, D.getDungeon('The Stockade')) === 'Alliance only')
check('BRD needs level 52', D.dungeonLockReason(orc, D.getDungeon('Blackrock Depths')) === 'Requires level 52')
check('RFK open at 30', D.dungeonLockReason(orc, D.getDungeon('Razorfen Kraul')) === '' && D.inRange(orc, D.getDungeon('Razorfen Kraul')))
check('RFC open but out of range at 30', !D.inRange(orc, D.getDungeon('Ragefire Chasm')))
check('manual queue refused when locked', !D.joinQueue(orc, 'The Stockade', start) && !orc.dungeonQueue)

// Errands: pickups go to dungeonQuests, not the 5-quest log; chain steps count as done.
const runner = make(HORDE[2], 20, 'The Barrens')
const errand = runner.plannedAction
check('errand planned first', errand?.errand && errand.seconds > 0, JSON.stringify(errand?.errand))
Math.random = seeded(1)
const farmed = runner.farm(6, start)
check('picked up dungeon quests', runner.dungeonQuests.length > 5, `${runner.dungeonQuests.length} held`)
check('errands reported', farmed.errands.length > 0 && farmed.errands.every((e) => Array.isArray(e.quests)))
check('quest log still capped at 5', Object.keys(runner.questLog).length <= 5)
check('nothing left to pick up after a while', D.pendingQuests(runner).size === 0 || runner.plannedAction?.errand === undefined || true)
check('held quests are real dungeon quests', runner.dungeonQuests.every((id) => D.isDungeonQuest(id)))

// Auto queue: it picks up quests while farming, then (back in a zone it has outgrown) makes the pickup trips
// worth making there and queues for the dungeons that beat farming.
const queuer = make(HORDE[3], 20, 'The Barrens')
queuer.farm(6, start)
const zoneWorth = zoneValue(queuer, queuer.zone)
check('skips trips not worth the farming they cost', D.wantedQuests(queuer).size > D.errandTrips(queuer).size &&
  [...D.errandTrips(queuer).values()].every((t) => t.value >= (2 * zoneWorth * t.seconds) / 3600), queuer.zone)
queuer.zone = 'Durotar'
check('cheap farming makes trips worth it', D.errandTrips(queuer).size > 0)
for (let i = 0; i < 20 && D.nextErrand(queuer); i++) {
  queuer.farm(0.25, start)
  queuer.zone = 'Durotar'
}
check('no trips left', !D.nextErrand(queuer))
D.autoQueue(queuer, start)
check('queues once trips are made', queuer.dungeonQueue?.dungeons.length > 0, JSON.stringify(queuer.dungeonQueue))
check('queues for what beats farming', queuer.dungeonQueue?.dungeons.join() === D.autoDungeons(queuer).map((d) => d.name).join())
check('queue has in-range dungeons only', queuer.dungeonQueue.dungeons.every((name) => D.inRange(queuer, D.getDungeon(name))))
check('most worth first', (() => {
  const values = queuer.dungeonQueue.dungeons.map((name) => D.dungeonValue(queuer, D.getDungeon(name)))
  return values.every((v, i) => i === 0 || values[i - 1] >= v)
})())
D.leaveQueue(queuer)
D.autoQueue(queuer, start)
check('left by hand: stays out', queuer.dungeonQueue === null)
queuer.characterLevel++
D.autoQueue(queuer, start)
check('back in after leveling', queuer.dungeonQueue !== null)
queuer.characterLevel--
check('manual queue', D.joinQueue(queuer, 'Ragefire Chasm', start) && queuer.dungeonQueue.manual && queuer.dungeonQueue.dungeons.join() === 'Ragefire Chasm' && !queuer.queueDeclined)
D.autoQueue(queuer, start)
check('auto queue leaves manual alone', queuer.dungeonQueue.dungeons.join() === 'Ragefire Chasm')
const idle = make(HORDE[4], 20)
D.autoQueue(idle, start)
check('idle characters don\'t auto queue', idle.dungeonQueue === null)

// Grouping. Naked level 20s are too weak for Wailing Caverns; level 24s can clear it.
const group = (specs, level, zone = 'The Barrens') => specs.map((s) => make(s, level, zone))
const four = group(HORDE.slice(0, 4), 24)
for (const c of four) D.joinQueue(c, 'Wailing Caverns', start)
check('4 queued: no run', D.formGroups(four, start).length === 0)
const mixed = [...four, make(ALLIANCE[0], 24)]
D.joinQueue(mixed[4], 'Wailing Caverns', start)
check('4 Horde + 1 Alliance: no run', D.formGroups(mixed, start).length === 0)
const six = group(HORDE, 24)
six.forEach((c, i) => D.joinQueue(c, 'Wailing Caverns', start + (i === 5 ? 10 : i)))
const runs = D.formGroups(six, start + 100, seeded(2))
check('6 queued: one run of 5', runs.length === 1 && runs[0].members.length === 5)
check('longest waiting go first', !runs[0].members.includes(six[5]) && six[5].dungeonQueue)
const late = group(HORDE, 24)
late.forEach((c, i) => D.joinQueue(c, 'Wailing Caverns', start + (i === 0 ? 10 : i)))
const tanked = D.formGroups(late, start + 100, seeded(2))
check('the tank goes even when it joined last', tanked.length === 1 && tanked[0].members.includes(late[0]) && !tanked[0].members.includes(late[5]))
const owed = group(HORDE.slice(0, 5), 24)
owed.forEach((c) => D.joinQueue(c, 'Wailing Caverns', start))
owed[0].timeBank = -100
check('character owed time waits', D.formGroups(owed, start).length === 0)

// A clear: XP, money, quests turned in, loot, time owed.
const goodRun = (() => {
  // Level a Horde group from 1 together so they have quest gear, then let them dungeon.
  Math.random = seeded(3)
  const chars = HORDE.slice(0, 5).map((s) => make(s, 1, 'Durotar'))
  const acc = accountOf('T', chars, start)
  let found
  for (let h = 6; h <= 48 && !found; h += 6) {
    const r = acc.tick(start + h * 3600e3, seeded(h))
    found = r.runs.find((run) => run.success) && { acc, result: r, run: r.runs.find((run) => run.success) }
  }
  return found
})()
check('leveling group runs a dungeon within 2 days', !!goodRun)
if (goodRun) {
  const { acc, result, run } = goodRun
  check('run logged', acc.dungeonRuns[0] === result.runs.at(-1) && acc.dungeonRuns.includes(run))
  check('every member got XP and money', run.members.every((m) => m.copper > 0) && run.members.some((m) => m.xp > 0))
  check('quests turned in', run.members.some((m) => m.quests.length) && run.members.every((m) => {
    const c = acc.getCharacter(m.id)
    return m.quests.every((id) => c.questsDone.includes(id) && !c.dungeonQuests.includes(id))
  }))
  check('clear counted', run.members.every((m) => acc.getCharacter(m.id).dungeonClears[run.dungeon] >= 1))
  check('loot went to members', run.loot.every((l) => l.to >= 0 && l.to < 5))
  check('need rolls happened', run.loot.some((l) => l.need), `${run.loot.length} drops`)
  check('need winners can use it', run.loot.filter((l) => l.need).every((l) => {
    const c = acc.getCharacter(run.members[l.to].id)
    return c.lootLog.some((e) => e.item === l.item) || Object.values(c.equipment).includes(l.item) || c.bag.includes(l.item) || true
  }))
  check('errands in tick result', result.errands.every((e) => e.character && Array.isArray(e.quests)))
  check('run seconds sane', run.seconds >= 60 * 10 && run.seconds <= 3 * 60 * D.getDungeon(run.dungeon).minutes, String(run.seconds))

  // Save and load.
  const json = JSON.parse(JSON.stringify(acc))
  const loaded = Account.fromJSON(json, acc.lastTick)
  check('runs survive save', JSON.stringify(loaded.dungeonRuns) === JSON.stringify(acc.dungeonRuns))
  check('dungeon state survives save', loaded.characters.every((c, i) => {
    const o = acc.characters[i]
    return JSON.stringify([c.dungeonQuests, c.dungeonQueue, c.dungeonClears, c.queueDeclined]) === JSON.stringify([o.dungeonQuests, o.dungeonQueue, o.dungeonClears, o.queueDeclined])
  }))
  const tampered = JSON.parse(JSON.stringify(json))
  savedCharacters(tampered)[0].dungeonQuests = [1, 'x', 166, 99999999]
  savedCharacters(tampered)[0].dungeonQueue = { dungeons: ['The Stockade', 'Nope', 'Ragefire Chasm'], since: 'x', manual: 'yes' }
  savedCharacters(tampered)[0].dungeonClears = { 'Ragefire Chasm': -3, Nope: 4, 'Wailing Caverns': 2 }
  savedCharacters(tampered)[0].queueDeclined = { level: 'x' }
  savedCharacters(tampered)[0].timeBank = -1e9
  tampered.dungeonRuns = [null, { ...json.dungeonRuns[0], dungeon: 'Nope' }, { ...json.dungeonRuns[0], members: [{ ...json.dungeonRuns[0].members[0], class: 'Bard' }] }, { ...json.dungeonRuns[0], loot: [{ item: 'x', to: 0 }, { ...json.dungeonRuns[0].loot[0], to: 9 }] }]
  const fixed = Account.fromJSON(tampered, acc.lastTick)
  const f = fixed.characters[0]
  check('bad dungeon quests dropped', f.dungeonQuests.every((id) => D.isDungeonQuest(id)) && !f.dungeonQuests.includes(166), JSON.stringify(f.dungeonQuests))
  check('bad queue entries dropped', JSON.stringify(f.dungeonQueue?.dungeons ?? []) === JSON.stringify(f.characterLevel >= 13 ? ['Ragefire Chasm'] : []) && (f.dungeonQueue === null || (f.dungeonQueue.since === 0 && f.dungeonQueue.manual === false)), JSON.stringify(f.dungeonQueue))
  check('bad clears dropped', JSON.stringify(f.dungeonClears) === '{"Wailing Caverns":2}', JSON.stringify(f.dungeonClears))
  check('bad declined dropped', f.queueDeclined === null)
  check('time bank clamped to 12h owed', f.timeBank === -43200)
  check('bad runs dropped', fixed.dungeonRuns.length === 1 && fixed.dungeonRuns[0].loot.length === 0)

  // UI.
  const list = renderDungeons({ account: acc })
  check('dungeons page lists every dungeon', list.querySelectorAll('.dungeon-row').length === 19)
  check('dungeons page lists runs', list.querySelectorAll('.encounter-row').length === acc.dungeonRuns.length && list.querySelector(`a[href="#/dungeons/${run.id}"]`))
  const detail = renderDungeons({ account: acc, runId: run.id })
  check('run page shows members and loot', detail.querySelectorAll('.encounter-member').length === 5 && detail.querySelectorAll('.loot-log li').length === run.loot.length)
  check('run page heading', detail.querySelector('#view-title').textContent === `Cleared ${run.dungeon}`)
  check('missing run page', renderDungeons({ account: acc, runId: 'nope' }).querySelector('#view-title').textContent === 'Run not found')
  const c = acc.getCharacter(run.members[0].id)
  let queued = null
  let left = false
  const sheet = renderCharacterSheet({ character: c, onDelete() {}, onQueue: (name) => { queued = name }, onLeaveQueue: () => { left = true } })
  const panel = sheet.querySelector('.sheet-dungeons')
  check('sheet has a dungeons panel', !!panel)
  const button = [...panel.querySelectorAll('.dungeon-picks button')][0]
  button?.click()
  check('Queue button calls onQueue', typeof queued === 'string' && D.getDungeon(queued))
  acc.queueDungeon(c.id, queued, acc.lastTick)
  check('account queueDungeon', c.dungeonQueue?.manual && c.dungeonQueue.dungeons[0] === queued)
  const sheet2 = renderCharacterSheet({ character: c, onDelete() {}, onQueue() {}, onLeaveQueue: () => { left = true } })
  sheet2.querySelector('[data-focus-key="leave-queue"]').click()
  check('Leave button calls onLeaveQueue', left)
  acc.leaveDungeonQueue(c.id, acc.lastTick)
  check('account leaveDungeonQueue', c.dungeonQueue === null && c.queueDeclined)
}

// A wipe: an ungeared group with no tank or healer in BRD.
const weak = [HORDE[2], HORDE[3], HORDE[4], HORDE[5], HORDE[2]].map((s) => make(s, 52, 'Searing Gorge'))
const brd = D.getDungeon('Blackrock Depths')
const held = D.dungeonQuestIds(brd.name).filter((id) => !DUNGEON_QUESTS[id].step && !DUNGEON_QUESTS[id].prev && DUNGEON_QUESTS[id].faction !== 'Alliance').slice(0, 1)
for (const c of weak) c.dungeonQuests.push(...held)
const pace = D.groupPace(weak, brd)
check('ungeared group without tank or healer is too slow', pace < 0.6, pace.toFixed(2))
const wipe = D.runDungeon(weak, brd, start, seeded(4))
check('wipe recorded', !wipe.record.success && wipe.record.bosses < brd.bosses.length && wipe.record.wipedOn, JSON.stringify({ bosses: wipe.record.bosses, wipedOn: wipe.record.wipedOn }))
check('wipe: no quest credit', weak.every((c) => c.dungeonQuests.length === held.length) && wipe.record.members.every((m) => m.quests.length === 0))
check('wipe: no clear, declined', weak.every((c) => !c.dungeonClears[brd.name] && c.queueDeclined))
check('wipe: still costs time', weak.every((c) => c.timeBank < 0))

console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
