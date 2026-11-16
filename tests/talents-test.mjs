// Talents: default builds, spending rules, auto-spend while farming, saves and sim effects.
import { CLASSES } from '../data.js'
import { TALENTS } from '../gear-data.js'
import * as T from '../talents.js'
import Character from '../character.js'
import Account from '../account.js'
import { characterStats } from '../stats.js'
import { buildKit } from '../sim.js'
import { effectValue, trainSpells } from '../spells.js'

let failed = 0
const check = (ok, msg) => {
  if (!ok) {
    failed++
    console.log('FAIL', msg)
  }
}

// Every default build: 51 points, every key real, every prefix legal.
for (const [cls, { specs }] of Object.entries(CLASSES)) {
  for (const spec of Object.keys(specs)) {
    const order = T.defaultOrder(cls, spec)
    check(order.length === 51, `${cls} ${spec}: ${order.length} points`)
    const build = {}
    for (const [i, key] of order.entries()) {
      const t = T.getTalent(cls, key)
      if (!t) {
        check(false, `${cls} ${spec}: unknown ${key}`)
        break
      }
      build[key] = (build[key] ?? 0) + 1
      if (!T.isValidBuild(cls, build)) {
        check(false, `${cls} ${spec}: point ${i + 1} (${key} ${build[key]}) illegal`)
        break
      }
    }
    // Most points in the spec's own tree.
    const trees = TALENTS[cls].map((tr) => tr.talents.reduce((s, t) => s + (build[t.key] ?? 0), 0))
    const main = TALENTS[cls].findIndex((tr) => tr.name === spec)
    check(main >= 0 && trees[main] === Math.max(...trees), `${cls} ${spec}: main tree ${trees}`)
  }
}

// Spending rules.
const make = (cls, spec, level, extra = {}) => {
  const c = new Character({ characterName: 'Tester', characterClass: cls, characterSpec: spec, characterRace: { Druid: 'Tauren', Shaman: 'Tauren', Paladin: 'Human', Mage: 'Undead', Priest: 'Undead' }[cls] ?? 'Orc', characterRole: CLASSES[cls].specs[spec][0], characterLevel: level, copper: 1e9, ...extra })
  trainSpells(c)
  return c
}
{
  const c = make('Warrior', 'Arms', 9)
  check(T.pointsSpent(c.talents) === 0, 'level 9 has no points')
  const w = make('Warrior', 'Arms', 12, { talents: {} })
  check(T.talentPoints(12) === 3, 'level 12 has 3 points')
  check(!w.learnTalent('mortalStrike'), 'row 7 locked')
  check(w.learnTalent('deflection') && w.talents.deflection === 1, 'learn row 0')
  check(w.learnTalent('deflection') && w.learnTalent('deflection'), 'learn 3')
  check(!w.learnTalent('deflection'), 'no points left')
  check(w.unlearnTalent('deflection') && w.talents.deflection === 2, 'unlearn')
  const f = make('Warrior', 'Arms', 60, { talents: {} })
  for (let i = 0; i < 5; i++) f.learnTalent('deflection')
  check(f.learnTalent('improvedCharge'), 'row 1 after 5')
  check(!f.unlearnTalent('deflection'), 'cannot unlearn below row requirement')
  f.resetTalents()
  check(T.pointsSpent(f.talents) === 0, 'reset')
  f.useDefaultTalents()
  check(T.pointsSpent(f.talents) === 51 && f.talents.mortalStrike === 1, 'default build applied')
  // Prereq: Mortal Strike needs nothing; Improved Overpower? Check one with prereq.
  const pre = Object.values(TALENTS.Warrior).flatMap((tr) => tr.talents).find((t) => t.prereq)
  check(!!pre, 'some talent has a prereq')
}

// New characters at a level get the default build; saves round-trip; bad saves fall back.
{
  const c = make('Mage', 'Frost', 40)
  check(T.pointsSpent(c.talents) === 31, `level 40 default spent ${T.pointsSpent(c.talents)}`)
  check(c.talents.improvedFrostbolt === 5, 'frost starts with improved frostbolt')
  c.unlearnTalent('arcticReach')
  const saved = JSON.parse(JSON.stringify({ guilds: [{ guildName: 'Test Guild', faction: c.faction, characters: [c] }] }))
  const restored = Account.fromJSON(saved).characters[0]
  check(JSON.stringify(restored.talents) === JSON.stringify(c.talents), 'talents round-trip')
  delete saved.guilds[0].characters[0].talents
  check(T.pointsSpent(Account.fromJSON(saved).characters[0].talents) === 31, 'old save gets default build')
  saved.guilds[0].characters[0].talents = { wintersChill: 5, nonsense: 3 }
  check(T.pointsSpent(Account.fromJSON(saved).characters[0].talents) === 31, 'illegal save gets default build')
  saved.guilds[0].characters[0].talents = { improvedFrostbolt: 99 }
  check(Account.fromJSON(saved).characters[0].talents.improvedFrostbolt === 5, 'ranks clamped')
}

