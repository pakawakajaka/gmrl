// Fights simulated event by event with expected values (no dice): every swing, cast, tick and regen tick
// happens at its real time, and each one deals its average outcome after misses, dodges, parries,
// glancing blows, crits, armor and resists. Formulas follow the CMaNGOS Classic server. Characters fight
// with the spell ranks they've trained, the gear they wear and their class's rotation; each class tries
// a few rotation variants and the fastest kill-and-recover cycle wins (see combat.js).
import { CLASS_SPELLS, PETS } from './gear-data.js'
import { characterStats } from './stats.js'
import { effectValue, getSpell, knownAbilities } from './spells.js'

export const MAX_FIGHT_SECONDS = 300
const MELEE_RANGE = 5
const PULL_RANGE = 30
const HUNTER_RANGE = 35
const YARDS_PER_RUN = 7 // yards per second at run speed 1
const DEFAULT_RUN = 1.14286
const PET_RUN = YARDS_PER_RUN * DEFAULT_RUN
const PET_LEVEL = 10 // hunters tame and warlocks get a voidwalker at 10
const PUSHBACK = [1, 0.8, 0.6, 0.4, 0.2] // seconds per landed hit while casting
const REGEN_TICK = 2
const FIVE_SECOND_RULE = 5
const STAT_KEYS = ['str', 'agi', 'sta', 'int', 'spi']
const SCHOOL_NAMES = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']
const WAND_CLASSES = new Set(['Mage', 'Priest', 'Warlock'])
const EPS = 1e-6

// Long self-buffs cast between fights; the first known spell of each group.
const PREBUFFS = {
  Warrior: [['Battle Shout']],
  Hunter: [['Aspect of the Hawk']],
  Mage: [['Arcane Intellect'], ['Ice Armor', 'Frost Armor']],
  Priest: [['Power Word: Fortitude'], ['Inner Fire']],
  Warlock: [['Demon Armor', 'Demon Skin']],
  Paladin: [['Devotion Aura'], ['Blessing of Might']],
  Druid: [['Mark of the Wild'], ['Thorns']],
}
const HEALS = { Priest: ['Lesser Heal', 'Heal', 'Greater Heal'], Paladin: ['Holy Light'], Shaman: ['Healing Wave'], Druid: ['Healing Touch'] }

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)
const average = (w) => (w.min + w.max) / 2
const rageConversion = (level) => 0.0091107836 * level * level + 3.225598133 * level + 4.2652911
const armorFactor = (armor, attackerLevel) => 1 - Math.min(0.75, armor / (armor + 400 + 85 * attackerLevel))
const levelPenalty = (spell) => (spell.spellLevel > 0 && spell.spellLevel < 20 ? 1 - (20 - spell.spellLevel) * 0.0375 : 1)

// A mob at `level` as the sim sees it.
export function foeFor(mob, level) {
  const [lo, hi] = mob.level
  const speed = mob.speed ?? 2
  return {
    level,
    hp: hi > lo ? Math.round(mob.hp[0] + ((mob.hp[1] - mob.hp[0]) * (level - lo)) / (hi - lo)) : mob.hp[0],
    armor: mob.armor ?? 0,
    speed,
    swing: mob.dps * speed,
    run: YARDS_PER_RUN * (mob.run ?? DEFAULT_RUN),
    resist: mob.resist ?? {},
  }
}

// Player or pet attacking an NPC (CMaNGOS Unit::CalculateEffective*Chance). Chances are fractions; `mult`
// is the expected damage of one attack relative to a normal hit.
function attackTable({ skill, crit, hit = 0, level, cls }, mobLevel, { white = false, ranged = false, dualWield = false, onlyMiss = false } = {}) {
  const d = mobLevel * 5 - skill
  let miss = 5 + (white && dualWield ? 19 : 0)
  miss += d > 10 ? 1 + (d - 10) * 0.6 : d * (d > 0 ? 0.1 : 0.04)
  miss = clamp(miss - hit, d > 10 ? 1 : 0, 100)
  const dodge = onlyMiss ? 0 : clamp(5 + d * (d > 0 ? 0.1 : 0.04), 0, 100 - miss)
  const parry = onlyMiss || ranged ? 0 : clamp(5 + d * (d > 10 ? 0.6 : d > 0 ? 0.1 : 0.04), 0, 100 - miss - dodge)
  const avoided = miss + dodge + parry
  let glance = 0
  let glanceMult = 1
  if (white && !ranged && mobLevel > 10) {
    glance = clamp((WAND_CLASSES.has(cls) ? Math.min(level, 30) : 10) + 2 * d, 0, 100 - avoided)
    const high = clamp(1.2 - 0.03 * d, 0.2, 0.99)
    const low = clamp(1.3 - 0.05 * d, 0.01, Math.min(0.91, high))
    glanceMult = (high + low) / 2
  }
  const critChance = clamp(crit + (skill - mobLevel * 5) * 0.2, 0, 100 - avoided - glance)
  const plain = 100 - avoided - glance - critChance
  return { land: (100 - avoided) / 100, dodge: dodge / 100, crit: critChance / 100, mult: (plain + critChance * 2 + glance * glanceMult) / 100 }
}

