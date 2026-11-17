// World PvP page checks. Run: node tests/worldpvp-test.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const HOUR = 3600 * 1000
const html = readFileSync(ROOT + 'main.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/main.html#/pvp', pretendToBeVisual: true })
const w = dom.window
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`)
  if (!ok) failures++
}
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let clock = Date.UTC(2026, 0, 1)
Date.now = () => clock
Math.random = seeded(7)

const { default: Character } = await import(ROOT + 'character.js')
const { CLASSES } = await import(ROOT + 'data.js')
const { default: Account, ENCOUNTER_LOG_SIZE, ENCOUNTER_DETAIL_SIZE } = await import(ROOT + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')

const SPECS = [
  ['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS'], ['Priest', 'Holy', 'Dwarf', 'Healer'],
  ['Rogue', 'Combat', 'Night Elf', 'DPS'], ['Paladin', 'Retribution', 'Human', 'DPS'],
  ['Warrior', 'Arms', 'Orc', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'], ['Hunter', 'Beast Mastery', 'Troll', 'DPS'],
]
// Level 24 in Ashenvale for 5 hours. Each hour everyone who moved on is sent back, so they keep meeting.
const make = ([cls, spec, race, role], i) => new Character({ id: `c${i}`, characterName: `${cls}${'ABCDEFGHIJ'[i]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: 24, zone: 'Ashenvale' })
const a = accountOf('Test', SPECS.map(make), clock - 5 * HOUR)
const fights = []
for (let h = 4; h >= 0; h--) {
  fights.push(...a.tick(clock - h * HOUR, seeded(5 - h)).fights)
  for (const c of a.characters) c.zone = 'Ashenvale'
}
// Brawls come early, while everyone's still in the zone: add a fresh one on top so it keeps its log.
const fresh = accountOf('Fresh', SPECS.map(make), clock - HOUR)
const freshFights = fresh.tick(clock, seeded(2)).fights
const added = { ...fresh.encounters.find((e) => e.kind === 'brawl'), at: a.encounters[0].at }
a.encounters.unshift(added)
fights.push(freshFights.find((x) => x.id === added.id))
// Getaways take a spotter facing a higher level it won't fight: add one from a mixed-level group if the
// hours above had none.
if (!a.encounters.some((e) => e.kind === 'evade')) {
  for (let seed = 1; seed <= 20; seed++) {
    const mixed = accountOf('Mixed', SPECS.map((s, i) => Object.assign(make(s, i), { characterLevel: i % 2 ? 30 : 24 })), clock - HOUR)
    const got = mixed.tick(clock, seeded(seed)).fights
    const getaway = mixed.encounters.find((e) => e.kind === 'evade')
    if (!getaway) continue
    a.encounters.splice(1, 0, { ...getaway, at: a.encounters[0].at })
    fights.push(got.find((x) => x.id === getaway.id))
    break
  }
}
for (const e of a.encounters.slice(ENCOUNTER_DETAIL_SIZE)) e.log = null

// --- Model
check('every fight is logged, newest first', a.encounters.length === Math.min(fights.length, ENCOUNTER_LOG_SIZE) && a.encounters.every((e, i, all) => i === 0 || all[i - 1].at >= e.at), `${a.encounters.length} encounters`)
check('fight ids match records', fights.every((f) => a.encounters.some((e) => e.id === f.id)))
const brawl = a.encounters.find((e) => e.kind === 'brawl' && e.log)
const oldFight = a.encounters.find((e) => e.kind !== 'evade' && !e.log)
const duel = a.encounters.find((e) => e.kind === 'duel' && e.log)
const evade = a.encounters.find((e) => e.kind === 'evade')
check('has a brawl, a duel and a getaway', brawl && duel && evade && oldFight, JSON.stringify({ brawl: !!brawl, duel: !!duel, evade: !!evade, oldFight: !!oldFight, n: a.encounters.length }))
const f = fights.find((x) => x.id === brawl.id)
check('brawl record matches its fight', brawl.members.length === f.sides.flat().length && brawl.members.filter((m) => m.out === 'died').length === f.dead.length && brawl.members.reduce((n, m) => n + m.honor, 0) === f.honor)
check('records are plain data', JSON.stringify(a.encounters).length > 0 && a.encounters.every((e) => e.members.every((m) => typeof m.name === 'string' && !('c' in m))))

