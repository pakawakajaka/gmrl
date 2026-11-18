import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf } = await import('./helpers.mjs')
const { QUESTS, baseId, getItem, levelToUse, questRewardsFor } = await import(root + 'gear.js')
const W = await import(root + 'wanted.js')
const D = await import(root + 'dungeons.js')
const { nextZone } = await import(root + 'leveling.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
let n = 0
const make = (level, zone = null) => new Character({ id: `w${n}`, characterName: `Wanter${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n++ % 26]}`, characterClass: 'Warlock', characterSpec: 'Affliction', characterRace: 'Orc', characterRole: 'DPS', characterLevel: level, zone })
const start = Date.UTC(2025, 0, 1)
const PADS = 6461 // Slime-encrusted Pads, from a Wailing Caverns boss

// What can be wanted.
const c = make(22, 'The Barrens')
check('dungeon drop is wantable', W.wantable(c, PADS) === PADS && W.wantable(c, `${PADS}:1`) === PADS)
check('nonexistent item is not', W.wantable(c, 99999999) === undefined)
const plate = Object.keys(QUESTS).flatMap((id) => QUESTS[id].choice ?? []).find((id) => getItem(id)?.class === 4 && getItem(id).subclass === 4)
check('gear its class can never wear is not', plate !== undefined && W.wantable(c, plate) === undefined)
const sources = W.itemSources(c, PADS)
check('sources: the boss in Wailing Caverns', sources.mobs.length > 0 && sources.mobs[0].places.includes('Wailing Caverns') && sources.mobs[0].n > 0.1, JSON.stringify(sources.mobs[0]))
check('wanted places', (() => {
  c.setWanted(PADS)
  const places = W.wantedPlaces(c)
  c.setWanted(null)
  return places.dungeons.has('Wailing Caverns')
})())
const drops = W.placeDrops(c, 'Wailing Caverns')
check('place drops: gear it could wear, best quality first', drops.some((d) => d.id === PADS) && drops.every((d, i) => !i || getItem(drops[i - 1].id).quality >= getItem(d.id).quality) && drops.every((d) => levelToUse(c, getItem(d.id)) < Infinity))
check('place drops cached', W.placeDrops(c, 'Wailing Caverns') === drops)
const found = W.searchItems(c, 'slime-encrusted')
check('search finds by name', found.includes(PADS), JSON.stringify(found))
check('search needs a few letters', W.searchItems(c, 's').length === 0 && W.searchItems(c, 'pads').length <= W.SEARCH_RESULTS)

// Setting it.
check('setWanted', c.setWanted(PADS) && c.wanted === PADS)
check('setWanted: same again is false', !c.setWanted(PADS))
check('setWanted: unwantable is false', !c.setWanted(99999999) && c.wanted === PADS)
check('one at a time', c.setWanted(drops.find((d) => d.id !== PADS).id) && c.wanted !== PADS)
check('clear', c.setWanted(null) && c.wanted === null && !c.setWanted(null))

// It goes after it: a likely boss drop queues it for the dungeon.
const before = D.autoDungeons(c).map((d) => d.name)
c.setWanted(PADS)
const after = D.autoDungeons(c).map((d) => d.name)
check('wanted dungeon drop queues for it', after.includes('Wailing Caverns'), `${before} -> ${after}`)
c.setWanted(null)

// A zone drop at good odds moves it there.
const traveler = make(40, 'Stranglethorn Vale')
const desolace = W.placeDrops(traveler, 'Desolace').find((d) => d.n < 0.1 && d.n >= 0.01)
traveler.setWanted(desolace.id)
check('wanted zone drop moves it', nextZone(traveler, 'wanted')?.zone === 'Desolace', `${getItem(desolace.id).name} ${JSON.stringify(nextZone(traveler, 'wanted'))}`)

// Quest choice: it picks the wanted one.
const picker = make(30, 'Stonetalon Mountains')
const quest = Object.values(QUESTS).find((q) => {
  const choices = (q.choice ?? []).filter((id) => W.wantable(picker, id) !== undefined)
  return choices.length >= 2 && choices.some((id) => !questRewardsFor(picker, q).includes(id))
})
const other = quest.choice.find((id) => W.wantable(picker, id) !== undefined && !questRewardsFor(picker, quest).includes(id))
picker.setWanted(other)
check('quest pick: the wanted choice', questRewardsFor(picker, quest).includes(other), quest.title)

// Getting it: kept, no longer wanted, logged.
const getter = make(22, 'The Barrens')
getter.setWanted(PADS)
getter.equipBest([PADS])
check('got it: kept and not wanted', getter.wanted === null && getter.kept[0] === PADS && W.owns(getter, PADS))
check('got it: can\'t want what it has', !getter.setWanted(PADS))
getter.finishDungeon({ xp: 0, copper: 0, found: [{ item: PADS, source: 'Mutanus the Devourer', place: 'Wailing Caverns' }], quests: [], wornBefore: new Set() }, start)
check('got it: loot log says wanted', getter.lootLog[0]?.item === PADS && getter.lootLog[0].wanted === true)
check('got it: loot log and origins say where and when', getter.lootLog[0]?.place === 'Wailing Caverns' && getter.origins[PADS]?.source === 'Mutanus the Devourer' && getter.origins[PADS].place === 'Wailing Caverns' && getter.origins[PADS].at === start, JSON.stringify(getter.origins))
{
  const page = renderCharacterSheet({ character: getter, onDelete() {}, onQueue() {}, onLeaveQueue() {}, onWant() {} })
  const logText = page.querySelector('.loot-log li .loot-source')?.textContent ?? ''
  check('loot log row says where and when', logText.includes('from Mutanus the Devourer in Wailing Caverns') && logText.includes(' ago'), logText)
  const worn = Object.values(getter.equipment).includes(PADS)
  const tip = [...page.querySelectorAll('.paper-doll .tt-origin')].map((e) => e.textContent)
  check('equipped tooltip says where it dropped', !worn || tip.some((t) => t.startsWith('Dropped from Mutanus the Devourer in Wailing Caverns')), JSON.stringify(tip))
}
getter.equipBest()
check('kept survives re-equipping', getter.kept.includes(PADS) && !getter.bag.includes(PADS))

// Save and load.
const saver = make(22, 'The Barrens')
saver.setWanted(PADS)
saver.kept = [6505]
const acc = accountOf('Wanted', [saver, getter], start)
const json = JSON.parse(JSON.stringify(acc))
const loaded = Account.fromJSON(json, start)
const [s2, g2] = loaded.characters
check('save: wanted and kept survive', s2.wanted === PADS && JSON.stringify(s2.kept) === JSON.stringify(saver.kept) && g2.kept.includes(PADS) && g2.wanted === null)
check('save: loot log flag survives', g2.lootLog[0]?.wanted === true)
check('save: origins survive', JSON.stringify(g2.origins) === JSON.stringify(getter.origins), JSON.stringify(g2.origins))
{
  const old = JSON.parse(JSON.stringify(json))
  delete old.guilds[0].characters[1].origins
  const o = Account.fromJSON(old, start).characters[1]
  check('save: old saves get origins from the loot log', o.origins[PADS]?.source === 'Mutanus the Devourer', JSON.stringify(o.origins))
  const bad = JSON.parse(JSON.stringify(json))
  bad.guilds[0].characters[1].origins = { [PADS]: { source: 5, at: 'x' }, 99999999: { source: 'X', at: 1 }, 6505: { source: 'Not held', at: 1 } }
  const b = Account.fromJSON(bad, start).characters[1]
  check('save: bad origins dropped', !b.origins[99999999] && !b.origins[6505] && b.origins[PADS]?.source === 'Mutanus the Devourer', JSON.stringify(b.origins))
}
const tampered = JSON.parse(JSON.stringify(json))
tampered.guilds[0].characters[0].wanted = 99999999
tampered.guilds[0].characters[0].kept = ['x', 99999999, ...Array(20).fill(6505)]
const fixed = Account.fromJSON(tampered, start).characters[0]
check('save: bad wanted and kept dropped', fixed.wanted === null && fixed.kept.length <= 8 && fixed.kept.every((key) => getItem(key)), JSON.stringify(fixed.kept))

// Tick reports it.
const ticker = make(22, 'The Barrens')
const tickAcc = accountOf('Tick', [ticker], start)
tickAcc.wantItem(ticker.id, PADS, start)
ticker.farm = function () {
  this.equipBest([PADS])
  return { levels: 0, upgrades: [], travels: [], errands: [] }
}
const result = tickAcc.tick(start + 60000)
check('tick reports the wanted item got', result.wanted.length === 1 && result.wanted[0].character === ticker && result.wanted[0].item === PADS)

// Sheet.
const viewer = make(22, 'The Barrens')
let want
const render = () => renderCharacterSheet({ character: viewer, onDelete() {}, onWant: (id) => { want = id } })
let sheet = render()
const row = sheet.querySelector('.sheet-focus .slot.wantable')
check('sheet: wantable rows', row?.getAttribute('role') === 'button' && row.getAttribute('aria-pressed') === 'false')
row?.click()
check('sheet: clicking calls onWant', typeof want === 'number' && W.wantable(viewer, want) === want)
viewer.setWanted(PADS)
sheet = render()
const box = sheet.querySelector('.want-box')
check('sheet: wanted box', box.querySelector('.slot.wanted .badge-wanted') && /Wailing Caverns/.test(box.textContent), box.textContent.slice(0, 200))
box.querySelector('[data-focus-key="want-clear"]').click()
check('sheet: stop wanting', want === null)
box.querySelector('.slot.wanted').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
check('sheet: Enter on the wanted row stops wanting', want === null)
const input = sheet.querySelector('.want-search')
input.value = 'slime-encrusted'
input.dispatchEvent(new window.Event('input'))
const results = [...sheet.querySelectorAll('.want-results .slot')]
check('sheet: search results', results.some((li) => /Slime-encrusted Pads/.test(li.textContent)))
sheet = render()
check('sheet: search kept over a re-render', sheet.querySelector('.want-search').value === 'slime-encrusted' && sheet.querySelectorAll('.want-results .slot').length > 0)
const details = sheet.querySelector('.sheet-dungeons .place-drops-box')
check('sheet: all drops start closed and empty', details && !details.open && !details.querySelector('.slot'))
details.open = true
details.dispatchEvent(new window.Event('toggle'))
check('sheet: all drops filled when opened', details.querySelectorAll('.slot').length > 0)
sheet = render()
check('sheet: open drops kept over a re-render', sheet.querySelector('.sheet-dungeons .place-drops-box')?.open)
viewer.setWanted(null)
check('sheet: no wanted item', /None\./.test(render().querySelector('.want-box').textContent))

// Long-shot BoE world drops: kept in zone lists, left out of quest and dungeon lists unless wanted.
{
  const naked = make(60, 'Eastern Plaguelands')
  const page = () => renderCharacterSheet({ character: naked, onDelete() {}, onWant() {} })
  const ids = (root) => [...root.querySelectorAll(':scope > .focus-drops > .slot[data-focus-key^="want-"]')].map((li) => Number(li.dataset.focusKey.slice(5)))
  const worldBoe = (id) => W.isWorldDrop(id) && getItem(id).binds === 2
  const longShot = (dungeon, id) => {
    const t = D.dungeonLoot(naked, dungeon).find((x) => baseId(x.id) === id)
    return D.runHours(naked, dungeon) / t.chance > 7 * 24
  }
  let sheet = page()
  const zoneIds = [...sheet.querySelectorAll('[data-scroll-key="focus-zones"] > li')].flatMap(ids)
  check('long shots: zone lists keep world BoE drops', zoneIds.some(worldBoe), `${zoneIds.length} rows`)
  const dungeonRows = [...sheet.querySelectorAll('[data-scroll-key="focus-dungeons"] > li')]
  const dungeonOf = (li) => D.getDungeon(li.querySelector('.quest-title').textContent)
  const shown = dungeonRows.flatMap((li) => ids(li).filter(worldBoe).map((id) => [dungeonOf(li), id]))
  const hidden = dungeonRows.flatMap((li) => D.dungeonLoot(naked, dungeonOf(li)).filter((t) => worldBoe(t.id) && longShot(dungeonOf(li), baseId(t.id))).map((t) => [dungeonOf(li), baseId(t.id)]))
  check('long shots: dungeon lists leave them out', hidden.length > 0 && shown.every(([d, id]) => !longShot(d, id)), `${shown.length} quick world BoE rows`)
  const worthOf = ([d, id]) => D.dungeonLoot(naked, d).find((t) => baseId(t.id) === id).worth
  const [where, wantedId] = hidden.filter(([, id]) => W.wantable(naked, id) === id).sort((a, b) => worthOf(b) - worthOf(a))[0] ?? []
  naked.setWanted(wantedId)
  sheet = page()
  const rule = (d) => D.dungeonLoot(naked, d).filter((t) => t.id === wantedId || (t.power >= 0.05 && !(worldBoe(t.id) && longShot(d, baseId(t.id))))).slice(0, 4).map((t) => baseId(t.id))
  const rows = [...sheet.querySelectorAll('[data-scroll-key="focus-dungeons"] > li')]
  check('long shots: wanted one is exempt', rows.some((li) => dungeonOf(li) === where) && rows.every((li) => `${ids(li)}` === `${rule(dungeonOf(li))}`), `${getItem(wantedId)?.name} in ${where?.name}`)
  naked.setWanted(null)
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
