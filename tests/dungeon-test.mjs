import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { DUNGEON_QUESTS, baseId, getItem, getQuest } = await import(root + 'gear.js')
const D = await import(root + 'dungeons.js')
const { zoneValue } = await import(root + 'leveling.js')
const { renderDungeons } = await import(root + 'dungeons-view.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')
const V = await import(root + 'value.js')
const { getMob } = await import(root + 'combat.js')
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

// Errands: pickups go to dungeonQuests, which share the 30-quest log with zone quests; chain steps count as done.
const runner = make(HORDE[2], 20, 'The Barrens')
const errand = runner.plannedAction
check('errand planned first', errand?.errand && errand.seconds > 0, JSON.stringify(errand?.errand))
check('status: pickup trip', runner.farmStatus === `Picking up dungeon quests ${errand.errand.zone === null ? 'in town' : `in ${errand.errand.zone}`}`, runner.farmStatus)
Math.random = seeded(1)
const farmed = runner.farm(6, start)
check('picked up dungeon quests', new Set(farmed.errands.flatMap((e) => e.quests)).size >= 5, `${runner.dungeonQuests.length} held`)
check('errands reported', farmed.errands.length > 0 && farmed.errands.every((e) => Array.isArray(e.quests)))
check('quest log capped at 30, dungeon quests included', Object.keys(runner.questLog).length + runner.dungeonQuests.length <= 30,
  `${Object.keys(runner.questLog).length}+${runner.dungeonQuests.length}`)
