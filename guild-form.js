import Guild, { GUILD_NAME_MAX } from './guild.js'
import { badge, el } from './dom.js'
import { FACTIONS, RACES } from './data.js'
import { field, pickerField, tile } from './character-form.js'

// Renders the create-guild screen. Calls onSave({ guildName, faction }) with valid values. An account may have
// one guild per faction (see Account.canFoundGuild), so factions that already have one can't be picked.
export function renderGuildForm({ account, onSave }) {
  const header = el('div', { class: 'view-header' },
    el('h2', { id: 'view-title' }, 'Create Guild'),
    el('p', { class: 'field-hint' }, 'A guild is Alliance or Horde, and only characters of that faction can join it. You can have one guild of each faction. The name and faction can\'t be changed later.'),
  )
  const open = FACTIONS.filter((f) => account.canFoundGuild(f))
  if (open.length === 0) {
    return el('section', { class: 'character-editor', 'aria-labelledby': 'view-title' },
      header,
      el('p', { class: 'empty' }, 'You already have a guild of each faction. ', el('a', { href: '#/roster' }, 'Back to roster'), '.'),
    )
  }

  const nameInput = el('input', {
    id: 'guildName', type: 'text', maxlength: GUILD_NAME_MAX, autocomplete: 'off', spellcheck: 'false',
    'data-autofocus': true,
  })
  const factionPicker = el('div', { class: 'tile-grid faction-picker' }, FACTIONS.map((faction) => {
    const existing = account.guilds.find((g) => g.faction === faction)
    const races = Object.keys(RACES).filter((race) => RACES[race].faction === faction).join(', ')
    const label = tile('faction', faction, { '--tile-color': `var(--${faction.toLowerCase()})` },
      el('span', { class: 'tile-text' }, faction, el('small', {}, existing ? `You have <${existing.guildName}>` : races)))
    const input = label.querySelector('input')
    input.disabled = Boolean(existing)
    input.checked = open.length === 1 && open[0] === faction
    label.classList.toggle('unavailable', Boolean(existing))
    return label
  }))

  const previewName = el('h3', { class: 'character-name' })
  const previewBadges = el('p', { class: 'badges' })
  const previewCard = el('div', { class: 'character-card' },
    el('div', { class: 'character-info' }, previewName, previewBadges))

  const faction = () => form.querySelector('input[name="faction"]:checked')?.value ?? ''

  function updatePreview() {
    const name = Guild.formatName(nameInput.value)
    previewCard.style.setProperty('--class-color', faction() ? `var(--${faction().toLowerCase()})` : 'var(--text-muted)')
    previewName.textContent = `<${name || 'Unnamed guild'}>`
    previewBadges.replaceChildren(...[faction()].filter(Boolean).map(badge))
  }

  function showError(key, message) {
    form.querySelector(`#${key}-error`).textContent = message ?? ''
    form.querySelector(`#${key}`).setAttribute('aria-invalid', String(Boolean(message)))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const values = { guildName: Guild.formatName(nameInput.value), faction: faction() }
    const errors = Guild.validate(values)
    if (!errors.guildName && account.isGuildNameTaken(values.guildName)) {
      errors.guildName = `You already have a guild named ${values.guildName}.`
    }
    if (!errors.faction && !account.canFoundGuild(values.faction)) {
      errors.faction = `You already have a ${values.faction} guild.`
    }
    showError('guildName', errors.guildName)
    showError('faction', errors.faction)
    if (errors.guildName) nameInput.focus()
    else if (errors.faction) form.querySelector('input[name="faction"]:not(:disabled)').focus()
    else onSave(values)
  }

  const form = el('form', {
    class: 'character-form', novalidate: true, onsubmit: handleSubmit,
    oninput: (event) => { if (event.target === nameInput) showError('guildName', null); updatePreview() },
    onchange: () => { showError('faction', null); updatePreview() },
  },
    el('div', { class: 'form-fields' },
      field('Name', nameInput, `2 to ${GUILD_NAME_MAX} letters and spaces.`),
      pickerField('faction', 'Faction', factionPicker),
      el('div', { class: 'form-actions' },
        el('button', { type: 'submit', class: 'button primary' }, 'Create Guild'),
        el('a', { class: 'button', href: '#/roster' }, 'Cancel'),
      ),
    ),
    el('aside', { class: 'preview', 'aria-label': 'Preview' },
      el('p', { class: 'preview-label' }, 'Preview'),
      previewCard,
    ),
  )

  updatePreview()

  return el('section', { class: 'character-editor', 'aria-labelledby': 'view-title' },
    header,
    form,
  )
}
