// The World PvP page: every recent fight and escape across the account, and each one in detail.
import { CLASSES, RACES, classIcon } from './data.js'
import { el, formatChance, formatDuration, formatNumber } from './dom.js'

const factionOf = (m) => RACES[m.race].faction
const sideOf = (e, side) => e.members.filter((m) => m.side === side)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const honorText = (points) => `${formatNumber(Math.floor(points))} honor`
const ago = (at) => `${formatDuration((Date.now() - at) / 3600000)} ago`
const clock = (seconds) => {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const length = (seconds) => {
  const s = Math.round(seconds)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
// m:ss.s from tenths of a second.
const stamp = (tenths) => `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`
const LOG_KINDS = ['hit', 'heal', 'immune', 'cast'] // as in pvp.js encounter records
const SCHOOLS = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']
// Warcraft Logs colors: players in their class color, abilities in their spell school's.
const actor = (m) => el('span', { class: 'actor', style: { '--class-color': CLASSES[m.class].color } }, m.name)
const spell = (e, a) => el('span', { class: e.schools?.[a] == null ? 'spell' : `spell school-${SCHOOLS[e.schools[a]]}` }, e.abilities[a])

export function renderWorldPvp({ account, encounterId }) {
  if (!encounterId) return renderList(account)
  const encounter = account.encounters.find((e) => e.id === encounterId)
  return encounter ? renderEncounter(encounter, account) : renderMissing()
}

// What happened, in a line: "Zarku ganked Bassor" means Bassor died; anything else says so.
// `who` renders a member (a name by default).
export function headline(e, who = (m) => m.name) {
  const [a, b] = e.members
  if (e.kind === 'evade') return [who(a), e.how === 'hid' ? ' hid from ' : ' outran ', who(b)]
  const after = a.out === 'died' ? (b.out === 'died' ? ' and both died' : ' and died')
    : a.out === 'escaped' ? ', then had to bubble-hearth out'
      : b.out === 'escaped' ? ', who bubble-hearthed out'
        : b.out === 'died' ? '' : ' but couldn\'t finish them'
  return [who(a), ' ganked ', who(b), after]
}

const shape = (e) => (e.kind === 'evade' ? 'Escape' : `${sideOf(e, 0).length}v${sideOf(e, 1).length}`)

function outcome(e) {
  if (e.kind === 'evade') return 'Escaped'
  const escaped = e.members.filter((m) => m.out === 'escaped')
  if (e.winner === null) {
    if (escaped.length && e.kind === 'duel') return `${escaped[0].name} bubble-hearthed out`
    return e.kind === 'duel' ? 'Nobody died' : 'No winner'
  }
  return e.kind === 'duel' ? `${e.members[e.winner].name} won` : `${factionOf(sideOf(e, e.winner)[0])} won`
}

const resultClass = (e) => `encounter-${e.winner === null ? 'none' : factionOf(sideOf(e, e.winner)[0]).toLowerCase()}`

function renderList(account) {
  const { encounters } = account
  const fights = encounters.filter((e) => e.kind !== 'evade')
  const wins = (faction) => fights.filter((e) => e.winner !== null && factionOf(sideOf(e, e.winner)[0]) === faction).length
  const sum = (f) => fights.reduce((total, e) => total + e.members.reduce((n, m) => n + f(m), 0), 0)
  const tally = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, formatNumber(value)))
  return el('section', { class: 'world-pvp', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' }, el('h2', { id: 'view-title' }, 'World PvP')),
    el('dl', { class: 'pvp-tally encounter-tally' },
      tally('Fights', fights.length),
      tally('Escapes', encounters.length - fights.length),
      tally('Alliance wins', wins('Alliance')),
      tally('Horde wins', wins('Horde')),
      tally('Honorable kills', sum((m) => m.honor)),
      tally('Honor', Math.floor(sum((m) => m.points ?? 0))),
      tally('Deaths', sum((m) => (m.out === 'died' ? 1 : 0))),
    ),
    encounters.length
      ? [
        el('p', { class: 'note' }, `The last ${plural(encounters.length, 'encounter')} between your characters, newest first. Select one to see how it played out.`),
        el('ul', { class: 'encounter-list' }, encounters.map(renderRow)),
      ]
      : el('p', { class: 'empty' }, 'No encounters yet. Characters of opposite factions farming the same contested zone run into each other.'),
  )
}

function renderRow(e) {
  const deaths = e.members.filter((m) => m.out === 'died').length
  const honor = e.members.reduce((n, m) => n + m.honor, 0)
  const points = e.members.reduce((n, m) => n + (m.points ?? 0), 0)
  const extras = [deaths && plural(deaths, 'death'), honor && `${plural(honor, 'honorable kill')}${points ? ` (${honorText(points)})` : ''}`].filter(Boolean)
  return el('li', {},
    el('a', { class: `encounter-row ${resultClass(e)}`, href: `#/pvp/${e.id}` },
      el('span', { class: 'encounter-shape' }, shape(e)),
      el('span', { class: 'encounter-main' },
        el('strong', {}, headline(e)),
        el('span', { class: 'encounter-meta' }, [e.zone, outcome(e), ...extras].join(' · ')),
      ),
      el('span', { class: 'encounter-when' }, ago(e.at)),
    ),
  )
}

function renderMissing() {
  return el('section', { class: 'world-pvp', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, 'Encounter not found'),
      el('a', { class: 'button small', href: '#/pvp' }, 'Back to World PvP'),
    ),
    el('p', { class: 'empty' }, `Only the last encounters are kept. This one is no longer in the log.`),
  )
}

