// Classic 1.12 PvP ranks (vmangos HonorMgr), reset every RESET_DAYS days (reset.js) instead of weekly.
// Each character's honor and honorable kills for the period (`honorPeriod`, see earnHonor in pvp.js) count
// toward its faction's standing. At the reset, everyone of a faction with enough honorable kills that
// period is ranked by honor; where it stands against the rest of its faction's honor earns it rank
// points, and a fifth of its rank points decay. Rank comes from rank points. "The server" is every
// character on the account.
import { periodOf } from './reset.js'

export const MIN_HONOR_KILLS = 15 // honorable kills in a period to be in the standings
export const MAX_RANK = 14
const RP_DECAY = 0.2 // of rank points, each reset
const MAX_RP_LOSS = 2500 // the most rank points a reset takes away
// The share of the standings (from the top) at or above each bracket's cutoff, ranks 1 to 14 (1.12).
const BRACKETS = [1, 0.845, 0.697, 0.566, 0.436, 0.327, 0.228, 0.159, 0.1, 0.06, 0.035, 0.02, 0.008, 0.003]
// Rank points earned at each bracket's cutoff.
const BRACKET_RP = [0, 400, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000]

export const RANK_TITLES = {
  Alliance: ['Private', 'Corporal', 'Sergeant', 'Master Sergeant', 'Sergeant Major', 'Knight', 'Knight-Lieutenant', 'Knight-Captain', 'Knight-Champion', 'Lieutenant Commander', 'Commander', 'Marshal', 'Field Marshal', 'Grand Marshal'],
  Horde: ['Scout', 'Grunt', 'Sergeant', 'Senior Sergeant', 'First Sergeant', 'Stone Guard', 'Blood Guard', 'Legionnaire', 'Centurion', 'Champion', 'Lieutenant General', 'General', 'Warlord', 'High Warlord'],
}

// The rank (0 to 14) that `rankPoints` give (vmangos CalculateRank).
export function rankOf(rankPoints) {
  if (rankPoints <= 0) return 0
  if (rankPoints < 2000) return 1
  if (rankPoints > 60000) return MAX_RANK
  return Math.floor(rankPoints / 5000) + 2
}

// The rank points where `rank` (1 to 14) starts and where the next one does.
export function rankRange(rank) {
  if (rank <= 1) return [0, 2000]
  if (rank === 2) return [2000, 5000]
  return [(rank - 2) * 5000, (rank - 1) * 5000]
}

export function rankTitle(faction, rank) {
  return rank > 0 ? RANK_TITLES[faction][rank - 1] : null
}

// The most rank points a character of `level` can hold after a reset it's in the standings for.
export function maxRpAtLevel(level) {
  if (level <= 29) return 6500
  if (level <= 35) return 7150 + 975 * (level - 30)
  if (level <= 39) return 12025 + 1300 * (level - 35)
  if (level <= 43) return 17225 + 1625 * (level - 39)
  if (level <= 52) return 23725 + 2275 * (level - 43)
  return 44200 + 2600 * (level - 52)
}

// The honor at each bracket's cutoff, from a faction's standings (honor, highest first), for rpEarning
// (vmangos GenerateScores). A cutoff is halfway between the honor at its position and the next one's,
// or half the honor there if nobody's next. Past the last bracket the standings fill, the cutoff is the
// top honor.
export function generateScores(standings) {
  const brackets = BRACKETS.map((share) => Math.floor(share * standings.length + 0.5))
  const at = (position) => (position >= 1 && position <= standings.length ? standings[position - 1] : 0)
  const top = standings[0] ?? 0
  const cutoffs = [0]
  let filled = false
  for (let i = 1; i < MAX_RANK; i++) {
    let honor = at(brackets[i])
    if (honor) honor += at(brackets[i] + 1)
    cutoffs[i] = honor / 2
    if (!filled && !honor) {
      cutoffs[i] = cutoffs[i - 1] ? top : 0
      filled = true
    }
  }
  cutoffs[MAX_RANK] = filled ? 0 : top
  return { brackets, cutoffs }
}

// Rank points earned for `honor` in standings scored by generateScores: between two cutoffs, in
// proportion (vmangos CalculateRpEarning).
export function rpEarning(honor, { brackets, cutoffs }) {
  let i = 0
  while (i < MAX_RANK && brackets[i] > 0 && cutoffs[i] <= honor) i++
  if (cutoffs[i] > honor && honor >= cutoffs[i - 1]) {
    return ((BRACKET_RP[i] - BRACKET_RP[i - 1]) * (honor - cutoffs[i - 1])) / (cutoffs[i] - cutoffs[i - 1]) + BRACKET_RP[i - 1]
  }
  return BRACKET_RP[i]
}

// Rank points after a reset: the earning, less a fifth of the old points. A net loss is halved and at
// most MAX_RP_LOSS (vmangos CalculateRpDecay).
export function rpDecay(earning, rankPoints) {
  let delta = earning - Math.floor(RP_DECAY * rankPoints + 0.5)
  if (delta < 0) delta = Math.max(delta / 2, -MAX_RP_LOSS)
  return rankPoints + delta
}

// What `character` earned toward the reset at the end of `period`.
export const earnedIn = (character, period) => (character.honorPeriod?.period === period ? character.honorPeriod : { kills: 0, points: 0 })

// A faction's standings for `period`: its characters with MIN_HONOR_KILLS in it, most honor first.
export function standings(characters, faction, period) {
  return characters
    .filter((c) => c.faction === faction && earnedIn(c, period).kills >= MIN_HONOR_KILLS)
    .sort((a, b) => earnedIn(b, period).points - earnedIn(a, period).points)
}

// The reset at the end of `period`. Characters with MIN_HONOR_KILLS in it are in their faction's
// standings and earn rank points, up to their level's cap; everyone else only decays. Sets each
// character's `rankPoints`, `highestRank` and `honorLastPeriod` ({ kills, points, standing }; standing
// is 0 for anyone not in the standings).
export function honorReset(characters, period) {
  const results = new Map(characters.map((c) => {
    const { kills, points } = earnedIn(c, period)
    return [c, { kills, points, standing: 0, rankPoints: rpDecay(0, c.rankPoints) }]
  }))
  for (const faction of new Set(characters.map((c) => c.faction))) {
    const ranked = standings(characters, faction, period)
    const scored = generateScores(ranked.map((c) => earnedIn(c, period).points))
    ranked.forEach((c, i) => {
      const r = results.get(c)
      r.standing = i + 1
      r.rankPoints = Math.min(maxRpAtLevel(c.characterLevel), rpDecay(rpEarning(r.points, scored), c.rankPoints))
    })
  }
  for (const [c, { kills, points, standing, rankPoints }] of results) {
    c.rankPoints = Math.max(0, rankPoints)
    c.highestRank = Math.max(c.highestRank, rankOf(c.rankPoints))
    c.honorLastPeriod = { kills, points, standing }
  }
}

// Runs every reset due between the ms times `from` and `to`: one at the end of each period from
// `from`'s up to the one before `to`'s.
export function honorResets(characters, from, to) {
  for (let period = periodOf(from); period < periodOf(to); period++) honorReset(characters, period)
}
