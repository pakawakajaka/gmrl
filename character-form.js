import Character from './character.js'
import { badge, el } from './dom.js'
import { CLASSES, FACTIONS, MIN_LEVEL, RACES, ROLES, classIcon } from './data.js'

const FIELD_ORDER = ['characterName', 'characterRace', 'characterClass', 'characterSpec', 'characterRole']

// Renders the create/edit screen. Pass `character` to edit an existing one.
export function renderCharacterForm({ account, character, onSave }) {
  const isEditing = Boolean(character)
  const level = character?.characterLevel ?? MIN_LEVEL // new characters always start at level 1
  const memberOf = new Set(isEditing ? account.guildsOf(character.id).map((g) => g.guildName) : [])

  // Race, class, spec and role can be picked in any order; a pick clears whatever it conflicts with.
  const picks = {
    characterRace: character?.characterRace ?? '',
    characterClass: character?.characterClass ?? '',
    characterSpec: character?.characterSpec ?? '',
    characterRole: character?.characterRole ?? '',
  }

  const nameInput = el('input', {
    id: 'characterName', type: 'text', maxlength: 12, autocomplete: 'off', spellcheck: 'false',
    'data-autofocus': true, value: character?.characterName,
  })
  const guildBoxes = account.guilds.map((g) =>
    el('input', { type: 'checkbox', value: g.guildName, checked: memberOf.has(g.guildName) }))

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
  const previewCard = el('div', { class: 'character-card' },
    previewIcon, el('div', { class: 'character-info' }, previewName, previewDetails, previewBadges))

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
    if (race && cls && !race.classes.includes(p.characterClass)) return false
    if (cls && p.characterRole && !cls.roles.includes(p.characterRole)) return false
    const specRoles = cls && Object.hasOwn(cls.specs, p.characterSpec) ? cls.specs[p.characterSpec] : null
    return !specRoles || !p.characterRole || specRoles.includes(p.characterRole)
  }

  function pick(group, value) {
    const p = picks
    p[group] = value
    const race = RACES[p.characterRace]
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
    const values = {
      ...picks,
      characterName: nameInput.value.trim(),
      characterLevel: level,
    }
    const errors = Character.validate(values)
    if (!errors.characterName && account.isNameTaken(values.characterName, character?.id)) {
      errors.characterName = `You already have a character named ${Character.formatName(values.characterName)}.`
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

    const guildNames = guildBoxes.filter((box) => box.checked).map((box) => box.value)
    onSave(new Character({ ...values, id: character?.id }), guildNames)
  }

  const form = el('form', { class: 'character-form', novalidate: true, onsubmit: handleSubmit, oninput: handleInput, onchange: handleChange, onclick: handleClick },
    el('div', { class: 'form-fields' },
      field('Name', nameInput, '2 to 12 letters, no spaces.'),
      el('p', { class: 'field-hint' }, 'Pick race, class, spec and role in any order. Click a selected option again to clear it. Dimmed options don\'t fit your other picks; choosing one clears the conflict.'),
      pickerField('characterRace', 'Race', racePicker),
      pickerField('characterClass', 'Class', classPicker),
      pickerField('characterSpec', 'Spec', specPicker),
      pickerField('characterRole', 'Role', rolePicker),
      guildBoxes.length > 0 && el('fieldset', { class: 'field' },
        el('legend', { class: 'field-label' }, 'Guilds'),
        guildBoxes.map((box) => el('label', { class: 'checkbox' }, box, box.value)),
      ),
      el('div', { class: 'form-actions' },
        el('button', { type: 'submit', class: 'button primary' }, isEditing ? 'Save Changes' : 'Create Character'),
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
      el('h2', { id: 'view-title' }, isEditing ? `Edit ${character.characterName}` : 'Create Character'),
      !isEditing && el('p', { class: 'field-hint' }, `New characters start at level ${MIN_LEVEL}. Send them farming to level up.`),
    ),
    form,
  )
}

function tile(group, value, style, ...content) {
  return el('label', { class: 'tile', style },
    el('input', { type: 'radio', name: group, value, class: 'visually-hidden' }),
    el('span', { class: 'tile-body' }, content),
  )
}

function pickerField(key, legend, picker) {
  return el('fieldset', { class: 'field', id: key, 'aria-describedby': `${key}-error` },
    el('legend', { class: 'field-label' }, legend),
    picker,
    el('p', { class: 'field-error', id: `${key}-error`, 'aria-live': 'polite' }),
  )
}

function field(label, control, hint) {
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

