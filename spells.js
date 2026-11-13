// Class trainer spells: what each character knows, what the next ranks cost, and spell effect values.
// Characters buy the abilities they fight with from their own gold, in each class's priority order.
import { CLASS_SPELLS, SPELLS, STARTING_SPELLS } from './gear-data.js'

export const getSpell = (id) => (Object.hasOwn(SPELLS, id) ? SPELLS[id] : undefined)

// Average value of a spell effect for a caster of `level` (CMaNGOS Unit::CalculateSpellEffectValue).
export function effectValue(spell, effect, level, combo = 0) {
  let lvl = level
  if (spell.maxLevel && lvl > spell.maxLevel) lvl = spell.maxLevel
  else if (spell.baseLevel && lvl < spell.baseLevel) lvl = spell.baseLevel
  lvl -= spell.spellLevel ?? 0
  const dice = effect.dice ?? 0
  const top = (effect.sides ?? 0) + lvl * (effect.dicePerLevel ?? 0)
  return effect.base + lvl * (effect.perLevel ?? 0) + (top > dice ? (dice + top) / 2 : dice) + combo * (effect.perCombo ?? 0)
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

// Buys ranks while the character can pay for them, saving up for the first one it can't afford.
// Returns the copper spent.
export function trainSpells(character) {
  let spent = 0
  for (;;) {
    const next = trainable(character)[0]
    if (!next || next.cost > character.copper) return spent
    character.copper -= next.cost
    character.spells.push(next.id)
    spent += next.cost
  }
}
