import { badge, characterName, el, formatChance, formatDuration, formatNumber, money } from './dom.js'
import { CLASS_BITS, DUNGEON_QUESTS, INVENTORY_TYPES, QUALITIES, QUEST_ITEMS, RACE_BITS, SLOTS, baseId, getItem, getQuest, itemTypeName, levelToUse, offSpecGear, questRewardsFor } from './gear.js'
import { SCHOOLS, STAT_NAMES, characterStats } from './stats.js'
import { drinkFor, foodFor, getMob, respawnWait } from './combat.js'
import { QUEST_LOG_SIZE, activeQuests, objectivesOf, questKills, questLogIds, questPlan, questProgress, questZone, rewardWorth, zoneQuestOffers } from './quests.js'
import { getSpell, knownAbilities, mountOf } from './spells.js'
import { renderTalentTile } from './talents-view.js'
import { talentKey } from './talents.js'
import { zoneOptions } from './leveling.js'
import { MAX_LEVEL } from './data.js'
import { DUNGEONS, autoDungeons, dungeonLockReason, dungeonLoot, dungeonValue, errandTrips, getDungeon, heldQuests, inRange, isQueuedFor, pendingQuests, runHours } from './dungeons.js'
import { grindTargets, grindValue, huntedMobs, itemPower, lootTargets, rewardGain, worth } from './value.js'
import { SEARCH_MIN_LENGTH, isWorldDrop, itemSources, owns, placeDrops, searchItems, wantable } from './wanted.js'
import { MAX_RANK, MIN_HONOR_KILLS, rankRange, rankTitle } from './honor.js'
import { RESET_DAYS, dayOf, periodOf, periodStart } from './reset.js'

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

// The character on the sheet and the handler that sets the item it wants, for item rows anywhere on it.
let sheet = { character: null, onWant: null }

export function renderCharacterSheet({ character, onDelete, onQueue, onLeaveQueue, onWant }) {
  sheet = { character, onWant }
  const stats = characterStats(character)
  const deleteDialog = renderDeleteDialog(character, onDelete)
  return el('section', { class: 'character-sheet', style: { '--class-color': character.classColor }, 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title' }, characterName(character)),
        el('p', { class: 'sheet-subtitle' }, `Level ${character.characterLevel} ${character.characterRace} ${character.characterSpec} ${character.characterClass}`),
        el('p', { class: 'sheet-subtitle sheet-status' }, character.farmStatus),
      ),
      el('div', { class: 'sheet-actions' },
        el('a', { class: 'button small', href: '#/roster' }, 'Back to roster'),
        el('button', { type: 'button', class: 'button small danger', onclick: () => deleteDialog.showModal() }, 'Delete'),
      ),
    ),
    el('div', { class: 'sheet-layout' },
      el('div', { class: 'sheet-column' },
        renderPaperDoll(character),
        renderPvp(character),
      ),
      el('div', { class: 'sheet-stack' },
        renderTalentTile(character),
        renderStats(character, stats),
      ),
    ),
    renderFocus(character),
    el('div', { class: 'sheet-layout' },
      el('div', { class: 'sheet-stack' },
        renderProgress(character),
        renderDungeons(character, onQueue, onLeaveQueue),
      ),
      el('div', { class: 'sheet-stack' },
        renderBag(character),
        renderLoot(character),
      ),
    ),
    deleteDialog,
  )
}

function renderDeleteDialog(character, onDelete) {
  const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'delete-title', 'aria-describedby': 'delete-text' },
    el('h3', { id: 'delete-title' }, 'Delete ', characterName(character), '?'),
    el('p', { id: 'delete-text' }, 'This permanently removes the character, their gear and progress. This can\'t be undone.'),
    el('div', { class: 'modal-actions' },
      el('button', { type: 'button', class: 'button', autofocus: true, onclick: () => dialog.close() }, 'Cancel'),
      el('button', { type: 'button', class: 'button danger', onclick: () => { dialog.close(); onDelete(character) } }, 'Delete character'),
    ),
  )
  return dialog
}

function renderPaperDoll(character) {
  const slot = (name, side) => renderSlot(SLOTS[name], getItem(character.equipment[name]), side, character.origins[character.equipment[name]])
  return el('section', { class: 'paper-doll', 'aria-label': 'Equipment' },
    el('ul', { class: 'slot-column left' }, LEFT.map((s) => slot(s, 'left'))),
    el('div', { class: 'doll-center' },
      el('img', { class: 'class-icon', src: character.classIcon, alt: '', width: 72, height: 72 }),
    ),
    el('ul', { class: 'slot-column right' }, RIGHT.map((s) => slot(s, 'right'))),
    el('ul', { class: 'slot-row' }, BOTTOM.map((s) => slot(s, 'bottom'))),
  )
}

