// Talents: one point per level from 10 to 60 (51 in all). A talent in row r needs 5r points in its tree's
// rows above it, and one with a prerequisite needs that talent maxed. Each spec has a default build that
// idle leveling spends points on; players can also spend them by hand. What the sim models: passive spell
// modifiers (CMaNGOS SPELL_AURA_ADD_FLAT/PCT_MODIFIER) on the spells it casts, and passive stat auras.
// Talents that add an ability, proc on hits or work through scripts aren't modeled.
import { SPELLS, TALENTS } from './gear-data.js'

export const FIRST_TALENT_LEVEL = 10
export const MAX_POINTS = 51
export const POINTS_PER_ROW = 5
export const talentPoints = (level) => Math.max(0, Math.min(MAX_POINTS, level - FIRST_TALENT_LEVEL + 1))

// Default builds: classic leveling specs. Each step raises a talent to the given rank; steps are in the
// order the points go in, and every prefix is a legal build.
const BUILDS = {
  Druid: {
    'Balance': 'improvedWrath 5, improvedMoonfire 5, improvedThorns 3, naturesReach 2, vengeance 5, naturesGrace 1, moonglow 3, improvedStarfire 1, moonfury 5, moonkinForm 1, improvedMarkOfTheWild 5, improvedHealingTouch 5, naturesFocus 5, reflection 3, insectSwarm 1, subtlety 1',
    'Feral Combat': 'ferocity 5, thickHide 5, sharpenedClaws 3, felineSwiftness 2, predatoryStrikes 3, bloodFrenzy 2, savageFury 2, faerieFireFeral 1, improvedShred 2, heartOfTheWild 5, leaderOfThePack 1, primalFury 1, naturesGrasp 1, improvedNaturesGrasp 4, naturalWeapons 5, omenOfClarity 1, naturalShapeshifter 3, furor 5',
    'Restoration': 'improvedMarkOfTheWild 5, improvedHealingTouch 5, reflection 3, insectSwarm 1, naturesFocus 1, tranquilSpirit 5, improvedRejuvenation 3, naturesSwiftness 1, giftOfNature 5, improvedRegrowth 5, swiftmend 1, improvedWrath 5, improvedMoonfire 5, naturalWeapons 5, omenOfClarity 1',
  },
  Hunter: {
    'Beast Mastery': 'improvedAspectOfTheHawk 5, thickHide 3, improvedEyesOfTheBeast 2, unleashedFury 5, ferocity 5, intimidation 1, bestialDiscipline 2, spiritBond 2, frenzy 5, bestialWrath 1, efficiency 5, lethalShots 5, aimedShot 1, improvedArcaneShot 4, mortalShots 5',
    'Marksmanship': 'efficiency 5, lethalShots 5, aimedShot 1, improvedArcaneShot 4, mortalShots 5, improvedSerpentSting 5, barrage 3, scatterShot 1, rangedWeaponSpecialization 5, trueshotAura 1, improvedAspectOfTheHawk 5, enduranceTraining 5, thickHide 3, unleashedFury 3',
    'Survival': 'deflection 5, savageStrikes 2, entrapment 3, survivalist 5, deterrence 1, surefooted 3, trapMastery 1, killerInstinct 3, counterattack 1, cleverTraps 1, lightningReflexes 5, wyvernSting 1, efficiency 5, lethalShots 5, aimedShot 1, improvedArcaneShot 4, mortalShots 5',
  },
  Mage: {
    'Arcane': 'arcaneSubtlety 2, arcaneFocus 3, arcaneConcentration 5, arcaneResilience 1, improvedArcaneExplosion 3, magicAttunement 1, arcaneMeditation 3, improvedCounterspell 2, presenceOfMind 1, arcaneMind 5, arcaneInstability 3, improvedManaShield 1, arcanePower 1, improvedFrostbolt 5, elementalPrecision 3, iceShards 5, piercingIce 3, frostChanneling 3, arcticReach 1',
    'Fire': 'improvedFireball 5, ignite 5, pyroblast 1, incinerate 2, burningSoul 2, improvedScorch 3, masterOfElements 2, criticalMass 3, blastWave 1, improvedFlamestrike 1, firePower 5, combustion 1, arcaneSubtlety 2, arcaneFocus 3, arcaneConcentration 5, improvedArcaneExplosion 3, arcaneResilience 1, magicAttunement 1, arcaneMeditation 3, improvedManaShield 2',
    'Frost': 'improvedFrostbolt 5, elementalPrecision 3, iceShards 5, piercingIce 2, frostChanneling 3, piercingIce 3, coldSnap 1, iceBlock 1, improvedConeOfCold 3, improvedBlizzard 1, wintersChill 5, iceBarrier 1, arcaneSubtlety 2, arcaneFocus 3, arcaneConcentration 5, improvedArcaneExplosion 3, arcaneResilience 1, magicAttunement 1, arcaneMeditation 3, magicAbsorption 2',
  },
  Paladin: {
    'Holy': 'divineIntellect 5, spiritualFocus 5, healingLight 3, consecration 1, unyieldingFaith 1, illumination 5, divineFavor 1, lastingJudgement 3, improvedLayOnHands 1, holyPower 5, holyShock 1, benediction 5, improvedJudgement 2, deflection 3, conviction 5, sealOfCommand 1, vindication 3, pursuitOfJustice 1',
    'Protection': 'redoubt 5, precision 3, toughness 2, shieldSpecialization 3, blessingOfKings 1, anticipation 5, toughness 5, improvedHammerOfJustice 3, blessingOfSanctuary 1, oneHandedWeaponSpecialization 4, holyShield 1, benediction 5, improvedJudgement 2, deflection 3, conviction 5, vindication 3, pursuitOfJustice 2',
    'Retribution': 'improvedBlessingOfMight 5, improvedJudgement 2, deflection 3, conviction 5, sealOfCommand 1, vindication 3, pursuitOfJustice 1, twoHandedWeaponSpecialization 3, sanctityAura 1, benediction 1, vengeance 5, repentance 1, divineStrength 5, improvedSealOfRighteousness 5, healingLight 3, consecration 1, improvedLayOnHands 1, illumination 5',
  },
  Priest: {
    'Discipline': 'wandSpecialization 5, improvedPowerWordFortitude 2, improvedPowerWordShield 3, meditation 3, innerFocus 1, martyrdom 1, mentalAgility 5, improvedInnerFire 3, mentalStrength 5, divineSpirit 1, forceOfWill 5, powerInfusion 1, healingFocus 2, holySpecialization 3, divineFury 5, inspiration 3, holyNova 1, improvedRenew 2',
    'Holy': 'improvedRenew 3, holySpecialization 2, divineFury 5, holyNova 1, inspiration 3, holySpecialization 3, searingLight 2, improvedHealing 3, spiritualGuidance 5, spiritualHealing 5, spiritOfRedemption 1, lightwell 1, wandSpecialization 5, improvedPowerWordFortitude 2, improvedPowerWordShield 3, meditation 3, innerFocus 1, silentResolve 1, mentalAgility 4',
    'Shadow': 'spiritTap 5, improvedShadowWordPain 2, shadowFocus 3, improvedMindBlast 5, mindFlay 1, shadowWeaving 4, vampiricEmbrace 1, shadowFocus 5, improvedVampiricEmbrace 2, darkness 5, shadowform 1, wandSpecialization 5, improvedPowerWordShield 3, improvedPowerWordFortitude 2, meditation 3, innerFocus 1, martyrdom 1, mentalAgility 5',
  },
  Rogue: {
    'Assassination': 'improvedEviscerate 3, remorselessAttacks 2, murder 2, ruthlessness 3, malice 5, relentlessStrikes 1, lethality 5, improvedSliceAndDice 3, coldBlood 1, sealFate 5, vigor 1, improvedSinisterStrike 2, lightningReflexes 3, precision 5, improvedBackstab 3, endurance 2, dualWieldSpecialization 5',
    'Combat': 'improvedSinisterStrike 2, improvedGouge 3, precision 5, endurance 2, deflection 3, dualWieldSpecialization 5, bladeFlurry 1, swordSpecialization 5, weaponExpertise 2, aggression 2, adrenalineRush 1, improvedEviscerate 3, remorselessAttacks 2, malice 5, murder 2, ruthlessness 3, relentlessStrikes 1, lethality 4',
    'Subtlety': 'opportunity 5, sleightOfHand 2, camouflage 3, initiative 3, ghostlyStrike 1, improvedAmbush 1, serratedBlades 3, setup 2, hemorrhage 1, preparation 1, heightenedSenses 2, dirtyDeeds 1, deadliness 5, premeditation 1, improvedSinisterStrike 2, lightningReflexes 3, precision 5, improvedBackstab 3, endurance 2, dualWieldSpecialization 5',
  },
  Shaman: {
    'Elemental': 'convection 5, concussion 5, callOfFlame 3, elementalFocus 1, callOfThunder 5, reverberation 1, eyeOfTheStorm 3, elementalDevastation 2, elementalFury 1, lightningMastery 5, elementalMastery 1, improvedHealingWave 5, tidalFocus 5, naturesGuidance 3, healingGrace 2, tidalMastery 4',
    'Enhancement': 'ancestralKnowledge 5, thunderingStrikes 5, twoHandedAxesAndMaces 1, anticipation 4, flurry 5, elementalWeapons 3, parry 1, improvedWeaponTotems 1, weaponMastery 5, stormstrike 1, convection 5, concussion 5, callOfFlame 3, elementalWarding 2, callOfThunder 5',
    'Restoration': 'improvedHealingWave 5, ancestralHealing 3, totemicFocus 2, naturesGuidance 3, healingFocus 2, tidalMastery 5, restorativeTotems 5, healingWay 3, naturesSwiftness 1, purification 5, manaTideTotem 1, convection 5, concussion 5, callOfFlame 3, elementalWarding 2, elementalFocus 1',
  },
  Warlock: {
    'Affliction': 'improvedCorruption 5, improvedLifeTap 2, improvedDrainLife 3, improvedCurseOfAgony 3, amplifyCurse 1, felConcentration 1, nightfall 2, grimReach 2, suppression 1, siphonLife 1, curseOfExhaustion 1, suppression 4, shadowMastery 5, darkPact 1, demonicEmbrace 5, improvedVoidwalker 3, felIntellect 2, felDomination 1, felStamina 4, masterSummoner 2, unholyPower 3',
    'Demonology': 'demonicEmbrace 5, improvedVoidwalker 3, improvedHealthFunnel 2, felDomination 1, felStamina 5, masterSummoner 2, unholyPower 5, demonicSacrifice 1, improvedHealthstone 1, masterDemonologist 5, soulLink 1, improvedCorruption 5, improvedLifeTap 2, improvedDrainLife 3, improvedCurseOfAgony 3, felConcentration 2, nightfall 2, grimReach 2, suppression 1',
    'Destruction': 'improvedShadowBolt 5, bane 5, devastation 5, shadowburn 1, intensity 2, destructiveReach 2, improvedImmolate 5, ruin 1, emberstorm 4, conflagrate 1, improvedCorruption 5, improvedLifeTap 2, improvedDrainLife 3, improvedCurseOfAgony 3, felConcentration 2, nightfall 2, grimReach 2, suppression 1',
  },
  Warrior: {
    'Arms': 'improvedHeroicStrike 3, improvedRend 2, tacticalMastery 5, improvedRend 3, angerManagement 1, deepWounds 3, twoHandedWeaponSpecialization 5, impale 2, sweepingStrikes 1, improvedOverpower 2, improvedCharge 2, deflection 3, mortalStrike 1, cruelty 5, unbridledWrath 5, improvedBattleShout 5, improvedExecute 2, enrage 3',
    'Fury': 'cruelty 5, unbridledWrath 5, improvedBattleShout 5, improvedExecute 2, dualWieldSpecialization 3, enrage 5, flurry 5, deathWish 1, bloodthirst 1, improvedHeroicStrike 3, improvedRend 2, tacticalMastery 5, improvedRend 3, angerManagement 1, deepWounds 3, twoHandedWeaponSpecialization 4',
    'Protection': 'shieldSpecialization 5, toughness 5, improvedBloodrage 2, lastStand 1, improvedRevenge 2, improvedSunderArmor 3, improvedTaunt 2, concussionBlow 1, improvedShieldWall 2, defiance 2, oneHandedWeaponSpecialization 5, shieldSlam 1, improvedHeroicStrike 3, improvedRend 2, tacticalMastery 5, improvedRend 3, angerManagement 1, deepWounds 3, improvedOverpower 2, impale 2, improvedCharge 1',
  },
}

