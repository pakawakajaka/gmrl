import { badge, el, formatDuration, formatNumber, money } from './dom.js'
import { MAX_LEVEL } from './data.js'
import { CONTINENTS, ZONES, getZone, zoneDifficulty, zoneLockReason } from './zones.js'
import { farmRates } from './combat.js'
import { grindPlan, huntedMobs } from './value.js'
import { renderSortControl, sortCharacters } from './sort.js'
import { LEAVE_START_LEVEL, zoneOptions } from './leveling.js'
import { renderGuildFilter } from './roster.js'

export function renderFarm({ account, selectedGuild, selectedId, sortKey, onSelectGuild, onSelect, onSort, onSend, onRecall }) {
  const guild = account.getGuild(selectedGuild)
  const characters = guild ? guild.characters : account.characters
  const selected = characters.find((c) => c.id === selectedId) ?? characters[0]
  const farming = characters.filter((c) => c.zone).length
  const createHref = guild ? `#/create/${guild.id}` : '#/create'

  return el('section', { class: 'farm', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, 'Farming'),
      el('p', { class: 'farm-income' },
        `${farming} of ${characters.length} farming`),
    ),
    renderGuildFilter(account, guild, onSelectGuild),
    selected
      ? [
          el('div', { class: 'list-toolbar' }, renderSortControl(sortKey, onSort)),
          el('ul', { class: 'farm-characters', 'aria-label': 'Characters' },
            sortCharacters(characters, sortKey).map((c) => renderFarmer(c, c === selected, onSelect, onRecall))),
          renderZoneTables(account, selected, onSend, onRecall),
        ]
      : el('p', { class: 'empty' }, 'No characters to send. ', el('a', { href: createHref }, 'Create one'), '.'),
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
        (character.honorableKills > 0 || character.pvpDeaths > 0) && el('span', { class: 'farmer-level' },
          `${character.rank > 0 ? `${character.rankTitle} · ` : ''}${formatNumber(character.honorableKills)} HK · ${formatNumber(Math.floor(character.honor))} honor · ${formatNumber(character.pvpDeaths)} PvP death${character.pvpDeaths === 1 ? '' : 's'}`),
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
      : character.rates.beatable ? 'No XP here' : 'Mobs too strong'
}

function renderZoneTables(account, character, onSend, onRecall) {
  const best = zoneOptions(character)[0]
  return el('div', { class: 'zone-tables' },
    el('p', { class: 'zone-intro' },
      'Send ', el('strong', { style: { color: character.classColor } }, character.characterName),
      ` (level ${character.characterLevel} ${character.faction}, power level ${formatNumber(Math.round(character.power.solo))}, item level ${formatNumber(character.itemLevel)}) to farm. `,
      el('span', { class: 'quest-hint', tabindex: 0, 'aria-label': 'How farming rates work', 'aria-describedby': 'farm-rules' },
        el('span', { class: 'quest-mark', 'aria-hidden': 'true' }, '!'),
        el('span', { class: 'hint-text', id: 'farm-rules', role: 'tooltip' },
          'Characters fight the mobs in their zone, simulated with their gear and the best rotation of the spells they have trained, ',
          'and they eat and drink back up after (free vendor food and water for their level; health, mana, armor and spirit regen set how long). Quests come first: they take the ones worth more than grinding, hunt whatever those need, ',
          'then grind the mobs most worth their time: everything they can beat, or just the best kinds when that pays for walking past the rest. Rates here are for grinding; quest XP, gold and gear come on top. ',
          'XP falls off as mobs drop below your level and stops once they turn gray; gold keeps coming. ',
          `New characters start in their race's starting zone and stay in a starting zone (theirs, or another they're sent to) until level ${LEAVE_START_LEVEL}. Farming characters then go where their time is worth most (the zone marked Best): below level ${MAX_LEVEL} that's mostly XP, with gear they'd wear counted in; at ${MAX_LEVEL} it's gear. They look again when they level up, run out of quests worth doing, or can't beat anything; at ${MAX_LEVEL} also after each upgrade. Sending one elsewhere lasts until then.`),
      )),
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
            .map((zone) => renderZoneRow(account, character, zone, best, onSend, onRecall))),
        ),
      ),
    ))),
  )
}

function renderZoneRow(account, character, zone, best, onSend, onRecall) {
  const lockReason = zoneLockReason(character, zone)
  const isHere = character.zone === zone.name
  const rates = farmRates(character, zone, grindPlan(character, zone.name))
  const [lo, hi] = rates.mobLevels ?? []
  const hunted = huntedMobs(character, zone.name)
  const fights = !rates.beatable ? 'Mobs here are too strong'
    : `${hunted.length ? `Hunting ${hunted.join(', ')}. ` : ''}Level ${lo === hi ? lo : `${lo}–${hi}`} mobs: ${Math.round(rates.fightSeconds)}s fights, ${Math.round(rates.eatSeconds)}s eating, ${formatNumber(rates.killsPerHour)} kills/hr`
  const xpNote = character.characterLevel >= MAX_LEVEL ? 'Max level'
    : rates.beatable && rates.xpPerHour === 0 ? 'Gray: no XP' : null
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
    el('th', { scope: 'row', class: 'zone-name' }, zone.name, best?.zone === zone.name
      ? el('span', { class: 'path-mark', title: `Where ${character.characterName}'s time is worth most right now, counting the trip` }, 'Best')
      : null),
    el('td', { class: 'zone-faction' }, badge(zone.faction)),
    el('td', { class: 'num zone-levels' }, zone.minLevel === zone.maxLevel ? String(zone.minLevel) : `${zone.minLevel}–${zone.maxLevel}`),
    el('td', { class: `num zone-xp${xpNote || !rates.beatable ? ' reduced' : ''}`, title: [fights, xpNote].filter(Boolean).join('. ') },
      rates.xpPerHour > 0 ? formatNumber(rates.xpPerHour) : '—'),
    el('td', { class: 'num zone-gold', title: fights }, rates.beatable ? money(rates.copperPerHour) : '—'),
    el('td', { class: 'zone-farmers' }, farmers.length
      ? farmers.map((c, i) => [i > 0 && ', ', el('span', { style: { color: c.classColor } }, c.characterName)])
      : null),
    el('td', { class: 'zone-action' }, action),
  )
}
