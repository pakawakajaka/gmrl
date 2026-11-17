import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { accountOf, addTo, savedCharacters } = await import('./helpers.mjs')
const { honorGain, worldPvp } = await import(root + 'pvp.js')
const { dayOf } = await import(root + 'reset.js')
const { sortCharacters, SORTS } = await import(root + 'sort.js')
const { renderCharacterSheet } = await import(root + 'character-sheet.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const near = (a, b) => Math.abs(a - b) < 1e-9

// Formula (vmangos GetHonorGain, rank 0).
check('60 kills 60: 188.3', near(honorGain(60, 60), 188.3))
check('60 kills 64: +20%', near(honorGain(60, 64), 188.3 * 1.2))
check('60 kills 63 (cap past +4 n/a): +15%', near(honorGain(60, 63), 188.3 * 1.15))
check('25 kills 40: capped at +20%', near(honorGain(25, 40), 0.207 * 188.3 * 1.2))
check('60 kills 55: (17-5)/17', near(honorGain(60, 55), 188.3 * 12 / 17), honorGain(60, 55).toFixed(2))
check('60 kills gray 51: 0', honorGain(60, 51) === 0)
check('30 kills 30: 0.3434', near(honorGain(30, 30), 0.3434 * 188.3))
check('10 kills 10: 0.1212', near(honorGain(10, 10), 0.1212 * 188.3))
check('50 vs 49: 0.9545 coeff', near(honorGain(50, 50), 0.9545 * 188.3))
check('9th same-victim kill: 20%', near(honorGain(60, 60, 0, 8), 188.3 * 0.2))
check('11th same-victim kill: 0', honorGain(60, 60, 0, 10) === 0)
check('split 5 ways', near(honorGain(60, 60, 0, 0, 5), 188.3 / 5))
check('rank 1 victim: 198.6', near(honorGain(60, 60, 1), 188.3 * Math.exp(0.05331)), honorGain(60, 60, 1).toFixed(2))
check('rank 14 victim: about 2.1x', near(honorGain(60, 60, 14), 188.3 * Math.exp(0.05331 * 14)), honorGain(60, 60, 14).toFixed(2))

// Fights pay honor.
const SPECS = [
  ['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS'], ['Priest', 'Holy', 'Dwarf', 'Healer'],
  ['Rogue', 'Combat', 'Night Elf', 'DPS'], ['Paladin', 'Retribution', 'Human', 'DPS'],
  ['Warrior', 'Arms', 'Orc', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'],
  ['Warlock', 'Affliction', 'Undead', 'DPS'], ['Hunter', 'Beast Mastery', 'Troll', 'DPS'],
]
const make = ([cls, spec, race, role], level, i) =>
  new Character({ id: `c${i}`, characterName: `${cls}${'ABCDEFGHIJ'[i]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, zone: 'Hillsbrad Foothills' })
const noon = Date.UTC(2025, 0, 1, 17) // noon Eastern; fights from midnight on
Math.random = seeded(1)
const chars = SPECS.map((s, i) => make(s, 25 + (i % 3) * 3, i))
const fights = worldPvp(chars, 12, noon, seeded(1)).filter((f) => f.kind !== 'evade')
const total = chars.reduce((s, c) => s + c.honor, 0)
check('honor earned', total > 0, total.toFixed(1))
check('fight points add up', near(total, fights.reduce((s, f) => s + f.points, 0)))
const logged = chars.flatMap((c) => c.pvpLog.filter((e) => e.honor))
check('HK log entries carry points', logged.length > 0 && logged.every((e) => e.points > 0))
check('no more than 10 HKs on one victim a day', chars.every((c) => !c.honorToday || Object.values(c.honorToday.victims).every((n) => n <= 10)))
check('the day counts HKs and honor', chars.every((c) => c.honorToday === null ? c.honor === 0 : c.honorToday.kills === c.honorableKills && near(c.honorToday.points, c.honor)))
check('so does the period', chars.every((c) => c.honorPeriod === null ? c.honor === 0 : c.honorPeriod.kills === c.honorableKills && near(c.honorPeriod.points, c.honor)))

// Same victim 10 times today: kills, but no honor.
let capped = false
for (let seed = 1; seed < 40 && !capped; seed++) {
  Math.random = seeded(seed)
  const pair = [make(SPECS[0], 60, 0), make(SPECS[5], 60, 5)]
  const day = dayOf(noon)
  pair[0].honorToday = { day, kills: 0, points: 0, victims: { c5: 10 } }
  pair[1].honorToday = { day, kills: 0, points: 0, victims: { c0: 10 } }
  worldPvp(pair, 12, noon, seeded(seed))
  if (pair.some((c) => c.pvpKills > 0)) {
    capped = true
    check('11th kill of the same player: no HK, no honor', pair.every((c) => c.honorableKills === 0 && c.honor === 0), `kills ${pair.map((c) => c.pvpKills)}`)
  }
}
check('found a capped fight', capped)

// Sorting.
check('honor and HK sorts', SORTS.honor.label === 'Honor' && SORTS.hks.label === 'Honorable kills')
const byHonor = sortCharacters(chars, 'honor')
check('sorted by honor', byHonor.every((c, i) => i === 0 || byHonor[i - 1].honor >= c.honor))
const byHks = sortCharacters(chars, 'hks')
check('sorted by HKs', byHks.every((c, i) => i === 0 || byHks[i - 1].honorableKills >= c.honorableKills))

// Save and load.
const acc = accountOf('Test', chars, noon)
const loaded = Account.fromJSON(JSON.parse(JSON.stringify(acc)), noon)
check('honor survives save', loaded.characters.every((c, i) => c.honor === chars[i].honor && JSON.stringify(c.honorToday) === JSON.stringify(chars[i].honorToday) && JSON.stringify(c.pvpLog) === JSON.stringify(chars[i].pvpLog)))
const bad = JSON.parse(JSON.stringify(acc))
savedCharacters(bad)[0].honor = -3
savedCharacters(bad)[0].honorToday = { day: 'x', victims: {} }
savedCharacters(bad)[1].honorToday = { day: 5, victims: { a: 99, b: 2, c: 'x' } }
const fixed = Account.fromJSON(bad, noon).characters
check('bad honor sanitized', fixed[0].honor === 0 && fixed[0].honorToday === null && JSON.stringify(fixed[1].honorToday) === '{"day":5,"kills":0,"points":0,"victims":{"b":2}}')
const old = JSON.parse(JSON.stringify(acc))
for (const c of savedCharacters(old)) { delete c.honor; delete c.honorToday }
check('old saves start at 0 honor', Account.fromJSON(old, noon).characters.every((c) => c.honor === 0 && c.honorToday === null))

// Sheet shows honor.
const top = byHonor[0]
const sheet = renderCharacterSheet({ character: top, onDelete: () => {} })
const text = sheet.textContent
check('sheet shows Honor tally', text.includes('Honor' + Math.floor(top.honor).toLocaleString()) || text.includes(`Honor${Math.floor(top.honor)}`), text.match(/Honor\d[\d,]*/)?.[0])
check('sheet log shows honor per kill', /honorable kill \(\d[\d,]* honor\)/.test(text))

// Encounter records and the World PvP page.
const { encounterRecord, restoreEncounter } = await import(root + 'pvp.js')
const { renderWorldPvp } = await import(root + 'world-pvp.js')
const records = fights.map((f, i) => encounterRecord(f, `e${i}`))
check('records carry member points', records.every((r, i) => near(r.members.reduce((s, m) => s + m.points, 0), fights[i].points) || Math.abs(r.members.reduce((s, m) => s + m.points, 0) - fights[i].points) < 0.05))
check('records restore identically', records.every((r) => JSON.stringify(restoreEncounter(JSON.parse(JSON.stringify(r)))) === JSON.stringify(r)))
const oldRecord = JSON.parse(JSON.stringify(records.find((r) => r.members.some((m) => m.honor))))
for (const m of oldRecord.members) delete m.points
check('old records restore with null points', restoreEncounter(oldRecord).members.every((m) => m.points === null))
acc.encounters = records.map((r) => restoreEncounter(r))
const list = renderWorldPvp({ account: acc }).textContent
const listHonor = Math.floor(records.reduce((s, r) => s + r.members.reduce((n, m) => n + m.points, 0), 0))
check('list shows Honor tally', list.includes(`Honor${listHonor.toLocaleString('en-US')}`), list.match(/Honor\d[\d,]*/)?.[0])
check('list rows show honor', /honorable kills? \(\d[\d,]* honor\)/.test(list))
const { periodOf } = await import(root + 'reset.js')
const saved = acc.characters.map((c) => c.honorPeriod)
const [leader, ...rest] = acc.characters
leader.honorPeriod = { period: periodOf(Date.now()), kills: 20, points: 1234.6 }
for (const c of rest) c.honorPeriod = { period: periodOf(Date.now()), kills: 3, points: 10 }
const board = renderWorldPvp({ account: acc }).querySelector('.pvp-standings')
const boardText = board?.textContent ?? ''
check('standings show the leader first', board?.querySelector('tbody tr th a')?.textContent === leader.characterName && boardText.includes('#1'), boardText.slice(0, 200))
check('standings show leader honor and kills', boardText.includes('1,234') && boardText.includes('20'))
check('standings dim characters short of the kills', !rest.length || (board.querySelectorAll('.standings-out').length === rest.length && boardText.includes('3 / 15')))
check('standings say when the reset is', /Resets in \S/.test(boardText))
acc.characters.forEach((c, i) => { c.honorPeriod = saved[i] })
const hkRecord = records.find((r) => r.members.some((m) => m.honor))
const page = renderWorldPvp({ account: acc, encounterId: hkRecord.id }).textContent
check('encounter page shows member honor', /\d+ honorable, \d[\d,]* honor\)/.test(page), page.match(/\(\d+ honorable[^)]*\)/)?.[0])
acc.encounters = [restoreEncounter(oldRecord)]
const oldPage = renderWorldPvp({ account: acc, encounterId: oldRecord.id }).textContent
check('old encounter shows HK count only', /\(\d+ honorable\)/.test(oldPage))

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
