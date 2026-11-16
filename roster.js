import { badge, el, formatNumber } from './dom.js'
import { FACTIONS, ROLES } from './data.js'
import { renderSortControl, sortCharacters } from './sort.js'

export function renderRoster({ account, selectedGuild, sortKey, onSelectGuild, onSort, onSaveToFile }) {
  const guild = account.getGuild(selectedGuild)
  const characters = sortCharacters(guild ? guild.characters : account.characters, sortKey)
  const createHref = guild ? `#/create/${guild.id}` : '#/create'

  return el('section', { class: 'roster', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('div', {},
        el('h2', { id: 'view-title', class: guild ? `guild-title faction-${guild.faction.toLowerCase()}` : null }, guild ? `<${guild.guildName}>` : 'All Characters'),
      ),
      el('div', { class: 'sheet-actions' },
        FACTIONS.some((f) => account.canFoundGuild(f)) && el('a', { class: 'button', href: '#/create-guild' }, '+ Create Guild'),
        account.guilds.length
          ? el('a', { class: 'button primary', href: createHref }, '+ Create Character')
          : el('button', { type: 'button', class: 'button primary', disabled: true, title: 'Create a guild first.' }, '+ Create Character'),
      ),
    ),
    renderGuildFilter(account, guild, onSelectGuild),
    el('div', { class: 'list-toolbar' },
      renderRoleSummary(characters),
      renderSortControl(sortKey, onSort),
    ),
    characters.length
      ? el('ul', { class: 'character-list' }, characters.map((c) => renderCharacterCard(c, account)))
      : account.guilds.length
        ? el('p', { class: 'empty' }, 'No characters here yet. ', el('a', { href: createHref }, 'Create one'), '.')
        : el('p', { class: 'empty' }, 'No guilds yet. ', el('a', { href: '#/create-guild' }, 'Create a guild'), ' to add characters.'),
    account.devMode && el('footer', { class: 'view-footer' },
      el('button', { type: 'button', class: 'button subtle', onclick: onSaveToFile }, 'Save to file'),
    ),
  )
}

export function renderGuildFilter(account, activeGuild, onSelectGuild) {
  const options = [
    { label: 'All Characters', id: null, count: account.characters.length },
    ...account.guilds.map((g) => ({ label: g.guildName, id: g.id, faction: g.faction, count: g.characters.length })),
  ]
  return el('nav', { class: 'guild-filter', 'aria-label': 'Filter by guild' },
    options.map((option) => el('button', {
      type: 'button',
      class: option.faction ? `chip guild-chip faction-${option.faction.toLowerCase()}` : 'chip',
      title: option.faction ? `${option.faction} guild` : null,
      'aria-pressed': String((activeGuild?.id ?? null) === option.id),
      onclick: () => onSelectGuild(option.id),
    }, option.label, el('span', { class: 'count' }, String(option.count)))),
  )
}

function renderRoleSummary(characters) {
  return el('ul', { class: 'role-summary', 'aria-label': 'Role breakdown' },
    ROLES.map((role) => el('li', { class: `role-${role.toLowerCase()}` },
      el('strong', {}, String(characters.filter((c) => c.characterRole === role).length)),
      ` ${role}`,
    )),
  )
}

function renderCharacterCard(character, account) {
  const guild = account.guildOf(character.id)

  return el('li', {},
    el('a', { class: 'character-card card-link', href: `#/character/${character.id}`, style: { '--class-color': character.classColor } },
      el('img', { class: 'class-icon', src: character.classIcon, alt: '', width: 56, height: 56 }),
      el('div', { class: 'character-info' },
        el('h3', { class: 'character-name' }, character.characterName),
        el('p', {}, `Level ${character.characterLevel} ${character.characterRace} ${character.characterSpec} ${character.characterClass}`),
        el('p', { class: 'badges' }, badge(character.characterRole), badge(character.faction)),
        el('p', { class: 'farm-status' }, `Power level ${formatNumber(Math.round(character.power.solo))} · Item level ${formatNumber(character.itemLevel)}`),
        el('p', { class: 'guild-tags' }, guild ? `<${guild.guildName}>` : 'No guild'),
        el('p', { class: 'farm-status' }, character.zone ? `Farming in ${character.zone}` : 'Idle'),
      ),
    ),
  )
}