// An NPC swinging at a player or pet: { land, mult, block } with block the chance of a blocked swing.
function defenseTable(defense, defender, mobLevel) {
  const skill = mobLevel * 5
  const diff = defense.defense - skill
  const miss = clamp(5 + diff * 0.04, 0, 100)
  const dodge = clamp(defense.dodge + diff * 0.04, 0, 100 - miss)
  const parry = defense.parry > 0 ? clamp(defense.parry + diff * 0.04, 0, 100 - miss - dodge) : 0
  const block = defense.block > 0 ? clamp(defense.block + diff * 0.04, 0, 100 - miss - dodge - parry) : 0
  let left = 100 - miss - dodge - parry - block
  const crit = clamp(5 - diff * 0.04, 0, left)
  left -= crit
  const deficit = skill - Math.min(defense.defense, defender * 5)
  const crush = deficit >= 15 ? clamp(deficit * 2 - 15, 0, left) : 0
  const plain = left - crush
  return { land: (100 - miss - dodge - parry) / 100, mult: (plain + block + crit * 2 + crush * 1.5) / 100, block: block / 100 }
}

// Everything about a character that doesn't depend on the mob: trained spells, prebuffed stats, pet.
export function buildKit(character) {
  const cls = character.characterClass
  const level = character.characterLevel
  const abilities = Object.fromEntries(Object.entries(knownAbilities(character)).map(([name, id]) => [name, getSpell(id)]))
  const buffs = {}
  const add = (key, value) => (buffs[key] = (buffs[key] ?? 0) + value)
  const kit = { cls, level, abilities, upkeep: [], regen: 0, chill: 0, thorns: null, innerFire: null, pet: null }
  for (const group of PREBUFFS[cls] ?? []) {
    const name = group.find((n) => abilities[n])
    if (!name) continue
    const spell = abilities[name]
    kit.upkeep.push(spell)
    for (const e of spell.effects) {
      const value = effectValue(spell, e, level)
      if (e.aura === 22 && e.misc & 1) {
        if (spell.charges) kit.innerFire = { armor: value, charges: spell.charges }
        else add('armor', value)
      } else if (e.aura === 29) STAT_KEYS.forEach((key, i) => (e.misc === -1 || (e.misc ?? 0) === i) && add(key, value))
      else if (e.aura === 99) add('attackPower', value)
      else if (e.aura === 124) add('rangedAttackPower', value)
      else if (e.aura === 15) kit.thorns = { value, school: spell.school }
      else if (e.aura === 161) kit.regen += value
      else if (e.aura === 42 && e.trigger) {
        const proc = getSpell(e.trigger)
        const haste = proc?.effects.find((x) => x.aura === 138)
        if (haste) kit.chill = -effectValue(proc, haste, level)
      }
    }
  }
  const stats = characterStats(character, buffs)
  kit.stats = stats
  kit.wand = stats.ranged?.isWand ? stats.ranged : null
  const known = new Set(character.spells)
  kit.heals = (HEALS[cls] ?? []).flatMap((name) => (CLASS_SPELLS[cls]?.[name] ?? []).filter(([id]) => known.has(id)).map(([id]) => getSpell(id)))
  if (abilities['Lightning Shield']) kit.lightningShield = { spell: abilities['Lightning Shield'], proc: getSpell(abilities['Lightning Shield'].proc) }

  if (cls === 'Hunter' && level >= PET_LEVEL) {
    const [hp, , armor, str, agi] = PETS.Hunter.levels[level - 1]
    const ap = Math.max(0, 2 * str - 20)
    kit.pet = { tank: true, level, hp, armor: armor + 2 * agi, speed: PETS.Hunter.speed, hit: (0.9375 * level + (ap / 14) * PETS.Hunter.speed) * 1.25 }
  } else if (cls === 'Warlock' && level >= PET_LEVEL) {
    const [hp, , armor, , agi, , , , dmg] = PETS.Voidwalker.levels[level - 1]
    kit.pet = { tank: true, level, hp, armor: armor + 2 * agi, speed: PETS.Voidwalker.speed, hit: dmg * 1.25 }
  } else if (cls === 'Warlock') {
    const firebolt = getSpell(PETS.Imp.spell)
    kit.pet = { tank: false, level, firebolt, castTime: firebolt.cast / 1000 }
  }
  return kit
}

// Mana a prebuff costs per cast.
export function manaCost(kit, spell) {
  return spell.cost ?? (spell.costPct ? (kit.stats.baseMana * spell.costPct) / 100 : 0)
}