// --- Breakdown and combat log
const fightsOnly = a.encounters.filter((e) => e.kind !== 'evade')
check('combat logs kept for the newest only', a.encounters.every((e, i) => (e.log !== null) === (i < ENCOUNTER_DETAIL_SIZE && e.kind !== 'evade')), `${a.encounters.filter((e) => e.log).length} logs`)
check('every fight has a breakdown', fightsOnly.every((e) => e.members.some((m) => m.damage.length) && e.abilities.length))
const KNOWN = { Melee: 0, 'Auto Shot': 0, Frostbolt: 4, Fireball: 2, 'Shadow Bolt': 5, Wrath: 3, 'Holy Light': 1, Judgement: 1, 'Arcane Missiles': 6, 'Sinister Strike': 0 }
check('every ability has its spell school', fightsOnly.every((e) => e.schools.length === e.abilities.length && e.schools.every((s, i) => Number.isInteger(s) && s >= 0 && s <= 6 && (!(e.abilities[i] in KNOWN) || KNOWN[e.abilities[i]] === s))),
  [...new Set(fightsOnly.flatMap((e) => e.abilities.map((n, i) => `${n}:${e.schools[i]}`)))].sort().join(' '))
check('damage dealt adds up to damage taken', fightsOnly.every((e) => {
  const dealt = e.members.reduce((n, m) => n + m.damage.reduce((s, r) => s + r[1], 0), 0)
  return Math.abs(dealt - e.members.reduce((n, m) => n + m.taken, 0)) <= e.members.length * 30
}))
check('breakdown matches the log', fightsOnly.filter((e) => e.log && e.log.length < 2000).every((e) => e.members.every((m, i) => {
  const hits = e.log.filter((r) => r[1] === 0 && r[2] === i).length
  return hits === m.damage.reduce((s, r) => s + r[2], 0)
})))
const lastHp = (e, i) => e.log.filter((r) => r[3] === i && (r[1] <= 1 || r[1] === 3)).at(-1)?.[7] // hits, heals and self casts (Life Tap)
check('the dead are at 0 health in the log, the rest above', fightsOnly.filter((e) => e.log).every((e) => e.members.every((m, i) => (m.out === 'died') === (lastHp(e, i) === 0))))
// Survivors can regain health after their last logged hit (regen, Drain Life), never lose it.
check('end health recorded: 0 for the dead, at least the log\'s last', fightsOnly.every((e) => e.members.every((m, i) => m.maxHp > 0 && m.hp >= 0 && m.hp <= m.maxHp && (m.out === 'died') === (m.hp === 0) && (!e.log || e.log.length >= 2000 || lastHp(e, i) === undefined || m.hp >= lastHp(e, i) - 1))))
check('getaways have no health', a.encounters.filter((e) => e.kind === 'evade').every((e) => e.members.every((m) => m.hp === null && m.maxHp === null)))
check('log times within the fight, in order', fightsOnly.filter((e) => e.log).every((e) => e.log.every((r, j) => r[0] <= Math.round(e.seconds * 10) + 1 && (j === 0 || e.log[j - 1][0] <= r[0]))))
const duels = fightsOnly.filter((e) => e.kind === 'duel')
check('1v1 winner is the one left standing', duels.every((e) => e.winner === null ? !e.members.some((m) => m.out === 'died') || e.members.some((m) => m.out === 'escaped') : e.members[1 - e.winner].out === 'died' && !e.members[e.winner].out))
console.log(`  ${duels.length} duels, ${fightsOnly.length - duels.length} brawls; log events: ${fightsOnly.filter((e) => e.log).map((e) => e.log.length).join(' ')}`)
console.log(`  save size: ${JSON.stringify(a.encounters).length} bytes for ${a.encounters.length} encounters`)

