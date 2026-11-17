// Fights simulated event by event with expected values (no dice): every swing, cast, tick and regen tick
// happens at its real time, and each one deals its average outcome after misses, dodges, parries,
// glancing blows, crits, armor and resists. Formulas follow the CMaNGOS Classic server. Characters fight
// with the spell ranks they've trained, the gear they wear and their class's rotation; each class tries
// a few rotation variants and the fastest kill-and-recover cycle wins (see combat.js). Passive talents
// change spells through kit.spell (see moddedSpell in talents.js) and stats through characterStats.
import { CLASS_SPELLS, PETS } from './gear-data.js'
import { characterStats, equippedItems } from './stats.js'
import { effectValue, getSpell, knownAbilities } from './spells.js'
import { moddedSpell, talentEffects } from './talents.js'

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
const PVP_HEAL_HORIZON = 10 // seconds a player looks ahead before healing against another player
const RECENT_SECONDS = 5 // how far back a player judges the damage it's taking
export const HEARTH_SECONDS = 10 // Hearthstone cast
const HEARTHSTONE = { name: 'Hearthstone' }
const BUBBLE_AT = 0.2 // health share at which a paladin bubbles and hearths out
const SWITCH_SECONDS = 1.5 // a melee player getting to its next target in a brawl
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
const damageBonus = (spell) => 1 + (spell.dmgPct ?? 0) / 100 // talents on direct damage and healing
const AUTO_SHOT = 75

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

// Two players fighting, both event by event on one clock, each one's hits landing on the other's actual
// health: `kits[i]` fights with variant `variants[i]`, joining after `delays[i]` seconds. Whoever goes
// down gets back up with full health and fights on, so both kill times are known: `downAt[i]` is when side
// i went down (null if not within the fight time limit), `atDown[i]` both sides' results at that moment
// (null if never), and `end` both sides' results when it stopped.
export function duelSim(kits, variants, delays) {
  const melee = variants.map((v) => v.pull === 'melee')
  // A melee attacker opens in the victim's face; a melee victim runs at a ranged one.
  const foes = [1, 0].map((j) => ({
    level: kits[j].level,
    ...bodyOf(kits[j], variants[j]),
    run: YARDS_PER_RUN,
    resist: kits[j].stats.resist,
    player: kits[j].stats.defenses,
    melee: melee[j],
    adjacent: melee[0],
    link: null,
  }))
  const fighters = [0, 1].map((i) => fighter(kits[i], foes[i], { ...variants[i], delay: delays[i] }))
  foes[0].link = fighters[1]
  foes[1].link = fighters[0]
  const downAt = [null, null]
  const atDown = [null, null]
  fighters.forEach((f) => f.act())
  while (downAt.includes(null)) {
    const next = fighters.map((f) => f.peek())
    const i = next[1] < next[0] ? 1 : 0
    if (next[i] >= MAX_FIGHT_SECONDS) break
    fighters[i].step()
    for (const j of [0, 1]) {
      if (downAt[j] !== null || fighters[j].hp > 0) continue
      downAt[j] = next[i]
      atDown[j] = fighters.map((f) => f.result())
      fighters[j].getUp()
    }
  }
  return { downAt, atDown, end: fighters.map((f) => f.result()) }
}

// The spell school of an ability named in the combat log (see brawl), as used by `kit`.
function schoolOf(kit, ability) {
  if (['Melee', 'Auto Shot', 'Pet Melee', 'Voidwalker Melee'].includes(ability)) return 0
  if (['Judgement', 'Divine Shield'].includes(ability)) return 1
  if (ability === 'Shoot') return kit.wand?.school ?? 0
  if (ability.startsWith('Imp ')) return kit.pet?.firebolt?.school ?? 2
  return kit.abilities[ability]?.school ?? 0
}