// Talent lookups per class: key -> { tree (index), ...talent }.
const index = new Map()
function talentsOf(cls) {
  if (!index.has(cls)) {
    const map = new Map()
    for (const [tree, { talents }] of (TALENTS[cls] ?? []).entries()) for (const t of talents) map.set(t.key, { ...t, tree })
    index.set(cls, map)
  }
  return index.get(cls)
}
export const getTalent = (cls, key) => talentsOf(cls).get(key)

// The default build as one talent key per point, in order.
const orders = new Map()
export function defaultOrder(cls, spec) {
  const id = `${cls}|${spec}`
  if (!orders.has(id)) {
    const order = []
    const ranks = {}
    for (const step of (BUILDS[cls]?.[spec] ?? '').split(',').filter((s) => s.trim())) {
      const [key, rank] = step.trim().split(' ')
      while ((ranks[key] ?? 0) < Number(rank)) {
        ranks[key] = (ranks[key] ?? 0) + 1
        order.push(key)
      }
    }
    orders.set(id, order)
  }
  return orders.get(id)
}

// The full default build: { key: rank }.
export function defaultBuild(cls, spec) {
  const out = {}
  for (const key of defaultOrder(cls, spec)) out[key] = (out[key] ?? 0) + 1
  return out
}

export const pointsSpent = (talents) => Object.values(talents).reduce((sum, rank) => sum + rank, 0)

