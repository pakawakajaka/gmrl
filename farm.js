import { badge, el, formatDuration, formatNumber, money } from './dom.js'
import { MAX_LEVEL } from './data.js'
import { CONTINENTS, ZONES, farmRates, getZone, zoneDifficulty, zoneLockReason } from './zones.js'

export function renderFarm({ account, selectedId, onSelect, onSend, onRecall }) {
  const selected = account.getCharacter(selectedId) ?? account.characters[0]
  const income = account.characters.reduce((sum, c) => sum + c.copperPerHour, 0)
  const farming = account.characters.filter((c) => c.zone).length

  return el('section', { class: 'farm', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, 'Farming'),
      el('p', { class: 'farm-income' },
        `${farming} of ${account.characters.length} farming · Income `, money(income), ' per hour'),
    ),
    selected
      ? [
          el('ul', { class: 'farm-characters', 'aria-label': 'Characters' },
            account.characters.map((c) => renderFarmer(c, c === selected, onSelect, onRecall))),
          renderZoneTables(account, selected, onSend, onRecall),
        ]
      : el('p', { class: 'empty' }, 'No characters to send. ', el('a', { href: '#/create' }, 'Create one'), '.'),
  )
}

// Updates the parts that change every tick (XP bars and time-to-level) without rebuilding the view.
export function updateFarm(root, account) {
  for (const character of account.characters) {
    const card = [...root.querySelectorAll('[data-character-id]')].find((e) => e.dataset.characterId === character.id)
    if (card) updateProgress(card, character)
  }
}

function renderFarmer(character, isSelected, onSelect, onRecall) {
  const name = character.characterName
  const zone = getZone(character.zone)
  const difficulty = zone ? zoneDifficulty(character, zone) : 'gray'
  const card = el('li', {
    class: `farmer difficulty-${difficulty}${isSelected ? ' selected' : ''}`,
    style: { '--class-color': character.classColor },
    'data-character-id': character.id,
  },
    el('button', {
      type: 'button',
      class: 'farmer-select',
      'aria-pressed': String(isSelected),
      'data-focus-key': `select-${character.id}`,
      onclick: () => onSelect(character.id),
    },
      el('span', { class: 'character-name', title: name }, name),
      el('img', { class: 'class-icon', src: character.classIcon, alt: '', width: 40, height: 40 }),
      el('span', { class: 'farmer-info' },
        el('span', { class: 'farmer-level' }, `Level ${character.characterLevel} ${character.characterClass}`),
        el('span', { class: 'farmer-level' }, `Power level ${formatNumber(Math.round(character.power.solo))}`),
        el('span', { class: 'farmer-zone' }, character.zone ?? 'Idle',
          zone && el('span', { class: 'visually-hidden' }, ` (${difficulty} difficulty)`)),
      ),
    ),
    el('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': `${name} experience`, 'aria-valuemin': 0 },
      el('div', { class: 'xp-fill' })),
    el('p', { class: 'farmer-stats' },
      el('span', { class: 'xp-text' }),
      el('span', { class: 'eta' }),
    ),
    el('a', { class: 'farmer-gear', href: `#/character/${character.id}`, 'aria-label': `Character page for ${name}` }, 'Character page'),
    character.zone && el('button', {
      type: 'button',
      class: 'button small subtle farmer-recall',
      'aria-label': `Recall ${name} from ${character.zone}`,
      onclick: () => onRecall(character.id),
    }, 'Recall'),
  )
  updateProgress(card, character)
  return card
}

function updateProgress(card, character) {
  const bar = card.querySelector('.xp-bar')
  const xpText = card.querySelector('.xp-text')
  const eta = card.querySelector('.eta')

  if (character.characterLevel >= MAX_LEVEL) {
    bar.setAttribute('aria-valuemax', 1)
    bar.setAttribute('aria-valuenow', 1)
    card.querySelector('.xp-fill').style.width = '100%'
    xpText.textContent = 'Max level'
    eta.textContent = ''
    return
  }

  const needed = character.xpToNextLevel
  const xp = Math.floor(character.characterXp)
  bar.setAttribute('aria-valuemax', needed)
  bar.setAttribute('aria-valuenow', xp)
  card.querySelector('.xp-fill').style.width = `${(xp / needed) * 100}%`
  xpText.textContent = `${formatNumber(xp)} / ${formatNumber(needed)} XP`
  eta.textContent = !character.zone ? ''
    : character.xpPerHour > 0 ? `Level ${character.characterLevel + 1} in ${formatDuration(character.hoursToLevel)}`
      : 'No XP here'
}

