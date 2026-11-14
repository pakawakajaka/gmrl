import { el, formatChance, formatDuration, formatNumber, money } from './dom.js'
import { CLASS_BITS, INVENTORY_TYPES, QUALITIES, QUEST_ITEMS, RACE_BITS, SLOTS, getItem, getQuest, itemTypeName, offSpecGear } from './gear.js'
import { SCHOOLS, STAT_NAMES, characterStats } from './stats.js'
import { drinkFor, foodFor, getMob } from './combat.js'
import { objectivesOf, questProgress } from './quests.js'
import { mountOf } from './pvp.js'
import { getSpell, knownAbilities } from './spells.js'
import { renderTalentTile } from './talents-view.js'
import { routeOf, routeZone } from './leveling.js'
import { MAX_LEVEL } from './data.js'
import { DUNGEONS, dungeonLockReason, heldQuests, inRange, isQueuedFor, pendingQuests } from './dungeons.js'

const LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist']
const RIGHT = ['hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2']
const BOTTOM = ['mainHand', 'offHand', 'ranged']

const BINDS = { 1: 'Binds when picked up', 2: 'Binds when equipped', 3: 'Binds when used', 4: 'Quest Item' }
const DAMAGE_SCHOOLS = ['', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane']
const ITEM_STAT_NAMES = { ...STAT_NAMES, health: 'Health', mana: 'Mana' }
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const signed = (n) => `${n >= 0 ? '+' : ''}${n}`
const pct = (n) => `${n.toFixed(2)}%`
const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/large/'

export function renderCharacterSheet({ character, onDelete, onQueue, onLeaveQueue }) {
  const stats = characterStats(character)
  const deleteDialog = renderDeleteDialog(character, onDelete)
  return el('section', { class: 'character-sheet', style: { '--class-color': character.classColor }, 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title' }, character.characterName),
        el('p', { class: 'sheet-subtitle' }, `Level ${character.characterLevel} ${character.characterRace} ${character.characterSpec} ${character.characterClass}`),
      ),
      el('div', { class: 'sheet-actions' },
        el('a', { class: 'button small', href: '#/roster' }, 'Back to roster'),
        el('button', { type: 'button', class: 'button small danger', onclick: () => deleteDialog.showModal() }, 'Delete'),
      ),
    ),
    el('div', { class: 'sheet-layout' },
      el('div', { class: 'sheet-column' },
        renderPaperDoll(character),
        renderTalentTile(character),
        renderPvp(character),
      ),
      renderStats(character, stats),
    ),
    el('div', { class: 'sheet-layout' },
      renderProgress(character),
      el('div', { class: 'sheet-stack' },
        renderDungeons(character, onQueue, onLeaveQueue),
        renderBag(character),
        renderLoot(character),
      ),
    ),
    deleteDialog,
  )
}

function renderDeleteDialog(character, onDelete) {
  const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'delete-title', 'aria-describedby': 'delete-text' },
    el('h3', { id: 'delete-title' }, `Delete ${character.characterName}?`),
    el('p', { id: 'delete-text' }, 'This permanently removes the character, their gear and progress. This can\'t be undone.'),
    el('div', { class: 'modal-actions' },
      el('button', { type: 'button', class: 'button', autofocus: true, onclick: () => dialog.close() }, 'Cancel'),
      el('button', { type: 'button', class: 'button danger', onclick: () => { dialog.close(); onDelete(character) } }, 'Delete character'),
    ),
  )
  return dialog
}

function renderPaperDoll(character) {
  const slot = (name, side) => renderSlot(SLOTS[name], getItem(character.equipment[name]), side)
  return el('section', { class: 'paper-doll', 'aria-label': 'Equipment' },
    el('ul', { class: 'slot-column left' }, LEFT.map((s) => slot(s, 'left'))),
    el('div', { class: 'doll-center' },
      el('img', { class: 'class-icon', src: character.classIcon, alt: '', width: 72, height: 72 }),
      el('p', {}, character.zone ? `Farming in ${character.zone}` : 'Idle'),
    ),
    el('ul', { class: 'slot-column right' }, RIGHT.map((s) => slot(s, 'right'))),
    el('ul', { class: 'slot-row' }, BOTTOM.map((s) => slot(s, 'bottom'))),
  )
}

