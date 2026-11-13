// Default leveling paths: where each race goes as it levels. Farming characters move to the next zone on the
// path when they reach its level, or when the quests in their zone run out. Sending a character somewhere
// else by hand lasts until one of those happens.
import { MAX_LEVEL } from './data.js'
import { activeQuests } from './quests.js'
import { getZone, zoneLockReason } from './zones.js'

// [level, zone] steps in level order. Orc/Troll and Dwarf/Gnome share a start but split up after.
export const ROUTES = {
  'Human': [[1, 'Elwynn Forest'], [10, 'Westfall'], [16, 'Redridge Mountains'], [21, 'Duskwood'], [30, 'Stranglethorn Vale'], [36, 'Dustwallow Marsh'], [41, 'Feralas'], [45, 'Tanaris'], [49, "Un'Goro Crater"], [52, 'Western Plaguelands'], [56, 'Eastern Plaguelands']],
  'Dwarf': [[1, 'Dun Morogh'], [10, 'Loch Modan'], [20, 'Wetlands'], [25, 'Duskwood'], [30, 'Stranglethorn Vale'], [35, 'Arathi Highlands'], [38, 'Badlands'], [42, 'The Hinterlands'], [47, 'Searing Gorge'], [50, 'Burning Steppes'], [53, 'Western Plaguelands'], [56, 'Eastern Plaguelands']],
  'Gnome': [[1, 'Dun Morogh'], [10, 'Loch Modan'], [14, 'Westfall'], [18, 'Redridge Mountains'], [22, 'Wetlands'], [27, 'Thousand Needles'], [32, 'Desolace'], [36, 'Stranglethorn Vale'], [41, 'Tanaris'], [46, 'Feralas'], [49, "Un'Goro Crater"], [52, 'Felwood'], [55, 'Winterspring']],
  'Night Elf': [[1, 'Teldrassil'], [10, 'Darkshore'], [20, 'Ashenvale'], [25, 'Stonetalon Mountains'], [30, 'Desolace'], [35, 'Dustwallow Marsh'], [40, 'Feralas'], [45, 'Tanaris'], [49, "Un'Goro Crater"], [52, 'Felwood'], [55, 'Winterspring']],
  'Orc': [[1, 'Durotar'], [10, 'The Barrens'], [19, 'Stonetalon Mountains'], [23, 'Ashenvale'], [28, 'Hillsbrad Foothills'], [31, 'Arathi Highlands'], [35, 'Stranglethorn Vale'], [40, 'Badlands'], [44, 'Tanaris'], [48, 'Azshara'], [50, "Un'Goro Crater"], [53, 'Felwood'], [56, 'Winterspring']],
  'Troll': [[1, 'Durotar'], [10, 'The Barrens'], [20, 'Hillsbrad Foothills'], [27, 'Thousand Needles'], [31, 'Stranglethorn Vale'], [37, 'Swamp of Sorrows'], [41, 'The Hinterlands'], [46, 'Tanaris'], [49, "Un'Goro Crater"], [52, 'Western Plaguelands'], [56, 'Eastern Plaguelands']],
  'Undead': [[1, 'Tirisfal Glades'], [10, 'Silverpine Forest'], [16, 'The Barrens'], [21, 'Hillsbrad Foothills'], [30, 'Arathi Highlands'], [34, 'Stranglethorn Vale'], [39, 'Badlands'], [43, 'The Hinterlands'], [47, 'Searing Gorge'], [50, 'Burning Steppes'], [52, 'Western Plaguelands'], [55, 'Eastern Plaguelands']],
  'Tauren': [[1, 'Mulgore'], [10, 'The Barrens'], [20, 'Stonetalon Mountains'], [25, 'Thousand Needles'], [30, 'Desolace'], [35, 'Dustwallow Marsh'], [40, 'Feralas'], [45, 'Tanaris'], [49, "Un'Goro Crater"], [52, 'Felwood'], [55, 'Winterspring']],
}

export const routeOf = (character) => (Object.hasOwn(ROUTES, character.characterRace) ? ROUTES[character.characterRace] : [])

// Index of the path step for the character's level.
const stepIndex = (character, level = character.characterLevel) => routeOf(character).findLastIndex(([at]) => at <= level)

// The zone the path has the character in at its level, or undefined.
export const routeZone = (character) => routeOf(character)[stepIndex(character)]?.[1]

// The first zone on the path, from the one for the character's level on, that isn't its current zone and
// still has quests for it. Undefined if none does yet.
function nextZoneWithQuests(character) {
  return routeOf(character).slice(Math.max(0, stepIndex(character)))
    .map(([, name]) => name)
    .find((name) => name !== character.zone && !zoneLockReason(character, getZone(name)) && activeQuests(character, name).length)
}

// Where a farming character moves after leveling from `fromLevel` and/or turning in a quest, or undefined
// to stay. Reaching a path step's level moves it to that step's zone; running out of quests moves it on to
// the next zone on the path that has some. Max-level characters stay wherever they are.
export function routeTravel(character, fromLevel, turnedIn) {
  if (!character.zone || character.characterLevel >= MAX_LEVEL) return undefined
  const reached = stepIndex(character) > stepIndex(character, fromLevel ?? character.characterLevel)
  if (!reached && !turnedIn) return undefined
  const target = reached ? routeOf(character)[stepIndex(character)][1] : character.zone
  const move = activeQuests(character, target).length ? target : nextZoneWithQuests(character) ?? target
  return move !== character.zone ? { zone: move, reason: reached ? 'level' : 'quests' } : undefined
}