function renderEncounter(e, account) {
  const evade = e.kind === 'evade'
  const kind = evade ? 'Escape' : e.kind === 'duel' ? '1v1' : `${shape(e)} brawl`
  return el('section', { class: 'world-pvp encounter', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title' }, headline(e)),
        el('p', { class: 'sheet-subtitle' }, [e.zone, kind, !evade && length(e.seconds), ago(e.at)].filter(Boolean).join(' · ')),
      ),
      el('a', { class: 'button small', href: '#/pvp' }, 'Back to World PvP'),
    ),
    el('p', { class: `encounter-summary ${resultClass(e)}` }, summary(e)),
    el('div', { class: 'encounter-sides' }, [0, 1].map((side) => renderSide(e, side, account))),
    !evade && e.members.some((m) => m.damage.length || m.healing.length) && renderBreakdown(e),
    !evade && e.log && renderLog(e),
    !evade && !e.log && el('section', { class: 'sheet-panel', 'aria-label': 'Timeline' },
      el('h3', {}, 'Timeline'),
      el('ol', { class: 'encounter-timeline' }, timeline(e).map(({ t, text }) =>
        el('li', {}, el('span', { class: 'encounter-time' }, clock(t)), el('span', {}, text)))),
    ),
  )
}

function summary(e) {
  const [a, b] = e.members
  if (e.kind === 'evade') {
    return `${a.name} spotted ${b.name}, ${plural(b.level - a.level, 'level')} higher, and ${e.how === 'hid' ? 'hid' : 'ran'} instead of fighting. Escaping cost a minute of farming.`
  }
  const caught = e.caught === 'hid' ? ` ${b.name} tried to hide and got found.` : e.caught === 'ran' ? ` ${b.name} tried to run and got caught.` : ''
  return `${outcome(e)}.${caught} ${a.name} sized it up at ${formatChance(e.guess)} to win; one on one it was really ${formatChance(e.odds)}.`
}

function renderSide(e, side, account) {
  const members = sideOf(e, side)
  const faction = factionOf(members[0])
  const role = e.kind === 'evade' ? (side === 0 ? 'Escaped' : 'Gave chase') : side === 0 ? 'Gankers' : 'Defenders'
  const held = e.winner === side ? ' · won' : ''
  return el('section', { class: `encounter-side faction-${faction.toLowerCase()}`, 'aria-label': `${faction} side` },
    el('h3', { class: 'faction-name' }, `${faction} · ${role}${held}`),
    el('ul', { class: 'encounter-members' }, members.map((m) => renderMember(e, m, account))),
  )
}

function renderMember(e, m, account) {
  const name = account.getCharacter(m.id) ? el('a', { href: `#/character/${m.id}` }, m.name) : m.name
  const status = e.kind === 'evade' ? []
    : [
      m.joined > 0 && `Added at ${clock(m.joined)}`,
      m.out === 'died' ? `Died at ${clock(m.left)}` : m.out === 'escaped' ? `Bubble-hearthed at ${clock(m.left)}` : 'Survived',
      m.kills > 0 && `${plural(m.kills, 'kill')}${m.honor ? ` (${m.honor} honorable${m.points ? `, ${honorText(m.points)}` : ''})` : ''}`,
    ].filter(Boolean)
  return el('li', { class: `encounter-member${m.out === 'died' ? ' dead' : ''}`, style: { '--class-color': CLASSES[m.class].color } },
    el('img', { class: 'class-icon', src: classIcon(m.class), alt: '', width: 40, height: 40 }),
    el('div', {},
      el('p', { class: 'character-name' }, name),
      el('p', { class: 'encounter-meta' }, `${m.level} ${m.race} ${m.spec} ${m.class}`),
      status.length > 0 && el('p', { class: 'encounter-meta' }, status.join(' · ')),
    ),
  )
}