const json = JSON.parse(JSON.stringify(a))
const back = Account.fromJSON(json, clock)
check('round trip keeps encounters exactly', JSON.stringify(back.encounters) === JSON.stringify(a.encounters))
const tampered = JSON.parse(JSON.stringify(a))
tampered.encounters = [
  null, { id: '<img>', kind: 'duel' }, { ...tampered.encounters[0], kind: 'nuke' },
  { ...tampered.encounters[0], members: [{ ...tampered.encounters[0].members[0], race: 'Pandaren' }, tampered.encounters[0].members[1]] },
  { ...tampered.encounters[0], members: [tampered.encounters[0].members[0]] },
  { ...tampered.encounters[0], zone: 'x'.repeat(500), seconds: 1e9, odds: 7, members: tampered.encounters[0].members.map((m) => ({ ...m, name: 'N'.repeat(50), kills: 99 })) },
  ...Array(300).fill(tampered.encounters[0]),
]
const t = Account.fromJSON(tampered, clock).encounters
check('bad encounters dropped, fields clamped, log capped', t.length < ENCOUNTER_LOG_SIZE && t[0].zone.length === 100 && t[0].seconds <= 610 && t[0].odds === 1 && t[0].members.every((m) => m.name.length === 12 && m.kills === 0), `${t.length}`)
check('saves without encounters still load', Account.fromJSON({ ...json, encounters: undefined }, clock).encounters.length === 0)
const e0 = JSON.parse(JSON.stringify(brawl))
const bad = { ...e0, abilities: [...e0.abilities.slice(0, -1), 'A'.repeat(99), 7], schools: ['x', 9, -1, 2.5, ...e0.schools.slice(4)], log: [[0, 9, 0, 1, 0, 1, 0, 1], [0, 0, 99, 1, 0, 1, 0, 1], [0, 0, 0, 1, 999, 1, 0, 1], ['x'], [5, 0, 0, 1, 0, -50, 1e12, 'q'], ...e0.log], members: e0.members.map((m, i) => ({ ...m, damage: [[999, 1, 1], [0, -5, 1.5], [0, 1e12, 2]], taken: 'lots', hp: [1e9, -5, 'x'][i % 3], maxHp: i === 1 ? 0 : 500 })) }
const r = Account.fromJSON({ ...json, encounters: [bad] }, clock).encounters[0]
check('bad log entries dropped, numbers clamped', r && r.log.length === e0.log.length + 1 && r.log[0][5] === 0 && r.log[0][6] === 1e7 && r.log[0][7] === 0 && r.abilities.at(-2).length === 40 && r.abilities.at(-1) === '' && r.members.every((m) => m.damage.length === 1 && m.damage[0][1] === 1e7 && m.taken === 0))
check('bad health clamped or dropped', r.members[0].hp === 500 && r.members[1].hp === null && r.members[1].maxHp === null && (r.members[2] ? r.members[2].hp === 0 : true), JSON.stringify(r.members.map((m) => [m.hp, m.maxHp])))
check('bad schools become null, one per ability', r.schools.length === r.abilities.length && r.schools.slice(0, 4).every((s) => s === null) && r.schools.at(-1) === null && JSON.stringify(r.schools.slice(4, -1)) === JSON.stringify(e0.schools.slice(4, r.abilities.length - 1)))
const noSchools = Account.fromJSON({ ...json, encounters: [{ ...e0, schools: undefined }] }, clock).encounters[0]
check('saves from before schools load uncolored', noSchools.schools.length === e0.abilities.length && noSchools.schools.every((s) => s === null) && noSchools.log.length === e0.log.length)
const legacy = JSON.parse(JSON.stringify(a))
legacy.encounters = legacy.encounters.map(({ abilities, log, ...e }) => ({ ...e, members: e.members.map(({ damage, healing, taken, hp, maxHp, ...m }) => m) }))
const l = Account.fromJSON(legacy, clock).encounters
check('older saves load without breakdown, log or health', l.length === a.encounters.length && l.every((e) => e.log === null && e.abilities.length === 0 && e.members.every((m) => m.damage.length === 0 && m.taken === 0 && m.hp === null && m.maxHp === null)))