function renderSlot(slotName, item, side) {
  const quality = item ? QUALITIES[item.quality] : 'empty'
  return el('li', { class: `slot slot-${side} q-${quality}`, tabindex: item ? 0 : null, 'aria-label': item ? `${slotName}: ${item.name}` : `${slotName}: empty` },
    renderIcon(item, slotName),
    el('span', { class: 'slot-text' },
      el('span', { class: 'slot-name' }, slotName),
      el('span', { class: 'item-name' }, item ? item.name : 'Empty'),
    ),
    item && renderTooltip(item),
  )
}

// Item icon from Wowhead's image CDN, falling back to the slot's initial when it can't be loaded.
function renderIcon(item, label) {
  const box = el('span', { class: 'item-icon', 'aria-hidden': 'true' }, el('span', { class: 'icon-fallback' }, label.charAt(0)))
  if (item) {
    const img = el('img', { src: `${ICON_URL}${encodeURIComponent(item.icon)}.jpg`, alt: '', width: 36, height: 36, loading: 'lazy', onerror: () => img.remove() })
    box.append(img)
  }
  return box
}

function maskNames(mask, bits) {
  const names = Object.entries(bits).filter(([, bit]) => mask & bit).map(([name]) => name)
  return names.length === Object.keys(bits).length ? null : names.join(', ')
}

// Classic-style item tooltip.
export function renderTooltip(item) {
  const line = (text, cls) => el('p', { class: cls }, text)
  const split = (left, right) => el('p', { class: 'split' }, el('span', {}, left), el('span', {}, right))
  const rows = [line(item.name, `tt-name q-${QUALITIES[item.quality]}`)]
  if (item.binds) rows.push(line(BINDS[item.binds]))
  if (item.unique) rows.push(line('Unique'))
  rows.push(split(INVENTORY_TYPES[item.slot] ?? '', itemTypeName(item)))
  if (item.damage) {
    const [[min, max, school], ...extra] = item.damage
    rows.push(split(`${min} - ${max} ${DAMAGE_SCHOOLS[school] ? `${DAMAGE_SCHOOLS[school]} ` : ''}Damage`, `Speed ${item.speed.toFixed(2)}`))
    for (const [lo, hi, s] of extra) rows.push(line(`+ ${lo} - ${hi} ${DAMAGE_SCHOOLS[s]} Damage`))
    const total = item.damage.reduce((sum, [lo, hi]) => sum + (lo + hi) / 2, 0)
    rows.push(line(`(${(total / item.speed).toFixed(1)} damage per second)`))
  }
  if (item.armor) rows.push(line(`${item.armor} Armor`))
  if (item.block) rows.push(line(`${item.block} Block`))
  for (const [stat, value] of Object.entries(item.stats ?? {})) rows.push(line(`${signed(value)} ${ITEM_STAT_NAMES[stat]}`))
  for (const [school, value] of Object.entries(item.resist ?? {})) rows.push(line(`${signed(value)} ${capitalize(school)} Resistance`))
  const classes = item.classes && maskNames(item.classes, CLASS_BITS)
  if (classes) rows.push(line(`Classes: ${classes}`))
  const races = item.races && maskNames(item.races, RACE_BITS)
  if (races) rows.push(line(`Races: ${races}`))
  if (item.requiredLevel) rows.push(line(`Requires Level ${item.requiredLevel}`))
  for (const effect of item.effects ?? []) rows.push(line(effect, 'tt-effect'))
  if (item.description) rows.push(line(`"${item.description}"`, 'tt-description'))
  return el('div', { class: 'tooltip', role: 'tooltip' }, rows)
}