function timeline(e, who = (m) => m.name) {
  const [a, b] = e.members
  const opener = e.caught === 'hid' ? [who(a), ' finds ', who(b), ' hiding and opens on them']
    : e.caught === 'ran' ? [who(a), ' chases down ', who(b), ' and opens on them']
      : [who(a), ' opens on ', who(b)]
  const events = [{ t: 0, text: opener, lead: true }]
  for (const m of e.members.slice(2)) events.push({ t: m.joined, text: [who(m), ` adds for the ${factionOf(m)}`], lead: true })
  for (const m of e.members) {
    if (m.out === 'died') events.push({ t: m.left, text: [who(m), ' dies'] })
    if (m.out === 'escaped') events.push({ t: m.left, text: [who(m), ' bubble-hearths out'] })
  }
  events.sort((x, y) => x.t - y.t)
  events.push({ t: Math.max(e.seconds, ...e.members.map((m) => m.left)), text: `${outcome(e)}.` })
  return events
}

// Who did what, like a Warcraft Logs meter. Up top, each side's total damage and healing pulling against
// the other's. Then each member's health when it ended, and its damage and healing on one scale shared by
// the whole fight (the biggest number fills its bar), opening to the abilities behind them.
function renderBreakdown(e) {
  const total = (rows) => rows.reduce((n, r) => n + r[1], 0)
  const sums = e.members.map((m) => ({ damage: total(m.damage), healing: total(m.healing) }))
  const top = Math.max(1, ...sums.flatMap((s) => [s.damage, s.healing]))
  const anyHealing = sums.some((s) => s.healing > 0)
  const factions = [0, 1].map((side) => factionOf(sideOf(e, side)[0]).toLowerCase())
  const width = (share) => ({ width: `${(100 * Math.min(Math.max(share, 0), 1)).toFixed(1)}%` })
  const bar = (share, attrs) => el('span', { class: 'meter-bar', 'aria-hidden': 'true', ...attrs }, el('span', { style: width(share) }))
  const abilityRows = (rows, of) => rows.map(([a, amount, hits]) =>
    el('tr', {},
      el('th', { scope: 'row' }, spell(e, a)),
      el('td', {}, formatNumber(amount)),
      el('td', {}, formatNumber(hits)),
      el('td', {}, formatNumber(hits ? Math.round(amount / hits) : 0)),
      el('td', {}, el('span', { class: 'encounter-share' },
        bar(of ? amount / of : 0, { class: `meter-bar ${e.schools?.[a] == null ? '' : `school-${SCHOOLS[e.schools[a]]}`}` }),
        `${of ? Math.round((100 * amount) / of) : 0}%`)),
    ))
  // Side 0's total against side 1's, in faction colors.
  const versus = (label, key) => {
    const per = [0, 1].map((side) => e.members.reduce((n, m, i) => n + (m.side === side ? sums[i][key] : 0), 0))
    if (!per[0] && !per[1]) return null
    return el('div', { class: 'versus' },
      el('div', { class: 'versus-labels' },
        el('span', { class: `versus-${factions[0]}` }, formatNumber(per[0])),
        el('span', { class: 'versus-title' }, label),
        el('span', { class: `versus-${factions[1]}` }, formatNumber(per[1])),
      ),
      el('div', { class: 'versus-bar', 'aria-hidden': 'true' },
        per.map((n, side) => el('span', { class: `versus-${factions[side]}`, style: { 'flex-grow': String(n) } }))),
    )
  }
  // A labeled bar: what it is, the bar, and the number.
  const stat = (label, share, kind, value) => el('div', { class: `stat-bar stat-${kind}` },
    el('span', { class: 'stat-label' }, label),
    bar(share, { class: `meter-bar meter-${kind}` }),
    el('span', { class: 'stat-value' }, value),
  )
  const health = (m) => {
    if (!m.maxHp) return null
    const share = m.hp / m.maxHp
    const level = share > 0.5 ? 'high' : share > 0.25 ? 'mid' : 'low'
    const value = m.out === 'died' ? 'Dead' : `${formatNumber(m.hp)} / ${formatNumber(m.maxHp)}`
    return stat('Health', m.out === 'died' ? 0 : share, `health hp-${level}`, value)
  }
  const member = (m, i) => {
    const { damage, healing } = sums[i]
    const seconds = Math.max(m.left - m.joined, 1)
    const fate = m.out === 'died' ? 'Died' : m.out === 'escaped' ? 'Hearthed out' : 'Survived'
    const head = (label) => el('tr', {}, el('th', { scope: 'col' }, label), ['Amount', 'Hits', 'Average', 'Share'].map((h) => el('th', { scope: 'col' }, h)))
    return el('details', { class: `encounter-breakdown${m.out === 'died' ? ' dead' : ''}`, style: { '--class-color': CLASSES[m.class].color } },
      el('summary', {},
        el('span', { class: 'breakdown-head' }, actor(m), el('span', { class: `fate fate-${m.out ?? 'alive'}` }, fate)),
        el('div', { class: 'stat-bars' },
          health(m),
          stat('Damage', damage / top, 'class', `${formatNumber(damage)} · ${formatNumber(Math.round(damage / seconds))} DPS`),
          anyHealing && stat('Healing', healing / top, 'heal', `${formatNumber(healing)} · ${formatNumber(Math.round(healing / seconds))} HPS`),
        ),
        el('span', { class: 'encounter-meta' }, `${formatNumber(m.taken)} damage taken · show abilities`),
      ),
      el('table', { class: 'encounter-abilities' },
        m.damage.length > 0 && [el('thead', {}, head('Damage')), el('tbody', {}, abilityRows(m.damage, damage))],
        m.healing.length > 0 && [el('thead', {}, head('Healing')), el('tbody', {}, abilityRows(m.healing, healing))],
      ),
    )
  }
  return el('section', { class: 'sheet-panel', 'aria-label': 'Damage breakdown' },
    el('h3', {}, 'Damage breakdown'),
    el('div', { class: 'versus-group' }, versus('Damage', 'damage'), versus('Healing', 'healing')),
    el('p', { class: 'note' }, 'Health is what each player had left when the fight ended. Damage and healing share one scale: the biggest number in the fight fills its bar.'),
    el('div', { class: 'encounter-sides' }, [0, 1].map((side) =>
      el('div', { class: `faction-${factions[side]}` }, e.members.map((m, i) => (m.side === side ? member(m, i) : null))))),
  )
}

