export const CONTINENTS = ['Eastern Kingdoms', 'Kalimdor']

const zone = (name, continent, faction, minLevel, maxLevel) => Object.freeze({ name, continent, faction, minLevel, maxLevel })

// Every Classic zone with mobs to farm. Cities and battlegrounds are left out. Level ranges are from the
// game; the mobs, quests and loot in each come from gear-data.js.
export const ZONES = [
  zone('Elwynn Forest', 'Eastern Kingdoms', 'Alliance', 1, 10),
  zone('Dun Morogh', 'Eastern Kingdoms', 'Alliance', 1, 10),
  zone('Tirisfal Glades', 'Eastern Kingdoms', 'Horde', 1, 10),
  zone('Westfall', 'Eastern Kingdoms', 'Alliance', 10, 20),
  zone('Loch Modan', 'Eastern Kingdoms', 'Alliance', 10, 20),
  zone('Silverpine Forest', 'Eastern Kingdoms', 'Horde', 10, 20),
  zone('Redridge Mountains', 'Eastern Kingdoms', 'Contested', 15, 25),
  zone('Duskwood', 'Eastern Kingdoms', 'Contested', 18, 30),
  zone('Wetlands', 'Eastern Kingdoms', 'Contested', 20, 30),
  zone('Hillsbrad Foothills', 'Eastern Kingdoms', 'Contested', 20, 30),
  zone('Alterac Mountains', 'Eastern Kingdoms', 'Contested', 30, 40),
  zone('Arathi Highlands', 'Eastern Kingdoms', 'Contested', 30, 40),
  zone('Stranglethorn Vale', 'Eastern Kingdoms', 'Contested', 30, 45),
  zone('Badlands', 'Eastern Kingdoms', 'Contested', 35, 45),
  zone('Swamp of Sorrows', 'Eastern Kingdoms', 'Contested', 35, 45),
  zone('The Hinterlands', 'Eastern Kingdoms', 'Contested', 40, 50),
  zone('Searing Gorge', 'Eastern Kingdoms', 'Contested', 43, 50),
  zone('Blasted Lands', 'Eastern Kingdoms', 'Contested', 45, 55),
  zone('Burning Steppes', 'Eastern Kingdoms', 'Contested', 50, 58),
  zone('Western Plaguelands', 'Eastern Kingdoms', 'Contested', 51, 58),
  zone('Eastern Plaguelands', 'Eastern Kingdoms', 'Contested', 53, 60),
  zone('Deadwind Pass', 'Eastern Kingdoms', 'Contested', 55, 60),

  zone('Durotar', 'Kalimdor', 'Horde', 1, 10),
  zone('Mulgore', 'Kalimdor', 'Horde', 1, 10),
  zone('Teldrassil', 'Kalimdor', 'Alliance', 1, 10),
  zone('Darkshore', 'Kalimdor', 'Alliance', 10, 20),
  zone('The Barrens', 'Kalimdor', 'Horde', 10, 25),
  zone('Stonetalon Mountains', 'Kalimdor', 'Contested', 15, 27),
  zone('Ashenvale', 'Kalimdor', 'Contested', 18, 30),
  zone('Thousand Needles', 'Kalimdor', 'Contested', 25, 35),
  zone('Desolace', 'Kalimdor', 'Contested', 30, 40),
  zone('Dustwallow Marsh', 'Kalimdor', 'Contested', 35, 45),
  zone('Feralas', 'Kalimdor', 'Contested', 40, 50),
  zone('Tanaris', 'Kalimdor', 'Contested', 40, 50),
  zone('Azshara', 'Kalimdor', 'Contested', 45, 55),
  zone('Felwood', 'Kalimdor', 'Contested', 48, 55),
  zone("Un'Goro Crater", 'Kalimdor', 'Contested', 48, 55),
  zone('Moonglade', 'Kalimdor', 'Sanctuary', 55, 60),
  zone('Silithus', 'Kalimdor', 'Contested', 55, 60),
  zone('Winterspring', 'Kalimdor', 'Contested', 55, 60),
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
// Classic "zero difference": how many levels below you a mob's XP fades out over.
export const zeroDifference = (level) => ZERO_DIFFERENCE.find(([below]) => level < below)?.[1] ?? 17

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