function renderStats(character, s) {
  const group = (title, rows) => el('section', { class: 'stat-group' },
    el('h3', {}, title),
    el('dl', {}, rows.filter(Boolean).map(([label, value]) => [el('dt', {}, label), el('dd', {}, value)])),
  )
  const damage = (d) => `${Math.floor(d.min)} - ${Math.floor(d.max)}`
  const { melee, ranged, defenses, spell } = s
  const rates = character.rates
  const mount = mountOf(character)
  return el('section', { class: 'sheet-stats', 'aria-label': 'Stats' },
    group('Combat', [
      ['Power Level', Math.round(character.power.solo)],
      ['Item Level', Math.floor(character.itemLevel)],
      ['Gold', money(character.copper)],
      ['Damage / sec', rates?.beatable ? rates.dps.toFixed(1) : '—'],
      ['Combat / Eat', rates?.beatable ? `${Math.round(rates.fightSeconds)}s / ${Math.round(rates.eatSeconds)}s` : '—'],
      ['Food', foodFor(character.characterLevel).name],
      s.mana > 0 && ['Drink', drinkFor(character.characterLevel).name],
      ['Mount', mount ? `${mount.name} (+${Math.round((mount.speed - 1) * 100)}% speed)` : 'None'],
    ]),
    group('Farm', [
      ['Kills / hr', rates ? formatNumber(rates.killsPerHour) : '—'],
      ['Gold / hr', rates ? money(rates.copperPerHour) : '—'],
      ['XP / hr', rates?.xpPerHour > 0 ? formatNumber(rates.xpPerHour) : '—'],
    ]),
    group('Base Stats', [
      ...Object.entries(STAT_NAMES).map(([key, name]) => [name, s.stats[key].total]),
      ['Health', s.health],
      s.mana > 0 && ['Mana', s.mana],
    ]),
    group('Melee', [
      ['Damage', damage(melee.mainHand)],
      melee.offHand && ['Off Hand', damage(melee.offHand)],
      ['Speed', [melee.mainHand, melee.offHand].filter(Boolean).map((d) => d.speed.toFixed(2)).join(' / ')],
      ['DPS', melee.dps.toFixed(1)],
      ['Attack Power', Math.floor(melee.attackPower)],
      ['Crit Chance', pct(melee.crit)],
      ['Hit Bonus', pct(melee.hit)],
    ]),
    ranged ? group(ranged.isWand ? 'Wand' : 'Ranged', [
      ['Damage', damage(ranged)],
      ['Speed', ranged.speed.toFixed(2)],
      ['DPS', ranged.dps.toFixed(1)],
      !ranged.isWand && ['Attack Power', Math.floor(ranged.attackPower)],
      !ranged.isWand && ['Crit Chance', pct(ranged.crit)],
    ]) : group('Ranged', ['Damage', 'Speed', 'DPS', 'Attack Power', 'Crit Chance'].map((label) => [label, '—'])),
    group('Spell', [
      ['Bonus Damage', spell.damage],
      ...Object.entries(spell.schoolDamage).map(([school, value]) => [`${capitalize(school)} Damage`, `+${value}`]),
      ['Bonus Healing', spell.healing],
      ['Crit Chance', pct(spell.crit)],
      ['Hit Bonus', pct(spell.hit)],
      ['Mana Regen', s.mana > 0 ? `${Math.floor(spell.regen)} per 5 sec (not casting)` : '—'],
      spell.mp5 > 0 && ['Mana per 5 sec', spell.mp5],
    ]),
    group('Defense', [
      ['Armor', defenses.armor],
      ['Defense', defenses.defense],
      ['Dodge', pct(defenses.dodge)],
      ['Parry', pct(defenses.parry)],
      ['Block', pct(defenses.block)],
      defenses.blockValue > 0 && ['Block Value', defenses.blockValue],
      s.hp5 > 0 && ['Health per 5 sec', s.hp5],
      ['Health Regen', `${Math.floor(s.healthRegen)} per 5 sec (out of combat)`],
    ]),
    group('Resistances', SCHOOLS.map((school) => [capitalize(school), s.resist[school]])),
    group('Trained Spells', Object.entries(knownAbilities(character)).map(([name, id]) => [name, `Rank ${getSpell(id).rank ?? 1}`])),
    el('span', { class: 'info-mark', tabindex: 0, 'aria-label': 'How these numbers work', 'aria-describedby': 'stats-note' }, '!',
      el('span', { id: 'stats-note', class: 'tooltip', role: 'tooltip' }, 'Fights are simulated swing by swing and cast by cast, with the best rotation of the spells the character has trained and the gear it wears. After each fight the character eats and drinks back what they lost; health, mana, armor and spirit regen set how long that takes. Food and drink are the best vendor kind for their level, free. Each character keeps its own gold and buys new spell ranks as soon as it can afford them. Item level is the average of worn gear (empty slots count as 0). Farm rates are for grinding the current zone, before quest rewards. Stats include passive talents but not buffs.')),
  )
}