// True if every talent with points has its rows' points above it and its prerequisite maxed.
export function isValidBuild(cls, talents) {
  const byKey = talentsOf(cls)
  const rows = new Map() // tree -> points per row
  for (const [key, rank] of Object.entries(talents)) {
    const t = byKey.get(key)
    if (!t || !Number.isInteger(rank) || rank < 0 || rank > t.max) return false
    if (!rows.has(t.tree)) rows.set(t.tree, [])
    const perRow = rows.get(t.tree)
    perRow[t.row] = (perRow[t.row] ?? 0) + rank
  }
  for (const [key, rank] of Object.entries(talents)) {
    if (!rank) continue
    const t = byKey.get(key)
    const above = rows.get(t.tree).slice(0, t.row).reduce((sum, n) => sum + (n ?? 0), 0)
    if (above < t.row * POINTS_PER_ROW) return false
    if (t.prereq) {
      const pre = [...byKey.values()].find((p) => p.tree === t.tree && p.row === t.prereq[0] && p.col === t.prereq[1])
      if ((talents[pre.key] ?? 0) < pre.max) return false
    }
  }
  return true
}

// Whether the character can put a point into `key` now.
export function canLearn(character, key) {
  const t = getTalent(character.characterClass, key)
  if (!t || pointsSpent(character.talents) >= talentPoints(character.characterLevel)) return false
  const rank = character.talents[key] ?? 0
  return rank < t.max && isValidBuild(character.characterClass, { ...character.talents, [key]: rank + 1 })
}