// The combat log, blow by blow, with who opened, joined, died and how it ended, colored like Warcraft Logs.
function renderLog(e) {
  const who = (i) => actor(e.members[i])
  const line = ([, kind, from, to, a, amount, extra]) => {
    const melee = e.abilities[a] === 'Melee'
    const by = melee ? [who(from)] : [who(from), '\'s ', spell(e, a)]
    switch (LOG_KINDS[kind]) {
      case 'hit': return [...by, ' hits ', who(to), ` for ${formatNumber(amount)}${extra ? ` (${formatNumber(extra)} absorbed)` : ''}.`]
      case 'heal': return [...by, ' heals ', who(to), ` for ${formatNumber(amount)}${extra ? ` (${formatNumber(extra)} overhealing)` : ''}.`]
      case 'immune': return [...(melee ? [who(from), ' attacks'] : [...by, ' fails']), '. ', who(to), ' is immune.']
      default: return [who(from), ' casts ', spell(e, a), '.']
    }
  }
  const rows = [
    ...timeline(e, actor).map(({ t, text, lead }) => ({ t: Math.round(t * 10), order: lead ? -1 : 1, text, mark: true })),
    ...e.log.map((r) => ({ t: r[0], order: 0, text: line(r), hp: r[7] })),
  ].sort((x, y) => x.t - y.t || x.order - y.order)
  return el('section', { class: 'sheet-panel', 'aria-label': 'Combat log' },
    el('h3', {}, 'Combat log'),
    el('p', { class: 'note' }, 'Every blow lands for its average: the fight is simulated without crits or misses. Health is the target\'s after each line.'),
    el('ol', { class: 'encounter-log' }, rows.map((r) =>
      el('li', { class: r.mark ? 'encounter-mark' : null },
        el('span', { class: 'encounter-time' }, stamp(r.t)),
        el('span', {}, r.text),
        el('span', { class: 'encounter-hp' }, r.mark ? '' : formatNumber(r.hp)),
      ))),
  )
}
