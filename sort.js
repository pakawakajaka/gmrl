// Character sorting shared by the roster and farming pages.
import { el } from './dom.js'

const byName = (a, b) => a.characterName.localeCompare(b.characterName)

// Names and classes sort A to Z; level and power level sort highest first. Ties fall back to name.
export const SORTS = {
  name: { label: 'Name', compare: byName },
  level: { label: 'Level', compare: (a, b) => b.characterLevel - a.characterLevel },
  power: { label: 'Power level', compare: (a, b) => b.power.solo - a.power.solo },
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
