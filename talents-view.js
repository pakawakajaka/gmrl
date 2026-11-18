// The talent selector: the class's three trees, with the spec's default build highlighted. Click a talent
// to add a point, right-click (or Shift+click, the - key, or touch and hold) to take one back.
import { characterName, el } from './dom.js'
import { TALENTS } from './gear-data.js'
import { specOptions } from './gear.js'
import { POINTS_PER_ROW, canLearn, canUnlearn, defaultBuild, pointsSpent, talentPoints, talentSupport } from './talents.js'

const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/large/'
// Each talent tree's icon in Classic (TalentTab.dbc), by class and spec.
const SPEC_ICONS = {
  Warrior: { Arms: 'ability_rogue_eviscerate', Fury: 'ability_warrior_innerrage', Protection: 'inv_shield_06' },
  Paladin: { Holy: 'spell_holy_holybolt', Protection: 'spell_holy_devotionaura', Retribution: 'spell_holy_auraoflight' },
  Hunter: { 'Beast Mastery': 'ability_hunter_beasttaming', Marksmanship: 'ability_marksmanship', Survival: 'ability_hunter_swiftstrike' },
  Rogue: { Assassination: 'ability_rogue_eviscerate', Combat: 'ability_backstab', Subtlety: 'ability_stealth' },
  Priest: { Discipline: 'spell_holy_wordfortitude', Holy: 'spell_holy_holybolt', Shadow: 'spell_shadow_shadowwordpain' },
  Shaman: { Elemental: 'spell_nature_lightning', Enhancement: 'spell_nature_lightningshield', Restoration: 'spell_nature_magicimmunity' },
  Mage: { Arcane: 'spell_holy_magicalsentry', Fire: 'spell_fire_firebolt02', Frost: 'spell_frost_frostbolt02' },
  Warlock: { Affliction: 'spell_shadow_deathcoil', Demonology: 'spell_shadow_metamorphosis', Destruction: 'spell_shadow_rainoffire' },
  Druid: { Balance: 'spell_nature_starfall', 'Feral Combat': 'ability_racial_bearform', Restoration: 'spell_nature_healingtouch' },
}
const SUPPORT = {
  full: 'Simulated in fights.',
  partial: 'Partly simulated in fights.',
  none: 'Not simulated in fights.',
}

// Touch and hold removes a point (iPhones have no long-press right-click). The view re-renders after each
// change, so the press is tracked here rather than on the button.
const HOLD_MS = 500
let hold = null
let held = false
const endHold = () => {
  clearTimeout(hold?.timer)
  hold = null
}

// Points per tree, e.g. [31, 0, 20].
export const treePoints = (character) =>
  (TALENTS[character.characterClass] ?? []).map((tree) => tree.talents.reduce((sum, t) => sum + (character.talents[t.key] ?? 0), 0))

// True if the character's talents are exactly its spec's default build so far (every spent point is a
// default one).
export function followsDefault(character) {
  const build = defaultBuild(character.characterClass, character.characterSpec)
  return Object.entries(character.talents).every(([key, rank]) => rank <= (build[key] ?? 0))
}

// Small summary tile for the character sheet.
export function renderTalentTile(character) {
  const total = talentPoints(character.characterLevel)
  const unspent = total - pointsSpent(character.talents)
  const href = `#/character/${character.id}/talents`
  const spec = character.characterSpec
  const icon = SPEC_ICONS[character.characterClass]?.[spec]
  const badge = el('span', { class: 'spec-icon', 'aria-hidden': 'true' }, el('span', { class: 'icon-fallback' }, spec.charAt(0)))
  if (icon) {
    const img = el('img', { src: `${ICON_URL}${icon}.jpg`, alt: '', width: 40, height: 40, onerror: () => img.remove() })
    badge.append(img)
  }
  return el('section', { class: 'sheet-panel talent-tile', 'aria-labelledby': 'talent-tile-title' },
    el('h3', { id: 'talent-tile-title' }, 'Talents'),
    el('div', { class: 'talent-tile-body' },
      badge,
      el('div', {},
        el('p', { class: 'talent-tile-spec' }, spec),
        total
          ? el('p', {}, `${treePoints(character).join(' / ')} · ${followsDefault(character) ? `${spec} default build` : 'Custom build'}${unspent ? ` · ${unspent} unspent` : ''}`)
          : el('p', { class: 'empty' }, 'Talent points start at level 10.'),
      ),
      el('a', { class: 'button small', href }, 'Open talents'),
    ),
  )
}

