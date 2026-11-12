import { MAX_LEVEL } from './data.js'
import { KILLS_PER_HOUR } from './gear.js'
import { characterPower, levelPower } from './power.js'

export const CONTINENTS = ['Eastern Kingdoms', 'Kalimdor']

// A kill takes FIGHT_SECONDS against a mob of equal power, plus OVERHEAD_SECONDS of looting, walking and
// resting that no amount of power removes. Together they make the base KILLS_PER_HOUR.
const FIGHT_SECONDS = 40
const OVERHEAD_SECONDS = 3600 / KILLS_PER_HOUR - FIGHT_SECONDS

const gold = (g, s = 0) => g * 10000 + s * 100

const zone = (name, continent, faction, minLevel, maxLevel, xpPerHour, copperPerHour) =>
  Object.freeze({ name, continent, faction, minLevel, maxLevel, xpPerHour, copperPerHour })

// Every Classic zone with mobs to farm. Cities and battlegrounds are left out.
// Level ranges are from the games; hourly rates are this game's balance values for a character with typical
// gear for its level, loosely based on typical leveling and farming speeds (e.g. Stranglethorn, Tanaris,
// Eastern Plaguelands and Winterspring as gold spots). Actual rates depend on the character's solo power.
export const ZONES = [
  zone('Elwynn Forest', 'Eastern Kingdoms', 'Alliance', 1, 10, 9000, gold(0, 6)),
  zone('Dun Morogh', 'Eastern Kingdoms', 'Alliance', 1, 10, 8500, gold(0, 5)),
  zone('Tirisfal Glades', 'Eastern Kingdoms', 'Horde', 1, 10, 8800, gold(0, 5)),
  zone('Westfall', 'Eastern Kingdoms', 'Alliance', 10, 20, 17000, gold(0, 28)),
  zone('Loch Modan', 'Eastern Kingdoms', 'Alliance', 10, 20, 16000, gold(0, 24)),
  zone('Silverpine Forest', 'Eastern Kingdoms', 'Horde', 10, 20, 16500, gold(0, 22)),
  zone('Redridge Mountains', 'Eastern Kingdoms', 'Contested', 15, 25, 23000, gold(0, 40)),
  zone('Duskwood', 'Eastern Kingdoms', 'Contested', 18, 30, 28000, gold(0, 55)),
  zone('Wetlands', 'Eastern Kingdoms', 'Contested', 20, 30, 29000, gold(0, 60)),
  zone('Hillsbrad Foothills', 'Eastern Kingdoms', 'Contested', 20, 30, 30000, gold(0, 65)),
  zone('Alterac Mountains', 'Eastern Kingdoms', 'Contested', 30, 40, 39000, gold(1, 20)),
  zone('Arathi Highlands', 'Eastern Kingdoms', 'Contested', 30, 40, 41000, gold(1, 35)),
  zone('Stranglethorn Vale', 'Eastern Kingdoms', 'Contested', 30, 45, 48000, gold(2, 10)),
  zone('Badlands', 'Eastern Kingdoms', 'Contested', 35, 45, 45000, gold(1, 80)),
  zone('Swamp of Sorrows', 'Eastern Kingdoms', 'Contested', 35, 45, 44000, gold(1, 70)),
  zone('The Hinterlands', 'Eastern Kingdoms', 'Contested', 40, 50, 55000, gold(2, 60)),
  zone('Searing Gorge', 'Eastern Kingdoms', 'Contested', 43, 50, 56000, gold(3)),
  zone('Blasted Lands', 'Eastern Kingdoms', 'Contested', 45, 55, 62000, gold(3, 40)),
  zone('Burning Steppes', 'Eastern Kingdoms', 'Contested', 50, 58, 72000, gold(4, 80)),
  zone('Western Plaguelands', 'Eastern Kingdoms', 'Contested', 51, 58, 74000, gold(5)),
  zone('Eastern Plaguelands', 'Eastern Kingdoms', 'Contested', 53, 60, 80000, gold(6, 50)),
  zone('Deadwind Pass', 'Eastern Kingdoms', 'Contested', 55, 60, 70000, gold(5, 50)),

  zone('Durotar', 'Kalimdor', 'Horde', 1, 10, 9200, gold(0, 6)),
  zone('Mulgore', 'Kalimdor', 'Horde', 1, 10, 8700, gold(0, 5)),
  zone('Teldrassil', 'Kalimdor', 'Alliance', 1, 10, 8600, gold(0, 5)),
  zone('Darkshore', 'Kalimdor', 'Alliance', 10, 20, 16000, gold(0, 22)),
  zone('The Barrens', 'Kalimdor', 'Horde', 10, 25, 21000, gold(0, 38)),
  zone('Stonetalon Mountains', 'Kalimdor', 'Contested', 15, 27, 24000, gold(0, 45)),
  zone('Ashenvale', 'Kalimdor', 'Contested', 18, 30, 29000, gold(0, 58)),
  zone('Thousand Needles', 'Kalimdor', 'Contested', 25, 35, 35000, gold(0, 95)),
  zone('Desolace', 'Kalimdor', 'Contested', 30, 40, 40000, gold(1, 40)),
  zone('Dustwallow Marsh', 'Kalimdor', 'Contested', 35, 45, 47000, gold(1, 90)),
  zone('Feralas', 'Kalimdor', 'Contested', 40, 50, 58000, gold(2, 80)),
  zone('Tanaris', 'Kalimdor', 'Contested', 40, 50, 60000, gold(3, 10)),
  zone('Azshara', 'Kalimdor', 'Contested', 45, 55, 61000, gold(3, 60)),
  zone('Felwood', 'Kalimdor', 'Contested', 48, 55, 66000, gold(3, 80)),
  zone("Un'Goro Crater", 'Kalimdor', 'Contested', 48, 55, 68000, gold(4)),
  zone('Moonglade', 'Kalimdor', 'Sanctuary', 55, 60, 15000, gold(1)),
  zone('Silithus', 'Kalimdor', 'Contested', 55, 60, 77000, gold(6)),
  zone('Winterspring', 'Kalimdor', 'Contested', 55, 60, 82000, gold(7)),
]