function renderZoneTables(account, character, onSend, onRecall) {
  return el('div', { class: 'zone-tables' },
    el('p', { class: 'zone-intro' },
      'Send ', el('strong', { style: { color: character.classColor } }, character.characterName),
      ` (level ${character.characterLevel} ${character.faction}, power level ${formatNumber(Math.round(character.power.solo))}, item level ${formatNumber(character.itemLevel)}) to farm. `,
      'Power level against the mobs sets the kill speed, which scales XP and gold. ',
      'XP falls off as mobs drop below your level and stops once they turn gray; gold keeps coming.'),
    el('div', { class: 'continents' }, CONTINENTS.map((continent) => el('section', { class: 'continent', 'aria-labelledby': `continent-${continent.replace(/\W/g, '')}` },
      el('h3', { id: `continent-${continent.replace(/\W/g, '')}` }, continent),
      el('div', { class: 'table-scroll' },
        el('table', { class: 'zone-table' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Zone'),
            el('th', { scope: 'col' }, 'Faction'),
            el('th', { scope: 'col', class: 'num' }, 'Levels'),
            el('th', { scope: 'col', class: 'num' }, 'XP / hr'),
            el('th', { scope: 'col', class: 'num' }, 'Gold / hr'),
            el('th', { scope: 'col' }, 'Farming here'),
            el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Action')),
          )),
          el('tbody', {}, ZONES.filter((z) => z.continent === continent)
            .map((zone) => renderZoneRow(account, character, zone, onSend, onRecall))),
        ),
      ),
    ))),
  )
}

function renderZoneRow(account, character, zone, onSend, onRecall) {
  const lockReason = zoneLockReason(character, zone)
  const isHere = character.zone === zone.name
  const rates = farmRates(character, zone)
  const speed = `Kill speed ×${rates.speed.toFixed(2)} (power level vs level ${rates.mobLevel} mobs)`
  const xpNote = character.characterLevel >= MAX_LEVEL ? 'Max level'
    : rates.xpFactor === 0 ? 'Gray: no XP'
      : rates.xpFactor < 1 ? `XP ×${rates.xpFactor.toFixed(2)} (mobs below your level)` : null
  const farmers = account.characters.filter((c) => c.zone === zone.name)
  const focusKey = `zone-${zone.name}`

  let action
  if (isHere) {
    action = el('button', { type: 'button', class: 'button small subtle', 'data-focus-key': focusKey, onclick: () => onRecall(character.id) }, 'Recall')
  } else if (lockReason) {
    action = el('span', { class: 'lock-reason' }, lockReason)
  } else {
    action = el('button', {
      type: 'button',
      class: 'button small primary',
      'data-focus-key': focusKey,
      'aria-label': `Send ${character.characterName} to ${zone.name}`,
      onclick: () => onSend(character.id, zone.name),
    }, 'Send')
  }

  return el('tr', { class: [isHere && 'current', lockReason && 'locked'].filter(Boolean).join(' ') || null },
    el('th', { scope: 'row' }, zone.name),
    el('td', {}, badge(zone.faction)),
    el('td', { class: 'num' }, zone.minLevel === zone.maxLevel ? String(zone.minLevel) : `${zone.minLevel}–${zone.maxLevel}`),
    el('td', { class: `num${xpNote ? ' reduced' : ''}`, title: [speed, xpNote].filter(Boolean).join('. ') },
      rates.xpPerHour > 0 ? formatNumber(rates.xpPerHour) : '—'),
    el('td', { class: 'num', title: speed }, money(rates.copperPerHour)),
    el('td', { class: 'zone-farmers' }, farmers.length
      ? farmers.map((c, i) => [i > 0 && ', ', el('span', { style: { color: c.classColor } }, c.characterName)])
      : ''),
    el('td', { class: 'zone-action' }, action),
  )
}
