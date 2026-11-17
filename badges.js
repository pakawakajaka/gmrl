// Badges a group record hands out to its members. They're worked out from what the record already stores, so
// nothing is saved and a new badge shows on old records too. Each badge names the kinds of record it's for
// ('dungeon' for now); raids and others add their kind to a badge, or new badges, here.
//   key: CSS class `badge-<key>`; label: what it says; title: its tooltip;
//   earnedBy(record): the member indexes that get it (none, one, or several for ties or group badges).

// The members with the highest amount, if anyone has more than nothing.
const topOf = (amounts = []) => {
  const top = Math.max(0, ...amounts)
  return top > 0 ? amounts.flatMap((n, i) => (n === top ? [i] : [])) : []
}

export const BADGES = [
  { key: 'top-damage', label: 'Top Damage', title: 'Did the most damage', kinds: ['dungeon'], earnedBy: (run) => topOf(run.meters?.damage) },
]

// The badges a record of this kind hands out, in BADGES order: [{ key, label, title, to: [member index] }].
export function earnedBadges(kind, record) {
  return BADGES.filter((b) => b.kinds.includes(kind))
    .map(({ key, label, title, earnedBy }) => ({ key, label, title, to: earnedBy(record) }))
    .filter((b) => b.to.length)
}