// What the character is doing right now, e.g. "Hunting Kobold Vermin (level 2) for "Kobold Camp Cleanup"."
function describeAction(character) {
  if (!character.zone) return 'Send this character to a zone to quest and collect loot.'
  const action = character.plannedAction
  if (!action) return `Nothing in ${character.zone} it can beat. Try an easier zone.`
  if (action.errand) {
    const where = action.errand.zone === null ? 'in town' : action.errand.zone === character.zone ? 'nearby' : `in ${action.errand.zone}`
    return `Picking up dungeon quests ${where}: ${action.errand.quests.map((id) => `"${getQuest(id).title}"`).join(', ')}.`
  }
  const title = action.questId && getQuest(action.questId).title
  if (!action.fight) return `Turning in "${title}".`
  const target = `${action.fight.mob.name} (level ${action.fight.level})`
  return title ? `Hunting ${target} for "${title}".` : `Grinding ${target}.`
}

function objectiveName(o) {
  if (o.item) return QUEST_ITEMS[o.item] ?? 'Quest item'
  return (getMob(o.id) ?? getMob(o.sources[0]))?.name ?? 'Kills'
}

function renderQuestLog(character) {
  const ids = character.activeQuests
  if (!ids.length) return el('p', { class: 'empty' }, `No quests left in ${character.zone} at this level.`)
  return el('ul', { class: 'quest-log' }, ids.map((id) => {
    const quest = getQuest(id)
    const counts = questProgress(character, id)
    const objectives = objectivesOf(id)
    return el('li', {},
      el('span', { class: 'quest-title' }, `[${quest.level}] ${quest.title}`),
      objectives.length
        ? el('ul', { class: 'quest-objectives' }, objectives.map((o, i) =>
          el('li', { class: counts[i] >= o.count ? 'done' : null }, `${objectiveName(o)}: ${counts[i]}/${o.count}`)))
        : el('span', { class: 'quest-objectives' }, quest.steps ? ` (errand, ${quest.steps} pickups)` : ' (errand)'),
    )
  }))
}

function renderRoute(character) {
  const here = routeZone(character)
  return [
    el('h3', {}, 'Leveling Path'),
    el('p', { class: 'note' }, `While farming below level ${MAX_LEVEL}, ${character.characterName} moves on at these levels or when a zone runs out of quests. Sending them elsewhere lasts until then.`),
    el('ol', { class: 'route' }, routeOf(character).map(([level, zone]) =>
      el('li', { class: [zone === here && 'route-step', zone === character.zone && 'route-here'].filter(Boolean).join(' ') || null },
        el('span', { class: 'route-level' }, String(level)), ` ${zone}`))),
  ]
}

function renderProgress(character) {
  return el('section', { class: 'sheet-panel', 'aria-label': 'Quests' },
    el('h3', {}, 'Questing'),
    el('p', {}, `${character.questsDone.length} quests completed. ${describeAction(character)}`),
    character.zone && renderQuestLog(character),
    renderRoute(character),
  )
}