function renderSlot(slotName, item, side, origin) {
  const quality = item ? QUALITIES[item.quality] : 'empty'
  return el('li', { class: `slot slot-${side} q-${quality}`, tabindex: item ? 0 : null, 'aria-label': item ? `${slotName}: ${item.name}` : `${slotName}: empty` },
    renderIcon(item, slotName),
    el('span', { class: 'slot-text' },
      el('span', { class: 'slot-name' }, slotName),
      el('span', { class: 'item-name' }, item ? item.name : 'Empty'),
    ),
    item && renderTooltip(item, origin),
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

// Classic-style item tooltip, with where the character got it (see Character.origins) when given.
export function renderTooltip(item, origin) {
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
  if (origin) rows.push(line(`${origin.quest ? 'Reward' : 'Dropped'} ${originText(origin)}, ${ago(origin.at)}`, 'tt-origin'))
  return el('div', { class: 'tooltip', role: 'tooltip' }, rows)
}

const ago = (at) => `${formatDuration((Date.now() - at) / 3600000)} ago`

// Where an item came from: "from Hogger in Elwynn Forest", "from "The Defias Brotherhood" in Westfall".
function originText({ source, place, quest }) {
  const from = quest ? `from "${source}"` : source === 'Drop' ? 'from a drop' : `from ${source}`
  return place && place !== source ? `${from} in ${place}` : from
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
  if (!action) return `Nothing in ${character.zone} it can beat; it moves to a zone it can farm next.`
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

// Every quest the character holds: the ones it's working on in its zone first, then other zone quests, then
// dungeon quests.
function renderQuestLog(character) {
  const ids = questLogIds(character)
  if (!ids.length) return el('p', { class: 'empty' }, 'No quests yet.')
  const working = new Set(character.activeQuests)
  const rank = (id) => (working.has(id) ? 0 : DUNGEON_QUESTS[id] ? 2 : 1)
  const where = (id) => (DUNGEON_QUESTS[id] ? DUNGEON_QUESTS[id].dungeon : questZone(id) ?? '')
  const sorted = [...ids].sort((a, b) => rank(a) - rank(b) || where(a).localeCompare(where(b)) || getQuest(a).level - getQuest(b).level)
  return el('ul', { class: 'quest-log focus-scroll', 'data-scroll-key': 'quest-log', onmouseover: placeTooltip, onfocusin: placeTooltip }, sorted.map((id) => {
    const quest = getQuest(id)
    const objectives = DUNGEON_QUESTS[id] ? [] : objectivesOf(id)
    const counts = objectives.length ? questProgress(character, id) : []
    return el('li', {},
      el('span', { class: 'quest-title' }, `[${quest.level}] ${quest.title}`), ' ',
      working.has(id) && badge('Working on'),
      el('span', { class: 'loot-source' }, DUNGEON_QUESTS[id] ? `Dungeon: ${where(id)}` : where(id)),
      objectives.length > 0 && el('ul', { class: 'quest-objectives' }, objectives.map((o, i) =>
        el('li', { class: counts[i] >= o.count ? 'done' : null }, `${objectiveName(o)}: ${counts[i]}/${o.count}`))),
      renderQuestRewards(character, [quest]),
    )
  }))
}

const QUEST_OFFERS = 10

// Quests the character could pick up now, the most worth on turn-in first: zone quests in zones open to
// it and dungeon quests for dungeons in its level range. Kept until what they depend on changes.
const offerCache = new WeakMap()
function questOffers(character) {
  const key = `${character.characterLevel}|${character.characterSpec}|${character.characterRole}|${Object.values(character.equipment).join()}|${talentKey(character)}|${character.questsDone.length}|${questLogIds(character).join()}|${character.wanted}|${character.mount}`
  const cached = offerCache.get(character)
  if (cached?.key === key) return cached.offers
  const dungeon = [...pendingQuests(character)].flatMap(([zone, ids]) => ids.map((id) => ({
    id, worth: rewardWorth(character, DUNGEON_QUESTS[id]), zone: `${DUNGEON_QUESTS[id].dungeon} (from ${zone ?? 'a city'})`,
  })))
  const least = character.characterLevel >= MAX_LEVEL ? 0.05 : 0.5 // shows as at least 0.1 power or 1 XP
  // One of each set of quests where finishing one rules out the others, and of quests giving the same gear
  // (the Argent Dawn's tiers).
  const seen = new Set()
  const offers = [...zoneQuestOffers(character), ...dungeon].filter((o) => o.worth >= least).sort((a, b) => b.worth - a.worth).filter(({ id }) => {
    const quest = getQuest(id)
    const keys = [quest.exclusive && `group ${quest.exclusive}`, (quest.reward || quest.choice) && `gear ${quest.reward ?? ''}|${quest.choice ?? ''}`].filter(Boolean)
    if (keys.some((k) => seen.has(k))) return false
    for (const k of keys) seen.add(k)
    return true
  }).slice(0, QUEST_OFFERS)
  offerCache.set(character, { key, offers })
  return offers
}

function renderQuestOffers(character) {
  const offers = questOffers(character)
  const maxed = character.characterLevel >= MAX_LEVEL
  return [
    el('h3', {}, 'Best Rewards'),
    el('p', { class: 'note' }, maxed
      ? 'Quests it could pick up now whose reward gear adds the most power. It takes a quest when doing it beats grinding there.'
      : 'Quests it could pick up now whose turn-in is worth the most: XP, with reward gear it would wear counted as XP. It takes a quest when doing it beats grinding there.'),
    offers.length
      ? el('ul', { class: 'focus-list' }, offers.map(({ id, worth: value, zone }) => {
        const quest = getQuest(id)
        return el('li', {},
          el('span', { class: 'quest-title' }, `[${quest.level}] ${quest.title}`), ' ',
          el('span', { class: 'route-level' }, maxed ? powerText(value) : `${formatNumber(Math.round(value))} XP`),
          el('span', { class: 'loot-source' }, zone),
          renderQuestRewards(character, [quest]),
        )
      }))
      : el('p', { class: 'empty' }, maxed ? 'No quest it could pick up has gear it would wear.' : 'No quests it could pick up right now.'),
  ]
}

function renderProgress(character) {
  return el('section', { class: 'sheet-panel sheet-quests', 'aria-label': 'Quests' },
    el('h3', {}, 'Questing'),
    el('p', {}, `${character.questsDone.length} quests completed. ${describeAction(character)}`),
    el('h3', {}, `Quest Log (${questLogIds(character).length}/${QUEST_LOG_SIZE})`),
    renderQuestLog(character),
    renderQuestOffers(character),
  )
}

// Worth per hour: XP below max level (gear counted as XP), power at max level.
const rateText = (character, value) =>
  (character.characterLevel >= MAX_LEVEL ? `${value.toFixed(1)} power/hr` : `${formatNumber(Math.round(value))} XP/hr`)
const powerText = (power) => `+${power.toFixed(1)} power`

// Each list scrolls; these cap how many rows it holds.
const FOCUS_QUESTS = 10
const FOCUS_ZONES = 6
const FOCUS_DUNGEONS = 8
const FOCUS_DROPS = 4 // per zone or dungeon
const FOCUS_QUEST_DROPS = 2 // from the kills a quest takes
// Rows worth listing: ones that show as at least +0.1 power, and the wanted item.
const shownFor = (character) => (target) => target.power >= 0.05 || baseId(target.id) === character.wanted

// Quest and dungeon lists leave out bind-on-equip world drops (any mob around their level may drop them)
// that would take more than LONG_SHOT_HOURS of doing that quest or running that dungeon, unless wanted;
// zone lists keep them. `hours` is how long one try (the quest, or a run) takes.
const LONG_SHOT_HOURS = 7 * 24
const notLongShot = (character, hours) => (target) =>
  baseId(target.id) === character.wanted || getItem(target.id).binds !== 2 || !isWorldDrop(target.id) || hours / target.chance <= LONG_SHOT_HOURS

// Tooltips in a scrolling list would be clipped by it, so they're fixed to the viewport next to the item.
function placeTooltip(event) {
  const slot = event.target.closest?.('.slot')
  const tip = slot?.querySelector(':scope > .tooltip')
  if (!tip) return
  const r = slot.getBoundingClientRect()
  const above = r.top > window.innerHeight / 2
  Object.assign(tip.style, {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`,
    top: above ? 'auto' : `${r.bottom + 8}px`,
    bottom: above ? `${window.innerHeight - r.top + 8}px` : 'auto',
  })
}
const focusScroll = (key, items) => el('ul', { class: 'focus-list focus-scroll', 'data-scroll-key': key, onmouseover: placeTooltip, onfocusin: placeTooltip }, items)

// The rows behind the lists, kept until what they depend on changes (the sheet re-renders on every event).
const focusCache = new WeakMap()
function focusRows(character) {
  const key = `${character.zone}|${character.characterLevel}|${character.characterSpec}|${character.characterRole}|${Object.values(character.equipment).join()}|${talentKey(character)}|${character.questsDone.length}|${character.dungeonQuests.join()}|${character.dungeonQueue?.dungeons.join() ?? ''}|${character.wanted}|${character.mount}`
  const cached = focusCache.get(character)
  if (cached?.key === key) return cached
  const zones = zoneOptions(character)
  const rows = { key, quests: focusQuests(character, zones), places: focusZones(character, zones), dungeons: focusDungeons(character) }
  focusCache.set(character, rows)
  return rows
}

// Quests worth doing that it's on here, then ones in other zones it weighs whose rewards it would wear.
function focusQuests(character, zones) {
  const rows = activeQuests(character, character.zone).map((id) => ({ id, zone: character.zone }))
  for (const { zone } of zones) {
    if (rows.length >= FOCUS_QUESTS) break
    if (zone === character.zone) continue
    for (const id of activeQuests(character, zone)) if (rewardGain(character, getQuest(id)) > 0) rows.push({ id, zone })
  }
  return rows.slice(0, FOCUS_QUESTS).map((row) => {
    const kills = questKills(character, row.id)
    const rares = kills.filter(([entry]) => respawnWait(entry)).map(([entry]) => `${getMob(entry).name} (about every ${formatDuration(respawnWait(entry) / 3600)})`)
    const hours = (questPlan(character, row.id)?.seconds ?? 0) / 3600
    return { ...row, rares, drops: lootTargets(character, kills).filter(shownFor(character)).filter(notLongShot(character, hours)) }
  })
}

// Its zone, then the other zones it weighs whose mobs drop upgrades, most worth first.
function focusZones(character, zones) {
  const shown = shownFor(character)
  const rows = [{ zone: character.zone, drops: grindTargets(character, character.zone).filter(shown) }]
  for (const { zone } of zones) {
    if (rows.length >= FOCUS_ZONES) break
    if (zone === character.zone) continue
    const drops = grindTargets(character, zone).filter(shown)
    if (drops.length) rows.push({ zone, drops })
  }
  return rows
}

// Dungeons it's queued for, then the others it can enter, clear and get upgrades from, most worth first.
function focusDungeons(character) {
  const shown = shownFor(character)
  const loot = (dungeon) => dungeonLoot(character, dungeon).filter(shown).filter(notLongShot(character, runHours(character, dungeon)))
  const queued = character.dungeonQueue?.dungeons ?? []
  const wanted = new Set(autoDungeons(character).map((d) => d.name))
  const rows = queued.map((name) => getDungeon(name)).map((dungeon) => ({ dungeon, tag: 'Queued', drops: loot(dungeon) }))
  const others = DUNGEONS.filter((d) => !queued.includes(d.name) && !dungeonLockReason(character, d))
    .map((d) => ({ dungeon: d, value: dungeonValue(character, d) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
  for (const { dungeon } of others) {
    if (rows.length >= FOCUS_DUNGEONS) break
    const held = heldQuests(character, dungeon.name).map((id) => DUNGEON_QUESTS[id])
    const drops = loot(dungeon)
    if (drops.length || held.some((q) => rewardGain(character, q) > 0)) {
      rows.push({ dungeon, tag: wanted.has(dungeon.name) && 'Wanted', drops })
    }
  }
  return rows.slice(0, FOCUS_DUNGEONS)
}

// What the character is farming for: the quests it works on, and the upgrades that make its zone and the
// dungeons it wants worth the time. It values a place by every upgrade that can drop there times its
// chance, counting only the best for each slot, so these are the items behind that worth, not a wish list.
function renderFocus(character) {
  const head = el('h3', {}, 'Farming For')
  if (!character.zone) {
    return el('section', { class: 'sheet-panel sheet-focus', 'aria-label': 'Farming for' }, head, renderWanted(character), el('p', { class: 'empty' }, 'Nothing while idle.'))
  }
  const maxed = character.characterLevel >= MAX_LEVEL
  const { quests, places, dungeons } = focusRows(character)
  const trips = [...errandTrips(character)]
  return el('section', { class: 'sheet-panel sheet-focus', 'aria-label': 'Farming for' },
    head,
    renderWanted(character),
    el('p', { class: 'note' }, maxed
      ? `At level ${MAX_LEVEL} only gear counts. A place is worth every upgrade that can drop there times its chance, counting only the best one for each slot; these are the items behind that worth.`
      : `XP first, with gear counted as the XP it helps earn (+1 power is worth ${formatNumber(Math.round(worth(character).gear))} XP now). A place is worth every upgrade that can drop there times its chance, counting only the best one for each slot; these are the items behind that worth.`),
    el('div', { class: 'focus-columns' },
      el('div', { class: 'focus-column' },
        el('h4', {}, 'Quests'),
        quests.length
          ? focusScroll('focus-quests', quests.map(({ id, zone, rares, drops }) => renderFocusQuest(character, getQuest(id), rateText(character, questPlan(character, id).rate), zone, rares, drops)))
          : el('p', { class: 'note' }, 'None worth more than grinding.'),
      ),
      el('div', { class: 'focus-column' },
        el('h4', {}, 'Zone drops'),
        focusScroll('focus-zones', places.map(({ zone, drops }) => renderFocusZone(character, zone, drops))),
      ),
      el('div', { class: 'focus-column' },
        el('h4', {}, 'Dungeons'),
        dungeons.length
          ? focusScroll('focus-dungeons', dungeons.map(({ dungeon, tag, drops }) => renderFocusDungeon(character, dungeon, tag, drops)))
          : el('p', { class: 'note' }, 'No upgrades from dungeons it can clear.'),
        trips.length > 0 && el('h4', {}, 'Quests to pick up'),
        trips.length > 0 && el('ul', { class: 'focus-list' }, trips.map(([zone, trip]) =>
          el('li', {}, `${zone ?? 'In town'}: `, trip.quests.map((id) => DUNGEON_QUESTS[id].title).join(', '), ' ',
            el('span', { class: 'route-level' }, `worth ${maxed ? trip.value.toFixed(1) : formatNumber(Math.round(trip.value))} ${maxed ? 'power' : 'XP'}`)))),
      ),
    ),
  )
}

// A quest it's working on: title, worth, the reward gear it would wear and the top upgrades its kills drop.
function renderFocusQuest(character, quest, detail, zone, rares, drops) {
  return el('li', {},
    el('span', { class: 'quest-title' }, `[${quest.level}] ${quest.title}`), ' ',
    el('span', { class: 'route-level' }, detail),
    zone && el('span', { class: 'loot-source' }, zone === character.zone ? `${zone} (here)` : zone),
    rares.length > 0 && el('span', { class: 'loot-source' }, `Waits on rare spawn: ${rares.join(', ')}`),
    renderQuestRewards(character, [quest]),
    drops.length > 0 && el('ul', { class: 'focus-drops' }, drops.slice(0, FOCUS_QUEST_DROPS).map((t) => renderTarget(t, 'quest'))),
  )
}

function renderFocusZone(character, zone, drops) {
  const hunted = huntedMobs(character, zone)
  return el('li', { class: 'focus-dungeon' },
    el('span', {}, el('span', { class: 'quest-title' }, zone), ' ', el('span', { class: 'route-level' }, rateText(character, grindValue(character, zone))),
      zone === character.zone && [' ', badge('Here')]),
    hunted.length > 0 && el('span', { class: 'loot-source' }, `Hunting: ${hunted.join(', ')}`),
    drops.length
      ? el('ul', { class: 'focus-drops' }, drops.slice(0, FOCUS_DROPS).map((t) => renderTarget(t, 'hour')))
      : el('span', { class: 'loot-source' }, 'No upgrades drop from its mobs.'),
    renderPlaceDrops(character, zone, 'focus'),
  )
}

// The quests' reward gear the character would wear, as rows like the drops: what each adds, and the quest
// it's from when `named` (rows not already under that quest). Most power first.
function renderQuestRewards(character, quests, named = false) {
  const rows = quests.flatMap((quest) => questRewardsFor(character, quest).map((id) => ({ id, quest, power: itemPower(character, id) })))
    .filter(shownFor(character))
    .sort((a, b) => b.power - a.power)
  return rows.length > 0 && el('ul', { class: 'focus-drops' }, rows.map(({ id, quest, power }) =>
    renderItemRow(id, named ? `${powerText(power)} · Quest: ${quest.title}` : powerText(power))))
}

function renderFocusDungeon(character, dungeon, tag, loot) {
  const held = heldQuests(character, dungeon.name).map((id) => DUNGEON_QUESTS[id])
  const drops = loot.slice(0, FOCUS_DROPS)
  return el('li', { class: 'focus-dungeon' },
    el('span', {}, el('span', { class: 'quest-title' }, dungeon.name), ' ', el('span', { class: 'route-level' }, rateText(character, dungeonValue(character, dungeon))),
      tag && [' ', badge(tag)]),
    held.length > 0 && el('span', { class: 'loot-source' }, `Quests held: ${held.map((q) => q.title).join(', ')}`),
    renderQuestRewards(character, held, true),
    drops.length > 0 && el('ul', { class: 'focus-drops' }, drops.map((t) => renderTarget(t, 'run'))),
    renderPlaceDrops(character, dungeon.name, 'focus'),
  )
}

// e.g. "12% per kill", "1 in 250 kills"; for a quest, the chance over the kills it still takes, e.g. "0.22% during quest"
const odds = (p, per) => per === 'quest'
  ? `${p >= 0.01 ? formatChance(p) : `${Number((p * 100).toPrecision(2))}%`} during quest`
  : p >= 0.01 ? `${formatChance(p)} per ${per}` : `1 in ${formatNumber(Math.round(1 / p))} ${per}s`

// An upgrade that can drop: what it adds, the chance to win one, and who drops it.
function renderTarget(target, per) {
  return renderItemRow(target.id, `${powerText(target.power)} · ${odds(target.chance, per)} · ${getMob(target.from)?.name ?? 'unknown'}`)
}

// An item as a row: icon, name, `meta` and its tooltip. Gear the character could go after is a toggle that
// sets it as the item it wants, or stops it wanting it on the wanted one.
function renderItemRow(key, meta) {
  const item = getItem(key)
  const { character, onWant } = sheet
  const id = baseId(key)
  const isWanted = character?.wanted === id
  const canWant = !!onWant && (isWanted || (wantable(character, id) !== undefined && !owns(character, id)))
  const name = `${item.name}${item.suffixes ? ' of ...' : ''}`
  const toggle = () => onWant(isWanted ? null : id)
  const action = !canWant ? '' : isWanted ? '. Wanted: press to stop going after it' : '. Press to have it go after this item'
  return el('li', {
    class: `slot slot-bottom q-${QUALITIES[item.quality]}${!canWant ? '' : isWanted ? ' wanted' : ' wantable'}`,
    tabindex: 0,
    role: canWant && 'button',
    'aria-pressed': canWant && String(isWanted),
    'aria-label': `${name}: ${meta}${action}`,
    'data-focus-key': canWant && `want-${id}`,
    onclick: canWant && toggle,
    onkeydown: canWant && ((e) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      toggle()
    }),
  },
    renderIcon(item, item.name),
    el('span', { class: 'slot-text' },
      el('span', { class: 'item-name' }, name, isWanted && [' ', badge('Wanted')]),
      el('span', { class: 'target-meta' }, meta)),
    renderTooltip(item),
  )
}

const WANT_SOURCES = 3 // mobs listed for the wanted item

// The item the character is set to go after and where it comes from, and a search for gear to set.
function renderWanted(character) {
  const id = character.wanted
  return el('div', { class: 'want-box' },
    el('h4', {}, 'Wanted item'),
    id
      ? renderWantedItem(character, id)
      : el('p', { class: 'note' }, 'None. Click gear it doesn\'t have (in these lists, quest rewards or a place\'s drops) or find it below to have it go after that item. It counts as a big upgrade: it heads where the odds are good and keeps leveling when they\'re long. One item at a time.'),
    renderSearch(character),
  )
}

function renderWantedItem(character, id) {
  const { mobs, quests, world } = itemSources(character, id)
  const need = levelToUse(character, getItem(id))
  const here = character.zone && grindTargets(character, character.zone).find((t) => baseId(t.id) === id)
  const sources = [
    ...mobs.slice(0, WANT_SOURCES).map((m) => `${m.name} (${m.places.join(', ')}): ${odds(m.n, 'kill')}`),
    mobs.length > WANT_SOURCES && `…and ${mobs.length - WANT_SOURCES} more mobs`,
    ...quests.map((q) => {
      const quest = getQuest(q)
      const place = quest.dungeon ?? quest.zone
      return `Quest: [${quest.level}] ${quest.title}${place ? ` (${place})` : ''}`
    }),
    world && 'World drop: any mob around its level may drop it',
  ].filter(Boolean)
  const meta = [
    need > character.characterLevel && `Wears at level ${need}`,
    character.zone && (here ? `${odds(here.chance, 'hour')} in ${character.zone}` : `None from ${character.zone}`),
  ].filter(Boolean).join(' · ')
  return [
    el('ul', { class: 'focus-drops' }, renderItemRow(id, meta || 'Wanted')),
    el('ul', { class: 'want-sources' }, sources.map((s) => el('li', {}, s))),
    el('p', { class: 'note' },
      el('button', { type: 'button', class: 'button small', 'data-focus-key': 'want-clear', onclick: () => sheet.onWant?.(null) }, 'Stop wanting it'),
      ' One item at a time.'),
  ]
}

// The search box's text, kept over re-renders while on the same character.
const search = { characterId: null, text: '' }

function renderSearch(character) {
  if (search.characterId !== character.id) Object.assign(search, { characterId: character.id, text: '' })
  const results = el('ul', { class: 'focus-drops want-results focus-scroll', 'data-scroll-key': 'want-results', onmouseover: placeTooltip, onfocusin: placeTooltip })
  const fill = () => {
    const query = search.text.trim()
    const ids = searchItems(character, query)
    results.hidden = !query
    results.replaceChildren(...(ids.length
      ? ids.map((id) => renderItemRow(id, searchMeta(character, id)))
      : [el('li', { class: 'note' }, query.length < SEARCH_MIN_LENGTH ? `Type at least ${SEARCH_MIN_LENGTH} letters.` : 'No gear it could go after by that name.')]))
  }
  const input = el('input', {
    type: 'search', class: 'want-search', placeholder: 'Find an item to want', 'aria-label': 'Find an item to want', autocomplete: 'off',
    'data-focus-key': 'want-search', oninput: (e) => { search.text = e.target.value; fill() },
  })
  input.value = search.text
  fill()
  return el('div', { class: 'want-finder' }, input, results)
}

function searchMeta(character, id) {
  const { mobs, quests, world } = itemSources(character, id)
  const source = mobs.length ? `${mobs[0].name} (${mobs[0].places[0]})` : quests.length ? `Quest: ${getQuest(quests[0]).title}` : world && 'World drop'
  return [`Level ${levelToUse(character, getItem(id))}`, owns(character, id) && 'Has it', source].filter(Boolean).join(' · ')
}

// Every piece of gear the place's mobs drop that the character could ever wear, filled in when opened.
// Which ones are open is kept over re-renders.
const openDrops = new Set()

function renderPlaceDrops(character, place, section) {
  const drops = placeDrops(character, place)
  if (!drops.length) return null
  const key = `${character.id}|${section}|${place}`
  const list = el('ul', { class: 'focus-drops place-drops', 'data-scroll-key': `drops-${section}-${place}`, onmouseover: placeTooltip, onfocusin: placeTooltip })
  const fill = () => {
    if (list.childElementCount) return
    list.append(...drops.map(({ id, entry, n }) => {
      const need = levelToUse(character, getItem(id))
      return renderItemRow(id, [odds(n, 'kill'), getMob(entry)?.name ?? 'unknown', need > character.characterLevel && `level ${need}`].filter(Boolean).join(' · '))
    }))
  }
  if (openDrops.has(key)) fill()
  return el('details', {
    class: 'place-drops-box',
    open: openDrops.has(key),
    ontoggle: (e) => {
      if (e.currentTarget.open) {
        openDrops.add(key)
        fill()
      } else openDrops.delete(key)
    },
  },
    el('summary', { 'data-focus-key': `drops-${section}-${place}` }, `All drops (${drops.length})`),
    list,
  )
}

// Dungeon queue, quests held and a Queue button for every dungeon the character can enter: ones in its
// level range first.
function renderDungeons(character, onQueue, onLeaveQueue) {
  const queue = character.dungeonQueue
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const pending = [...errandTrips(character)].map(([zone, trip]) => [zone, trip.quests])
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
    character.restingAfter && character.timeBank < 0 && el('p', { class: 'note' }, `Back from ${character.restingAfter}: farming again in ${formatDuration(-character.timeBank / 3600)}.`),
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
          renderPlaceDrops(character, d.name, 'dungeons'),
        )
      }))
      : el('p', { class: 'empty' }, `No dungeons until level ${first}.`),
  )
}

// How a loot list says why an item was kept (see Character.keptAs).
export const KEPT_TEXT = { 'equipped': 'equipped', 'wanted': 'wanted', 'later': 'in bag for later levels', 'off-spec': 'in bag for off-spec' }

function renderLoot(character) {
  return el('section', { class: 'sheet-panel', 'aria-label': 'Recent loot' },
    el('h3', {}, 'Recent Loot'),
    character.lootLog.length
      ? el('ul', { class: 'loot-log' }, character.lootLog.map((entry) => {
        const item = getItem(entry.item)
        return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0 },
          el('span', { class: 'item-name' }, item.name),
          el('span', { class: 'loot-source' }, ` ${originText(entry)}, ${ago(entry.at)}, ${KEPT_TEXT[entry.kept]}${entry.wanted && entry.kept !== 'wanted' ? ', wanted' : ''}`),
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

// PvP rank with progress to the next, and today's and the period's honor so far against the last period's.
function renderRank(character, now = Date.now()) {
  const { rank, rankPoints, highestRank, faction } = character
  const titled = (r) => `${rankTitle(faction, r)} (Rank ${r})`
  const [min, max] = rankRange(rank)
  const share = rank >= MAX_RANK ? 1 : (rankPoints - min) / (max - min)
  const icon = rank > 0 && el('img', {
    class: 'rank-icon', src: `${ICON_URL}achievement_pvp_${faction === 'Horde' ? 'h' : 'a'}_${String(rank).padStart(2, '0')}.jpg`,
    alt: '', width: 36, height: 36, loading: 'lazy', onerror: (e) => e.currentTarget.remove(),
  })
  const today = character.honorToday?.day === dayOf(now) ? character.honorToday : null
  const period = character.honorPeriod?.period === periodOf(now) ? character.honorPeriod : null
  const last = character.honorLastPeriod
  const row = (label, kills, points, standing) => el('tr', {}, el('th', { scope: 'row' }, label), el('td', {}, kills), el('td', {}, points), el('td', {}, standing))
  const resetIn = formatDuration((periodStart(periodOf(now) + 1) - now) / 3600000)
  return [
    el('div', { class: 'pvp-rank' },
      icon,
      el('div', { class: 'pvp-rank-text' },
        el('strong', {}, rank > 0 ? titled(rank) : 'No rank'),
        rank > 0 && el('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': 'Rank progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.floor(share * 100) },
          el('div', { class: 'xp-fill rank-fill', style: { width: `${share * 100}%` } })),
        el('span', { class: 'note' }, [
          rank >= MAX_RANK ? `${formatNumber(rankPoints)} rank points` : rank > 0 ? `${formatNumber(rankPoints)} / ${formatNumber(max)} rank points` : `Earn rank points with ${MIN_HONOR_KILLS} honorable kills in ${RESET_DAYS} days`,
          highestRank > rank && `highest ${titled(highestRank)}`,
          `resets in ${resetIn}`,
        ].filter(Boolean).join(' · ')),
      ),
    ),
    el('table', { class: 'pvp-days' },
      el('thead', {}, el('tr', {}, el('td', {}), el('th', { scope: 'col' }, 'HKs'), el('th', { scope: 'col' }, 'Honor'), el('th', { scope: 'col' }, 'Standing'))),
      el('tbody', {},
        row('Today', formatNumber(today?.kills ?? 0), formatNumber(today?.points ?? 0), '—'),
        row('Since reset', (period?.kills ?? 0) < MIN_HONOR_KILLS ? `${period?.kills ?? 0} / ${MIN_HONOR_KILLS}` : formatNumber(period.kills), formatNumber(period?.points ?? 0), '—'),
        row('Last reset', last ? formatNumber(last.kills) : '—', last ? formatNumber(last.points) : '—', last?.standing ? `#${last.standing}` : '—'),
      ),
    ),
  ]
}

function renderPvp(character) {
  const { honorableKills, honor, pvpKills, pvpDeaths, pvpLog } = character
  const tally = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, formatNumber(value)))
  return el('section', { class: 'sheet-panel sheet-pvp', 'aria-label': 'World PvP' },
    el('h3', {}, 'World PvP'),
    renderRank(character),
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
            el('span', {}, `${escaped ? PVP_ESCAPES[e.fled] : verb} `, characterName({ name: e.foe, class: e.foeClass }), el('span', { class: 'pvp-foe' }, ` ${e.foeLevel} ${e.foeRace} ${e.foeClass}`)),
            el('span', { class: 'pvp-when' }, ago(e.at)),
          ),
          el('span', { class: 'pvp-detail' }, pvpDetail(e)),
        )
      }))
      : el('p', { class: 'empty' }, 'No fights yet. Characters of opposite factions farming the same contested zone run into each other.'),
  )
}

