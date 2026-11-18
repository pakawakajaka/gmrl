// The Dungeons page: every dungeon with who's queued for it, recent runs, and each run in detail.
import { CLASSES, classIcon } from './data.js'
import { characterName, el, formatDuration, formatNumber, money } from './dom.js'
import { DUNGEON_QUESTS, QUALITIES, getItem } from './gear.js'
import { DUNGEONS, GROUP_SIZE, RUN_METER_SIZE, dungeonQuestIds, getDungeon, isQueuedFor } from './dungeons.js'
import { KEPT_TEXT, renderTooltip } from './character-sheet.js'
import { earnedBadges } from './badges.js'

const FACTIONS = ['Alliance', 'Horde']
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const ago = (at) => `${formatDuration((Date.now() - at) / 3600000)} ago`
const runLength = (seconds) => formatDuration(seconds / 3600)
const resultClass = (run) => (run.success ? `encounter-${run.faction.toLowerCase()}` : 'encounter-none')
export const runHeadline = (run) => (run.success ? `Cleared ${run.dungeon}` : `Wiped in ${run.dungeon}${run.wipedOn ? ` on ${run.wipedOn}` : ''}`)
const questCount = (run) => run.members.reduce((n, m) => n + m.quests.length, 0)

export function renderDungeons({ account, runId }) {
  if (!runId) return renderList(account)
  const run = account.dungeonRuns.find((r) => r.id === runId)
  return run ? renderRun(run, account) : renderMissing()
}

function renderList(account) {
  const runs = account.dungeonRuns
  const tally = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, formatNumber(value)))
  return el('section', { class: 'world-pvp dungeons', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' }, el('h2', { id: 'view-title' }, 'Dungeons')),
    el('dl', { class: 'pvp-tally encounter-tally' },
      tally('Runs', runs.length),
      tally('Clears', runs.filter((r) => r.success).length),
      tally('Wipes', runs.filter((r) => !r.success).length),
      tally('Quests turned in', runs.reduce((n, r) => n + questCount(r), 0)),
      tally('Queued', account.characters.filter((c) => c.dungeonQueue).length),
    ),
    el('p', { class: 'note' }, `Farming characters pick up the quests for dungeons in their level range, traveling for them when needed, then queue on their own. Queue anyone by hand from their character page. When ${GROUP_SIZE} of a faction are queued for the same dungeon, they run it together: drops go to whoever would wear them now, else to a random member, and finishing turns in everyone's quests for it. Run pages list only the loot that was kept.`),
    el('ul', { class: 'dungeon-list' }, DUNGEONS.map((d) => renderDungeonRow(d, account))),
    el('h3', { class: 'dungeon-runs-title' }, 'Recent runs'),
    runs.length
      ? el('ul', { class: 'encounter-list' }, runs.map(renderRunRow))
      : el('p', { class: 'empty' }, 'No runs yet.'),
  )
}

function renderDungeonRow(dungeon, account) {
  const factions = dungeon.faction ? [dungeon.faction] : FACTIONS
  const name = (c) => characterName(c, true)
  return el('li', { class: 'dungeon-row' },
    el('span', { class: 'encounter-shape' }, `${dungeon.level[0]}–${dungeon.level[1]}`),
    el('span', { class: 'encounter-main' },
      el('strong', {}, dungeon.name),
      el('span', { class: 'encounter-meta' }, [
        dungeon.faction && `${dungeon.faction} only`,
        `${dungeon.bosses.length} boss${dungeon.bosses.length === 1 ? '' : 'es'}`,
        plural(dungeonQuestIds(dungeon.name).filter((id) => !DUNGEON_QUESTS[id].step).length, 'quest'),
        `about ${formatDuration(dungeon.minutes / 60)}`,
      ].filter(Boolean).join(' · ')),
    ),
    el('span', { class: 'dungeon-queues' }, factions.map((faction) => {
      const queued = account.characters.filter((c) => c.faction === faction && isQueuedFor(c, dungeon.name))
      return el('span', { class: `dungeon-queue faction-${faction.toLowerCase()}` },
        el('span', { class: 'faction-name' }, `${faction} ${queued.length}/${GROUP_SIZE}`),
        queued.length > 0 && el('span', { class: 'encounter-meta' }, queued.flatMap((c, i) => (i ? [', ', name(c)] : [name(c)]))),
      )
    })),
  )
}

function renderRunRow(run) {
  return el('li', {},
    el('a', { class: `encounter-row ${resultClass(run)}`, href: `#/dungeons/${run.id}` },
      el('span', { class: 'encounter-shape' }, run.success ? 'Clear' : 'Wipe'),
      el('span', { class: 'encounter-main' },
        el('strong', {}, runHeadline(run)),
        el('span', { class: 'encounter-meta' }, [
          run.faction,
          runLength(run.seconds),
          `${run.bosses} of ${getDungeon(run.dungeon).bosses.length} bosses`,
          plural(questCount(run), 'quest'),
          run.loot.length && `${plural(run.loot.length, 'item')} kept`,
          run.meters?.deaths.length && plural(run.meters.deaths.length, 'death'),
        ].filter(Boolean).join(' · ')),
      ),
      el('span', { class: 'encounter-when' }, ago(run.at)),
    ),
  )
}

function renderMissing() {
  return el('section', { class: 'world-pvp', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, 'Run not found'),
      el('a', { class: 'button small', href: '#/dungeons' }, 'Back to Dungeons'),
    ),
    el('p', { class: 'empty' }, 'Only the last runs are kept. This one is no longer in the log.'),
  )
}