export function renderTalents({ character, onLearn, onUnlearn, onReset, onDefault, onSpec }) {
  const cls = character.characterClass
  const total = talentPoints(character.characterLevel)
  const unspent = total - pointsSpent(character.talents)
  const defaults = defaultBuild(cls, character.characterSpec)
  const counts = treePoints(character)
  const options = specOptions(cls)
  const current = options.findIndex((o) => o.spec === character.characterSpec && o.role === character.characterRole)
  return el('section', { class: 'talents-view', style: { '--class-color': character.classColor }, 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title' }, characterName(character), '\'s Talents'),
        el('p', { class: 'sheet-subtitle' }, `Level ${character.characterLevel} ${character.characterSpec} ${character.characterClass} · ${counts.join(' / ')} · `,
          el('strong', { class: 'talent-points-left' }, `${unspent} point${unspent === 1 ? '' : 's'} left`)),
      ),
      el('div', { class: 'sheet-actions' },
        el('a', { class: 'button small', href: `#/character/${character.id}` }, 'Back to character'),
        el('label', { class: 'spec-picker' }, 'Spec ',
          el('select', {
            'data-focus-key': 'talents-spec',
            onchange: (event) => onSpec(options[Number(event.currentTarget.value)]),
          }, options.map((o, i) => el('option', { value: String(i), selected: i === current }, o.label)))),
        el('button', { type: 'button', class: 'button small', 'data-focus-key': 'talents-default', onclick: onDefault }, 'Use default build'),
        el('button', { type: 'button', class: 'button small danger', 'data-focus-key': 'talents-reset', disabled: !pointsSpent(character.talents), onclick: onReset }, 'Reset'),
      ),
    ),
    el('p', { class: 'note talent-help' },
      el('span', { class: 'talent-legend' }), ` Gold ring: the ${character.characterSpec} default build (dashed until learned), which idle leveling spends new points on. `,
      'Click a talent to add a point; right-click, Shift+click or press - to remove one. On a phone, tap to add and touch and hold to remove. Changing talents is free, and so is changing spec: it respends on the new spec\'s default build and swaps in its gear from the bag.'),
    el('div', { class: 'talent-trees' }, (TALENTS[cls] ?? []).map((tree, i) =>
      renderTree(character, tree, counts[i], defaults, unspent, onLearn, onUnlearn))),
  )
}

function renderTree(character, tree, spent, defaults, unspent, onLearn, onUnlearn) {
  const rows = Math.max(...tree.talents.map((t) => t.row)) + 1
  const at = (row, col) => tree.talents.find((t) => t.row === row && t.col === col)
  const arrows = tree.talents.filter((t) => t.prereq).map((t) => {
    const [row, col] = t.prereq
    const done = (character.talents[at(row, col)?.key] ?? 0) >= (at(row, col)?.max ?? 1)
    const style = row === t.row
      ? { 'grid-row': `${row + 1}`, 'grid-column': `${Math.min(col, t.col) + 1} / ${Math.max(col, t.col) + 2}` }
      : { 'grid-row': `${row + 1} / ${t.row + 2}`, 'grid-column': `${col + 1}` }
    const direction = row === t.row ? (t.col > col ? 'across right' : 'across left') : 'down'
    return el('span', { class: `talent-arrow ${direction}${done ? ' met' : ''}`, style, 'aria-hidden': 'true' })
  })
  return el('section', { class: 'talent-tree', 'aria-label': `${tree.name}, ${spent} points` },
    el('h3', {}, tree.name, el('span', { class: 'tree-points' }, ` ${spent}`)),
    el('div', { class: 'talent-grid', style: { 'grid-template-rows': `repeat(${rows}, auto)` } },
      arrows,
      tree.talents.map((t) => renderTalent(character, t, tree, defaults[t.key] ?? 0, unspent, onLearn, onUnlearn)),
    ),
  )
}

