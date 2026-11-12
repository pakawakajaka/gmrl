import { el, formatDuration, formatNumber, money } from './dom.js'
import { CLASS_BITS, INVENTORY_TYPES, QUALITIES, QUEST_HOURS, RACE_BITS, SLOTS, getItem, itemTypeName } from './gear.js'
import { SCHOOLS, STAT_NAMES, characterStats } from './stats.js'

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

export function renderCharacterSheet({ character, onDelete }) {
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
      renderPaperDoll(character),
      renderStats(character, stats),
    ),
    el('div', { class: 'sheet-layout' },
      renderProgress(character),
      renderBag(character),
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
  return el('section', { class: 'sheet-stats', 'aria-label': 'Stats' },
    group('Power', [
      ['Power Level', Math.round(character.power.solo)],
      ['Item Level', Math.floor(character.itemLevel)],
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
      ['Attack Power', melee.attackPower],
      ['Crit Chance', pct(melee.crit)],
      ['Hit Bonus', pct(melee.hit)],
    ]),
    ranged ? group(ranged.isWand ? 'Wand' : 'Ranged', [
      ['Damage', damage(ranged)],
      ['Speed', ranged.speed.toFixed(2)],
      ['DPS', ranged.dps.toFixed(1)],
      !ranged.isWand && ['Attack Power', ranged.attackPower],
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
    ]),
    group('Resistances', SCHOOLS.map((school) => [capitalize(school), s.resist[school]])),
    el('p', { class: 'note' }, 'Power level sets farming speed. Item level is the average of worn gear (empty slots count as 0). Farm rates are for the current zone. Stats are without talents or buffs.'),
  )
}

function renderProgress(character) {
  const quest = character.currentQuest
  return el('section', { class: 'sheet-panel', 'aria-label': 'Quests and loot' },
    el('h3', {}, 'Questing'),
    el('p', {}, `${character.questsDone.length} quests completed.`),
    character.zone
      ? el('p', {}, quest
        ? `Working on "${quest.quest.title}" (${formatDuration((QUEST_HOURS - character.questProgress) / character.rates.speed)} left).`
        : `No quests with usable rewards left in ${character.zone} at this level.`)
      : el('p', {}, 'Send this character to a zone to quest and collect loot.'),
    el('h3', {}, 'Recent Loot'),
    character.lootLog.length
      ? el('ul', { class: 'loot-log' }, character.lootLog.map((entry) => {
        const item = getItem(entry.item)
        return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0 },
          el('span', { class: 'item-name' }, item.name),
          el('span', { class: 'loot-source' }, ` ${entry.source === 'Drop' ? 'from a drop' : `from "${entry.source}"`}${entry.equipped ? ', equipped' : ''}`),
          renderTooltip(item),
        )
      }))
      : el('p', { class: 'empty' }, 'Nothing yet.'),
  )
}

function renderBag(character) {
  return el('section', { class: 'sheet-panel', 'aria-label': 'Bag' },
    el('h3', {}, 'Bag'),
    el('p', { class: 'note' }, 'Gear saved for when the character is high enough level. Everything else is sold.'),
    character.bag.length
      ? el('ul', { class: 'bag' }, character.bag.map((id) => {
        const item = getItem(id)
        return el('li', { class: `slot slot-bottom q-${QUALITIES[item.quality]}`, tabindex: 0, 'aria-label': item.name },
          renderIcon(item, item.name),
          renderTooltip(item),
        )
      }))
      : el('p', { class: 'empty' }, 'Empty.'),
  )
}