// Players fighting in two sides on one clock, like duelSim but for any number. `openers` are the first
// two, side 0 and side 1, fighting each other: { kit, variant, delay, luck, hearth } (see fighter). More
// join as they arrive (`add`). Each player attacks the enemy with the least health left and moves on
// when it dies or bubbles; healers heal whichever ally needs it most. Nobody gets back up: a player is
// out when it dies or hearths away. Melee players stand on their target and casters keep their range,
// so nobody kites or gets caught in a hunter's dead zone. The caller drives it with `run`. `log` is the
// combat log: { t, kind: 'hit' | 'heal' | 'immune' | 'cast', from, to, ability, school, amount, extra, hp }
// with `from` and `to` member indexes, `school` the ability's (0 physical to 6 arcane), `extra` what was
// absorbed or overhealed and `hp` the target's health after.
export function brawl(openers) {
  const members = [] // { index, kit, side, offset, target, first, handle, out: null | { at, how } }
  const log = []
  let now = 0
  const alive = (side) => members.filter((m) => m.side === side && !m.out)
  // How `from` sees `to`: a foe whose clock is shifted to from's (each fighter counts from its join).
  const views = new Map()
  function view(from, to) {
    const key = `${from.index}>${to.index}`
    if (!views.has(key)) {
      const { kit, variant } = to
      const link = {
        index: to.index,
        receive: (amount, struck, time, _from, ability) => to.handle.receive(amount, struck, time + from.offset - to.offset, view(to, from).link, ability),
        get hp() {
          return to.handle.hp
        },
      }
      views.set(key, { level: kit.level, ...bodyOf(kit, variant), run: YARDS_PER_RUN, resist: kit.stats.resist, player: kit.stats.defenses, melee: false, adjacent: false, link })
    }
    return views.get(key)
  }
  function pickTarget(m) {
    const enemies = alive(1 - m.side)
    const open = enemies.filter((e) => !e.handle.immune)
    return (open.length ? open : enemies).reduce((a, b) => (b.handle.hp < a.handle.hp ? b : a))
  }
  function join(spec, side, target) {
    const m = { index: members.length, kit: spec.kit, variant: spec.variant, side, offset: now, target, first: target, handle: null, out: null }
    members.push(m)
    return m
  }
  function start(m, { variant, delay = 0, luck = 1, hearth = 0 }) {
    const allies = () => members.filter((a) => a.side === m.side && !a.out && a.handle).map((a) => a.handle)
    const record = (e) => log.push({ ...e, t: e.t + m.offset, from: e.from.index, to: e.to.index, school: schoolOf(members[e.from.index].kit, e.ability) })
    m.handle = fighter(m.kit, view(m, m.target), { ...variant, delay, luck, hearth, allies, log: record })
    m.handle.index = m.index
  }

  const [a, b] = openers.map((spec, side) => join(spec, side, null))
  a.target = a.first = b
  b.target = b.first = a
  openers.forEach((spec, i) => start(members[i], spec))
  members.forEach((m) => m.handle.act())

  return {
    members,
    alive,
    log,
    get time() {
      return now
    },
    get over() {
      return !alive(0).length || !alive(1).length
    },
    // A player arriving now on `side`.
    add(spec, side) {
      const m = join(spec, side, null)
      m.target = m.first = pickTarget(m)
      start(m, spec)
      m.handle.act()
      return m
    },
    // Plays on until `until` seconds, or until someone dies or escapes (returns true).
    run(until) {
      for (;;) {
        let who = null
        let next = until
        for (const m of members) {
          if (m.out) continue
          const time = m.handle.peek() + m.offset
          if (time < next) {
            next = time
            who = m
          }
        }
        if (!who) {
          now = until
          return false
        }
        now = next
        who.handle.step()
        let changed = false
        for (const m of members) {
          if (m.out) continue
          const how = m.handle.hp <= 0 ? 'died' : m.handle.escaped ? 'escaped' : null
          if (how) {
            m.out = { at: now, how }
            changed = true
          }
        }
        for (const m of members) {
          if (m.out || !alive(1 - m.side).length || !(m.target.out || m.target.handle.immune)) continue
          const next = pickTarget(m)
          if (next === m.target) continue
          m.target = next
          m.handle.retarget(view(m, next), SWITCH_SECONDS, now - m.offset)
        }
        if (changed) return true
      }
    },
  }
}

// Player or pet attacking an NPC (CMaNGOS Unit::CalculateEffective*Chance). Chances are fractions; `mult`
// is the expected damage of one attack relative to a normal hit, with crits doing `critMult` times.
function attackTable({ skill, crit, hit = 0, level, cls }, mobLevel, { white = false, ranged = false, dualWield = false, onlyMiss = false, critMult = 2 } = {}) {
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
  return { land: (100 - avoided) / 100, dodge: dodge / 100, crit: critChance / 100, mult: (plain + critChance * critMult + glance * glanceMult) / 100 }
}

// Player or pet attacking a player (`victim` is its defenses): no glancing blows, and each point of skill
// against defense is worth 0.04% both ways. `hitSize` is the average hit, for what a shield block takes off.
function pvpAttackTable({ skill, crit, hit = 0, level }, victim, { white = false, ranged = false, dualWield = false, onlyMiss = false, hitSize, critMult = 2 } = {}) {
  const d = victim.defense - skill
  const miss = clamp(5 + (white && dualWield ? 19 : 0) + d * 0.04 - hit, d > 10 ? 1 : 0, 100)
  const dodge = onlyMiss ? 0 : clamp(victim.dodge + d * 0.04, 0, 100 - miss)
  const parry = onlyMiss || ranged || !victim.parry ? 0 : clamp(victim.parry + d * 0.04, 0, 100 - miss - dodge)
  const avoided = miss + dodge + parry
  const block = onlyMiss || !hitSize || !victim.block ? 0 : clamp(victim.block + d * 0.04, 0, 100 - avoided)
  const critChance = clamp(crit + (level * 5 - victim.defense) * 0.04, 0, 100 - avoided - block)
  const plain = 100 - avoided - block - critChance
  const blocked = block > 0 ? block * Math.max(0, 1 - victim.blockValue / hitSize) : 0
  return { land: (100 - avoided) / 100, dodge: dodge / 100, crit: critChance / 100, mult: (plain + critChance * critMult + blocked) / 100 }
}