// --- UI
localStorage.setItem('gmrl.account', JSON.stringify(a))
w.setInterval = globalThis.setInterval = () => {}
await import(ROOT + 'interface.js')
const q = (s) => document.querySelector(s)
const qa = (s) => [...document.querySelectorAll(s)]
const go = (hash) => {
  location.hash = hash
  w.dispatchEvent(new w.HashChangeEvent('hashchange'))
}
check('nav has World PvP, marked current', q('.site-nav [aria-current]')?.textContent === 'World PvP', qa('.site-nav a').map((x) => x.textContent).join(', '))
check('title', document.title.startsWith('World PvP'), document.title)
check('one row per encounter', qa('.encounter-row').length === a.encounters.length)
console.log('  tally:', qa('.encounter-tally div').map((d) => `${d.querySelector('dt').textContent} ${d.querySelector('dd').textContent}`).join(' | '))
console.log('  first rows:'); for (const r of qa('.encounter-row').slice(0, 4)) console.log('   ', r.querySelector('.encounter-shape').textContent, '|', r.querySelector('strong').textContent, '|', r.querySelector('.encounter-meta').textContent)

const row = qa('.encounter-row').find((r) => r.getAttribute('href') === `#/pvp/${brawl.id}`)
go(row.getAttribute('href'))
check('brawl page renders', q('#view-title')?.textContent && qa('.encounter-member').length === brawl.members.length)
check('nav still World PvP on detail', q('.site-nav [aria-current]')?.textContent === 'World PvP')
check('members link to character sheets', qa('.encounter-member a').length === brawl.members.length && qa('.encounter-member a').every((x) => x.getAttribute('href').startsWith('#/character/c')))
check('breakdown per member', qa('.encounter-breakdown').length === brawl.members.length && qa('.encounter-abilities tbody tr').length === brawl.members.reduce((n, m) => n + m.damage.length + m.healing.length, 0))
check('combat log replaces the timeline', !q('.encounter-timeline') && qa('.encounter-log li').length === brawl.log.length + 2 + brawl.members.slice(2).length + brawl.members.filter((m) => m.out).length)
check('combat log starts with the opener and ends with the outcome', qa('.encounter-log li')[0].classList.contains('encounter-mark') && qa('.encounter-log li').at(-1).classList.contains('encounter-mark'))
check('names in class colors', qa('.encounter-log .actor').length > brawl.log.length && qa('.encounter-log .actor').every((s) => brawl.members.some((m) => m.name === s.textContent && s.style.getPropertyValue('--class-color') === CLASSES[m.class].color)))
check('abilities in school colors', qa('.encounter-log .spell').length > 0 && qa('.encounter-log .spell, .encounter-abilities .spell').every((s) => /^spell school-(physical|holy|fire|nature|frost|shadow|arcane)$/.test(s.className)) && !qa('.encounter-log .spell').some((s) => s.textContent === 'Melee'))
{
  const ordered = [0, 1].flatMap((s) => brawl.members.filter((m) => m.side === s)) // as on the page, side by side
  const sums = ordered.map((m) => ['damage', 'healing'].map((k) => m[k].reduce((s, r) => s + r[1], 0)))
  const top = Math.max(...sums.flat())
  const widths = qa('.encounter-breakdown .meter-class > span, .encounter-breakdown .meter-heal > span').map((s) => parseFloat(s.style.width))
  check('meter bars: damage per member, healing on the same scale, biggest full, share bar per ability',
    qa('.encounter-breakdown .meter-class').length === brawl.members.length && widths.some((x) => x === 100) && widths.every((x) => x >= 0 && x <= 100)
    && qa('.encounter-breakdown .meter-class > span').every((s, i) => Math.abs(parseFloat(s.style.width) - (100 * sums[i][0]) / top) < 0.1)
    && qa('.encounter-share .meter-bar').length === qa('.encounter-abilities tbody tr').length)
  const hp = qa('.encounter-breakdown .stat-health')
  check('health bar per member, empty and "Dead" for the dead', hp.length === brawl.members.length && hp.every((h, i) => {
    const m = ordered[i]
    const width = parseFloat(h.querySelector('.meter-bar > span').style.width)
    return m.out === 'died' ? width === 0 && h.querySelector('.stat-value').textContent === 'Dead' : Math.abs(width - (100 * m.hp) / m.maxHp) < 0.1
  }))
  const vs = qa('.versus')
  check('team totals pull against each other', vs.length >= 1 && vs.every((v) => v.querySelectorAll('.versus-bar > span').length === 2))
}
console.log('  ', q('#view-title').textContent, '|', q('#view-title').className)
console.log('  ', q('.encounter-summary').textContent)
for (const s of qa('.encounter-side')) {
  console.log('  ', s.querySelector('h3').textContent)
  for (const m of s.querySelectorAll('.encounter-member')) console.log('     ', [...m.querySelectorAll('p')].map((p) => p.textContent).join(' | '))
}
for (const d of qa('.encounter-breakdown')) {
  console.log('     ', d.querySelector('.breakdown-head').textContent, '|', d.querySelectorAll('.stat-bar').length ? [...d.querySelectorAll('.stat-bar')].map((s) => `${s.querySelector('.stat-label').textContent} ${s.querySelector('.stat-value').textContent} [${s.querySelector('.meter-bar > span').style.width}]`).join(' | ') : '')
  for (const tr of d.querySelectorAll('tr')) console.log('        ', [...tr.children].map((c) => c.textContent).join(' | '))
}
const logLines = qa('.encounter-log li').map((li) => [...li.children].map((c) => c.textContent).join('  '))
for (const line of [...logLines.slice(0, 12), '...', ...logLines.slice(-8)]) console.log('     ', line)

