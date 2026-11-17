// The reset, every RESET_DAYS days at midnight US Eastern time (EST/EDT, so 05:00 or 04:00 UTC).
// Classic's weekly resets (honor ranks) happen every RESET_DAYS days here. Days are Eastern calendar
// dates counted from 1970-01-01; periods are runs of RESET_DAYS of them from there.
const DAY_MS = 24 * 3600 * 1000
export const RESET_DAYS = 3
const ZONE = 'America/New_York'

const clock = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })

// The Eastern wall-clock time at the ms time `at`, as if it were UTC.
function wallClock(at) {
  const p = {}
  for (const { type, value } of clock.formatToParts(at)) p[type] = Number(value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

// The Eastern day that the ms time `at` falls in.
export const dayOf = (at) => Math.floor(wallClock(at) / DAY_MS)

// The ms time `day` starts (Eastern midnight), which is when the day before it resets. Clocks change at
// 2am, so the offset at midnight is the one a few hours earlier.
export function dayStart(day) {
  const midnight = day * DAY_MS
  return midnight - (wallClock(midnight) - midnight)
}

// The reset period that the ms time `at` falls in.
export const periodOf = (at) => Math.floor(dayOf(at) / RESET_DAYS)

// The ms time `period` starts, which is when the period before it resets.
export const periodStart = (period) => dayStart(period * RESET_DAYS)
