// Character sorting shared by the roster and farming pages.
import { el } from './dom.js'

const byName = (a, b) => a.characterName.localeCompare(b.characterName)

// Names and classes sort A to Z; numbers sort highest first. Ties fall back to name.
// DPS is against the current zone's mobs, so idle characters sort last.
export const SORTS = {
  name: { label: 'Name', compare: byName },
  level: { label: 'Level', compare: (a, b) => b.characterLevel - a.characterLevel },
  power: { label: 'Power level', compare: (a, b) => b.power.solo - a.power.solo },
  gold: { label: 'Gold', compare: (a, b) => b.copper - a.copper },
  dps: { label: 'DPS', compare: (a, b) => (b.rates?.dps ?? 0) - (a.rates?.dps ?? 0) },
  honor: { label: 'Honor', compare: (a, b) => b.honor - a.honor },
  hks: { label: 'Honorable kills', compare: (a, b) => b.honorableKills - a.honorableKills },
  class: { label: 'Class', compare: (a, b) => a.characterClass.localeCompare(b.characterClass) },
}
export const DEFAULT_SORT = 'name'

export function sortCharacters(characters, sortKey) {
  const compare = (Object.hasOwn(SORTS, sortKey) ? SORTS[sortKey] : SORTS[DEFAULT_SORT]).compare
  return [...characters].sort((a, b) => compare(a, b) || byName(a, b))
}

export function renderSortControl(sortKey, onSort) {
  return el('label', { class: 'sort-control' }, 'Sort by ',
    el('select', { 'data-focus-key': 'sort', onchange: (event) => onSort(event.target.value) },
      Object.entries(SORTS).map(([key, { label }]) => el('option', { value: key, selected: key === sortKey }, label))),
  )
}
