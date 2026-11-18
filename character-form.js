import Account, { DAILY_CHARACTERS } from './account.js'
import Character from './character.js'
import { GUILD_SIZE } from './guild.js'
import { badge, el, formatDuration, guildName } from './dom.js'
import { CLASSES, FACTIONS, MIN_LEVEL, RACES, ROLES, classIcon } from './data.js'

const FIELD_ORDER = ['characterName', 'guildId', 'characterRace', 'characterClass', 'characterSpec', 'characterRole']

// Why no new character can join the guild right now, or null if one can: it's full (see GUILD_SIZE) or its
// faction has used up today's new characters (see Account.createsLeft).
export function cantCreateReason(account, guild, now = Date.now()) {
  if (guild.isFull) return `<${guild.guildName}> is full (${GUILD_SIZE} characters).`
  if (account.createsLeft(guild.faction, now) > 0) return null
  const wait = formatDuration((Account.nextCreateReset(now) - now) / 3600e3)
  return `You've created ${DAILY_CHARACTERS} ${guild.faction} characters today. More after the midnight reset (US Eastern), in ${wait}.`
}

// Renders the create screen, with `guildId` (if any) preselected. Characters can't be edited after creation.
// Guilds that can't take a new character (see cantCreateReason) can't be picked.
export function renderCharacterForm({ account, guildId, onSave }) {
  const joinable = (g) => g && !cantCreateReason(account, g)
  if (!account.guilds.some(joinable)) {
    return el('section', { class: 'character-editor', 'aria-labelledby': 'view-title' },
      el('div', { class: 'view-header' }, el('h2', { id: 'view-title' }, 'Create Character')),
      account.guilds.length
        ? el('p', { class: 'empty' }, account.guilds.map((g) => `${cantCreateReason(account, g)} `),
          FACTIONS.some((f) => account.canFoundGuild(f)) && [el('a', { href: '#/create-guild' }, 'Create a guild'), ' of the other faction, or '],
          el('a', { href: '#/roster' }, 'back to roster'), '.')
        : el('p', { class: 'empty' }, 'Characters belong to a guild. ', el('a', { href: '#/create-guild' }, 'Create a guild'), ' first.'),
    )
  }
  const level = MIN_LEVEL // new characters always start at level 1

  // Guild, race, class, spec and role can be picked in any order; a pick clears whatever it conflicts with.
  const picks = {
    guildId: joinable(account.getGuild(guildId)) ? guildId : '',
    characterRace: '',
    characterClass: '',
    characterSpec: '',
    characterRole: '',
  }

  const nameInput = el('input', {
    id: 'characterName', type: 'text', maxlength: 12, autocomplete: 'off', spellcheck: 'false',
    'data-autofocus': true,
  })

  const guildPicker = el('div', {},
    el('div', { class: 'faction-columns' }, FACTIONS.map((faction) => {
      const guilds = account.guilds.filter((g) => g.faction === faction)
      return guilds.length > 0 && el('div', { class: `faction faction-${faction.toLowerCase()}` },
        el('p', { class: 'faction-name' }, faction),
        el('div', { class: 'tile-grid' }, guilds.map((g) => {
          const left = account.createsLeft(g.faction)
          const room = g.isFull ? 'full' : left ? `${left} more today` : 'none left today'
          const label = tile('guildId', g.id, null,
            el('span', { class: 'tile-text' }, guildName(g, g.guildName),
              el('small', {}, `${g.characters.length}/${GUILD_SIZE} members, ${room}`)))
          label.title = cantCreateReason(account, g) ?? ''
          label.querySelector('input').disabled = !joinable(g)
          return label
        })),
      )
    })),
    el('p', { class: 'field-hint', style: { 'margin-top': '0.5rem' } }, 'Only races of the guild\'s faction can join it. ',
      FACTIONS.some((f) => account.canFoundGuild(f)) && el('a', { href: '#/create-guild' }, '+ Create Guild')),
  )

  const racePicker = el('div', { class: 'faction-columns' }, FACTIONS.map((faction) =>
    el('div', { class: `faction faction-${faction.toLowerCase()}` },
      el('p', { class: 'faction-name' }, faction),
      el('div', { class: 'tile-grid' },
        Object.keys(RACES).filter((race) => RACES[race].faction === faction)
          .map((race) => tile('characterRace', race, null, race))),
    )))
  const classPicker = el('div', { class: 'tile-grid' }, Object.entries(CLASSES).map(([cls, { color }]) =>
    tile('characterClass', cls, { '--tile-color': color },
      el('img', { src: classIcon(cls), alt: '', width: 32, height: 32 }), cls)))
  const rolePicker = el('div', { class: 'tile-grid' }, ROLES.map((role) =>
    tile('characterRole', role, { '--tile-color': `var(--${role.toLowerCase()})` }, role)))
  const specPicker = el('div')

  const previewIcon = el('img', { class: 'class-icon', alt: '', width: 72, height: 72 })
  const previewName = el('h3', { class: 'character-name' })
  const previewDetails = el('p')
  const previewBadges = el('p', { class: 'badges' })
  const previewGuild = el('p', { class: 'guild-tags' })
  const previewCard = el('div', { class: 'character-card' },
    previewIcon, el('div', { class: 'character-info' }, previewName, previewDetails, previewBadges, previewGuild))

  // Spec tiles depend on the class, so they're rebuilt whenever the class changes.
  function renderSpecTiles() {
    const cls = picks.characterClass
    if (specPicker.dataset.class === cls) return
    specPicker.dataset.class = cls
    specPicker.replaceChildren(cls
      ? el('div', { class: 'tile-grid' }, Object.entries(CLASSES[cls].specs).map(([spec, roles]) =>
        tile('characterSpec', spec, { '--tile-color': CLASSES[cls].color },
          el('span', { class: 'tile-text' }, spec, el('small', {}, roles.join(' / '))))))
      : el('p', { class: 'field-hint' }, 'Choose a class to see its specs.'))
  }

  function isCompatible(group, value) {
    const p = { ...picks, [group]: value }
    const race = RACES[p.characterRace]
    const cls = CLASSES[p.characterClass]
    const guild = account.getGuild(p.guildId)
    if (guild && !joinable(guild)) return false
    if (race && !account.guilds.some((g) => g.faction === race.faction && joinable(g))) return false
    if (guild && race && race.faction !== guild.faction) return false
    if (race && cls && !race.classes.includes(p.characterClass)) return false
    if (cls && p.characterRole && !cls.roles.includes(p.characterRole)) return false
    const specRoles = cls && Object.hasOwn(cls.specs, p.characterSpec) ? cls.specs[p.characterSpec] : null
    return !specRoles || !p.characterRole || specRoles.includes(p.characterRole)
  }

  function pick(group, value) {
    const p = picks
    p[group] = value
    const guild = account.getGuild(p.guildId)
    if (guild && p.characterRace && RACES[p.characterRace].faction !== guild.faction) {
      p[group === 'guildId' ? 'characterRace' : 'guildId'] = ''
    }
    const race = RACES[p.characterRace]
    if (race && !p.guildId) {
      const fitting = account.guilds.filter((g) => g.faction === race.faction && joinable(g))
      if (fitting.length === 1) p.guildId = fitting[0].id
    }
    if (race && p.characterClass && !race.classes.includes(p.characterClass)) {
      p[group === 'characterRace' ? 'characterClass' : 'characterRace'] = ''
    }
    if (p.characterClass && p.characterRole && !CLASSES[p.characterClass].roles.includes(p.characterRole)) {
      p[group === 'characterRole' ? 'characterClass' : 'characterRole'] = ''
    }

    const cls = CLASSES[p.characterClass]
    if (!cls || !Object.hasOwn(cls.specs, p.characterSpec)) p.characterSpec = ''
    if (!cls) return
    if (p.characterSpec && p.characterRole && !cls.specs[p.characterSpec].includes(p.characterRole)) {
      p[group === 'characterRole' ? 'characterSpec' : 'characterRole'] = ''
    }

    // Fill in whatever now has only one possible answer.
    const fittingSpecs = Object.keys(cls.specs).filter((spec) => !p.characterRole || cls.specs[spec].includes(p.characterRole))
    if (!p.characterSpec && fittingSpecs.length === 1) p.characterSpec = fittingSpecs[0]
    const roles = p.characterSpec ? cls.specs[p.characterSpec] : cls.roles
    if (!p.characterRole && roles.length === 1) p.characterRole = roles[0]
  }

  function syncPicks() {
    renderSpecTiles()
    for (const input of form.querySelectorAll('input[type="radio"]')) {
      input.checked = picks[input.name] === input.value
      input.closest('.tile').classList.toggle('unavailable', !isCompatible(input.name, input.value))
    }
  }

  function updatePreview() {
    const { characterRace: race, characterClass: cls, characterSpec: spec, characterRole: role } = picks
    previewCard.style.setProperty('--class-color', cls ? CLASSES[cls].color : 'var(--text-muted)')
    previewIcon.hidden = !cls
    if (cls) previewIcon.src = classIcon(cls)
    previewName.textContent = Character.formatName(nameInput.value) || 'Unnamed hero'
    previewDetails.textContent = ['Level', level, race, spec, cls].filter(Boolean).join(' ')
    previewBadges.replaceChildren(...[role, race && RACES[race].faction].filter(Boolean).map(badge))
    const guild = account.getGuild(picks.guildId)
    previewGuild.replaceChildren(guild ? guildName(guild) : 'No guild chosen')
  }

  function showError(key, message) {
    form.querySelector(`#${key}-error`).textContent = message ?? ''
    form.querySelector(`#${key}`).setAttribute('aria-invalid', String(Boolean(message)))
  }

  function handleChange(event) {
    const { type, name, value, checked } = event.target
    if (type !== 'radio' || !checked || !Object.hasOwn(picks, name)) return
    pick(name, value)
    showError(name, null)
    syncPicks()
    updatePreview()
  }

  // Clicking (or pressing Space on) the already-selected tile clears it.
  function handleClick(event) {
    const { type, name, value } = event.target
    if (type !== 'radio' || !Object.hasOwn(picks, name) || picks[name] !== value) return
    picks[name] = ''
    if (name === 'characterClass') picks.characterSpec = ''
    syncPicks()
    updatePreview()
  }

  function handleInput(event) {
    if (event.target !== nameInput) return
    showError(event.target.id, null)
    updatePreview()
  }

  function handleSubmit(event) {
    event.preventDefault()
    const { guildId: chosenGuild, ...choices } = picks
    const values = {
      ...choices,
      characterName: nameInput.value.trim(),
      characterLevel: level,
    }
    const errors = Character.validate(values)
    if (!errors.characterName && account.isNameTaken(values.characterName)) {
      errors.characterName = `You already have a character named ${Character.formatName(values.characterName)}.`
    }
    const chosen = account.getGuild(chosenGuild)
    if (!joinable(chosen)) {
      const faction = RACES[values.characterRace]?.faction
      const home = chosen ?? (faction && account.guilds.find((g) => g.faction === faction))
      errors.guildId = faction && !home
        ? `You have no ${faction} guild yet. Create one first.`
        : (home && cantCreateReason(account, home)) || 'Choose a guild.'
    }

    for (const key of FIELD_ORDER) showError(key, errors[key])
    const firstInvalid = FIELD_ORDER.find((key) => errors[key])
    if (firstInvalid) {
      const target = Object.hasOwn(picks, firstInvalid)
        ? form.querySelector(`input[name="${firstInvalid}"]:checked`) ?? form.querySelector(`input[name="${firstInvalid}"]`)
        : form.querySelector(`#${firstInvalid}`)
      target?.focus()
      return
    }

    onSave(new Character(values), chosenGuild)
  }

  const form = el('form', { class: 'character-form', novalidate: true, onsubmit: handleSubmit, oninput: handleInput, onchange: handleChange, onclick: handleClick },
    el('div', { class: 'form-fields' },
      field('Name', nameInput, '2 to 12 letters, no spaces.'),
      el('p', { class: 'field-hint' }, 'Pick guild, race, class, spec and role in any order. Click a selected option again to clear it. Dimmed options don\'t fit your other picks; choosing one clears the conflict.'),
      pickerField('guildId', 'Guild', guildPicker),
      pickerField('characterRace', 'Race', racePicker),
      pickerField('characterClass', 'Class', classPicker),
      pickerField('characterSpec', 'Spec', specPicker),
      pickerField('characterRole', 'Role', rolePicker),
      el('div', { class: 'form-actions' },
        el('button', { type: 'submit', class: 'button primary' }, 'Create Character'),
        el('a', { class: 'button', href: '#/roster' }, 'Cancel'),
      ),
    ),
    el('aside', { class: 'preview', 'aria-label': 'Preview' },
      el('p', { class: 'preview-label' }, 'Preview'),
      previewCard,
    ),
  )

  syncPicks()
  updatePreview()

  return el('section', { class: 'character-editor', 'aria-labelledby': 'view-title' },
    el('div', { class: 'view-header' },
      el('h2', { id: 'view-title' }, 'Create Character'),
      el('p', { class: 'field-hint' }, `New characters start at level ${MIN_LEVEL}. Send them farming to level up. You can create ${DAILY_CHARACTERS} characters per faction each day. Name, guild, race, class, spec and role can't be changed later.`),
    ),
    form,
  )
}

export function tile(group, value, style, ...content) {
  return el('label', { class: 'tile', style },
    el('input', { type: 'radio', name: group, value, class: 'visually-hidden' }),
    el('span', { class: 'tile-body' }, content),
  )
}

export function pickerField(key, legend, picker) {
  return el('fieldset', { class: 'field', id: key, 'aria-describedby': `${key}-error` },
    el('legend', { class: 'field-label' }, legend),
    picker,
    el('p', { class: 'field-error', id: `${key}-error`, 'aria-live': 'polite' }),
  )
}

export function field(label, control, hint) {
  const hintId = `${control.id}-hint`
  const errorId = `${control.id}-error`
  control.setAttribute('aria-describedby', hint ? `${hintId} ${errorId}` : errorId)
  return el('div', { class: 'field' },
    el('label', { class: 'field-label', for: control.id }, label),
    control,
    hint && el('p', { class: 'field-hint', id: hintId }, hint),
    el('p', { class: 'field-error', id: errorId, 'aria-live': 'polite' }),
  )
}