// Dungeon queue, quests held and a Queue button for every dungeon the character can enter: ones in its
// level range first.
function renderDungeons(character, onQueue, onLeaveQueue) {
  const queue = character.dungeonQueue
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const pending = [...pendingQuests(character).entries()]
  const toPickUp = pending.reduce((n, [, ids]) => n + ids.length, 0)
  const enterable = DUNGEONS.filter((d) => !dungeonLockReason(character, d))
    .sort((a, b) => inRange(character, b) - inRange(character, a) || b.level[0] - a.level[0])
  const first = DUNGEONS.filter((d) => !d.faction || d.faction === character.faction).reduce((min, d) => Math.min(min, d.level[0]), MAX_LEVEL)
  return el('section', { class: 'sheet-panel sheet-dungeons', 'aria-label': 'Dungeons' },
    el('h3', {}, 'Dungeons'),
    queue
      ? el('p', { class: 'dungeon-status' },
        `Queued${queue.manual ? ' by hand' : ''} for ${queue.dungeons.join(', ')} (${formatDuration((Date.now() - queue.since) / 3600000)}). `,
        el('button', { type: 'button', class: 'button small', 'data-focus-key': 'leave-queue', onclick: () => onLeaveQueue?.() }, 'Leave queue'))
      : el('p', { class: 'dungeon-status' }, 'Not queued.'),
    toPickUp > 0 && el('p', { class: 'note' }, `${plural(toPickUp, 'dungeon quest')} to pick up (${pending.map(([zone, ids]) => `${ids.length} ${zone ?? 'in town'}`).join(', ')}) before it queues on its own.`),
    character.timeBank < 0 && el('p', { class: 'note' }, `Back from a dungeon run: farming again in ${formatDuration(-character.timeBank / 3600)}.`),
    enterable.length
      ? el('ul', { class: 'dungeon-picks' }, enterable.map((d) => {
        const held = heldQuests(character, d.name)
        const clears = character.dungeonClears[d.name] ?? 0
        return el('li', { class: inRange(character, d) ? 'in-range' : null },
          el('div', { class: 'dungeon-pick-head' },
            el('span', {}, el('strong', {}, d.name), ` ${d.level[0]}–${d.level[1]}`),
            isQueuedFor(character, d.name)
              ? el('span', { class: 'dungeon-queued' }, 'Queued')
              : el('button', { type: 'button', class: 'button small', 'data-focus-key': `queue-${d.name}`, onclick: () => onQueue?.(d.name) }, 'Queue'),
          ),
          el('span', { class: 'encounter-meta' }, [`${plural(held.length, 'quest')} held`, clears && `cleared ${clears}×`].filter(Boolean).join(' · ')),
          held.length > 0 && el('ul', { class: 'dungeon-quests' }, held.map((id) => el('li', {}, `[${getQuest(id).level}] ${getQuest(id).title}`))),
        )
      }))
      : el('p', { class: 'empty' }, `No dungeons until level ${first}.`),
  )
}

function renderLoot(character) {
  return el('section', { class: 'sheet-panel', 'aria-label': 'Recent loot' },
    el('h3', {}, 'Recent Loot'),
    character.lootLog.length
      ? el('ul', { class: 'loot-log' }, character.lootLog.map((entry) => {
        const item = getItem(entry.item)
        return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0 },
          el('span', { class: 'item-name' }, item.name),
          el('span', { class: 'loot-source' }, ` ${entry.quest ? `from "${entry.source}"` : entry.source === 'Drop' ? 'from a drop' : `from ${entry.source}`}${entry.equipped ? ', equipped' : ''}`),
          renderTooltip(item),
        )
      }))
      : el('p', { class: 'empty' }, 'Nothing yet.'),
  )
}

const PVP_RESULTS = { true: ['win', 'Killed'], false: ['loss', 'Died to'], null: ['draw', 'Walked away from'] }
const PVP_ESCAPES = { ran: 'Outran', hid: 'Hid from', hearth: 'Bubble-hearthed away from' }

