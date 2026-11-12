import { badge, el, formatNumber } from './dom.js'
import { ROLES } from './data.js'

export function renderRoster({ account, selectedGuild, onSelectGuild, onReset, onSaveToFile }) {
  const guild = account.getGuild(selectedGuild)
  const characters = sortForRaid(guild ? account.characters.filter((c) => guild.has(c.id)) : account.characters)

  return el('section', { class: 'roster', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, guild ? `<${guild.guildName}>` : 'All Characters'),
      el('a', { class: 'button primary', href: '#/create' }, '+ Create Character'),
    ),
    renderGuildFilter(account, guild, onSelectGuild),
    renderRoleSummary(characters),
    characters.length
      ? el('ul', { class: 'character-list' }, characters.map((c) => renderCharacterCard(c, account)))
      : el('p', { class: 'empty' }, 'No characters here yet. ', el('a', { href: '#/create' }, 'Create one'), '.'),
    el('footer', { class: 'view-footer' },
      el('button', { type: 'button', class: 'button subtle', onclick: onSaveToFile }, 'Save to file'),
      el('button', { type: 'button', class: 'button subtle', onclick: onReset }, 'Reset to default data'),
    ),
  )
}

function sortForRaid(characters) {
  return [...characters].sort((a, b) =>
    ROLES.indexOf(a.characterRole) - ROLES.indexOf(b.characterRole) ||
    a.characterName.localeCompare(b.characterName))
}

function renderGuildFilter(account, activeGuild, onSelectGuild) {
  const options = [
    { label: 'All Characters', guildName: null, count: account.characters.length },
    ...account.guilds.map((g) => ({ label: g.guildName, guildName: g.guildName, count: g.characterIds.length })),
  ]
  return el('nav', { class: 'guild-filter', 'aria-label': 'Filter by guild' },
    options.map((option) => el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String((activeGuild?.guildName ?? null) === option.guildName),
      onclick: () => onSelectGuild(option.guildName),
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
  const guildNames = account.guildsOf(character.id).map((g) => `<${g.guildName}>`)

  return el('li', {},
    el('a', { class: 'character-card card-link', href: `#/character/${character.id}`, style: { '--class-color': character.classColor } },
      el('img', { class: 'class-icon', src: character.classIcon, alt: '', width: 56, height: 56 }),
      el('div', { class: 'character-info' },
        el('h3', { class: 'character-name' }, character.characterName),
        el('p', {}, `Level ${character.characterLevel} ${character.characterRace} ${character.characterSpec} ${character.characterClass}`),
        el('p', { class: 'badges' }, badge(character.characterRole), badge(character.faction)),
        el('p', { class: 'farm-status' }, `Power level ${formatNumber(Math.round(character.power.solo))} · Item level ${formatNumber(character.itemLevel)}`),
        el('p', { class: 'guild-tags' }, guildNames.length ? guildNames.join(', ') : 'No guild'),
        el('p', { class: 'farm-status' }, character.zone ? `Farming in ${character.zone}` : 'Idle'),
      ),
    ),
  )
}