// Whether the character can take a point back out of `key` without breaking the build.
export function canUnlearn(character, key) {
  const rank = character.talents[key] ?? 0
  if (!rank) return false
  const next = { ...character.talents, [key]: rank - 1 }
  if (!next[key]) delete next[key]
  return isValidBuild(character.characterClass, next)
}

// Raise or lower a talent by one rank. Return false if not allowed.
export function learnTalent(character, key) {
  if (!canLearn(character, key)) return false
  character.talents = { ...character.talents, [key]: (character.talents[key] ?? 0) + 1 }
  return true
}
export function unlearnTalent(character, key) {
  if (!canUnlearn(character, key)) return false
  const next = { ...character.talents, [key]: character.talents[key] - 1 }
  if (!next[key]) delete next[key]
  character.talents = next
  return true
}

// Spends up to `count` unspent points on the default build: each goes to the earliest default point not
// yet taken that's legal now. A point stays unspent if none is (the player went their own way).
export function autoSpend(character, count = Infinity) {
  const order = defaultOrder(character.characterClass, character.characterSpec)
  let spent = 0
  while (spent < count && pointsSpent(character.talents) < talentPoints(character.characterLevel)) {
    const seen = {}
    const key = order.find((k) => {
      seen[k] = (seen[k] ?? 0) + 1
      return (character.talents[k] ?? 0) < seen[k] && canLearn(character, k)
    })
    if (!key || !learnTalent(character, key)) break
    spent += 1
  }
  return spent
}