// Squared coefficient of variation of one attack's damage: missed, hit or crit, times the damage roll.
function spreadOf(miss, crit, critMult, roll = 0) {
  const hit = 1 - miss - crit
  const mean = hit + crit * critMult
  return mean > 0 ? ((hit + crit * critMult * critMult) * (1 + roll)) / (mean * mean) - 1 : 0
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
  // Spells as the character's talents change them, one copy per spell.
  const { mods } = talentEffects(character)
  const modded = new Map()
  const spell = (id) => {
    if (!modded.has(id)) modded.set(id, moddedSpell(getSpell(id), mods))
    return modded.get(id)
  }
  const abilities = Object.fromEntries(Object.entries(knownAbilities(character)).map(([name, id]) => [name, spell(id)]))
  const buffs = {}
  const add = (key, value) => (buffs[key] = (buffs[key] ?? 0) + value)
  const itemArmor = equippedItems(character).reduce((sum, [, item]) => sum + (item.armor ?? 0), 0)
  const kit = { cls, level, spell, abilities, itemArmor, upkeep: [], regen: 0, chill: 0, thorns: null, innerFire: null, pet: null }
  for (const group of PREBUFFS[cls] ?? []) {
    const name = group.find((n) => abilities[n])
    if (!name) continue
    const buff = abilities[name]
    kit.upkeep.push(buff)
    for (const e of buff.effects) {
      const value = effectValue(buff, e, level)
      if (e.aura === 22 && e.misc & 1) {
        if (buff.charges) kit.innerFire = { armor: value, charges: buff.charges }
        else add('armor', value)
      } else if (e.aura === 29) STAT_KEYS.forEach((key, i) => (e.misc === -1 || (e.misc ?? 0) === i) && add(key, value))
      else if (e.aura === 99) add('attackPower', value)
      else if (e.aura === 124) add('rangedAttackPower', value)
      else if (e.aura === 15) kit.thorns = { value, school: buff.school }
      else if (e.aura === 161) kit.regen += value
      else if (e.aura === 42 && e.trigger) {
        const proc = spell(e.trigger)
        const haste = proc?.effects.find((x) => x.aura === 138)
        if (haste) kit.chill = -effectValue(proc, haste, level)
      }
    }
  }
  const stats = characterStats(character, buffs)
  kit.stats = stats
  kit.wand = stats.ranged?.isWand ? stats.ranged : null
  const known = new Set(character.spells)
  kit.heals = (HEALS[cls] ?? []).flatMap((name) => (CLASS_SPELLS[cls]?.[name] ?? []).filter(([id]) => known.has(id)).map(([id]) => spell(id)))
  if (abilities['Lightning Shield']) kit.lightningShield = { spell: abilities['Lightning Shield'], proc: spell(abilities['Lightning Shield'].proc) }
  kit.autoShot = getSpell(AUTO_SHOT) && spell(AUTO_SHOT)

  if (cls === 'Hunter' && level >= PET_LEVEL) {
    const [hp, , armor, str, agi] = PETS.Hunter.levels[level - 1]
    const ap = Math.max(0, 2 * str - 20)
    kit.pet = { tank: true, level, hp, armor: armor + 2 * agi, speed: PETS.Hunter.speed, hit: (0.9375 * level + (ap / 14) * PETS.Hunter.speed) * 1.25 }
  } else if (cls === 'Warlock' && level >= PET_LEVEL) {
    const [hp, , armor, , agi, , , , dmg] = PETS.Voidwalker.levels[level - 1]
    kit.pet = { tank: true, level, hp, armor: armor + 2 * agi, speed: PETS.Voidwalker.speed, hit: dmg * 1.25 }
  } else if (cls === 'Warlock') {
    const firebolt = spell(PETS.Imp.spell)
    kit.pet = { tank: false, level, firebolt, castTime: firebolt.cast / 1000 }
  }
  return kit
}

// Mana a prebuff costs per cast.
export function manaCost(kit, spell) {
  return spell.cost ?? (spell.costPct ? (kit.stats.baseMana * spell.costPct) / 100 : 0)
}

// The druid form a variant fights in, if any.
function formOf(kit, v) {
  if (v?.cat) return kit.abilities['Cat Form']
  if (v?.bear) return kit.abilities['Dire Bear Form'] ?? kit.abilities['Bear Form']
  return null
}

// What a form's passive adds: { attackPower, health, armorPct } (armorPct on armor from items).
function formBonus(kit, form) {
  const out = { attackPower: 0, health: 0, armorPct: 0 }
  const passive = form?.passive && kit.spell(form.passive)
  for (const e of passive?.effects ?? []) {
    const value = effectValue(passive, e, kit.level)
    if (e.aura === 99) out.attackPower += value
    else if (e.aura === 34) out.health += value
    else if (e.aura === 142 && e.misc & 1) out.armorPct += value
  }
  return out
}

// Health and armor `kit` fights with in variant `v`.
function bodyOf(kit, v) {
  const form = formBonus(kit, formOf(kit, v))
  return { hp: kit.stats.health + form.health, armor: kit.stats.defenses.armor + Math.round((kit.itemArmor * form.armorPct) / 100) }
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
    case 'Druid': return [
      { pull: 'ranged', filler: 'Wrath' },
      ...(A['Cat Form'] && A.Claw ? [{ pull: 'melee', cat: true }] : []),
      ...(A['Bear Form'] && A.Maul ? [{ pull: 'melee', bear: true }] : []),
    ]
    default: return [{ pull: 'melee' }]
  }
}

// One fight from pull to kill. `v` is a variant from variantsFor; `v.cycle` (seconds from one pull to the
// next) spreads cooldowns longer than a fight, like Bloodrage and Battle Shout, across fights.
// Returns { seconds, died, hpLost, manaLost, petLost, petDied, charges, dps, hits, spread }: `hits` is the
// effective number of equal damage events and `spread` the squared coefficient of variation of the main
// attack, for how much a kill time can swing (duels only).
export function simulate(kit, foe, v) {
  return fighter(kit, foe, v).run()
}

