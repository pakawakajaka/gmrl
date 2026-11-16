import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { CLASS_SPELLS, ITEMS } = await import(root + 'gear-data.js')
const { variantsFor, buildKit } = await import(root + 'sim.js')
const { combatOf } = await import(root + 'combat.js')
const { mountOf } = await import(root + 'pvp.js')
const { knownAbilities, trainable } = await import(root + 'spells.js')

let fails = 0
const check = (name, ok, extra = '') => {
  console.log(ok ? 'PASS' : 'FAIL', name, extra)
  if (!ok) fails++
}
const druid = (L, cls = 'Druid', race = 'Tauren') => {
  const c = new Character({ characterName: 'F', characterClass: cls, characterRace: race, characterLevel: L })
  c.spells = Object.values(CLASS_SPELLS[cls]).flatMap((r) => r.filter(([, lvl]) => lvl <= L).map(([id]) => id))
  return c
}
const kinds = (c) => variantsFor(combatOf(c).kit).map((v) => (v.cat ? 'cat' : v.bear ? 'bear' : 'caster')).join(',')

check('L9 caster only', kinds(druid(9)) === 'caster', kinds(druid(9)))
check('L10 bear', kinds(druid(10)) === 'caster,bear', kinds(druid(10)))
check('L20 cat and bear', kinds(druid(20)) === 'caster,cat,bear', kinds(druid(20)))
const k40 = knownAbilities(druid(40))
check('L40 Dire Bear known', !!k40['Dire Bear Form'] && !!k40['Bear Form'])
check('L16 Aquatic known', !!knownAbilities(druid(16))['Aquatic Form'] && !knownAbilities(druid(15))['Aquatic Form'])
const fresh = new Character({ characterName: 'G', characterClass: 'Druid', characterRace: 'Tauren', characterLevel: 30 })
check('Travel Form trainable at 30', trainable(fresh).some((s) => s.name === 'Travel Form'), trainable(fresh).map((s) => s.name).join(','))
check('mount L29 druid none', mountOf(druid(29)) === null)
check('mount L30 druid Travel Form', JSON.stringify(mountOf(druid(30))) === '{"name":"Travel Form","speed":1.4}', JSON.stringify(mountOf(druid(30))))
const untrained = druid(35)
untrained.spells = untrained.spells.filter((id) => id !== 783)
check('mount L35 druid untrained none', mountOf(untrained) === null)
check('mount L40 Riding', mountOf(druid(40))?.name === 'Riding')
check('mount L20 shaman Ghost Wolf', mountOf(druid(20, 'Shaman', 'Orc'))?.name === 'Ghost Wolf')
check('mount L19 warrior none', mountOf(druid(19, 'Warrior', 'Orc')) === null)
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