// Bag items grouped by what they're kept for: items it got for wanting them, each other spec's best gear,
// then gear for later levels.
function renderBag(character) {
  const offSpec = offSpecGear(character, [...Object.values(character.equipment), ...character.bag])
  const worn = new Set(Object.values(character.equipment))
  const kept = character.kept.filter((key) => !worn.has(key))
  const groups = new Map(kept.length ? [['Wanted', kept]] : [])
  for (const id of character.bag) {
    const label = offSpec.has(id) ? `Off-spec: ${offSpec.get(id).join(', ')}` : 'For later levels'
    groups.set(label, [...(groups.get(label) ?? []), id])
  }
  const rank = (label) => (label === 'Wanted' ? -1 : label === 'For later levels' ? 1 : 0)
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return el('section', { class: 'sheet-panel', 'aria-label': 'Bag' },
    el('h3', {}, 'Bag'),
    el('p', { class: 'note' }, 'The best gear for the character\'s other specs (switch specs on the ', el('a', { href: `#/character/${character.id}/talents` }, 'Talents'),
      ' page), gear saved for when it\'s high enough level and items it got for wanting them. Everything else is sold.'),
    groups.size
      ? order.map((label) => el('div', { class: 'bag-group' },
        el('h4', { class: label === 'Wanted' ? 'bag-label wanted-label' : label === 'For later levels' ? 'bag-label' : 'bag-label off-spec' }, label),
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