// Rotation variants worth comparing for the class. combat.js keeps the fastest.
export function variantsFor(kit) {
  const A = kit.abilities
  switch (kit.cls) {
    case 'Warrior': return [{ pull: 'melee', hs: null }, { pull: 'melee', hs: 30 }, { pull: 'melee', hs: 60 }].filter((v) => v.hs === null || A['Heroic Strike'])
    case 'Rogue': return A['Slice and Dice'] ? [{ pull: 'melee' }, { pull: 'melee', snd: true }] : [{ pull: 'melee' }]
    case 'Hunter': {
      const stings = A['Serpent Sting'] || A["Hunter's Mark"] ? [false, true] : [false]
      const arcane = A['Arcane Shot'] ? [false, true] : [false]
      const pull = kit.stats.ranged && !kit.stats.ranged.isWand ? 'ranged' : 'melee'
      return stings.flatMap((s) => arcane.map((a) => ({ pull, stings: s, arcane: a })))
    }
    case 'Mage': return ['Frostbolt', 'Fireball', 'Arcane Missiles', kit.wand && 'wand'].filter((f) => f && (f === 'wand' || A[f])).map((filler) => ({ pull: 'ranged', filler }))
    case 'Priest': return ['Smite', kit.wand && 'wand'].filter(Boolean).flatMap((filler) => [{ pull: 'ranged', filler }, ...(A['Power Word: Shield'] ? [{ pull: 'ranged', filler, shield: true }] : [])])
    case 'Warlock': return [{ pull: 'ranged', filler: 'Shadow Bolt', dots: true }, { pull: 'ranged', filler: 'Shadow Bolt' }, ...(kit.wand ? [{ pull: 'ranged', filler: 'wand', dots: true }] : [])]
    case 'Paladin': return [{ pull: 'melee' }, ...(A.Judgement ? [{ pull: 'melee', judge: true }] : [])]
    case 'Shaman': return [{ pull: 'ranged', filler: 'Lightning Bolt' }, { pull: 'melee' }]
    case 'Druid': return [{ pull: 'ranged', filler: 'Wrath' }, ...(A['Cat Form'] && A.Claw ? [{ pull: 'melee', cat: true }] : [])]
    default: return [{ pull: 'melee' }]
  }
}

