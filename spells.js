// Class trainer spells: what each character knows, what the next ranks cost, and spell effect values.
// Characters buy the abilities they fight with from their own gold, in each class's priority order, then mounts.
import { CLASS_SPELLS, SPELLS, STARTING_SPELLS } from './gear-data.js'

export const getSpell = (id) => (Object.hasOwn(SPELLS, id) ? SPELLS[id] : undefined)

// Average value of a spell effect for a caster of `level` (CMaNGOS Unit::CalculateSpellEffectValue),
// with talent modifiers (pct, flat; see moddedSpell in talents.js).
export function effectValue(spell, effect, level, combo = 0) {
  let lvl = level
  if (spell.maxLevel && lvl > spell.maxLevel) lvl = spell.maxLevel
  else if (spell.baseLevel && lvl < spell.baseLevel) lvl = spell.baseLevel
  lvl -= spell.spellLevel ?? 0
  const dice = effect.dice ?? 0
  const top = (effect.sides ?? 0) + lvl * (effect.dicePerLevel ?? 0)
  const value = effect.base + lvl * (effect.perLevel ?? 0) + (top > dice ? (dice + top) / 2 : dice) + combo * (effect.perCombo ?? 0)
  return value * (1 + (effect.pct ?? 0) / 100) + (effect.flat ?? 0)
}

// Spells a new character of the class knows.
export const startingSpells = (cls) => [...(STARTING_SPELLS[cls] ?? [])]

// Every rotation spell id the class can know.
const classSpellIds = new Map()
export function isClassSpell(cls, id) {
  if (!classSpellIds.has(cls)) {
    classSpellIds.set(cls, new Set(Object.values(CLASS_SPELLS[cls] ?? {}).flatMap((ranks) => ranks.map(([spellId]) => spellId))))
  }
  return classSpellIds.get(cls).has(id)
}

// { abilityName: spell id of the highest known rank }
export function knownAbilities(character) {
  const known = new Set(character.spells)
  const out = {}
  for (const [name, ranks] of Object.entries(CLASS_SPELLS[character.characterClass] ?? {})) {
    const best = ranks.findLast(([id]) => known.has(id))
    if (best) out[name] = best[0]
  }
  return out
}

// The next rank of each ability the character could train at its level, in priority order:
// [{ name, id, rank, cost }]. Ranks are learned in order.
export function trainable(character) {
  const known = new Set(character.spells)
  const out = []
  for (const [name, ranks] of Object.entries(CLASS_SPELLS[character.characterClass] ?? {})) {
    const next = ranks.find(([id]) => !known.has(id))
    if (next && next[1] <= character.characterLevel) out.push({ name, id: next[0], rank: SPELLS[next[0]].rank ?? 1, cost: next[2] ?? 0 })
  }
  return out
}

// Buys ranks while the character can pay for them, saving up for the first one it can't afford. With every
// rank it can train known, it saves up for its next mount (RIDING). Returns the copper spent.
export function trainSpells(character) {
  let spent = 0
  for (;;) {
    const next = trainable(character)[0] ?? nextMount(character)
    if (!next || next.cost > character.copper) return spent
    character.copper -= next.cost
    if (next.speed) character.mount = next.key
    else character.spells.push(next.id)
    spent += next.cost
  }
}

// Mounts, in the order they're bought: riding and the mount together, Classic prices. Paladins and warlocks
// pay the same for theirs.
export const RIDING = [
  { key: 'riding', name: 'Riding', level: 40, cost: 100 * 10000, speed: 1.6 },
  { key: 'epic', name: 'Epic Riding', level: 60, cost: 1000 * 10000, speed: 2 },
]

// The mount the character can buy next at its level, or undefined.
export function nextMount(character) {
  const next = RIDING[RIDING.findIndex((r) => r.key === character.mount) + 1]
  return next && next.level <= character.characterLevel ? next : undefined
}

const TRAVEL_FORMS = { Shaman: ['Ghost Wolf', 20, 1.4], Hunter: ['Aspect of the Cheetah', 20, 1.3] } // name, level, speed

// How the character gets around faster than on foot: { name, speed } or null. The mount it bought (see RIDING);
// without one, a trained Travel Form, Ghost Wolf or Aspect of the Cheetah.
export function mountOf(character) {
  const mount = RIDING.find((r) => r.key === character.mount)
  if (mount) return { name: mount.name, speed: mount.speed }
  const travel = character.characterClass === 'Druid' && knownAbilities(character)['Travel Form']
  if (travel) {
    const passive = getSpell(getSpell(travel).passive)
    const e = passive.effects.find((x) => x.aura === 31)
    return { name: 'Travel Form', speed: 1 + effectValue(passive, e, character.characterLevel) / 100 }
  }
  const form = TRAVEL_FORMS[character.characterClass]
  return form && character.characterLevel >= form[1] ? { name: form[0], speed: form[2] } : null
}

// Ground speed against running on foot. Flights don't get faster.
export const groundSpeed = (character) => mountOf(character)?.speed ?? 1