// Talents from untrusted saved data: unknown keys dropped and ranks clamped; null if the result isn't a
// legal build for the level.
export function sanitizeTalents(cls, level, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    const t = getTalent(cls, key)
    const rank = Math.floor(Number(value))
    if (t && rank > 0) out[key] = Math.min(rank, t.max)
  }
  return isValidBuild(cls, out) && pointsSpent(out) <= talentPoints(level) ? out : null
}

// For cache keys.
export const talentKey = (character) => Object.entries(character.talents ?? {}).map(([k, v]) => k + v).join()

// ---- Effects ----
// Spell modifier ops (CMaNGOS SpellModOp) the sim applies; flat or percent.
const MOD_OPS = {
  0: 'pct', // direct damage and healing
  1: 'both', // duration
  3: 'both', 8: 'both', 12: 'both', 23: 'both', // effect values: 1st, all, 2nd, 3rd
  7: 'flat', // crit chance
  9: 'pct', // chance to keep casting time when hit
  10: 'both', // cast time
  11: 'both', // cooldown
  14: 'both', // cost
  15: 'pct', // crit damage bonus
  16: 'flat', // hit chance
  22: 'pct', // damage over time
}
// Ops and auras that don't matter to a solo fight (threat, range, radius).
const IRRELEVANT_OPS = new Set([2, 5, 6])
const IRRELEVANT_AURAS = new Set([10])
// Stat auras characterStats applies (see stats.js).
const STAT_AURAS = new Set([30, 35, 47, 49, 51, 52, 54, 55, 57, 71, 79, 98, 122, 132, 133, 134, 137, 142, 150, 166, 174, 175, 182])
const WAND = 1 << 19

const familyMatch = (mask, family) => !!family && family[0] === mask[0] && ((family[1] & mask[1]) !== 0 || (family[2] & mask[2]) !== 0)
const isMod = (e) => e.aura === 107 || e.aura === 108