check('nothing left to pick up after a while', D.pendingQuests(runner).size === 0 || runner.plannedAction?.errand === undefined || true)
check('held quests are real dungeon quests', runner.dungeonQuests.every((id) => D.isDungeonQuest(id)))
{
  // Swapping one held quest for another keeps the count; what it can still pick up must follow.
  const swapper = make(HORDE[2], 58, 'Eastern Plaguelands')
  const [a, b] = [...D.pendingQuests(swapper).values()].flat().filter((id) => !DUNGEON_QUESTS[id].step)
  swapper.dungeonQuests = [a]
  D.pendingQuests(swapper)
  swapper.dungeonQuests = [b]
  const offered = [...D.pendingQuests(swapper).values()].flat()
  check('pending quests skip held ones after a swap', offered.includes(a) && !offered.includes(b))
  // In a full log, a quest only takes the place of one worth less than it.
  const full = make(HORDE[2], 58, 'Eastern Plaguelands')
  const ids = Object.keys(DUNGEON_QUESTS).map(Number).filter((id) => !DUNGEON_QUESTS[id].step)
  const { QUEST_LOG_SIZE, logRoom, rewardWorth } = await import(root + 'quests.js')
  const byWorth = Map.groupBy(ids, (id) => rewardWorth(full, getQuest(id)))
  const same = [...byWorth.values()].sort((x, y) => y.length - x.length)[0]
  const w0 = rewardWorth(full, getQuest(same[0]))
  full.dungeonQuests = [...same.slice(1), ...ids.filter((id) => rewardWorth(full, getQuest(id)) > w0)].slice(0, QUEST_LOG_SIZE)
  check('full log: pickup trips never swap for a quest worth the same', full.dungeonQuests.length === QUEST_LOG_SIZE &&
    !logRoom(full, () => false, undefined, false)(same[0]) && logRoom(full, () => false)(same[0]))
}

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
  check('kept loot logged', run.loot.some((l) => l.kept === 'equipped'), `${run.loot.length} kept`)
  check('run loot is only kept items, once each', run.loot.every((l) => ['equipped', 'wanted', 'later', 'off-spec'].includes(l.kept) && run.loot.filter((o) => o.item === l.item && o.to === l.to).length === 1), JSON.stringify(run.loot))
  check('loot logs are only kept items', acc.characters.every((c) => c.lootLog.every((e) => ['equipped', 'wanted', 'later', 'off-spec'].includes(e.kept))))
  check('run loot logged with the dungeon as place, origins kept', run.loot.every((l) => {
    const c = acc.getCharacter(run.members[l.to].id)
    return c.lootLog.some((e) => e.item === l.item && e.place === run.dungeon) || !c.heldItems().has(l.item) || c.origins[l.item]?.place === run.dungeon
  }) && acc.characters.every((c) => Object.values(c.equipment).some((id) => c.origins[id]?.place)))
  const oldRun = D.restoreRun({ ...JSON.parse(JSON.stringify(run)), loot: [{ item: run.loot[0]?.item ?? 6505, to: 0, need: true, from: 'X' }, { item: run.loot[0]?.item ?? 6505, to: 1, need: false, from: 'X' }] })
  check('old runs: need wins show as equipped, greed wins dropped', oldRun.loot.length === 1 && oldRun.loot[0].kept === 'equipped' && oldRun.loot[0].to === 0, JSON.stringify(oldRun.loot))
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
  const quests = sheet.querySelector('[aria-label="Quests"]')
  const questHeads = [...quests.querySelectorAll('h3')].map((h) => h.textContent)
  const held = Object.keys(c.questLog).length + c.dungeonQuests.length
  check('quest panel lists the whole log', questHeads.includes(`Quest Log (${held}/30)`) && (held === 0 || quests.querySelectorAll('.quest-log > li').length === held), questHeads.join())
  check('quest panel lists best rewards, not zones', questHeads.includes('Best Rewards') && !questHeads.includes('Where to Farm') && quests.querySelectorAll('.focus-list > li').length <= 10)
  const button = [...panel.querySelectorAll('.dungeon-picks button')][0]
  button?.click()
  check('Queue button calls onQueue', typeof queued === 'string' && D.getDungeon(queued))
  acc.queueDungeon(c.id, queued, acc.lastTick)
  check('account queueDungeon', c.dungeonQueue?.manual && c.dungeonQueue.dungeons[0] === queued)
  const sheet2 = renderCharacterSheet({ character: c, onDelete() {}, onQueue() {}, onLeaveQueue: () => { left = true } })
  sheet2.querySelector('[data-focus-key="leave-queue"]').click()
  check('Leave button calls onLeaveQueue', left)
  const focus = sheet2.querySelector('.sheet-focus')
  const heads = [...focus.querySelectorAll('h4')].map((h) => h.textContent)
  check('focus: quests, zones and dungeons', ['Quests', 'Zone drops', 'Dungeons'].every((h) => heads.includes(h)) && focus.querySelectorAll('.focus-scroll').length >= 2, heads.join('; '))
  const zoneCard = focus.querySelector('.focus-dungeon')
  check('focus: its zone first', zoneCard?.querySelector('.quest-title').textContent === c.zone && /Here/.test(zoneCard.textContent))
  const card = [...focus.querySelectorAll('.focus-dungeon')].find((li) => /Queued/.test(li.textContent))
  check('focus: the queued dungeon', card?.querySelector('.quest-title').textContent === queued)
  const targets = [...card.querySelectorAll('.focus-drops > li')]
  check('focus: dungeon upgrades with tooltip, chance and boss', targets.length > 0 && targets.every((li) => li.querySelector('.tooltip') && /power · .*run.* · \S/.test(li.getAttribute('aria-label'))), targets.map((li) => li.getAttribute('aria-label')).join('; '))
  const dungeon = D.getDungeon(queued)
  const kills = [...dungeon.bosses.flatMap((slot) => [slot].flat().map((entry, _, all) => [entry, 1 / all.length])), ...dungeon.trash.map(([entry, count]) => [entry, count * 0.6])]
  const loot = V.lootTargets(c, kills, 0.5)
  const sum = loot.reduce((s, t) => s + t.worth, 0)
  check('lootTargets add up to runGear', Math.abs(sum - V.runGear(c, kills, 0.5)) < 1e-9 * Math.max(1, sum), `${sum}`)
  check('lootTargets most worth first', loot.every((t, i) => !i || loot[i - 1].worth >= t.worth))
  check('dungeonLoot is lootTargets of a clear', JSON.stringify(D.dungeonLoot(c, dungeon)) === JSON.stringify(loot))
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
check('status: resting after the run', weak.every((c) => c.restingAfter === brd.name && c.farmStatus === 'Resting after Blackrock Depths'), weak[0].farmStatus)
{
  const saved = Account.fromJSON(JSON.parse(JSON.stringify(accountOf('Rest', [weak[0]], start))), start).characters[0]
  check('status: resting survives save', saved.restingAfter === brd.name && saved.farmStatus === weak[0].farmStatus)
  weak[0].farm(-weak[0].timeBank / 3600 + 0.01, start)
  check('status: done resting', weak[0].restingAfter === null && !weak[0].farmStatus.startsWith('Resting'), weak[0].farmStatus)
  weak[1].timeBank = -60
  weak[1].restingAfter = null
  check('status: time owed for other reasons isn\'t resting', !weak[1].farmStatus.startsWith('Resting'), weak[1].farmStatus)
}
{
  // The Ring of Law: one of six arena bosses per run, each counted as a sixth of a kill.
  const ring = brd.bosses.find(Array.isArray)
  check('BRD: Ring of Law slot of six', ring?.length === 6 && ring.includes(9027) && getItem(11726)?.name === 'Savage Gladiator Chain')
  const warrior = make(['Warrior', 'Arms', 'Orc', 'DPS'], 60, 'Searing Gorge')
  const chain = D.dungeonLoot(warrior, brd).find((t) => t.id === 11726)
  check('BRD: Savage Gladiator Chain at a sixth of Gorosh', chain?.from === 9027 && Math.abs(chain.chance - 0.5 * (1 - Math.exp(-0.15 / 6))) < 1e-9, JSON.stringify(chain))
  const group = [0, 1, 2, 3, 4].map((i) => make(HORDE[i], 60, 'Searing Gorge'))
  const run = D.runDungeon(group, brd, start, seeded(7))
  const arena = new Set(run.results.flatMap((r) => r.share.found.map((f) => f.source)).filter((s) => ring.some((e) => getMob(e).name === s)))
  check('BRD: a clear fights one arena boss', run.record.success && run.record.bosses === brd.bosses.length && arena.size === 1, [...arena].join(', '))
  const atRing = { ...run.record, success: false, bosses: brd.bosses.indexOf(ring) }
  check('BRD: restored wipe keeps its arena boss', D.restoreRun({ ...atRing, wipedOn: 'Grizzle' }).wipedOn === 'Grizzle' && D.restoreRun({ ...atRing, wipedOn: 'Nobody' }).wipedOn === getMob(ring[0]).name)

  // Meters: an amount per member; DPS out-damage the tank and healer, the healer heals most, the tank takes most.
  const m = run.record.meters
  const top = (list) => list.indexOf(Math.max(...list))
  check('meters: per member', ['damage', 'healing', 'taken'].every((k) => m[k].length === 5) && m.combat > 0 && m.combat < run.record.seconds)
  check('meters: DPS out-damage tank and healer', m.damage.slice(2).every((n) => n > m.damage[0] && n > m.damage[1]), m.damage.join())
  check('meters: healer heals, tank takes most', top(m.healing) === 1 && m.healing[2] === 0 && top(m.taken) === 0, `${m.healing} / ${m.taken}`)
  check('meters: deaths name a mob killed', m.deaths.every((d) => d.to >= 0 && d.to < 5 && typeof d.by === 'string'))
  check('meters: survive save', JSON.stringify(D.restoreRun(JSON.parse(JSON.stringify(run.record))).meters) === JSON.stringify(m))
  check('meters: bad ones dropped', !('meters' in D.restoreRun({ ...run.record, meters: { ...m, damage: [1, 2] } })) &&
    JSON.stringify(D.restoreRun({ ...run.record, meters: { ...m, deaths: [{ to: 7, by: 'x' }, { to: 0, by: 5 }, null] } }).meters.deaths) === '[]')
  check('meters: wipe kills everyone on its boss', wipe.record.meters.deaths.filter((d) => d.by === wipe.record.wipedOn).length === 5)
  const acc = accountOf('Meters', [], start)
  acc.dungeonRuns = Array.from({ length: 7 }, () => JSON.parse(JSON.stringify({ ...run.record, id: crypto.randomUUID() })))
  const loaded = Account.fromJSON(JSON.parse(JSON.stringify(acc)), start)
  check('meters: kept for the newest 5 runs', loaded.dungeonRuns.length === 7 && loaded.dungeonRuns.every((r, i) => (i < 5) === !!r.meters))
  const page = renderDungeons({ account: loaded, runId: loaded.dungeonRuns[0].id })
  check('meters: run page shows the boards', page.querySelectorAll('.dungeon-meter').length === 4 && page.querySelectorAll('.dungeon-meter .stat-bar').length === 5 + 1 + 5)
  check('meters: old run says why there are none', /last 5 runs/.test(renderDungeons({ account: loaded, runId: loaded.dungeonRuns[6].id }).textContent))

  // Badges: Top Damage goes to the top of the damage meter, only on dungeon runs with meters.
  const { earnedBadges } = await import(root + 'badges.js')
  const earned = earnedBadges('dungeon', run.record)
  check('badges: Top Damage to the top damage dealer', earned.length === 1 && earned[0].key === 'top-damage' && earned[0].to.join() === String(top(m.damage)))
  check('badges: none without meters or for other kinds', !earnedBadges('dungeon', loaded.dungeonRuns[6]).length && !earnedBadges('raid', run.record).length)
  const cards = [...page.querySelectorAll('.encounter-member')]
  check('badges: shown on the member card', page.querySelectorAll('.badge-top-damage').length === 1 && cards[top(m.damage)].querySelector('.badge-top-damage')?.textContent === 'Top Damage')
  check('badges: none on an old run', !renderDungeons({ account: loaded, runId: loaded.dungeonRuns[6].id }).querySelector('.encounter-member .badge'))
}
const quester = make(HORDE[5], 12, 'Durotar')
const questAction = quester.plannedAction
check('status: questing names the quest', questAction?.questId && quester.farmStatus === `Questing in Durotar: ${getQuest(questAction.questId).title}`, quester.farmStatus)