function pvpDetail(e) {
  if (e.fled && e.fled !== 'hearth' && !e.caught) return `${e.zone}. Spotted them first and escaped.`
  const chance = e.odds !== undefined ? formatChance(e.odds) : null
  const start = e.joined ? 'Added to the fight.'
    : e.attacked ? `Opened on them: sized it up at ${formatChance(e.guess)}${chance ? `, really ${chance}` : ''}.`
      : e.caught ? `${e.fled === 'hid' ? 'Got found hiding' : 'Got chased down'}${chance ? `: ${chance} to win` : ''}.`
        : `${e.won === false ? 'Got ganked' : 'Got attacked'}${chance ? `: ${chance} to win` : ''}.`
  const brawl = e.size ? ` ${e.size[0]}v${e.size[1]} brawl, ${e.kills} kill${e.kills === 1 ? '' : 's'}.` : ''
  const honor = e.honor ? `, honorable kill${e.points !== undefined ? ` (${formatNumber(Math.floor(e.points))} honor)` : ''}` : ''
  return `${e.zone}${honor}. ${start}${brawl}`
}

function renderPvp(character) {
  const { honorableKills, honor, pvpKills, pvpDeaths, pvpLog } = character
  const tally = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, formatNumber(value)))
  return el('section', { class: 'sheet-panel sheet-pvp', 'aria-label': 'World PvP' },
    el('h3', {}, 'World PvP'),
    el('dl', { class: 'pvp-tally' },
      tally('Honor', Math.floor(honor)),
      tally('Honorable Kills', honorableKills),
      tally('Kills', pvpKills),
      tally('Deaths', pvpDeaths),
    ),
    pvpLog.length
      ? el('ul', { class: 'pvp-log' }, pvpLog.map((e) => {
        const [kind, verb] = PVP_RESULTS[e.won]
        const escaped = e.won === null && (e.fled === 'hearth' || (e.fled && !e.caught))
        return el('li', { class: `pvp-${kind}` },
          el('span', { class: 'pvp-headline' },
            el('span', {}, `${escaped ? PVP_ESCAPES[e.fled] : verb} ${e.foe}`, el('span', { class: 'pvp-foe' }, ` ${e.foeLevel} ${e.foeRace} ${e.foeClass}`)),
            el('span', { class: 'pvp-when' }, `${formatDuration((Date.now() - e.at) / 3600000)} ago`),
          ),
          el('span', { class: 'pvp-detail' }, pvpDetail(e)),
        )
      }))
      : el('p', { class: 'empty' }, 'No fights yet. Characters of opposite factions farming the same contested zone run into each other.'),
  )
}

// Bag items grouped by what they're kept for: each other spec's best gear, then gear for later levels.
function renderBag(character) {
  const offSpec = offSpecGear(character, [...Object.values(character.equipment), ...character.bag])
  const groups = new Map()
  for (const id of character.bag) {
    const label = offSpec.has(id) ? `Off-spec: ${offSpec.get(id).join(', ')}` : 'For later levels'
    groups.set(label, [...(groups.get(label) ?? []), id])
  }
  const order = [...groups.keys()].sort((a, b) => (a === 'For later levels') - (b === 'For later levels') || a.localeCompare(b))
  return el('section', { class: 'sheet-panel', 'aria-label': 'Bag' },
    el('h3', {}, 'Bag'),
    el('p', { class: 'note' }, 'The best gear for the character\'s other specs (switch specs on the ', el('a', { href: `#/character/${character.id}/talents` }, 'Talents'),
      ' page) and gear saved for when it\'s high enough level. Everything else is sold.'),
    character.bag.length
      ? order.map((label) => el('div', { class: 'bag-group' },
        el('h4', { class: label === 'For later levels' ? 'bag-label' : 'bag-label off-spec' }, label),
        el('ul', { class: 'bag' }, groups.get(label).map((id) => {
          const item = getItem(id)
          return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0, 'aria-label': `${item.name} (${label})` },
            renderIcon(item, item.name),
            renderTooltip(item),
          )
        }))))
      : el('p', { class: 'empty' }, 'Empty.'),
  )
}