// One fight from pull to kill. `v` is a variant from variantsFor; `v.cycle` (seconds from one pull to the
// next) spreads cooldowns longer than a fight, like Bloodrage and Battle Shout, across fights.
// Returns { seconds, died, hpLost, manaLost, petLost, petDied, charges, dps }.
export function simulate(kit, foe, v) {
  const { cls, level, stats, abilities: A } = kit
  const maxHp = stats.health
  const maxMana = stats.mana
  const cat = v.cat
  let t = 0
  let hp = maxHp
  let mana = maxMana
  let rage = 0
  let energy = 100
  let cp = 0
  let mobHp = foe.hp
  let dealt = 0
  let lastSpend = -Infinity
  let gcdEnd = 0
  const cooldowns = new Map()
  const onMob = new Map() // debuff name -> { end }
  let cast = null // { spell, end, total, hits, channel }
  let castEv = null
  let queued = null // next-swing ability
  let wanding = false
  let overpowerAcc = 0
  let overpowerUntil = -1
  let absorb = 0
  let weakenedSoul = -1
  let lsCharges = kit.lightningShield ? 3 : 0
  let ifCharges = kit.innerFire?.charges ?? 0
  let chilled = false
  let sealEnd = -1
  let sndEnd = -1
  let markBonus = 0
  let stunUntil = 0

  // ---- Events ----
  const events = []
  const at = (time, fn) => {
    const ev = { time, fn }
    events.push(ev)
    return ev
  }
  const nextEvent = () => {
    let best = 0
    for (let i = 1; i < events.length; i++) if (events[i].time < events[best].time) best = i
    const ev = events[best]
    events[best] = events[events.length - 1]
    events.pop()
    return ev
  }

  // ---- Positions ----
  const range = cls === 'Hunter' ? HUNTER_RANGE : PULL_RANGE
  const pet = kit.pet && { ...kit.pet, maxHp: kit.pet.hp, alive: true }
  let target = pet?.tank ? 'pet' : 'player'
  let inMelee = false // the mob is beating on its target
  let gap = v.pull === 'melee' ? 0 : range - MELEE_RANGE
  let running = false
  let runFrom = 0
  let runSpeed = 0
  let arriveEv = null
  let slow = 0
  let slowEnd = 0
  const playerInMelee = () => inMelee && target === 'player'

  function move() {
    if (running) gap = Math.max(0, gap - runSpeed * (t - runFrom))
    runFrom = t
  }
  function setCourse() {
    move()
    runSpeed = foe.run * (t < slowEnd - EPS ? 1 - slow : 1)
    if (arriveEv) arriveEv.fn = null
    arriveEv = at(t + gap / runSpeed, arrive)
  }
  function aggro() {
    if (running || inMelee || target !== 'player') return
    running = true
    runFrom = t
    setCourse()
  }
  function arrive() {
    arriveEv = null
    move()
    running = false
    gap = 0
    engage()
  }
  function applySlow(fraction, seconds) {
    slow = fraction
    slowEnd = t + seconds
    if (running) {
      setCourse()
      at(slowEnd, () => running && setCourse())
    }
  }

  // ---- Damage ----
  const conversion = rageConversion(level)
  const mobArmor = armorFactor(foe.armor, level)
  const resistFactor = (school) => {
    if (!school || school === 1) return 1
    const skill = Math.max(level * 5, 100)
    const pct = ((foe.resist[SCHOOL_NAMES[school]] ?? 0) / skill) * 75 + 0.4 * Math.max(foe.level * 5 - skill, 0)
    return 1 - Math.min(75, pct) / 100
  }
  const spellTables = new Map()
  function spellTable(school) {
    if (spellTables.has(school)) return spellTables.get(school)
    const diff = foe.level - level
    const miss = clamp((diff <= 2 ? 4 + diff : 6 + (diff - 2) * 11) - stats.spell.hit, 1, 100)
    const land = 1 - miss / 100
    const crit = stats.spell.crit / 100
    const resist = resistFactor(school)
    const table = { land, crit, mult: land * (1 + crit * 0.5) * resist, tick: land * resist }
    spellTables.set(school, table)
    return table
  }
  const spellPower = (school) => (school > 0 ? stats.spell.damage + (stats.spell.schoolDamage[SCHOOL_NAMES[school]] ?? 0) : 0)

  const melee = stats.melee
  const catAp = melee.attackPower + stats.stats.agi.total
  const mh = cat ? { min: 0.85 * level + catAp / 14, max: 1.25 * level + catAp / 14, speed: 1, base: [0.85 * level, 1.25 * level], subclass: -1 } : melee.mainHand
  const oh = cat ? null : melee.offHand
  const attacker = { skill: cat ? level * 5 : melee.skill, crit: cat ? melee.baseCrit : melee.crit, hit: melee.hit, level, cls }
  const whiteMh = attackTable(attacker, foe.level, { white: true, dualWield: !!oh })
  const whiteOh = oh && whiteMh
  const yellow = attackTable(attacker, foe.level)
  const overpower = attackTable(attacker, foe.level, { onlyMiss: true })
  const ranged = stats.ranged && !stats.ranged.isWand ? stats.ranged : null
  const rangedTable = ranged && attackTable({ skill: ranged.skill, crit: ranged.crit, hit: melee.hit, level, cls }, foe.level, { ranged: true })
  const wandTable = kit.wand && attackTable({ skill: kit.wand.skill, crit: kit.wand.crit, hit: melee.hit, level, cls }, foe.level, { ranged: true })
  const defense = defenseTable(stats.defenses, level, foe.level)
  const normalized = cat ? 1 : mh.subclass === 15 ? 1.7 : melee.twoHand ? 3.3 : 2.4
  const attackPower = cat ? catAp : melee.attackPower

  function gainRage(amount) {
    if (cls === 'Warrior') rage = Math.min(100, rage + amount)
  }
  function damageMob(amount) {
    if (amount <= 0) return
    mobHp -= amount
    dealt += amount
    aggro()
  }

  // Seal of Righteousness: holy damage on each melee hit (CMaNGOS spell 25742 script).
  let sealProc = 0
  if (A['Seal of Righteousness']) {
    const seal = A['Seal of Righteousness']
    const amount = effectValue(seal, seal.effects[0], level)
    const speed = mh.speed
    const weapon = (mh.base[0] + mh.base[1]) / 2
    const base = melee.twoHand
      ? 1.2 * amount * 1.2 * 1.03 * speed / 100 + 1 + 0.03 * weapon + 1
      : 0.85 * Math.ceil(amount * 1.2 * 1.03 * speed / 100) + 0.03 * weapon
    sealProc = (base + (melee.twoHand ? 0.108 : 0.092) * speed * spellPower(1) * levelPenalty(seal)) * yellow.land * (1 + yellow.crit)
  }
  function meleeLanded(land) {
    if (sealEnd > t) damageMob(sealProc * land)
  }
  function trackDodges(dodge) {
    if (!A.Overpower) return
    overpowerAcc += dodge
    if (overpowerAcc >= 1) {
      overpowerAcc -= 1
      overpowerUntil = t + 5
    }
  }
  const swingTime = (speed) => (sndEnd > t ? speed / 1.3 : speed)

  // ---- Player auto attacks ----
  let mhEv = null
  let ohEv = null
  let autoEv = null
  let wandEv = null
  function startMelee() {
    if (!mhEv) mhEv = at(t, mhSwing)
    if (oh && !ohEv) ohEv = at(t, ohSwing)
  }
  function mhSwing() {
    mhEv = null
    if (!playerInMelee()) return
    if (cast) {
      mhEv = at(cast.end + EPS, mhSwing)
      return
    }
    if (!wanding) {
      if (queued && canAfford(queued)) {
        const s = queued
        spend(s)
        const bonus = s.effects.reduce((sum, e) => sum + ([17, 58].includes(e.type) ? effectValue(s, e, level) : 0), 0)
        damageMob((average(mh) + bonus) * yellow.mult * mobArmor)
        trackDodges(yellow.dodge)
        meleeLanded(yellow.land)
        if (s.cooldown) cooldowns.set(cdKey(s), t + s.cooldown / 1000)
      } else {
        const dmg = average(mh) * whiteMh.mult * mobArmor
        damageMob(dmg)
        gainRage((dmg * 7.5) / conversion)
        trackDodges(whiteMh.dodge)
        meleeLanded(whiteMh.land)
      }
    }
    queued = null
    mhEv = at(t + swingTime(mh.speed), mhSwing)
  }
  function ohSwing() {
    ohEv = null
    if (!playerInMelee()) return
    if (cast) {
      ohEv = at(cast.end + EPS, ohSwing)
      return
    }
    const dmg = average(oh) * whiteOh.mult * mobArmor
    damageMob(dmg)
    gainRage((dmg * 7.5) / conversion)
    trackDodges(whiteOh.dodge)
    meleeLanded(whiteOh.land)
    ohEv = at(t + swingTime(oh.speed), ohSwing)
  }
  // Hunters' Auto Shot, only while the mob isn't on top of them.
  function autoShot() {
    autoEv = null
    if (playerInMelee()) return
    damageMob((average(ranged) + (markBonus / 14) * ranged.speed) * rangedTable.mult * mobArmor)
    autoEv = at(t + ranged.speed, autoShot)
  }
  function wandShot() {
    wandEv = null
    if (!wanding) return
    if (cast) {
      wandEv = at(cast.end + EPS, wandShot)
      return
    }
    const school = kit.wand.school
    damageMob(average(kit.wand) * wandTable.mult * (school ? resistFactor(school) : mobArmor))
    wandEv = at(t + kit.wand.speed, wandShot)
  }
  function setWanding(on) {
    wanding = on
    if (on && !wandEv) wandEv = at(t, wandShot)
  }

  // ---- The mob's swings ----
  let mobEv = null
  function engage() {
    inMelee = true
    if (!mobEv) mobEv = at(Math.max(t, stunUntil), mobSwing)
    if (target === 'player') startMelee()
  }
  function mobSwing() {
    mobEv = null
    if (!inMelee) return
    if (target === 'pet') hitPet()
    else hitPlayer()
    if (mobHp > 0) mobEv = at(t + foe.speed * (chilled ? 1 + kit.chill / 100 : 1), mobSwing)
  }
  function hitPlayer() {
    const armor = stats.defenses.armor + (ifCharges > 0 ? kit.innerFire.armor : 0)
    const raw = foe.swing * armorFactor(armor, foe.level)
    let dmg = Math.max(0, raw * defense.mult - defense.block * Math.min(raw, stats.defenses.blockValue))
    const soaked = Math.min(absorb, dmg)
    absorb -= soaked
    dmg -= soaked
    hp -= dmg
    gainRage((dmg * 2.5) / conversion)
    const land = defense.land
    if (cast?.spell.pushback && land > 0) pushback(land)
    if (lsCharges > 0) {
      const used = Math.min(lsCharges, land)
      lsCharges -= used
      const proc = kit.lightningShield.proc
      const e = proc.effects[0]
      damageMob((effectValue(proc, e, level) + (e.coef ?? 0) * spellPower(proc.school) * levelPenalty(proc)) * spellTable(proc.school).mult * used)
    }
    if (kit.thorns) damageMob(kit.thorns.value * land * resistFactor(kit.thorns.school))
    if (ifCharges > 0) ifCharges = Math.max(0, ifCharges - land)
    if (kit.chill && land > 0) chilled = true
  }
  const petDefense = pet?.tank && defenseTable({ defense: pet.level * 5, dodge: 5, parry: 0, block: 0 }, pet.level, foe.level)
  function hitPet() {
    pet.hp -= foe.swing * armorFactor(pet.armor, foe.level) * petDefense.mult
    if (pet.hp > 0) return
    pet.alive = false
    target = 'player'
    inMelee = false
    gap = range - MELEE_RANGE
    running = true
    runFrom = t
    setCourse()
  }
  function petSwing() {
    if (!pet.alive || mobHp <= 0) return
    damageMob(pet.hit * petTable.mult * armorFactor(foe.armor, pet.level))
    at(t + pet.speed, petSwing)
  }
  const petTable = pet?.tank && attackTable({ skill: pet.level * 5, crit: 5, level: pet.level, cls: 'Pet' }, foe.level, { white: true })
  function impCast() {
    if (mobHp <= 0) return
    const s = pet.firebolt
    const e = s.effects[0]
    const diff = foe.level - pet.level
    const land = 1 - clamp(diff <= 2 ? 4 + diff : 6 + (diff - 2) * 11, 1, 100) / 100
    damageMob(effectValue(s, e, pet.level) * land * 1.025 * resistFactor(s.school))
    at(t + pet.castTime, impCast)
  }

  // ---- Casting ----
  function pushback(land) {
    const step = PUSHBACK[Math.min(Math.floor(cast.hits), 4)] * land
    cast.hits += land
    cast.end = cast.channel ? Math.max(t, cast.end - step) : Math.min(cast.end + step, t + cast.total)
    castEv.time = cast.end
  }
  const cdKey = (s) => s.category || s.name
  const ready = (s) => (cooldowns.get(cdKey(s)) ?? 0) <= t + EPS
  function costOf(s) {
    if (s.power === 'health') return s.costPct ? (stats.baseHealth * s.costPct) / 100 : effectValue(s, s.effects[0], level)
    if (s.power === 'rage' || s.power === 'energy') return s.cost ?? 0
    return s.cost ?? (s.costPct ? (stats.baseMana * s.costPct) / 100 : 0)
  }
  function canAfford(s) {
    const c = costOf(s)
    if (s.power === 'rage') return rage >= c
    if (s.power === 'energy') return energy >= c
    if (s.power === 'health') return hp > c + 1
    return mana >= c
  }
  function spend(s) {
    const c = costOf(s)
    if (s.power === 'rage') rage -= c
    else if (s.power === 'energy') energy -= c
    else if (s.power === 'health') hp -= c
    else if (c > 0) {
      mana -= c
      lastSpend = t + (s.cast ?? 0) / 1000
    }
  }
  function usable(s) {
    if (!s || cast) return false
    if (s.gcd && t < gcdEnd - EPS) return false
    if (!ready(s) || !canAfford(s)) return false
    if (s.targetState === 2 && mobHp > foe.hp * 0.2) return false
    if (s.melee && !playerInMelee()) return false
    return true
  }
  // Starts `s`; `effect` runs when it lands (at once for instants).
  function use(s, effect = () => resolve(s)) {
    spend(s)
    if (s.gcd) {
      gcdEnd = t + s.gcd / 1000
      at(gcdEnd, null)
    }
    const done = () => {
      if (s.cooldown) {
        cooldowns.set(cdKey(s), t + s.cooldown / 1000)
        at(t + s.cooldown / 1000, null)
      }
      effect()
    }
    if (s.channel) {
      const tick = s.effects.find((e) => e.period)
      const me = { spell: s, channel: true, end: t + s.duration / 1000, hits: 0 }
      cast = me
      castEv = at(me.end, () => {
        if (cast === me) cast = null
      })
      const ticks = Math.round(s.duration / tick.period)
      for (let k = 1; k <= ticks; k++) {
        at(t + (k * tick.period) / 1000, () => {
          if (cast === me && t <= me.end + EPS) channelTick(s, tick)
        })
      }
      done()
    } else if (s.cast) {
      const me = { spell: s, end: t + s.cast / 1000, total: s.cast / 1000, hits: 0 }
      cast = me
      castEv = at(me.end, () => {
        cast = null
        castEv = null
        done()
      })
    } else done()
    return true
  }
  const tryUse = (name, when = true) => when && usable(A[name]) && use(A[name])

  function channelTick(s, e) {
    if (e.aura === 23) {
      const missile = getSpell(e.trigger)
      const me = missile.effects[0]
      damageMob((effectValue(missile, me, level) + (me.coef ?? 0) * spellPower(missile.school) * levelPenalty(missile)) * spellTable(missile.school).mult)
    } else if (e.aura === 53) {
      const amount = (effectValue(s, e, level) + (e.coef ?? 0) * spellPower(s.school) * levelPenalty(s)) * spellTable(s.school).tick
      damageMob(amount)
      hp = Math.min(maxHp, hp + amount)
    }
  }

  function addDot(s, e, perTick, table) {
    const token = { end: t + s.duration / 1000 }
    onMob.set(s.name, token)
    const ticks = Math.round(s.duration / e.period)
    for (let k = 1; k <= ticks; k++) {
      // Curse of Agony starts weak and ends strong (CMaNGOS Aura::PeriodicTick).
      const scale = s.name === 'Curse of Agony' ? (k <= 4 ? 0.5 : k > 8 ? 1.5 : 1) : 1
      at(t + (k * e.period) / 1000, () => {
        if (onMob.get(s.name) === token && mobHp > 0) damageMob(perTick * scale * table)
      })
    }
  }

  const physicalTable = (s) => (s.name === 'Overpower' ? overpower : s.dmgClass === 3 ? rangedTable : yellow)
  const isFinisher = (s) => s.comboDuration || s.effects.some((e) => e.perCombo)

  // Applies a spell's effects when it lands.
  function resolve(s) {
    const physical = s.dmgClass === 2 || s.dmgClass === 3
    const table = physical ? physicalTable(s) : spellTable(s.school)
    const combo = isFinisher(s) ? cp : 0
    const bonus = (e) => (s.school > 0 ? (e.coef ?? 0) * spellPower(s.school) * levelPenalty(s) : 0) + (e.apCoef ?? 0) * attackPower
    const armor = s.school === 0 ? mobArmor : resistFactor(s.school)
    for (const e of s.effects) {
      const value = effectValue(s, e, level, combo)
      switch (e.type) {
        case 2: {
          let amount = value + bonus(e)
          if (s.name === 'Eviscerate') amount += attackPower * combo * 0.03
          if (s.name === 'Ferocious Bite') {
            amount += energy * (e.mult ?? 1) + attackPower * 0.03 * combo
            energy = 0
          }
          damageMob(amount * table.mult * armor)
          break
        }
        case 3:
          if (s.name === 'Execute') {
            damageMob((value + rage * 10 * (e.mult ?? 0)) * table.mult * mobArmor)
            rage = 0
          } else if (s.name === 'Life Tap') mana = Math.min(maxMana, mana + value)
          break
        case 17: case 58: case 121: {
          const weapon = s.dmgClass === 3
            ? average(ranged) + (markBonus / 14) * ranged.speed
            : e.type === 121 ? (mh.base[0] + mh.base[1]) / 2 + (attackPower / 14) * normalized : average(mh)
          damageMob((weapon + value) * table.mult * mobArmor)
          if (s.melee) meleeLanded(table.land)
          if (s.melee || s.dmgClass === 2) trackDodges(table.dodge ?? 0)
          break
        }
        case 30:
          if (e.misc === 1) gainRage(value / 10)
          break
        case 80:
          cp = Math.min(5, cp + table.land)
          break
        case 6: case 35:
          applyAura(s, e, value + bonus(e), table, physical ? table.land * (s.school ? resistFactor(s.school) : 1) : table.tick)
          break
      }
    }
    if (isFinisher(s)) cp = s.comboDuration ? 0 : cp * (1 - table.land)
    if (physical || s.effects.some((e) => e.type === 2 || e.aura === 3 || e.aura === 33)) aggro()
  }

  function applyAura(s, e, value, table, dotFactor) {
    switch (e.aura) {
      case 3: addDot(s, e, value, dotFactor); break
      case 33: if (value < 0) applySlow((-value / 100) * table.land, s.duration / 1000); break
      case 69: absorb = value; break
      case 127: markBonus = value; onMob.set(s.name, { end: t + s.duration / 1000 }); break
      case 138:
        if (s.comboDuration) {
          const [one, five] = s.comboDuration
          sndEnd = t + (one + ((five - one) * Math.max(0, cp - 1)) / 4) / 1000
        }
        break
      case 4: if (s.proc && s.judgement) sealEnd = t + s.duration / 1000; break
      case 42: if (s.charges) lsCharges = s.charges; break
    }
  }

  function heal(s) {
    const e = s.effects[0]
    const power = (s.proc ? getSpell(s.proc).effects[0].coef : (e.coef ?? 0)) * stats.spell.healing * levelPenalty(s)
    return (effectValue(s, e, level) + power) * (1 + (stats.spell.crit / 100) * 0.5)
  }
  const incoming = () => (playerInMelee() ? (foe.swing * armorFactor(stats.defenses.armor, foe.level) * defense.mult) / foe.speed : 0)
  const timeToKill = () => (dealt > 0 && t > 1 ? mobHp / (dealt / t) : MAX_FIGHT_SECONDS)
  // Heals only when the fight would otherwise end with the character (nearly) dead.
  function tryHeal() {
    if (!kit.heals.length || cast || t < gcdEnd - EPS) return false
    const need = incoming() * (Math.min(timeToKill(), 60) + 3) - hp + maxHp * 0.1
    if (need <= 0) return false
    const missing = maxHp - hp
    const options = kit.heals.filter((s) => canAfford(s))
    if (!options.length) return false
    const pick = options.find((s) => heal(s) >= Math.min(need, missing)) ?? options.at(-1)
    if (heal(pick) > missing * 1.25 && hp > maxHp * 0.3) return false
    return use(pick, () => (hp = Math.min(maxHp, hp + heal(pick))))
  }

  // ---- Rotations ----
  const notOn = (name) => !onMob.has(name) || onMob.get(name).end <= t + EPS
  const lasts = (seconds) => timeToKill() > seconds
  function filler(name) {
    const s = A[name]
    if (name !== 'wand' && s && usable(s)) {
      setWanding(false)
      return use(s)
    }
    if (kit.wand && !cast && (name === 'wand' || !s || !canAfford(s))) setWanding(true)
    return false
  }
  const ROTATIONS = {
    Warrior() {
      if (tryUse('Execute')) return true
      if (t < overpowerUntil && tryUse('Overpower')) {
        overpowerUntil = -1
        return true
      }
      if (tryUse('Rend', notOn('Rend') && lasts(9))) return true
      const hs = A['Heroic Strike']
      if (v.hs !== null && hs && !queued && rage >= v.hs && mobHp > foe.hp * 0.2) queued = hs
      return false
    },
    Rogue() {
      if (v.snd && cp >= 1 && sndEnd <= t && lasts(6) && tryUse('Slice and Dice')) return true
      const evis = A.Eviscerate
      const finishes = () => mobHp <= (effectValue(evis, evis.effects[0], level, cp) + attackPower * cp * 0.03) * yellow.mult * mobArmor
      if (cp >= 1 && (cp >= 5 - EPS || finishes()) && tryUse('Eviscerate')) return true
      return cp < 5 - EPS && tryUse('Sinister Strike')
    },
    Hunter() {
      if (v.stings && tryUse("Hunter's Mark", notOn("Hunter's Mark") && lasts(10))) return true
      if (!playerInMelee() && ranged) {
        if (!autoEv) autoEv = at(t, autoShot)
        if (v.stings && tryUse('Serpent Sting', notOn('Serpent Sting') && lasts(9))) return true
        if (v.arcane && tryUse('Arcane Shot')) return true
      } else if (playerInMelee()) {
        const raptor = A['Raptor Strike']
        if (!queued && raptor && ready(raptor) && canAfford(raptor)) queued = raptor
      }
      return false
    },
    Mage() {
      if (v.filler !== 'wand' && tryUse('Fire Blast')) return true
      return filler(v.filler)
    },
    Priest() {
      if (tryHeal()) return true
      if (v.shield && target === 'player' && absorb <= 0 && weakenedSoul <= t && usable(A['Power Word: Shield'])) {
        weakenedSoul = t + 15
        return use(A['Power Word: Shield'])
      }
      if (tryUse('Shadow Word: Pain', notOn('Shadow Word: Pain') && lasts(9))) return true
      if (v.filler !== 'wand' && tryUse('Mind Blast')) return true
      return filler(v.filler)
    },
    Warlock() {
      const drain = A['Drain Life']
      if (drain && incoming() * (Math.min(timeToKill(), 60) + 3) > hp && usable(drain)) {
        setWanding(false)
        return use(drain, () => {})
      }
      if (v.dots) {
        for (const name of ['Corruption', 'Curse of Agony', 'Immolate']) {
          if (A[name] && tryUse(name, notOn(name) && lasts(A[name].duration / 2000))) return true
        }
      }
      const main = A[v.filler]
      const tap = A['Life Tap']
      if (main && !canAfford(main) && tap && usable(tap) && hp - incoming() * timeToKill() > costOf(tap) + maxHp * 0.2) return use(tap)
      return filler(v.filler)
    },
    Paladin() {
      if (tryHeal()) return true
      if (sealEnd <= t && tryUse('Seal of Righteousness')) return true
      const judgement = A.Judgement
      if (v.judge && sealEnd > t && playerInMelee() && usable(judgement)) {
        const seal = A['Seal of Righteousness']
        return use(judgement, () => {
          const jor = getSpell(seal.judgement)
          const e = jor.effects[0]
          damageMob((effectValue(jor, e, level) + (e.coef ?? 0) * spellPower(1) * levelPenalty(jor)) * spellTable(1).mult)
          sealEnd = -1
        })
      }
      return false
    },
    Shaman() {
      if (tryHeal()) return true
      if (v.pull === 'melee' && lsCharges <= 0 && tryUse('Lightning Shield')) return true
      if (A['Flame Shock'] && notOn('Flame Shock') && lasts(9) && tryUse('Flame Shock')) return true
      if (tryUse('Earth Shock')) return true
      return v.filler ? filler(v.filler) : false
    },
    Druid() {
      if (cat) {
        if (tryUse('Rake', notOn('Rake') && lasts(6))) return true
        if (cp >= 5 - EPS) {
          if (A.Rip && notOn('Rip') && lasts(10)) return tryUse('Rip')
          return tryUse(A['Ferocious Bite'] ? 'Ferocious Bite' : 'Rip')
        }
        return tryUse('Claw')
      }
      if (tryHeal()) return true
      if (tryUse('Moonfire', notOn('Moonfire') && lasts(6))) return true
      return filler(v.filler)
    },
  }
  const rotation = ROTATIONS[cls]

  // ---- Pull ----
  const cycle = v.cycle ?? 0
  if (cls === 'Warrior') {
    const shout = A['Battle Shout']
    if (shout) rage -= (shout.cost ?? 0) * Math.min(1, cycle / (shout.duration / 1000))
    const charge = A.Charge
    if (charge) {
      gainRage(effectValue(charge, charge.effects.find((e) => e.type === 30), level) / 10)
      stunUntil = 1
    }
    const bloodrage = A.Bloodrage
    if (bloodrage) {
      const share = Math.min(1, cycle / (bloodrage.cooldown / 1000))
      hp -= costOf(bloodrage) * share
      gainRage((effectValue(bloodrage, bloodrage.effects[0], level) / 10) * share)
      const over = getSpell(bloodrage.effects.find((e) => e.trigger).trigger)
      const tick = over.effects[0]
      for (let k = 1; k <= over.duration / tick.period; k++) at((k * tick.period) / 1000, () => gainRage((effectValue(over, tick, level) / 10) * share))
    }
  }
  if (cat) {
    mana -= costOf(A['Cat Form'])
    lastSpend = 0
  }
  if (A['Seal of Righteousness'] && cls === 'Paladin') {
    // Sealed just before the pull.
    mana -= costOf(A['Seal of Righteousness'])
    sealEnd = A['Seal of Righteousness'].duration / 1000
  }
  if (pet?.tank) {
    at((range - MELEE_RANGE) / PET_RUN, () => {
      if (target !== 'pet') return
      engage()
      petSwing()
    })
  } else if (pet) at(0, impCast)
  if (v.pull === 'melee') engage()

  // Regen ticks (CMaNGOS: every 2 seconds) and rogue/cat energy.
  const usesEnergy = cls === 'Rogue' || cat
  function regenTick() {
    if (maxMana > 0) {
      const perSecond = stats.spell.mp5 / 5 + (t - lastSpend >= FIVE_SECOND_RULE ? stats.spell.regen / 5 : 0)
      mana = Math.min(maxMana, mana + perSecond * REGEN_TICK)
    }
    hp = Math.min(maxHp, hp + (kit.regen + stats.hp5 / 5) * REGEN_TICK)
    if (usesEnergy) energy = Math.min(100, energy + 20)
    at(t + REGEN_TICK, regenTick)
  }
  at(REGEN_TICK, regenTick)

  // ---- Run ----
  while (mobHp > 0 && hp > 0 && t < MAX_FIGHT_SECONDS) {
    for (let i = 0; i < 6 && rotation(); i++);
    if (mobHp <= 0 || hp <= 0) break
    const ev = nextEvent()
    t = ev.time
    if (ev.fn) ev.fn()
  }
  const died = hp <= 0 || mobHp > 0
  return {
    seconds: t,
    died,
    hpLost: clamp(maxHp - hp, 0, maxHp),
    manaLost: clamp(maxMana - mana, 0, maxMana),
    petLost: pet?.tank ? clamp(1 - pet.hp / pet.maxHp, 0, 1) : 0,
    petDied: !!pet && !pet.alive,
    charges: { lightningShield: kit.lightningShield ? 3 - lsCharges : 0, innerFire: kit.innerFire ? kit.innerFire.charges - ifCharges : 0 },
    dps: died ? 0 : foe.hp / Math.max(t, 0.1),
  }
}
