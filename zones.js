import { MAX_LEVEL } from './data.js'

export const CONTINENTS = ['Eastern Kingdoms', 'Kalimdor']

// Mobs turn gray (no XP) this many levels above a zone's max level; XP scales down linearly until then.
const GRAY_LEVELS = 6

const gold = (g, s = 0) => g * 10000 + s * 100

const zone = (name, continent, faction, minLevel, maxLevel, xpPerHour, copperPerHour) =>
  Object.freeze({ name, continent, faction, minLevel, maxLevel, xpPerHour, copperPerHour })

// Every Classic zone with mobs to farm. Cities and battlegrounds are left out.
// Level ranges are from the games; hourly rates are this game's balance values, loosely based on typical
// leveling and farming speeds (e.g. Stranglethorn, Tanaris, Eastern Plaguelands and Winterspring as gold spots).
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

export function xpPerHour(character, zone) {
  if (character.characterLevel >= MAX_LEVEL) return 0
  const levelsOver = character.characterLevel - zone.maxLevel
  if (levelsOver <= 0) return zone.xpPerHour
  return zone.xpPerHour * Math.max(0, 1 - levelsOver / GRAY_LEVELS)
}

// Classic "con" color of a zone for a character, judged against the zone's typical (middle) mob level.
// Gray matches where XP runs out in xpPerHour.
export function zoneDifficulty(character, zone) {
  const level = character.characterLevel
  if (level - zone.maxLevel >= GRAY_LEVELS) return 'gray'
  const diff = Math.floor((zone.minLevel + zone.maxLevel) / 2) - level
  if (diff >= 5) return 'red'
  if (diff >= 3) return 'orange'
  if (diff >= -2) return 'yellow'
  return 'green'
}