// The fight itself, as a handle that either runs it alone against an NPC (`run`) or steps it event by event
// against another player's fighter (`foe.link`). `v.delay` holds the character back that many seconds,
// like a player reacting to being jumped. In a brawl: `v.luck` scales the damage it deals, `v.allies()`
// lists the allies it can heal (itself included), `v.hearth` is its Divine Shield's seconds if it may
// bubble and hearth out, and `retarget` moves it on to another foe.
function fighter(kit, foe, v) {
  const { cls, level, stats, abilities: A } = kit
  const body = bodyOf(kit, v)
  const maxHp = body.hp
  const maxMana = stats.mana
  const { cat, bear } = v
  const form = formOf(kit, v)
  let t = 0
  let hp = maxHp
  let mana = maxMana
  let rage = 0
  let energy = stats.energy
  let cp = 0
  let mobHp = foe.hp
  let dealt = 0
  let lastSpend = -Infinity
  let gcdEnd = 0
  const cooldowns = new Map()
  let onMob = new Map() // debuff name -> { end }, on the current foe
  const debuffs = new Map() // foe link -> its onMob, in a brawl
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
  let received = 0 // damage taken from a player foe, fading over RECENT_SECONDS
  let receivedAt = 0
  let sumSq = 0
  const pvp = !!foe.player
  const start = v.delay ?? 0
  const luck = v.luck ?? 1
  let leaving = null // when the Hearthstone lands
  let immuneUntil = -1
  let escaped = false

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
  let target = pet?.tank && !pvp ? 'pet' : 'player' // players ignore pets
  let inMelee = false // the mob is beating on its target
  let gap = v.pull === 'melee' || foe.adjacent ? 0 : range - MELEE_RANGE
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
    if (running || inMelee || target !== 'player' || (pvp && !foe.melee)) return
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
  let mobArmor
  const resistFactor = (school) => {
    if (!school || school === 1) return 1
    const skill = Math.max(level * 5, 100)
    // Only NPCs get bonus resistance from their level.
    const pct = ((foe.resist[SCHOOL_NAMES[school]] ?? 0) / skill) * 75 + (pvp ? 0 : 0.4 * Math.max(foe.level * 5 - skill, 0))
    return 1 - Math.min(75, pct) / 100
  }
  // Spell miss chance by level difference: steeper against NPCs than players.
  const spellMiss = (diff) => (diff <= 2 ? 4 + diff : 6 + (diff - 2) * (pvp ? 7 : 11))
  // Per school, or per spell for one with talent crit or hit mods (`s`).
  const spellTables = new Map()
  function spellTable(school, s) {
    const key = s?.critBonus || s?.critDmgPct || s?.hitBonus ? s : school
    if (spellTables.has(key)) return spellTables.get(key)
    const diff = foe.level - level
    const miss = clamp(spellMiss(diff) - stats.spell.hit - (stats.spell.schoolHit[school] ?? 0) - (s?.hitBonus ?? 0), 1, 100)
    const land = 1 - miss / 100
    const crit = clamp((stats.spell.crit + (stats.spell.schoolCrit[school] ?? 0) + (s?.critBonus ?? 0)) / 100, 0, 1)
    const critExtra = 0.5 * (1 + (s?.critDmgPct ?? 0) / 100)
    const resist = resistFactor(school)
    const table = { land, crit, critExtra, mult: land * (1 + crit * critExtra) * resist, tick: land * resist }
    spellTables.set(key, table)
    return table
  }
  const spellPower = (school) => (school > 0 ? stats.spell.damage + (stats.spell.schoolDamage[SCHOOL_NAMES[school]] ?? 0) : 0)

  const melee = stats.melee
  // Cat and bear forms fight with paws (CMaNGOS Player::UpdateDamagePhysical): damage by level, swing
  // speed 1 for cats and 2.5 for bears; cats also get attack power from agility.
  const attackPower = form ? melee.attackPower + formBonus(kit, form).attackPower + (cat ? stats.stats.agi.total : 0) : melee.attackPower
  const paws = form && cat ? 1 : 2.5
  const mh = form
    ? { min: (0.85 * level + attackPower / 14) * paws, max: (1.25 * level + attackPower / 14) * paws, speed: paws, base: [0.85 * level * paws, 1.25 * level * paws], subclass: -1 }
    : melee.mainHand
  const oh = form ? null : melee.offHand
  const attacker = { skill: form ? level * 5 : melee.skill, crit: form ? melee.baseCrit + melee.formCrit : melee.crit, hit: melee.hit, level, cls }
  const hitTable = (who, opts) => (pvp ? pvpAttackTable(who, foe.player, opts) : attackTable(who, foe.level, opts))
  const ranged = stats.ranged && !stats.ranged.isWand ? stats.ranged : null
  const shooter = ranged && { skill: ranged.skill, crit: ranged.crit, hit: ranged.hit, level, cls }
  // Talent physical damage done: with the worn weapon, or paws in a form.
  const meleeMult = form ? melee.formDamageMult : melee.damageMult
  const physicalMult = (s) => (s.school === 0 ? (s.dmgClass === 3 ? (ranged?.damageMult ?? 1) : meleeMult) : 1)
  let whiteMh, whiteOh, yellow, overpower, rangedTable, autoTable, wandTable, petTable, sealProc
  const modTables = new Map() // per spell with talent crit or hit mods
  const defense = defenseTable(stats.defenses, level, foe.level)
  const normalized = form ? paws : mh.subclass === 15 ? 1.7 : melee.twoHand ? 3.3 : 2.4

  function gainRage(amount) {
    if (cls === 'Warrior' || bear) rage = Math.min(100, rage + amount)
  }
  // `ability` names it for the combat log. `struck` is the chance it was a landed melee hit, for a player
  // foe's shields, thorns and armors. `to` is the player it lands on, if not the current foe.
  function damageMob(ability, amount, struck = 0, to = foe.link) {
    if (amount <= 0) return
    amount *= luck
    if (to) {
      const left = to.receive(amount, struck, t, self, ability)
      if (to === foe.link) mobHp = left
    } else mobHp -= amount
    dealt += amount
    sumSq += amount * amount
    aggro()
  }
  // Returns the health gained.
  function gainHp(amount) {
    const before = hp
    hp = Math.min(maxHp, hp + amount)
    return hp - before
  }

  // Seal of Righteousness: holy damage on each melee hit (CMaNGOS spell 25742 script).
  let sealBase = 0
  if (A['Seal of Righteousness']) {
    const seal = A['Seal of Righteousness']
    const amount = effectValue(seal, seal.effects[0], level)
    const speed = mh.speed
    const weapon = (mh.base[0] + mh.base[1]) / 2
    const base = melee.twoHand
      ? 1.2 * amount * 1.2 * 1.03 * speed / 100 + 1 + 0.03 * weapon + 1
      : 0.85 * Math.ceil(amount * 1.2 * 1.03 * speed / 100) + 0.03 * weapon
    sealBase = base + (melee.twoHand ? 0.108 : 0.092) * speed * spellPower(1) * levelPenalty(seal)
  }
  function meleeLanded(land) {
    if (sealEnd > t) damageMob('Seal of Righteousness', sealProc * land)
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
        const table = tableOf(s)
        spend(s)
        const bonus = s.effects.reduce((sum, e) => sum + ([17, 58].includes(e.type) ? effectValue(s, e, level) : 0), 0)
        damageMob(s.name, (average(mh) + bonus) * table.mult * mobArmor * damageBonus(s) * meleeMult, table.land)
        trackDodges(table.dodge)
        meleeLanded(table.land)
        if (s.cooldown) cooldowns.set(cdKey(s), t + s.cooldown / 1000)
      } else {
        const dmg = average(mh) * whiteMh.mult * mobArmor * meleeMult
        damageMob('Melee', dmg, whiteMh.land)
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
    const dmg = average(oh) * whiteOh.mult * mobArmor * meleeMult
    damageMob('Melee', dmg, whiteOh.land)
    gainRage((dmg * 7.5) / conversion)
    trackDodges(whiteOh.dodge)
    meleeLanded(whiteOh.land)
    ohEv = at(t + swingTime(oh.speed), ohSwing)
  }
  // Hunters' Auto Shot, only while the mob isn't on top of them.
  function autoShot() {
    autoEv = null
    if (playerInMelee()) return
    damageMob('Auto Shot', (average(ranged) + (markBonus / 14) * ranged.speed) * autoTable.mult * mobArmor * ranged.damageMult)
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
    damageMob('Shoot', average(kit.wand) * wandTable.mult * (school ? resistFactor(school) : mobArmor) * kit.wand.damageMult)
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
    if (!mobEv && !pvp) mobEv = at(Math.max(t, stunUntil), mobSwing)
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
    const armor = body.armor + (ifCharges > 0 ? kit.innerFire.armor : 0)
    const raw = foe.swing * armorFactor(armor, foe.level)
    takeHit(Math.max(0, raw * defense.mult - defense.block * Math.min(raw, stats.defenses.blockValue)), defense.land, defense.land)
  }
  // A player foe's hit, already through this character's armor and avoidance, landing at time `now`;
  // `from` is who struck it, with `ability`. Returns the health left.
  function receive(amount, struck, now, from, ability) {
    t = now
    if (t < immuneUntil) {
      // Divine Shield
      if (hp > 0) v.log?.({ t, kind: 'immune', from, to: self, ability, amount: 0, extra: 0, hp })
      return hp
    }
    received = recently() + amount
    receivedAt = t
    takeHit(amount, 1, struck, from, ability)
    at(t, null) // a chance to react
    return hp
  }
  // `land` is the chance the hit landed, for pushback; `struck` the chance it was a landed melee hit.
  function takeHit(amount, land, struck, from, ability) {
    const soaked = Math.min(absorb, amount)
    absorb -= soaked
    const dmg = amount - soaked
    if (v.log && hp > 0) v.log({ t, kind: 'hit', from, to: self, ability, amount: Math.min(dmg, hp), extra: soaked, hp: Math.max(0, hp - dmg) })
    hp -= dmg
    gainRage((dmg * 2.5) / conversion)
    if (cast?.spell.pushback && land > 0) pushback(land)
    // Shields, thorns and armors answer melee hits only.
    if (lsCharges > 0) {
      const used = Math.min(lsCharges, struck)
      lsCharges -= used
      const proc = kit.lightningShield.proc
      const e = proc.effects[0]
      damageMob('Lightning Shield', (effectValue(proc, e, level) + (e.coef ?? 0) * spellPower(proc.school) * levelPenalty(proc)) * spellTable(proc.school, proc).mult * damageBonus(proc) * used, 0, from)
    }
    if (kit.thorns) damageMob('Thorns', kit.thorns.value * struck * resistFactor(kit.thorns.school), 0, from)
    if (ifCharges > 0) ifCharges = Math.max(0, ifCharges - struck)
    if (kit.chill && struck > 0) chilled = true
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
    damageMob(cls === 'Warlock' ? 'Voidwalker Melee' : 'Pet Melee', pet.hit * petTable.mult * armorFactor(foe.armor, pet.level), petTable.land)
    at(t + pet.speed, petSwing)
  }
  // Hit tables against the current foe.
  function retable() {
    mobArmor = armorFactor(foe.armor, level)
    whiteMh = hitTable(attacker, { white: true, dualWield: !!oh, hitSize: average(mh) })
    whiteOh = oh && whiteMh
    yellow = hitTable(attacker, { hitSize: average(mh) })
    overpower = hitTable(attacker, { onlyMiss: true })
    rangedTable = ranged && hitTable(shooter, { ranged: true, hitSize: average(ranged) })
    autoTable = ranged && (kit.autoShot?.critDmgPct ? hitTable(shooter, { ranged: true, hitSize: average(ranged), critMult: 2 + kit.autoShot.critDmgPct / 100 }) : rangedTable)
    wandTable = kit.wand && hitTable({ skill: kit.wand.skill, crit: kit.wand.crit, hit: kit.wand.hit, level, cls }, { ranged: true })
    modTables.clear()
    petTable = pet?.tank && hitTable({ skill: pet.level * 5, crit: 5, level: pet.level, cls: 'Pet' }, { white: true, hitSize: pet.hit })
    sealProc = sealBase * yellow.land * (1 + yellow.crit)
  }
  retable()
  // Brawls: on to `next` (a foe like the first), reaching it after `delay` seconds if fighting in melee.
  function retarget(next, delay, now) {
    t = now
    debuffs.set(foe.link, onMob)
    foe = next
    onMob = debuffs.get(foe.link) ?? new Map()
    spellTables.clear()
    retable()
    mobHp = foe.link.hp
    cp = 0
    queued = null
    if (v.pull === 'melee') {
      inMelee = false
      at(t + delay, () => foe === next && engage())
    }
    at(t, null)
  }
  function impCast() {
    if (mobHp <= 0) return
    const s = pet.firebolt
    const e = s.effects[0]
    const diff = foe.level - pet.level
    const land = 1 - clamp(spellMiss(diff), 1, 100) / 100
    damageMob(`Imp ${s.name}`, effectValue(s, e, pet.level) * land * 1.025 * resistFactor(s.school) * damageBonus(s))
    at(t + pet.castTime, impCast)
  }

  // ---- Casting ----
  function pushback(hit) {
    const land = hit * (1 - Math.min(100, cast.spell.pushbackAvoid ?? 0) / 100)
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
    else if (s.power === 'health') {
      hp -= c
      v.log?.({ t, kind: 'cast', from: self, to: self, ability: s.name, amount: c, extra: 0, hp })
    } else if (c > 0) {
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
      const missile = kit.spell(e.trigger)
      const me = missile.effects[0]
      damageMob(s.name, (effectValue(missile, me, level) + (me.coef ?? 0) * spellPower(missile.school) * levelPenalty(missile)) * tableOf(missile).mult * damageBonus(missile))
    } else if (e.aura === 53) {
      const amount = (effectValue(s, e, level) + (e.coef ?? 0) * spellPower(s.school) * levelPenalty(s)) * spellTable(s.school).tick * (1 + (s.dotPct ?? 0) / 100)
      damageMob(s.name, amount)
      healed(self, amount, s.name)
    }
  }

  function addDot(s, e, perTick, table) {
    const token = { end: t + s.duration / 1000 }
    const on = onMob
    const to = foe.link
    on.set(s.name, token)
    const ticks = Math.round(s.duration / e.period)
    for (let k = 1; k <= ticks; k++) {
      // Curse of Agony starts weak and ends strong (CMaNGOS Aura::PeriodicTick).
      const scale = s.name === 'Curse of Agony' ? (k <= 4 ? 0.5 : k > 8 ? 1.5 : 1) : 1
      at(t + (k * e.period) / 1000, () => {
        if (on.get(s.name) === token && (to ? to.hp : mobHp) > 0) damageMob(s.name, perTick * scale * table, 0, to)
      })
    }
  }

  const physicalTable = (s) => (s.name === 'Overpower' ? overpower : s.dmgClass === 3 ? rangedTable : yellow)
  // The hit table for a spell or ability, with its talent crit and hit mods.
  function tableOf(s) {
    const physical = s.dmgClass === 2 || s.dmgClass === 3
    if (!physical) return spellTable(s.school, s)
    if (!s.critBonus && !s.critDmgPct && !s.hitBonus) return physicalTable(s)
    if (!modTables.has(s)) {
      const shot = s.dmgClass === 3 && ranged
      const who = shot ? shooter : attacker
      const opts = { ranged: !!shot, onlyMiss: s.name === 'Overpower', hitSize: average(shot ? ranged : mh), critMult: 2 + (s.critDmgPct ?? 0) / 100 }
      modTables.set(s, hitTable({ ...who, crit: who.crit + (s.critBonus ?? 0), hit: who.hit + (s.hitBonus ?? 0) }, opts))
    }
    return modTables.get(s)
  }
  const isFinisher = (s) => s.comboDuration || s.effects.some((e) => e.perCombo)

  // Applies a spell's effects when it lands.
  function resolve(s) {
    const physical = s.dmgClass === 2 || s.dmgClass === 3
    const table = tableOf(s)
    const combo = isFinisher(s) ? cp : 0
    const bonus = (e) => (s.school > 0 ? (e.coef ?? 0) * spellPower(s.school) * levelPenalty(s) : 0) + (e.apCoef ?? 0) * attackPower
    // Armor or resists, and talent damage bonuses.
    const factor = (s.school === 0 ? mobArmor : resistFactor(s.school)) * damageBonus(s) * physicalMult(s)
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
          damageMob(s.name, amount * table.mult * factor, s.melee ? table.land : 0)
          break
        }
        case 3:
          if (s.name === 'Execute') {
            damageMob(s.name, (value + rage * 10 * (e.mult ?? 0)) * table.mult * factor, table.land)
            rage = 0
          } else if (s.name === 'Life Tap') mana = Math.min(maxMana, mana + value)
          break
        case 17: case 58: case 121: {
          const weapon = s.dmgClass === 3
            ? average(ranged) + (markBonus / 14) * ranged.speed
            : e.type === 121 ? (mh.base[0] + mh.base[1]) / 2 + (attackPower / 14) * normalized : average(mh)
          damageMob(s.name, (weapon + value) * table.mult * factor, s.melee ? table.land : 0)
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
      case 3: addDot(s, e, value * (1 + (s.dotPct ?? 0) / 100) * physicalMult(s), dotFactor); break
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
    const crit = clamp((stats.spell.crit + (stats.spell.schoolCrit[s.school] ?? 0) + (s.critBonus ?? 0)) / 100, 0, 1)
    return (effectValue(s, e, level) + power) * damageBonus(s) * (1 + crit * 0.5 * (1 + (s.critDmgPct ?? 0) / 100))
  }
  // Against a player, damage per second as the last few seconds felt.
  const recently = () => received * Math.exp(-(t - receivedAt) / RECENT_SECONDS)
  const incoming = () => (pvp ? recently() / RECENT_SECONDS : playerInMelee() ? (foe.swing * armorFactor(body.armor, foe.level) * defense.mult) / foe.speed : 0)
  const timeToKill = () => (dealt > 0 && t > 1 ? mobHp / (dealt / t) : MAX_FIGHT_SECONDS)
  // Heals only when the fight would otherwise end with the character (nearly) dead. Against a player
  // that heals back, the end is a guess; it looks only a few seconds ahead, healing when low.
  function tryHeal() {
    if (!kit.heals.length || cast || t < gcdEnd - EPS) return false
    if (v.allies) return healAlly()
    const need = incoming() * (Math.min(timeToKill(), pvp ? PVP_HEAL_HORIZON : 60) + 3) - hp + maxHp * 0.1
    if (need <= 0) return false
    const missing = maxHp - hp
    const options = kit.heals.filter((s) => canAfford(s))
    if (!options.length) return false
    const pick = options.find((s) => heal(s) >= Math.min(need, missing)) ?? options.at(-1)
    if (heal(pick) > missing * 1.25 && hp > maxHp * 0.3) return false
    return use(pick, () => healed(self, heal(pick), pick.name))
  }
  // In a brawl: heals the ally (or itself) furthest short of what the next few seconds will take.
  function healAlly() {
    let who = null
    let need = 0
    for (const ally of v.allies()) {
      const short = ally.incoming() * (PVP_HEAL_HORIZON + 3) - ally.hp + ally.maxHp * 0.1
      if (short > need) {
        who = ally
        need = short
      }
    }
    if (!who) return false
    const missing = who.maxHp - who.hp
    const options = kit.heals.filter((s) => canAfford(s))
    if (!options.length) return false
    const pick = options.find((s) => heal(s) >= Math.min(need, missing)) ?? options.at(-1)
    if (heal(pick) > missing * 1.25 && who.hp > who.maxHp * 0.3) return false
    return use(pick, () => healed(who, heal(pick), pick.name))
  }
  // Heals `who` (itself or an ally's handle), logging it.
  function healed(who, amount, ability) {
    const got = who === self ? gainHp(amount) : who.heal(amount)
    if (v.log && got !== null) v.log({ t, kind: 'heal', from: self, to: who, ability, amount: got, extra: amount - got, hp: who.hp })
  }
  // Divine Shield, then Hearthstone out before it wears off.
  function bubbleHearth() {
    v.log?.({ t, kind: 'cast', from: self, to: self, ability: 'Divine Shield', amount: 0, extra: 0, hp })
    immuneUntil = t + v.hearth
    leaving = t + HEARTH_SECONDS
    if (castEv) castEv.fn = null
    cast = { spell: HEARTHSTONE, end: leaving, total: HEARTH_SECONDS, hits: 0 }
    castEv = at(leaving, () => {
      escaped = true
    })
    return true
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
      const finishes = () => mobHp <= (effectValue(evis, evis.effects[0], level, cp) + attackPower * cp * 0.03) * tableOf(evis).mult * mobArmor * damageBonus(evis) * meleeMult
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
      if (leaving !== null) return false
      if (v.hearth && hp < maxHp * BUBBLE_AT) return bubbleHearth()
      if (tryHeal()) return true
      if (sealEnd <= t && tryUse('Seal of Righteousness')) return true
      const judgement = A.Judgement
      if (v.judge && sealEnd > t && playerInMelee() && usable(judgement)) {
        const seal = A['Seal of Righteousness']
        return use(judgement, () => {
          const jor = kit.spell(seal.judgement)
          const e = jor.effects[0]
          damageMob('Judgement', (effectValue(jor, e, level) + (e.coef ?? 0) * spellPower(1) * levelPenalty(jor)) * spellTable(1, jor).mult * damageBonus(jor))
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
      if (bear) {
        // Maul is the only rage sink; it goes on the next swing whenever there's rage for it.
        if (!queued && canAfford(A.Maul)) queued = A.Maul
        return false
      }
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
      const over = kit.spell(bloodrage.effects.find((e) => e.trigger).trigger)
      const tick = over.effects[0]
      for (let k = 1; k <= over.duration / tick.period; k++) at((k * tick.period) / 1000, () => gainRage((effectValue(over, tick, level) / 10) * share))
    }
  }
  if (form) {
    mana -= costOf(form)
    lastSpend = 0
  }
  if (A['Seal of Righteousness'] && cls === 'Paladin') {
    // Sealed just before the pull.
    mana -= costOf(A['Seal of Righteousness'])
    sealEnd = A['Seal of Righteousness'].duration / 1000
  }
  if (pet?.tank) {
    at(start + (range - MELEE_RANGE) / PET_RUN, () => {
      if (target === 'pet') engage()
      else if (!pvp) return
      petSwing()
    })
  } else if (pet) at(start, impCast)
  if (v.pull === 'melee' || foe.adjacent) {
    if (start > 0) at(start, engage)
    else engage()
  }
  if (start > 0) at(start, null)

  // Regen ticks (CMaNGOS: every 2 seconds) and rogue/cat energy.
  const usesEnergy = cls === 'Rogue' || cat
  function regenTick() {
    if (maxMana > 0) {
      const perSecond = stats.spell.mp5 / 5 + (stats.spell.regen / 5) * (t - lastSpend >= FIVE_SECOND_RULE ? 1 : stats.spell.castingRegen / 100)
      mana = Math.min(maxMana, mana + perSecond * REGEN_TICK)
    }
    gainHp((kit.regen + stats.hp5 / 5) * REGEN_TICK)
    if (usesEnergy) energy = Math.min(stats.energy, energy + 20)
    at(t + REGEN_TICK, regenTick)
  }
  at(REGEN_TICK, regenTick)

  // ---- Run ----
  function act() {
    if (t >= start - EPS) for (let i = 0; i < 6 && rotation(); i++);
  }
  function step() {
    const ev = nextEvent()
    t = ev.time
    if (ev.fn) ev.fn()
  }
  function result() {
    const died = hp <= 0 || mobHp > 0
    return {
      seconds: t,
      died,
      hpLost: clamp(maxHp - hp, 0, stats.health), // a form's extra health goes when it shifts back
      manaLost: clamp(maxMana - mana, 0, maxMana),
      petLost: pet?.tank ? clamp(1 - pet.hp / pet.maxHp, 0, 1) : 0,
      petDied: !!pet && !pet.alive,
      charges: { lightningShield: kit.lightningShield ? 3 - lsCharges : 0, innerFire: kit.innerFire ? kit.innerFire.charges - ifCharges : 0 },
      dps: died ? 0 : foe.hp / Math.max(t, 0.1),
      hits: sumSq > 0 ? (dealt * dealt) / sumSq : 0,
      spread: pvp ? mainSpread() : 0,
    }
  }
  const self = {
    run() {
      while (mobHp > 0 && hp > 0 && t < MAX_FIGHT_SECONDS) {
        act()
        if (mobHp <= 0 || hp <= 0) break
        step()
      }
      return result()
    },
    act,
    // One event against the linked player foe, whose health may have changed since.
    step() {
      mobHp = foe.link.hp
      step()
      act()
    },
    peek: () => events.reduce((min, ev) => Math.min(min, ev.time), Infinity),
    receive,
    result,
    get hp() {
      return hp
    },
    // Back up with full health after going down, to see how long the other side takes to fall.
    getUp() {
      hp += maxHp
    },
    retarget,
    maxHp,
    incoming,
    // Returns the health gained, or null if it's down.
    heal: (amount) => (hp > 0 ? gainHp(amount) : null),
    get escaped() {
      return escaped
    },
    get immune() {
      return leaving !== null
    },
  }
  return self

  // How much the main attack's damage swings from one use to the next.
  function mainSpread() {
    const roll = (w) => (w.max - w.min) ** 2 / 12 / average(w) ** 2
    const physical = (table, w) => spreadOf(1 - table.land, table.crit, 2, roll(w))
    if (v.filler === 'wand' && kit.wand) return physical(wandTable, kit.wand)
    if (v.filler && A[v.filler]) {
      const table = spellTable(A[v.filler].school)
      return spreadOf(1 - table.land, table.land * table.crit, 1.5)
    }
    if (v.pull === 'ranged' && ranged) return physical(rangedTable, ranged)
    return physical(whiteMh, mh)
  }
}