go(`#/pvp/${oldFight.id}`)
check('an older fight keeps the timeline and breakdown', qa('.encounter-timeline li').length >= 2 && !q('.encounter-log') && qa('.encounter-breakdown').length === oldFight.members.length)
check('versus bars sit above the members', !!q('.versus-group + .note + .encounter-sides'))
check('timeline starts at 0:00 and has the end', qa('.encounter-timeline li')[0].textContent.startsWith('0:00') && qa('.encounter-timeline li').length >= 2 + oldFight.members.filter((m) => m.out).length)
for (const li of qa('.encounter-timeline li')) console.log('     ', li.textContent.replace(/^(\d+:\d+)/, '$1 '))

go(`#/pvp/${evade.id}`)
check('getaway page renders without a timeline', qa('.encounter-member').length === 2 && !q('.encounter-timeline') && !q('.encounter-log') && !q('.encounter-breakdown'))
console.log('  ', q('#view-title').textContent, '|', q('.encounter-summary').textContent)

go(`#/pvp/${duel.id}`)
console.log('  ', q('#view-title').textContent, '|', q('.encounter-summary').textContent)
for (const li of qa('.encounter-log li').slice(-6)) console.log('     ', [...li.children].map((c) => c.textContent).join('  '))

go('#/pvp/nope')
check('unknown encounter shows not found', q('#view-title').textContent === 'Encounter not found')

go('#/pvp')
const { headline } = await import(ROOT + 'world-pvp.js')
const text = (e) => headline(e).join('')
check('no "jumped" anywhere', !document.body.textContent.includes('jump'))
check('"ganked" alone only when the victim died', a.encounters.filter((e) => e.kind !== 'evade' && / ganked \w+$/.test(text(e))).every((e) => e.members[1].out === 'died'))
check('ganker deaths say "and died"', a.encounters.filter((e) => e.kind !== 'evade' && e.members[0].out === 'died').every((e) => / and (both )?died$/.test(text(e))))
const seen = new Map()
for (const e of a.encounters) {
  const key = text(e).replace(/^\w+ /, 'X ').replace(/(ganked|from|outran) \w+/, '$1 Y')
  if (!seen.has(key)) seen.set(key, `${shape(e)} ${text(e)}`)
}
console.log('  headline kinds:'); for (const v of seen.values()) console.log('   ', v)
function shape(e) { return e.kind === 'evade' ? 'Escape' : `${e.members.filter((m) => m.side === 0).length}v${e.members.filter((m) => m.side === 1).length}` }

go('#/roster')
check('roster nav current again', q('.site-nav [aria-current]')?.textContent === 'Roster')

console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
