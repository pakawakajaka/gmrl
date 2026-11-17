import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { CLASS_SPELLS, ITEMS } = await import(root + 'gear-data.js')
const { variantsFor, buildKit } = await import(root + 'sim.js')
const { combatOf } = await import(root + 'combat.js')
const { knownAbilities, mountOf, trainable } = await import(root + 'spells.js')

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
{
  // Mounts are bought with gold once every trainable rank is known: riding at 40, epic at 60.
  const { trainSpells } = await import(root + 'spells.js')
  const { default: Account } = await import(root + 'account.js')
  const rider = druid(40, 'Warrior', 'Orc')
  rider.mount = null
  rider.copper = 99 * 10000
  check('mount: none without 100g', trainSpells(rider) === 0 && rider.mount === null && mountOf(rider) === null)
  rider.copper = 150 * 10000
  check('mount: riding for 100g', trainSpells(rider) === 100 * 10000 && rider.mount === 'riding' && rider.copper === 50 * 10000)
  rider.characterLevel = 60
  rider.copper = 1000 * 10000
  rider.spells = []
  trainSpells(rider)
  check('mount: spells before the epic mount', rider.mount === 'riding' && rider.spells.length > 0, `${rider.copper}`)
  rider.copper += 1000 * 10000
  trainSpells(rider)
  check('mount: epic for 1000g', rider.mount === 'epic' && JSON.stringify(mountOf(rider)) === '{"name":"Epic Riding","speed":2}' && trainable(rider).length === 0)
  const orc = (name, level) => new Character({ characterName: name, characterClass: 'Warrior', characterSpec: 'Arms', characterRace: 'Orc', characterRole: 'DPS', characterLevel: level })
  const chars = [orc('Abcx', 60), orc('Abcy', 39), orc('Abcz', 45)]
  const saved = JSON.parse(JSON.stringify({ saveVersion: 4, accountName: 'M', guilds: [{ guildName: 'Mounts', faction: 'Horde', characters: chars }] }))
  saved.guilds[0].characters[0].mount = 'epic'
  saved.guilds[0].characters[1].mount = 'epic'
  delete saved.guilds[0].characters[2].mount
  const [epic, low, old] = Account.fromJSON(saved).characters
  check('mount: saved epic kept, too-low dropped, old saves ride from 40', epic.mount === 'epic' && low.mount === null && old.mount === 'riding')
}
{
  // Mounts and travel forms speed up the ground legs of travel, not flights.
  const { travelSeconds } = await import(root + 'leveling.js')
  const { questSeconds } = await import(root + 'quests.js')
  const { getZone } = await import(root + 'zones.js')
  const [barrens, stv, tanaris] = ['The Barrens', 'Stranglethorn Vale', 'Tanaris'].map(getZone)
  const walker = druid(40, 'Warrior', 'Orc')
  walker.mount = null
  const rider = druid(40, 'Warrior', 'Orc')
  const epic = druid(60, 'Warrior', 'Orc')
  epic.mount = 'epic'
  check('travel: on foot', travelSeconds(walker, barrens, tanaris) === 900 && travelSeconds(walker, barrens, stv) === 1800 && questSeconds(walker) === 300)
  check('travel: riding shortens the ground leg', travelSeconds(rider, barrens, tanaris) === 300 / 1.6 + 600 && travelSeconds(rider, barrens, stv) === 300 / 1.6 + 1500 && questSeconds(rider) === 60 + 240 / 1.6)
  check('travel: epic', travelSeconds(epic, barrens, tanaris) === 750 && questSeconds(epic) === 180)
  check('travel: Ghost Wolf', questSeconds(druid(20, 'Shaman', 'Orc')) === 60 + 240 / 1.4)
  check('travel: none within a zone', travelSeconds(rider, barrens, barrens) === 0)
}
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