// Spells a mod could change: any the game knows of that family.
const familySpells = Object.values(SPELLS).filter((s) => s.family)
function modApplies(e) {
  const kind = MOD_OPS[e.misc ?? 0]
  if (!kind || (kind !== 'both' && kind !== (e.aura === 107 ? 'flat' : 'pct'))) return false
  return familySpells.some((s) => familyMatch(e.mask, s.family))
}
function statApplies(t, e) {
  if (!STAT_AURAS.has(e.aura)) return false
  if (e.aura === 79) return (e.misc & 1) !== 0 || (t.item?.[0] === 2 && (t.item[1] & WAND) !== 0)
  if (e.aura === 142 || e.aura === 182) return (e.misc & 1) !== 0
  return true
}
const relevant = (e) => !(isMod(e) && IRRELEVANT_OPS.has(e.misc ?? 0)) && !IRRELEVANT_AURAS.has(e.aura)
const modeled = (t, e) => !t.active && (isMod(e) ? modApplies(e) : e.type === 6 && statApplies(t, e))

// How much of a talent the sim models: 'full', 'partial' or 'none'.
export function talentSupport(cls, key) {
  const t = getTalent(cls, key)
  const effects = t.ranks[0].effects.filter(relevant)
  const done = effects.filter((e) => modeled(t, e)).length
  return done === 0 ? 'none' : done === effects.length ? 'full' : 'partial'
}

// What the character's talents do, for the sim and stats: { mods, auras }. mods: { op, pct, value, mask };
// auras: { aura, misc, value, item, forms } (item: [class, subclass mask], forms: shapeshift mask).
const effectCache = new WeakMap()
export function talentEffects(character) {
  const key = `${character.characterClass}|${talentKey(character)}`
  const cached = effectCache.get(character)
  if (cached?.key === key) return cached.value
  const value = { mods: [], auras: [] }
  for (const [k, rank] of Object.entries(character.talents ?? {})) {
    const t = getTalent(character.characterClass, k)
    if (!t || !rank) continue
    for (const e of t.ranks[rank - 1].effects) {
      if (!modeled(t, e)) continue
      if (isMod(e)) value.mods.push({ op: e.misc ?? 0, pct: e.aura === 108, value: e.value, mask: e.mask })
      else value.auras.push({ aura: e.aura, misc: e.misc ?? 0, value: e.value, item: t.item, forms: t.forms })
    }
  }
  effectCache.set(character, { key, value })
  return value
}

// `spell` with the talent mods that touch it applied (the same object if none do). Adds dmgPct, dotPct,
// critBonus, critDmgPct, hitBonus and pushbackAvoid to the spell, and pct/flat to its effects (see
// effectValue). Rage cost mods are in tenths of rage.
export function moddedSpell(spell, mods) {
  if (!spell) return spell
  const mine = mods.filter((m) => familyMatch(m.mask, spell.family))
  if (!mine.length) return spell
  const sum = (op, pct) => mine.reduce((total, m) => total + (m.op === op && m.pct === pct ? m.value : 0), 0)
  const apply = (value, op) => value * (1 + sum(op, true) / 100) + sum(op, false)
  const s = { ...spell, effects: spell.effects.map((e) => ({ ...e })) }
  if (s.cast) s.cast = Math.max(0, apply(s.cast, 10))
  if (s.cooldown) s.cooldown = Math.max(0, apply(s.cooldown, 11))
  if (s.duration > 0) s.duration = apply(s.duration, 1)
  if (s.comboDuration) s.comboDuration = s.comboDuration.map((d) => apply(d, 1))
  if (s.cost) s.cost = Math.max(0, s.cost * (1 + sum(14, true) / 100) + sum(14, false) / (s.power === 'rage' ? 10 : 1))
  if (s.costPct) s.costPct *= 1 + sum(14, true) / 100
  const fields = { dmgPct: sum(0, true), dotPct: sum(22, true), critBonus: sum(7, false), critDmgPct: sum(15, true), hitBonus: sum(16, false), pushbackAvoid: sum(9, true) }
  for (const [field, value] of Object.entries(fields)) if (value) s[field] = value
  s.effects.forEach((e, i) => {
    const op = [3, 12, 23][i]
    const pct = sum(op, true) + sum(8, true)
    const flat = sum(op, false) + sum(8, false)
    if (pct) e.pct = pct
    if (flat) e.flat = flat
  })
  return s
}