export const getZone = (name) => ZONES.find((z) => z.name === name)

// Why `character` can't farm `zone`, or '' if it can.
export function zoneLockReason(character, zone) {
  if (!zone) return 'Unknown zone'
  if ((zone.faction === 'Alliance' || zone.faction === 'Horde') && zone.faction !== character.faction) {
    return `${zone.faction} only`
  }
  if (character.characterLevel < zone.minLevel) return `Requires level ${zone.minLevel}`
  return ''
}

// Classic gray level: mobs at or below it give no XP (CMaNGOS Formulas.h).
export function grayLevel(level) {
  if (level <= 5) return 0
  if (level <= 39) return level - 5 - Math.floor(level / 10)
  if (level <= 59) return level - 1 - Math.floor(level / 5)
  return level - 9
}

const ZERO_DIFFERENCE = [[8, 5], [10, 6], [12, 7], [16, 8], [20, 9], [30, 11], [40, 12], [45, 13], [50, 14], [55, 15], [60, 16]]
const zeroDifference = (level) => ZERO_DIFFERENCE.find(([below]) => level < below)?.[1] ?? 17

// Share of full XP a mob gives (Classic): +5% per level above you (up to +4), falling to nothing at gray.
export function mobXpFactor(level, mobLevel) {
  if (mobLevel <= grayLevel(level)) return 0
  if (mobLevel >= level) return 1 + 0.05 * Math.min(4, mobLevel - level)
  return 1 - (level - mobLevel) / zeroDifference(level)
}

// Characters fight the mobs nearest their own level that the zone has.
export const mobLevel = (character, zone) => Math.min(Math.max(character.characterLevel, zone.minLevel), zone.maxLevel)

// What the character earns per hour in the zone. Solo power against the mobs' power sets the kill speed,
// which scales XP and gold alike. XP also falls off as the mobs get lower than the character and stops
// once they're gray; gold doesn't, so outleveled zones still pay (faster, even).
export function farmRates(character, zone) {
  const power = characterPower(character)
  const mob = mobLevel(character, zone)
  const powerRatio = power.solo / levelPower(mob)
  const speed = (FIGHT_SECONDS + OVERHEAD_SECONDS) / (FIGHT_SECONDS / powerRatio + OVERHEAD_SECONDS)
  const xpFactor = character.characterLevel >= MAX_LEVEL ? 0 : mobXpFactor(character.characterLevel, mob)
  return {
    power,
    mobLevel: mob,
    powerRatio,
    speed,
    xpFactor,
    killsPerHour: KILLS_PER_HOUR * speed,
    xpPerHour: zone.xpPerHour * speed * xpFactor,
    copperPerHour: zone.copperPerHour * speed,
  }
}

// Classic "con" color of a zone for a character, judged against the zone's typical (middle) mob level.
// Gray is when even the zone's highest mobs are gray to the character, which is where XP stops.
export function zoneDifficulty(character, zone) {
  const level = character.characterLevel
  if (zone.maxLevel <= grayLevel(level)) return 'gray'
  const diff = Math.floor((zone.minLevel + zone.maxLevel) / 2) - level
  if (diff >= 5) return 'red'
  if (diff >= 3) return 'orange'
  if (diff >= -2) return 'yellow'
  return 'green'
}