function renderTalent(character, t, tree, defaultRank, unspent, onLearn, onUnlearn) {
  const rank = character.talents[t.key] ?? 0
  const learnable = canLearn(character, t.key)
  const state = rank >= t.max ? 'maxed' : rank > 0 ? 'learned' : learnable ? 'available' : 'locked'
  const remove = (event) => {
    event.preventDefault()
    if (canUnlearn(character, t.key)) onUnlearn(t.key)
  }
  const line = (text, cls) => el('p', { class: cls }, text)
  const needs = []
  const above = tree.talents.filter((o) => o.row < t.row).reduce((sum, o) => sum + (character.talents[o.key] ?? 0), 0)
  if (above < t.row * POINTS_PER_ROW) needs.push(`Requires ${t.row * POINTS_PER_ROW} points in ${tree.name} Talents`)
  const pre = t.prereq && tree.talents.find((o) => o.row === t.prereq[0] && o.col === t.prereq[1])
  if (pre && (character.talents[pre.key] ?? 0) < pre.max) needs.push(`Requires ${pre.max} point${pre.max === 1 ? '' : 's'} in ${pre.name}`)
  const tooltip = el('div', { class: 'tooltip', role: 'tooltip' },
    line(t.name, 'tt-name'),
    line(`Rank ${rank}/${t.max}`),
    needs.map((n) => line(n, 'tt-requires')),
    rank > 0 && line(t.ranks[rank - 1].desc, 'tt-desc'),
    rank < t.max && [rank > 0 && line('Next rank:', 'tt-next'), line(t.ranks[rank].desc, 'tt-desc')],
    defaultRank > 0 && line(`Default build: ${defaultRank}/${t.max}`, 'tt-default'),
    line(SUPPORT[talentSupport(character.characterClass, t.key)], `tt-support support-${talentSupport(character.characterClass, t.key)}`),
    learnable ? line('Click to learn', 'tt-hint') : !unspent && rank < t.max && line('No points left', 'tt-hint'),
  )
  const icon = el('span', { class: 'talent-icon', 'aria-hidden': 'true' }, el('span', { class: 'icon-fallback' }, t.name.charAt(0)))
  const img = el('img', { src: `${ICON_URL}${encodeURIComponent(t.icon)}.jpg`, alt: '', width: 36, height: 36, loading: 'lazy', onerror: () => img.remove() })
  icon.append(img)
  return el('button', {
    type: 'button',
    class: `talent ${state}${defaultRank ? ' default' : ''}${t.col >= 2 ? ' tip-left' : ''}`,
    style: { 'grid-row': `${t.row + 1}`, 'grid-column': `${t.col + 1}` },
    'aria-label': `${t.name}, rank ${rank} of ${t.max}${defaultRank ? `, default build ${defaultRank}` : ''}`,
    'aria-disabled': !learnable && !rank ? 'true' : null,
    'data-focus-key': `talent-${t.key}`,
    'data-talent': t.key,
    onclick: (event) => {
      // The finger lifting after a hold still clicks; that tap shouldn't add the point straight back.
      if (held) return void (held = false)
      if (event.shiftKey) remove(event)
      else if (learnable) onLearn(t.key)
    },
    // Android turns a long press into a right-click, so whichever of it and the timer comes first wins.
    oncontextmenu: (event) => {
      if (held) return event.preventDefault()
      if (hold) {
        endHold()
        held = true
      }
      remove(event)
    },
    onpointerdown: (event) => {
      held = false
      endHold()
      if (event.pointerType !== 'touch') return
      hold = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
        hold = null
        held = true
        if (canUnlearn(character, t.key)) onUnlearn(t.key)
      }, HOLD_MS) }
    },
    onpointermove: (event) => {
      if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) endHold()
    },
    onpointerup: endHold,
    onpointercancel: endHold,
    onkeydown: (event) => {
      if (event.key === '-' || event.key === 'Delete' || event.key === 'Backspace') remove(event)
    },
  },
  icon,
  el('span', { class: 'talent-rank' }, `${rank}/${t.max}`),
  tooltip,
  )
}