function renderRun(run, account) {
  const dungeon = getDungeon(run.dungeon)
  const badges = earnedBadges('dungeon', run)
  const summary = run.success
    ? `The ${run.faction} group killed all ${dungeon.bosses.length} bosses and ${formatNumber(run.trash)} other mobs, then turned in ${plural(questCount(run), 'quest')}.`
    : `The group was too weak for ${run.dungeon}: it killed ${run.bosses} of ${dungeon.bosses.length} bosses and ${formatNumber(run.trash)} other mobs before wiping${run.wipedOn ? ` on ${run.wipedOn}` : ''}. No quest credit. They won't queue again on their own until they level or pick up more quests.`
  return el('section', { class: 'world-pvp encounter dungeon-run', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title' }, runHeadline(run)),
        el('p', { class: 'sheet-subtitle' }, [run.faction, runLength(run.seconds), ago(run.at)].join(' · ')),
      ),
      el('a', { class: 'button small', href: '#/dungeons' }, 'Back to Dungeons'),
    ),
    el('p', { class: `encounter-summary ${resultClass(run)}` }, summary),
    el('div', { class: 'encounter-sides' },
      el('section', { 'aria-label': 'Group' },
        el('h3', {}, 'Group'),
        el('ul', { class: 'encounter-members' }, run.members.map((m, i) => renderMember(run, m, i, account, badges.filter((b) => b.to.includes(i))))),
      ),
      el('section', { 'aria-label': 'Loot' },
        el('h3', {}, 'Loot'),
        run.loot.length
          ? el('ul', { class: 'loot-log' }, run.loot.map((l) => {
            const item = getItem(l.item)
            return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0 },
              el('span', { class: 'item-name' }, item.name),
              el('span', { class: 'loot-source' }, ` from ${l.from} · `, characterName(run.members[l.to]), `, ${KEPT_TEXT[l.kept]}`),
              renderTooltip(item),
            )
          }))
          : el('p', { class: 'empty' }, 'Nothing kept.'),
      ),
    ),
    run.meters
      ? renderMeters(run)
      : el('p', { class: 'note' }, `Meters are kept for the last ${RUN_METER_SIZE} runs.`),
  )
}

// Damage, healing and damage taken, like a Warcraft Logs meter: each member's bar against the top one, with
// the amount and per second of fighting. Then who died to what.
function renderMeters(run) {
  const { meters } = run
  const board = (title, key, perSecond) => {
    const rows = run.members.map((m, i) => ({ m, amount: meters[key][i] })).filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
    if (!rows.length) return null
    const top = rows[0].amount
    const total = rows.reduce((n, r) => n + r.amount, 0)
    return el('section', { class: 'dungeon-meter', 'aria-label': title },
      el('h4', {}, title, el('span', { class: 'encounter-meta' }, `${formatNumber(total)} · ${formatNumber(Math.round(total / meters.combat))} ${perSecond}`)),
      el('div', { class: 'stat-bars' }, rows.map(({ m, amount }) =>
        el('div', { class: 'stat-bar', style: { '--class-color': CLASSES[m.class].color } },
          el('span', { class: 'stat-label actor' }, m.name),
          el('span', { class: `meter-bar ${key === 'healing' ? 'meter-heal' : 'meter-class'}`, 'aria-hidden': 'true' },
            el('span', { style: { width: `${((100 * amount) / top).toFixed(1)}%` } })),
          el('span', { class: 'stat-value' }, `${formatNumber(amount)} · ${formatNumber(Math.round(amount / meters.combat))} ${perSecond}`),
        ))),
    )
  }
  const died = (m) => el('span', { class: 'actor', style: { '--class-color': CLASSES[m.class].color } }, m.name)
  return el('section', { class: 'dungeon-meters', 'aria-labelledby': 'meters-title' },
    el('h3', { id: 'meters-title' }, 'Meters', el('span', { class: 'encounter-meta' }, ` ${runLength(meters.combat)} in combat`)),
    el('div', { class: 'dungeon-meter-boards' },
      board('Damage done', 'damage', 'DPS'),
      board('Healing done', 'healing', 'HPS'),
      board('Damage taken', 'taken', 'DTPS'),
      el('section', { class: 'dungeon-meter', 'aria-label': 'Deaths' },
        el('h4', {}, 'Deaths', el('span', { class: 'encounter-meta' }, formatNumber(meters.deaths.length))),
        meters.deaths.length
          ? el('ul', { class: 'death-log' }, meters.deaths.map((d) => el('li', {}, died(run.members[d.to]), ` killed by ${d.by}`)))
          : el('p', { class: 'empty' }, 'Nobody died.'),
      ),
    ),
  )
}

function renderMember(run, m, index, account, badges) {
  const name = account.getCharacter(m.id) ? characterName(m, true) : m.name
  const won = run.loot.filter((l) => l.to === index)
  const gains = [m.xp > 0 && `${formatNumber(m.xp)} XP`, won.length && plural(won.length, 'item')].filter(Boolean)
  return el('li', { class: 'encounter-member', style: { '--class-color': CLASSES[m.class].color } },
    el('img', { class: 'class-icon', src: classIcon(m.class), alt: '', width: 40, height: 40 }),
    el('div', {},
      el('p', { class: 'character-name' }, name),
      el('p', { class: 'encounter-meta' }, `${m.level} ${m.race} ${m.spec} ${m.class} · ${m.role}`),
      el('p', { class: 'encounter-meta' }, gains.join(' · '), gains.length ? ' · ' : '', money(m.copper)),
      m.quests.length > 0 && el('p', { class: 'encounter-meta' }, `Turned in: ${m.quests.map((id) => DUNGEON_QUESTS[id].title).join(', ')}`),
      badges.length > 0 && el('div', { class: 'badges' }, badges.map((b) => el('span', { class: `badge badge-${b.key}`, title: b.title }, b.label))),
    ),
  )
}
