import { el } from './dom.js'
import { CHANGES } from './version.js'

// What's new (#/changes): every version's notes, newest first.
export function renderChanges() {
  return el('section', { class: 'changes', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, "What's New"),
      el('a', { class: 'button small', href: '#/roster' }, 'Back to roster'),
    ),
    el('ol', { class: 'change-list' }, CHANGES.map((change) => el('li', {},
      el('h3', {}, `v${change.version}`, el('span', { class: 'change-date' }, formatDate(change.date))),
      el('ul', {}, change.notes.map((note) => el('li', {}, note))),
    ))),
  )
}

// '2026-11-18' as e.g. "Nov 18, 2026", on that day wherever the player is.
function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
