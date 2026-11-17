// Run: node tests/rank-test.mjs
// PvP ranks (honor.js): rank math, the daily honor reset, and how ticks, saves and the sheet use them.
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(ROOT + 'character.js')
const { default: Account } = await import(ROOT + 'account.js')
const { accountOf, savedCharacters } = await import('./helpers.mjs')
const { MIN_HONOR_KILLS, RANK_TITLES, generateScores, honorReset, maxRpAtLevel, rankOf, rankRange, rankTitle, rpDecay, rpEarning } = await import(ROOT + 'honor.js')
const { honorGain, worldPvp } = await import(ROOT + 'pvp.js')
const { RESET_DAYS, dayOf, dayStart, periodOf, periodStart } = await import(ROOT + 'reset.js')
const { renderCharacterSheet } = await import(ROOT + 'character-sheet.js')
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const near = (a, b) => Math.abs(a - b) < 1e-6

const HORDE = ['Warrior', 'Arms', 'Orc', 'DPS']
const ALLIANCE = ['Warrior', 'Arms', 'Human', 'DPS']
let n = 0
const letters = (i) => (i >= 26 ? letters(Math.floor(i / 26) - 1) : '') + 'abcdefghijklmnopqrstuvwxyz'[i % 26]
const make = ([cls, spec, race, role], level = 60, zone = null) =>
  new Character({ id: `r${++n}`, characterName: `Ranker${letters(n)}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: level, zone })
const D = dayOf(Date.UTC(2025, 0, 10, 17))
const P = periodOf(Date.UTC(2025, 0, 10, 17))
const earned = (c, kills, points, p = P) => { c.honorPeriod = { period: p, kills, points }; return c }

// Rank from rank points (vmangos CalculateRank).
const ranks = [[0, 0], [1, 1], [1999, 1], [2000, 2], [4999, 2], [5000, 3], [9999, 3], [10000, 4], [59999, 13], [60000, 14], [60001, 14], [65000, 14]]
check('rank boundaries', ranks.every(([rp, r]) => rankOf(rp) === r), ranks.map(([rp]) => rankOf(rp)).join(','))
check('rank ranges', [[1, 0, 2000], [2, 2000, 5000], [3, 5000, 10000], [13, 55000, 60000]].every(([r, a, b]) => rankRange(r)[0] === a && rankRange(r)[1] === b))
check('14 titles each', RANK_TITLES.Alliance.length === 14 && RANK_TITLES.Horde.length === 14)
check('titles', rankTitle('Horde', 14) === 'High Warlord' && rankTitle('Alliance', 1) === 'Private' && rankTitle('Horde', 7) === 'Blood Guard' && rankTitle('Alliance', 0) === null)

// Level caps (vmangos MaximumRpAtLevel).
const caps = [[1, 6500], [29, 6500], [30, 7150], [35, 12025], [36, 13325], [39, 17225], [40, 18850], [43, 23725], [44, 26000], [52, 44200], [53, 46800], [60, 65000]]
check('level caps', caps.every(([l, rp]) => maxRpAtLevel(l) === rp), caps.map(([l]) => maxRpAtLevel(l)).join(','))

// Decay (vmangos CalculateRpDecay).
check('earning less a fifth', rpDecay(6300, 18870) === 21396)
check('net loss halved', rpDecay(0, 18870) === 16983)
check('rank 13 to 14', rpDecay(12500, 55000) === 56500)
check('loss at most 2500', rpDecay(0, 60000) === 57500)
check('small rank points stick', rpDecay(0, 2) === 2 && rpDecay(0, 0) === 0)

// Earning (vmangos GenerateScores, CalculateRpEarning).
check('alone in the standings: 3000', rpEarning(1000, generateScores([1000])) === 3000)
const five = generateScores([5000, 4000, 3000, 2000, 1000])
const fiveEarned = [5000, 4000, 3000, 2000, 1000].map((cp) => rpEarning(cp, five))
check('five in the standings', near(fiveEarned[0], 8000) && near(fiveEarned[1], 4500) && near(fiveEarned[2], 2500) && near(fiveEarned[3], 700) && near(fiveEarned[4], 400 * 1000 / 1500), fiveEarned.map((e) => e.toFixed(1)).join(','))
const pool = Array.from({ length: 1000 }, (_, i) => 1000 - i)
const big = generateScores(pool)
const bigEarned = pool.map((cp) => rpEarning(cp, big))
check('top of a big pool: 13000', bigEarned[0] === 13000)
check('more honor never earns less', bigEarned.every((e, i) => i === 0 || bigEarned[i - 1] >= e))
check('bottom of a big pool earns a little', bigEarned.at(-1) > 0 && bigEarned.at(-1) < 400)

// The reset.
{
  const top = earned(make(HORDE), 30, 5000)
  const second = earned(make(HORDE), 20, 4000)
  const short = earned(make(HORDE), MIN_HONOR_KILLS - 1, 9000)
  short.rankPoints = 10000
  const stale = earned(make(HORDE), 30, 9000, P - 1)
  const low = earned(make(HORDE, 30), 15, 6000)
  low.rankPoints = 7000
  const ally = earned(make(ALLIANCE), 15, 100)
  const chars = [top, second, short, stale, low, ally]
  honorReset(chars, P)
  check('ranked by honor', low.honorLastPeriod.standing === 1 && top.honorLastPeriod.standing === 2 && second.honorLastPeriod.standing === 3)
  check('short of kills: not ranked, decays', short.honorLastPeriod.standing === 0 && short.rankPoints === 9000 && short.honorLastPeriod.kills === MIN_HONOR_KILLS - 1)
  check('another period doesn\'t count', stale.honorLastPeriod.kills === 0 && stale.honorLastPeriod.points === 0 && stale.rankPoints === 0)
  check('level caps rank points', low.rankPoints === maxRpAtLevel(30), low.rankPoints)
  check('each faction its own standings', ally.honorLastPeriod.standing === 1 && ally.rankPoints === 3000)
  check('highest rank kept', top.highestRank === top.rank && top.rank > 0 && short.highestRank === 3)
}

// Ticks run the reset at Eastern midnight.
{
  check('midnight EST is 05:00 UTC', dayStart(dayOf(Date.UTC(2026, 10, 16, 12))) === Date.UTC(2026, 10, 16, 5))
  check('midnight EDT is 04:00 UTC', dayStart(dayOf(Date.UTC(2026, 6, 4, 12))) === Date.UTC(2026, 6, 4, 4))
  check('before 05:00 UTC is still yesterday', dayOf(Date.UTC(2026, 10, 16, 4, 59)) === dayOf(Date.UTC(2026, 10, 15, 12)) && dayOf(Date.UTC(2026, 10, 16, 5)) === dayOf(Date.UTC(2026, 10, 16, 12)))
  check('clock-change days', dayStart(dayOf(Date.UTC(2026, 2, 8, 12))) === Date.UTC(2026, 2, 8, 5) && dayStart(dayOf(Date.UTC(2026, 2, 9, 12))) === Date.UTC(2026, 2, 9, 4) && dayStart(dayOf(Date.UTC(2026, 10, 1, 12))) === Date.UTC(2026, 10, 1, 4) && dayStart(dayOf(Date.UTC(2026, 10, 2, 12))) === Date.UTC(2026, 10, 2, 5))
  check('days follow each other', Array.from({ length: 800 }, (_, i) => D + i).every((d) => dayOf(dayStart(d)) === d && dayOf(dayStart(d) - 1) === d - 1))
  check('3-day periods', RESET_DAYS === 3 && Array.from({ length: 300 }, (_, i) => P + i).every((p) => periodOf(periodStart(p)) === p && periodOf(periodStart(p) - 1) === p - 1 && dayOf(periodStart(p + 1)) - dayOf(periodStart(p)) === 3))
  check('the reset after Nov 16 2026 is Nov 18, 05:00 UTC', periodStart(periodOf(Date.UTC(2026, 10, 16, 12)) + 1) === Date.UTC(2026, 10, 18, 5))
}
{
  const c = earned(make(HORDE), 20, 3000)
  const acc = accountOf('Ticks', [c], periodStart(P + 1) - 3600000)
  const result = acc.tick(periodStart(P + 1) + 3600000, seeded(1))
  check('reset at the period\'s end', c.rankPoints === 3000 && c.rank === 2 && c.honorLastPeriod.standing === 1, c.rankPoints)
  check('rank change reported', result.ranks.length === 1 && result.ranks[0].character === c && result.ranks[0].from === 0 && result.ranks[0].to === 2)
  acc.tick(periodStart(P + 1) + 2 * 3600000, seeded(1))
  check('one reset a period', c.rankPoints === 3000)
}
{
  const c = make(HORDE)
  c.rankPoints = 20000
  const acc = accountOf('Away', [c], periodStart(P) + 12 * 3600000)
  acc.tick(periodStart(P + 5) + 12 * 3600000, seeded(1))
  let rp = 20000
  for (let i = 0; i < 5; i++) rp = rpDecay(0, rp)
  check('every reset while away decays', near(c.rankPoints, rp), `${c.rankPoints} vs ${rp}`)
  check('away resets have no honor', c.honorLastPeriod.kills === 0 && c.honorLastPeriod.points === 0 && c.honorLastPeriod.standing === 0)
}
{
  // Fights before the reset count for that period, fights after for the next; midnights in between only
  // start a new day.
  const SPECS = [
    ['Warrior', 'Arms', 'Human', 'DPS'], ['Mage', 'Frost', 'Gnome', 'DPS'], ['Priest', 'Holy', 'Dwarf', 'Healer'],
    ['Rogue', 'Combat', 'Night Elf', 'DPS'], ['Paladin', 'Retribution', 'Human', 'DPS'],
    ['Warrior', 'Arms', 'Orc', 'DPS'], ['Shaman', 'Enhancement', 'Orc', 'DPS'], ['Druid', 'Restoration', 'Tauren', 'Healer'],
    ['Warlock', 'Affliction', 'Undead', 'DPS'], ['Hunter', 'Beast Mastery', 'Troll', 'DPS'],
  ]
  Math.random = seeded(3)
  const chars = SPECS.map((s, i) => make(s, 25 + (i % 3) * 3, 'Hillsbrad Foothills'))
  const reset = periodStart(P + 1)
  const acc = accountOf('Midnight', chars, reset - 4 * 3600000)
  const result = acc.tick(reset + 4 * 3600000, seeded(3))
  const before = result.fights.filter((f) => f.kind !== 'evade' && f.at < reset).reduce((s, f) => s + f.honor, 0)
  const lastPeriod = chars.reduce((s, c) => s + c.honorLastPeriod.kills, 0)
  const since = chars.reduce((s, c) => s + (c.honorPeriod?.period === P + 1 ? c.honorPeriod.kills : 0), 0)
  check('HKs on both sides of the reset', before > 0 && since > 0, `${before} before, ${since} after`)
  check('pre-reset HKs went into the reset', lastPeriod === before && lastPeriod + since === chars.reduce((s, c) => s + c.honorableKills, 0))

  const midnight = dayStart(dayOf(reset) + 1)
  // By then most have leveled and moved on; send them back to meet again.
  acc.tick(midnight - 3600000, seeded(4))
  for (const c of chars) c.zone = 'Hillsbrad Foothills'
  const later = acc.tick(midnight + 4 * 3600000, seeded(5)).fights.filter((f) => f.kind !== 'evade')
  const sinceMidnight = later.filter((f) => f.at >= midnight).reduce((s, f) => s + f.honor, 0)
  const today = chars.reduce((s, c) => s + (c.honorToday?.day === dayOf(midnight) ? c.honorToday.kills : 0), 0)
  check('midnight starts a new day', sinceMidnight > 0 && today === sinceMidnight, `${today} vs ${sinceMidnight}`)
  check('but not a new period', chars.every((c) => (c.honorPeriod?.period === P + 1 ? c.honorPeriod.kills : 0) === c.honorableKills - c.honorLastPeriod.kills) && chars.some((c) => c.honorPeriod?.kills > c.honorToday?.kills))
}

// A ranked victim is worth more.
{
  let found = false
  for (let seed = 1; seed < 40 && !found; seed++) {
    Math.random = seeded(seed)
    const killer = make(HORDE, 60, 'Hillsbrad Foothills')
    const victim = make(ALLIANCE, 60, 'Hillsbrad Foothills')
    victim.rankPoints = 65000
    worldPvp([killer, victim], 12, Date.UTC(2025, 0, 1, 17), seeded(seed))
    if (killer.honorableKills > 0 && victim.honorableKills > 0) {
      found = true
      const expected = (rank, kills) => Array.from({ length: kills }, (_, k) => honorGain(60, 60, rank, k)).reduce((a, b) => a + b, 0)
      check('honor for a rank 14 victim', near(killer.honor, expected(14, killer.honorableKills)), `${killer.honor.toFixed(1)} for ${killer.honorableKills}`)
      check('honor for a rank 0 victim', near(victim.honor, expected(0, victim.honorableKills)), `${victim.honor.toFixed(1)} for ${victim.honorableKills}`)
    }
  }
  check('found kills both ways', found)
}

// Save and load.
{
  const c = earned(make(HORDE), 20, 1234.5)
  c.honorToday = { day: D, kills: 6, points: 400.5, victims: { x: 2 } }
  c.rankPoints = 25000.5
  c.highestRank = 9
  c.honorLastPeriod = { kills: 17, points: 2500.25, standing: 3 }
  const acc = accountOf('Save', [c])
  const back = Account.fromJSON(JSON.parse(JSON.stringify(acc))).characters[0]
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('rank survives save', back.rankPoints === 25000.5 && back.highestRank === 9 && same(back.honorLastPeriod, c.honorLastPeriod) && same(back.honorPeriod, c.honorPeriod) && same(back.honorToday, c.honorToday))
  const bad = JSON.parse(JSON.stringify(acc))
  Object.assign(savedCharacters(bad)[0], { rankPoints: 1e9, highestRank: 3, honorLastPeriod: { kills: -2, points: 'x', standing: 2.5 }, honorPeriod: { period: P, kills: 'x', points: -5 } })
  const fixed = Account.fromJSON(bad).characters[0]
  check('bad rank sanitized', fixed.rankPoints === 65000 && fixed.highestRank === 14 && same(fixed.honorLastPeriod, { kills: 0, points: 0, standing: 2 }) && same(fixed.honorPeriod, { period: P, kills: 0, points: 0 }), JSON.stringify([fixed.rankPoints, fixed.highestRank, fixed.honorLastPeriod]))
  Object.assign(savedCharacters(bad)[0], { rankPoints: -5, highestRank: 'x', honorLastPeriod: 'x', honorPeriod: { period: 'x' } })
  const fixed2 = Account.fromJSON(bad).characters[0]
  check('bad rank sanitized to none', fixed2.rankPoints === 0 && fixed2.highestRank === 0 && fixed2.honorLastPeriod === null && fixed2.honorPeriod === null)
  const v2 = JSON.parse(JSON.stringify(acc))
  for (const s of savedCharacters(v2)) { delete s.honorPeriod; delete s.honorLastPeriod; s.honorLastDay = { kills: 17, points: 2500, standing: 3 } }
  const v2Back = Account.fromJSON(v2).characters[0]
  check('version 2 saves: the day counts toward its period', same(v2Back.honorPeriod, { period: Math.floor(D / RESET_DAYS), kills: 6, points: 400.5 }) && v2Back.honorLastPeriod === null && v2Back.rankPoints === 25000.5)
  const old = JSON.parse(JSON.stringify(acc))
  for (const s of savedCharacters(old)) { delete s.rankPoints; delete s.highestRank; delete s.honorLastPeriod; delete s.honorPeriod; s.honorToday = { day: D, victims: { x: 2 } } }
  const oldBack = Account.fromJSON(old).characters[0]
  check('old saves start at rank 0', oldBack.rank === 0 && oldBack.highestRank === 0 && oldBack.honorLastPeriod === null && oldBack.honorToday.kills === 0 && oldBack.honorToday.victims.x === 2 && oldBack.honorPeriod.kills === 0)
}

// The sheet.
{
  const c = make(HORDE)
  c.rankPoints = 25000
  c.highestRank = 9
  c.honorLastPeriod = { kills: 17, points: 2500, standing: 3 }
  c.honorToday = { day: dayOf(Date.now()), kills: 4, points: 312, victims: {} }
  earned(c, 9, 700, periodOf(Date.now()))
  const text = renderCharacterSheet({ character: c, onDelete: () => {} }).textContent
  check('sheet shows rank', text.includes('Blood Guard (Rank 7)') && text.includes('25,000 / 30,000 rank points'), text.match(/Blood Guard[^·]*·[^·]*/)?.[0])
  check('sheet shows highest rank', text.includes('highest Centurion (Rank 9)'))
  check('sheet shows today, since and before the reset', text.includes('Today4312') && text.includes(`Since reset9 / ${MIN_HONOR_KILLS}700`) && text.includes('Last reset172,500#3'))
  const none = renderCharacterSheet({ character: make(ALLIANCE), onDelete: () => {} }).textContent
  check('sheet shows no rank', none.includes('No rank') && none.includes(`${MIN_HONOR_KILLS} honorable kills in 3 days`))
}

process.exit(fails ? 1 : 0)