// Auto-spend while farming follows the default build; manual picks are kept.
{
  const c = make('Rogue', 'Combat', 10, { talents: {} })
  c.characterXp = 0
  T.autoSpend(c)
  check(c.talents.improvedSinisterStrike === 1, 'auto-spend first default point')
  c.resetTalents()
  c.learnTalent('lightningReflexes')
  c.characterLevel = 15
  const n = T.autoSpend(c, 5)
  check(n === 5 && c.talents.lightningReflexes === 1 && T.pointsSpent(c.talents) === 6, `manual pick kept, ${JSON.stringify(c.talents)}`)
  // farm(): level up from xp gains points.
  const f = make('Warrior', 'Fury', 20)
  f.zone = 'The Barrens'
  const before = T.pointsSpent(f.talents)
  f.characterXp = f.xpToNextLevel - 1
  f.farm(1)
  check(f.characterLevel > 20 ? T.pointsSpent(f.talents) === before + f.characterLevel - 20 : true, `farm auto-spends (${f.characterLevel}, ${T.pointsSpent(f.talents)})`)
}

// Effects: spell mods and stat auras.
{
  const plain = make('Mage', 'Frost', 60, { talents: {} })
  const frost = make('Mage', 'Frost', 60)
  const kp = buildKit(plain)
  const kf = buildKit(frost)
  check(kf.abilities.Frostbolt.cast === kp.abilities.Frostbolt.cast - 500, 'Improved Frostbolt -0.5s')
  check(kf.abilities.Frostbolt.critDmgPct === 100, 'Ice Shards')
  check(kf.abilities.Frostbolt.dmgPct === 6, 'Piercing Ice')
  check(kf.abilities.Frostbolt.cost < kp.abilities.Frostbolt.cost, 'Frost Channeling')

  const war = make('Warrior', 'Arms', 60, { equipment: { mainHand: 870 } })
  const st = characterStats(war)
  check(st.melee.crit > characterStats(make('Warrior', 'Arms', 60, { talents: {}, equipment: { mainHand: 870 } })).melee.crit + 4.9, 'Cruelty crit')
  const kw = buildKit(war)
  check(kw.abilities['Heroic Strike'].cost === buildKit(make('Warrior', 'Arms', 60, { talents: {} })).abilities['Heroic Strike'].cost - 3, 'Improved Heroic Strike -3 rage')
  const rend = kw.abilities.Rend
  check(effectValue(rend, rend.effects[0], 60) > 0 && rend.effects[0].pct === 35, 'Improved Rend 35%')

  const pal = make('Paladin', 'Holy', 60)
  const sp = characterStats(pal)
  const sp0 = characterStats(make('Paladin', 'Holy', 60, { talents: {} }))
  check(sp.stats.int.total > sp0.stats.int.total, 'Divine Intellect')
  check(sp.spell.schoolCrit[1] === 5, 'Holy Power holy crit')

  const rog = make('Rogue', 'Assassination', 60)
  check(characterStats(rog).energy === 110, 'Vigor energy')
  const pri = make('Priest', 'Discipline', 60)
  check(characterStats(pri).spell.castingRegen === 15, 'Meditation')
  const dru = make('Druid', 'Feral Combat', 60)
  check(characterStats(dru).melee.formCrit === 6, 'Sharpened Claws in forms only')
}

// Support classification covers every talent, and every rank has data.
{
  const counts = { full: 0, partial: 0, none: 0 }
  for (const [cls, trees] of Object.entries(TALENTS)) for (const tr of trees) for (const t of tr.talents) {
    counts[T.talentSupport(cls, t.key)]++
    check(t.ranks.length === t.max, `${cls} ${t.key} has ${t.ranks.length}/${t.max} ranks`)
  }
  console.log('support', JSON.stringify(counts))
  check(counts.full > 50, 'many talents modeled')
}

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