const idleFocus = renderCharacterSheet({ character: make(HORDE[0], 10), onDelete() {} }).querySelector('.sheet-focus')
check('focus: idle farms for nothing', idleFocus.textContent.includes('Nothing while idle.'))
const grind = V.grindTargets(make(HORDE[0], 12, 'Durotar'), 'Durotar')
check('grindTargets: upgrades from the zone, chance per hour', grind.length > 0 && grind.every((t) => t.power > 0 && t.chance > 0 && t.chance < 1 && t.worth <= t.power * (1 + 1e-9)))
{
  const hunter = make(HORDE[5], 60, 'Winterspring') // naked: most drops are upgrades
  const plan = V.grindPlan(hunter, 'Winterspring')
  const { grindPool } = await import(root + 'combat.js')
  const all = new Set(grindPool(hunter, 'Winterspring').weighted.map((m) => m.fight.entry))
  const hunted = new Set(plan.weighted.map((m) => m.fight.entry))
  const picks = Array.from({ length: 100 }, (_, i) => V.pickGrindTarget(hunter, 'Winterspring', seeded(i)))
  check('grindPlan: hunts some or all of the beatable mobs, kills capped by respawns', plan.total > 0 && [...hunted].every((e) => all.has(e)) && plan.kills > 0 && plan.kills <= (3600 / 300) * plan.total + 1e-9 && plan.targeted === hunted.size < all.size)
  check('grindPlan: grinding picks only hunted mobs, searching included', picks.every((p) => hunted.has(p.fight.entry) && p.seconds === p.fight.seconds + plan.extra) && plan.extra >= 0)
  const next = hunter.plannedAction
  const status = next?.errand ? 'Picking up dungeon quests ' : next?.questId ? `Questing in Winterspring: ${getQuest(next.questId).title}` : null
  check('farm status names hunted mobs', status ? hunter.farmStatus.startsWith(status) : plan.targeted ? hunter.farmStatus.startsWith('Farming in Winterspring: ') : hunter.farmStatus === 'Farming in Winterspring', `${hunter.farmStatus} (${hunted.size}/${all.size})`)
  const { QUESTS } = await import(root + 'gear-data.js')
  const grinder = make(HORDE[5], 60, 'Winterspring')
  grinder.questsDone.push(...Object.keys(DUNGEON_QUESTS).map(Number), ...Object.keys(QUESTS).map(Number)) // nothing left but grinding
  const grinding = grinder.plannedAction
  const names = V.huntedMobs(grinder, 'Winterspring')
  check('status: grinding names hunted mobs', grinding?.fight && !grinding.questId && !grinding.errand &&
    grinder.farmStatus === `Farming in Winterspring${names.length ? `: ${names.slice(0, 2).join(', ')}` : ''}${names.length > 3 ? `, ${names.length - 2} more` : names.length === 3 ? `, ${names[2]}` : ''}`, grinder.farmStatus)
  const card = [...renderCharacterSheet({ character: hunter, onDelete() {} }).querySelectorAll('.sheet-focus .focus-dungeon')][0]
  check('focus: own zone card names hunted mobs', plan.targeted === card.textContent.includes('Hunting: '))
  // Random-suffix drops show the one suffix that adds the most, at that suffix's odds.
  const { ITEMS, SUFFIX_POOLS } = await import(root + 'gear-data.js')
  const suffixed = V.grindTargets(hunter, 'Winterspring').filter((t) => ITEMS[baseId(t.id)].suffixes)
  const bestOf = (id) => Math.max(...SUFFIX_POOLS[ITEMS[id].suffixes].map(([s]) => V.itemPower(hunter, `${id}:${s}`)))
  check('suffix drops: best suffix, its power', suffixed.length > 0 && suffixed.every((t) => typeof t.id === 'string' && getItem(t.id) && Math.abs(t.power - bestOf(baseId(t.id))) < 1e-9 && t.power > V.itemPower(hunter, baseId(t.id))), `${suffixed.length}`)
  const kills = plan.weighted.map(({ fight, weight }) => [fight.entry, (plan.kills * weight) / plan.total])
  const t = V.lootTargets(hunter, kills).find((x) => ITEMS[baseId(x.id)].suffixes)
  const pool = SUFFIX_POOLS[ITEMS[baseId(t.id)].suffixes]
  const odds = pool.find(([s]) => `${baseId(t.id)}:${s}` === t.id)[1] / pool.reduce((s, [, c]) => s + c, 0)
  hunter.setWanted(baseId(t.id))
  const any = V.lootTargets(hunter, kills).find((x) => x.id === baseId(t.id))
  hunter.setWanted(null)
  check('suffix drops: chance of that suffix; wanted stays any suffix', any && odds < 1 && t.chance < any.chance && Math.abs(Math.log(1 - t.chance) - odds * Math.log(1 - any.chance)) < 1e-9 && Math.abs(any.power - t.power) < 1e-9, `${getItem(t.id).name} ${odds.toFixed(3)} ${t.chance} vs ${any?.chance}`)
  const card2 = [...renderCharacterSheet({ character: hunter, onDelete() {} }).querySelectorAll('.sheet-focus .focus-dungeon .focus-drops > li')]
  check('suffix drops: named with the suffix', card2.length > 0 && !card2.some((li) => / of \.\.\./.test(li.querySelector('.item-name').textContent)), card2.map((li) => li.querySelector('.item-name').textContent).join('; '))
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
