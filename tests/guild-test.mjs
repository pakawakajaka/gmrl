// Run: node tests/guild-test.mjs
// Account -> guilds -> characters: structure, faction locking, old-save migration, and the create screens.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/#/roster', pretendToBeVisual: true })
const w = dom.window
w.scrollTo = () => {}
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)
globalThis.setInterval = () => {}

const { default: Account, SAVE_VERSION, DAILY_CHARACTERS } = await import(ROOT + 'account.js')
const { default: Character } = await import(ROOT + 'character.js')
const { default: Guild, GUILD_SIZE } = await import(ROOT + 'guild.js')
const { sampleAccount } = await import('./helpers.mjs')

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const make = (name, race, cls, spec, role) => new Character({ characterName: name, characterRace: race, characterClass: cls, characterSpec: spec, characterRole: role })
const summary = (acc) => acc.guilds.map((g) => `${g.guildName}/${g.faction}:${g.characters.map((c) => c.characterName).join(',')}`).join(' | ')

// Structure.
const def = sampleAccount()
check('sample guilds', summary(def) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(def))
check('characters come from guilds', def.characters.length === 3 && def.characters[2].characterName === 'Bassor')
const json = JSON.parse(JSON.stringify(def))
check('save nests characters in guilds', json.saveVersion === SAVE_VERSION && !('characters' in json) && json.guilds.every((g) => g.id && g.faction && Array.isArray(g.characters)) && typeof json.id === 'string')
const back = Account.fromJSON(json)
check('round-trip keeps guilds', summary(back) === summary(def) && back.guilds.every((g, i) => g.id === def.guilds[i].id) && back.id === def.id)
check('guildOf', def.guildOf(def.characters[2].id).guildName === 'South Bank Satellites')

// Gold belongs to guilds (worked out from their characters), not the account.
{
  const acc = sampleAccount()
  const [h, al] = acc.guilds
  h.characters[0].copper = 150; h.characters[1].copper = 50; al.characters[0].copper = 7
  check('totalGold sums its characters', h.totalGold() === 200 && al.totalGold() === 7)
  check('guild has no gold value, only the method', !('gold' in h) && !Object.keys(h).some((k) => /gold|copper/i.test(k)) && typeof Guild.prototype.totalGold === 'function')
  check('no account gold', !('gold' in acc))
  const saved = JSON.parse(JSON.stringify(acc))
  check('guild gold not saved', saved.guilds.every((g) => Object.keys(g).join() === 'id,guildName,faction,characters') && !('gold' in saved))
  const r = acc.tick(acc.lastTick + 3600 * 1000)
  check('tick reports no money', !('copper' in r) && !('earned' in r))
}

// Faction lock.
const [tymf, sbs] = def.guilds
const gnome = make('Gnomer', 'Gnome', 'Mage', 'Frost', 'DPS')
check('Alliance character refused by Horde guild', def.addCharacter(gnome, tymf.id) === false && !def.getCharacter(gnome.id))
check('Alliance character joins Alliance guild', def.addCharacter(gnome, sbs.id) === true && sbs.has(gnome.id) && gnome.characterLevel === 1)
check('missing guild refused', def.addCharacter(make('Lost', 'Orc', 'Warrior', 'Arms', 'DPS'), 'nope') === false)
check('Guild.add refuses other faction', tymf.add(make('Dwarfy', 'Dwarf', 'Priest', 'Holy', 'Healer')) === false)
def.deleteCharacter(gnome.id)
check('delete removes from guild', !sbs.has(gnome.id) && def.characters.length === 3)

// Guild size cap.
const { renderCharacterForm } = await import(ROOT + 'character-form.js')
const { renderRoster } = await import(ROOT + 'roster.js')
{
  const acc = sampleAccount()
  const [h, al] = acc.guilds
  const fill = (guild, race, cls, spec) => {
    while (guild.characters.length < GUILD_SIZE) {
      acc.created = null // past the daily limit (checked below)
      acc.addCharacter(make(`Fill${'abcdefghij'[guild.characters.length]}${race[0].toLowerCase()}`, race, cls, spec, 'DPS'), guild.id)
    }
  }
  fill(h, 'Orc', 'Warrior', 'Arms')
  check('cap is 10', GUILD_SIZE === 10 && h.characters.length === 10 && h.isFull && !al.isFull)
  check('full guild refuses a character', acc.addCharacter(make('Eleventh', 'Orc', 'Warrior', 'Arms', 'DPS'), h.id) === false && h.characters.length === 10)
  const form = renderCharacterForm({ account: acc, guildId: h.id, onSave: () => {} })
  const hInput = form.querySelector(`input[name=guildId][value="${h.id}"]`)
  check('full guild greyed out in picker', hInput.disabled && !hInput.checked && hInput.closest('.tile').textContent.includes('10/10 members, full'), hInput.closest('.tile').textContent)
  check('open guild shows its count', form.querySelector(`input[name=guildId][value="${al.id}"]`).closest('.tile').textContent.includes('1/10 members'))
  const rosterButton = (selectedGuild) => [...renderRoster({ account: acc, selectedGuild, onSelectGuild() {}, onSort() {}, onSaveToFile() {} }).querySelectorAll('.view-header .button.primary')].find((b) => b.textContent === '+ Create Character')
  check('roster: Create Character greyed out for a full guild', rosterButton(h.id).tagName === 'BUTTON' && rosterButton(h.id).disabled && rosterButton(al.id).tagName === 'A' && rosterButton(null).tagName === 'A')
  fill(al, 'Human', 'Warrior', 'Arms')
  check('roster: Create Character greyed out when all guilds are full', rosterButton(null).tagName === 'BUTTON' && rosterButton(null).disabled)
  const fullForm = renderCharacterForm({ account: acc, onSave: () => {} })
  check('create screen says guilds are full', !fullForm.querySelector('form') && fullForm.querySelector('.empty').textContent.includes('<TYMF> is full (10 characters). <South Bank Satellites> is full'), fullForm.textContent)
  const big = JSON.parse(JSON.stringify(acc))
  big.guilds[0].characters.push({ ...big.guilds[0].characters[0], id: 'over', characterName: 'Overcap' })
  check('older saves over the cap keep everyone', Account.fromJSON(big).guilds[0].characters.length === 11)
}

// Daily limit: 5 new characters per faction per day, reset at midnight (US Eastern).
{
  const { dayOf } = await import(ROOT + 'reset.js')
  const now = Date.now()
  const acc = sampleAccount()
  const [h, al] = acc.guilds
  const addOrc = (i) => acc.addCharacter(make(`Day${'abcdefgh'[i]}`, 'Orc', 'Warrior', 'Arms', 'DPS'), h.id, now)
  const adds = [0, 1, 2, 3, 4, 5].map(addOrc)
  check('5 Horde characters a day', DAILY_CHARACTERS === 5 && adds.join() === 'true,true,true,true,true,false' && h.characters.length === 7, adds.join())
  check('the other faction still has 5', acc.createsLeft('Horde', now) === 0 && acc.createsLeft('Alliance', now) === 5)
  acc.deleteCharacter(h.characters.at(-1).id)
  check('deleting does not give one back', acc.createsLeft('Horde', now) === 0 && addOrc(6) === false)
  const reset = Account.nextCreateReset(now)
  check('resets at the next midnight', dayOf(reset) === dayOf(now) + 1 && dayOf(reset - 1) === dayOf(now) && reset - now <= 25 * 3600e3 && acc.createsLeft('Horde', reset) === 5)

  const form = renderCharacterForm({ account: acc, guildId: h.id, onSave: () => {} })
  const tileOf = (g) => form.querySelector(`input[name=guildId][value="${g.id}"]`).closest('.tile')
  check('used-up guild greyed out in picker', tileOf(h).querySelector('input').disabled && !tileOf(h).querySelector('input').checked && tileOf(h).textContent.includes('6/10 members, none left today') && tileOf(h).title.includes("You've created 5 Horde characters today. More after the midnight reset (US Eastern), in "), tileOf(h).textContent + ' | ' + tileOf(h).title)
  check('other guild shows what is left today', tileOf(al).textContent.includes('1/10 members, 5 more today') && !tileOf(al).querySelector('input').disabled, tileOf(al).textContent)
  check('Horde races dimmed', form.querySelector('input[name=characterRace][value="Orc"]').closest('.tile').classList.contains('unavailable'))
  check('form hint mentions the limit', form.textContent.includes('5 characters per faction each day'))
  const rosterButton = (selectedGuild) => [...renderRoster({ account: acc, selectedGuild, onSelectGuild() {}, onSort() {}, onSaveToFile() {} }).querySelectorAll('.view-header .button.primary')].find((b) => b.textContent === '+ Create Character')
  check('roster: Create Character greyed out for a used-up guild', rosterButton(h.id).disabled && rosterButton(h.id).title.startsWith("You've created 5 Horde") && rosterButton(al.id).tagName === 'A' && rosterButton(null).tagName === 'A', rosterButton(h.id).title)

  const back = Account.fromJSON(JSON.parse(JSON.stringify(acc)))
  check('daily count saved', back.createsLeft('Horde', now) === 0 && back.createsLeft('Alliance', now) === 5)
  const tampered = JSON.parse(JSON.stringify(acc))
  tampered.created = { day: tampered.created.day, Horde: -3, Alliance: 99 }
  const fixedCount = Account.fromJSON(tampered)
  check('bad daily count repaired', fixedCount.createsLeft('Horde', now) === 5 && fixedCount.createsLeft('Alliance', now) === 0)
  check('no daily count in old saves', Account.fromJSON({ ...tampered, created: undefined }).created === null && Account.fromJSON({ ...tampered, created: 'x' }).createsLeft('Horde', now) === 5)

  for (const [i, race] of ['Human', 'Dwarf', 'Gnome', 'Human', 'Dwarf'].entries()) acc.addCharacter(make(`Ally${'abcde'[i]}`, race, 'Warrior', 'Arms', 'DPS'), al.id, now)
  const blocked = renderCharacterForm({ account: acc, onSave: () => {} })
  check('both used up: create screen says when', !blocked.querySelector('form') && blocked.querySelector('.empty').textContent.includes('5 Horde characters today') && blocked.querySelector('.empty').textContent.includes('5 Alliance characters today'), blocked.textContent)
  check('roster: greyed out when both are used up', rosterButton(null).disabled)
  acc.created.day-- // as if those were made yesterday
  check('next day: can create again', addOrc(7) === true && acc.createsLeft('Horde', now) === 4 && acc.createsLeft('Alliance', now) === 5)
}

// Guild validation and the one-guild-per-faction limit.
const solo = new Account('Solo', [new Guild({ guildName: 'TYMF', faction: 'Horde' })])
check('canFoundGuild', !solo.canFoundGuild('Horde') && solo.canFoundGuild('Alliance'))
const tries = [['A', 'Alliance'], ['Bad1', 'Alliance'], ['x'.repeat(25), 'Alliance'], ['tymf', 'Alliance'], ['Fine Name', 'Scourge'], ['Second Horde', 'Horde'], ['  Iron   Forge ', 'Alliance'], ['Another', 'Alliance']]
const added = tries.map(([guildName, faction]) => solo.addGuild(new Guild({ guildName, faction })))
check('addGuild validates', JSON.stringify(added) === '[false,false,false,false,false,false,true,false]', JSON.stringify(added))
check('guild name tidied', solo.guilds.at(-1).guildName === 'Iron Forge' && solo.guilds.length === 2)
check('full account', !solo.canFoundGuild('Horde') && !solo.canFoundGuild('Alliance'))
check('no rename or move methods', !('rename' in Guild.prototype) && !Object.getOwnPropertyNames(Account.prototype).some((m) => /rename|move|transfer/i.test(m)))
check('validate messages', Object.keys(Guild.validate({ guildName: 'x', faction: '' })).join() === 'guildName,faction')

// Old saves (characters at the top, guilds listing ids).
const [troll, paka, bassor] = JSON.parse(JSON.stringify(sampleAccount().characters))
const legacy = {
  accountName: 'old', gold: 0, lastTick: Date.now(),
  characters: [troll, paka, bassor],
  guilds: [{ guildName: 'TYMF', characterIds: [troll.id, paka.id, bassor.id] }, { guildName: 'South Bank Satellites', characterIds: [bassor.id] }],
}
const migrated = Account.fromJSON(legacy)
check('old save migrates', summary(migrated) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(migrated))
const noAlliance = Account.fromJSON({ ...legacy, guilds: [{ guildName: 'TYMF', characterIds: [troll.id, paka.id] }] })
check('character without a guild of its faction is dropped', summary(noAlliance) === 'TYMF/Horde:Trollwarrior,Pakawakajaka', summary(noAlliance))
const noGuilds = Account.fromJSON({ ...legacy, guilds: [] })
check('no guilds at all', noGuilds.guilds.length === 0 && noGuilds.characters.length === 0, summary(noGuilds))
const stray = JSON.parse(JSON.stringify(sampleAccount()))
stray.guilds[0].characters.push({ ...stray.guilds[1].characters[0], id: 'stray', characterName: 'Strayhuman' })
check('wrong-faction character joins the existing guild of its faction', summary(Account.fromJSON(stray)) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor,Strayhuman')
const oldGold = Account.fromJSON({ ...legacy, characters: legacy.characters.map(({ copper, ...c }) => c), gold: 300 })
check('old account gold is split', oldGold.characters.every((c) => c.copper === 100), oldGold.characters.map((c) => c.copper).join())
const twoHorde = Account.fromJSON({ ...legacy, guilds: [{ guildName: 'TYMF', characterIds: [troll.id] }, { guildName: 'Iron Horde', characterIds: [paka.id] }, { guildName: 'South Bank Satellites', characterIds: [bassor.id] }] })
check('old second Horde guild merges into the first', summary(twoHorde) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(twoHorde))

// Tampered new-format saves.
const bad = JSON.parse(JSON.stringify(sampleAccount()))
bad.guilds[1].characters.push(bad.guilds[0].characters.shift()) // a Horde character in the Alliance guild
bad.guilds.push({ id: bad.guilds[0].id, guildName: 'tymf', faction: 'Horde', characters: [] }) // clashing name
bad.guilds.push({ id: 'x y', guildName: 'Ok Guild', faction: 'Alliance', characters: [{ ...bad.guilds[1].characters[0] }] }) // bad id, duplicate character
bad.guilds.push({ guildName: '<b>', faction: 'Horde', characters: [{ ...bad.guilds[0].characters[0], id: 'moved' }] }) // invalid name
const fixed = Account.fromJSON(bad)
check('tampered save repaired', summary(fixed) === 'TYMF/Horde:Pakawakajaka,Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(fixed))
const extra = JSON.parse(JSON.stringify(sampleAccount()))
extra.guilds[1].id = 'x y'
extra.guilds.push({ id: 'extra', guildName: 'Iron Horde', faction: 'Horde', characters: [{ ...extra.guilds[0].characters[0], id: 'second', characterName: 'Secondtroll' }] })
const merged = Account.fromJSON(extra)
check('second guild of a faction merges into the first', summary(merged) === 'TYMF/Horde:Trollwarrior,Pakawakajaka,Secondtroll | South Bank Satellites/Alliance:Bassor', summary(merged))
check('bad guild id replaced', merged.guilds[1].id !== 'x y' && /^[\w-]+$/.test(merged.guilds[1].id))

// The real saves.
for (const file of [ROOT + 'gmrl-save.json']) {
  let data
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
  const before = Array.isArray(data.characters) ? data.characters.length : data.guilds.reduce((n, g) => n + g.characters.length, 0)
  const acc = Account.fromJSON(data)
  const counts = acc.guilds.map((g) => `${g.guildName}/${g.faction}:${g.characters.length}`).join(' | ')
  check(`${file.split('/').pop()} migrates`, acc.characters.length === before && acc.guilds.every((g) => g.characters.every((c) => c.faction === g.faction)), counts)
}

// Screens, starting as a new player with no save.
localStorage.clear()
await import(ROOT + 'interface.js')
const q = (s) => document.querySelector(s)
const qa = (s) => [...document.querySelectorAll(s)]
const go = (hash) => { location.hash = hash; w.dispatchEvent(new w.HashChangeEvent('hashchange')) }
const submit = () => q('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))
const click = (name, value) => q(`input[name=${name}][value="${value}"]`).closest('label').querySelector('.tile-body').click()
const saved = () => Account.fromJSON(JSON.parse(localStorage.getItem('gmrl.account')))
const createGuildLink = () => qa('.view-header a').some((a) => a.getAttribute('href') === '#/create-guild')

const createChar = () => qa('.view-header .button.primary').find((b) => b.textContent === '+ Create Character')
check('new player: no default characters, sent to Create Guild', location.hash === '#/create-guild' && q('#view-title').textContent === 'Create Guild' && !q('.character-card .class-icon'), location.hash)
check('new player: welcome, no Cancel', q('.view-header .welcome')?.textContent.startsWith('Welcome!') && !qa('.form-actions a').some((a) => a.textContent === 'Cancel') && q('.view-header .field-hint').textContent.includes('up to 10 characters'))
check('new player: Load from file', qa('.form-actions button').some((b) => b.textContent === 'Load from file'))
check('new player: no account name in header', q('#accountLabel').hidden && q('#gold').textContent === '')
go('#/roster')
check('no guilds: roster sends you to Create Guild', location.hash === '#/create-guild' && q('#view-title').textContent === 'Create Guild')
go('#/create')
check('no guilds: create screen sends you to Create Guild', location.hash === '#/create-guild' && q('#guildName'))

// Found a Horde guild.
go('#/create-guild')
check('both factions free, none preselected', qa('input[name=faction]').every((i) => !i.disabled && !i.checked))
click('faction', 'Horde')
q('#guildName').value = 'TYMF'
submit()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('roster chips by faction', qa('.guild-chip').map((c) => c.className).join() === 'chip guild-chip faction-horde')
check('roster has Create Guild', createGuildLink())
check('header shows guild gold, no account total', qa('#gold .guild-gold').map((s) => s.querySelector('strong').textContent).join() === 'TYMF' && !q('.account').textContent.includes('Gold:') && q('#gold').textContent.startsWith('TYMF'), q('.account').textContent)
check('header shows whole gold only', qa('#gold .coin').every((c) => c.classList.contains('coin-gold') && /^[\d,]+g$/.test(c.textContent)), q('#gold').textContent)
check('Create Character enabled once a guild exists', createChar()?.tagName === 'A')
go('#/create')
check('picker shows only existing guilds', [...q('#guildId').querySelectorAll('.faction-name')].map((p) => p.textContent).join() === 'Horde' && qa('input[name=guildId]').length === 1 && !q('.character-form').textContent.includes('guild yet'))

go('#/create-guild')
check('guild form', q('#view-title').textContent === 'Create Guild' && qa('input[name=faction]').length === 2 && !q('.welcome') && qa('.form-actions a').some((a) => a.textContent === 'Cancel'))
check('Horde taken, Alliance preselected', q('input[value=Horde]').disabled && q('input[value=Horde]').closest('.tile').textContent.includes('You have <TYMF>') && q('input[value=Alliance]').checked)
submit()
check('empty name errors', q('#guildName-error').textContent !== '' && q('#faction-error').textContent === '')
click('faction', 'Horde')
check('disabled faction cannot be picked', q('input[value=Alliance]').checked && !q('input[value=Horde]').checked)
q('#guildName').value = 'tymf'
submit()
check('taken name refused', q('#guildName-error').textContent.includes('already'), q('#guildName-error').textContent)
q('#guildName').value = '  South   Bank Satellites '
q('#guildName').dispatchEvent(new w.Event('input', { bubbles: true }))
check('guild preview', q('.preview .character-name').textContent === '<South Bank Satellites>' && q('.preview .badge').textContent === 'Alliance')
submit()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
const sbs2 = saved().guilds.find((g) => g.guildName === 'South Bank Satellites')
check('guild created and selected', sbs2?.faction === 'Alliance' && q('#view-title').textContent === '<South Bank Satellites>' && !q('.roster .sheet-subtitle') && q('#view-title').classList.contains('faction-alliance'), q('#view-title').textContent)
check('create link preselects guild', q('.view-header a.primary').getAttribute('href') === `#/create/${sbs2.id}`)
check('no Create Guild once both factions have one', !createGuildLink())
go('#/farm')
const pressedChip = () => q('.guild-filter .chip[aria-pressed="true"]')?.textContent
check('farm shares selected guild', pressedChip()?.startsWith('South Bank Satellites') && q('.guild-filter .chip.faction-horde'), pressedChip())
check('farm shows only guild characters', q('.view-header .farm-income').textContent === `0 of ${sbs2.characters.length} farming` && !q('.farmer') && q('.farm .empty a').getAttribute('href') === `#/create/${sbs2.id}`, q('.farm-income').textContent)
q('.guild-filter .chip').click()
check('farm All Characters', pressedChip()?.startsWith('All Characters') && document.querySelectorAll('.farmer').length === saved().guilds.reduce((n, g) => n + g.characters.length, 0), document.querySelectorAll('.farmer').length)
q('.guild-filter .chip.faction-horde').click()
check('farm Horde guild', qa('.farmer').length === saved().guilds.find((g) => g.faction === 'Horde').characters.length)
qa('.guild-filter .chip').find((c) => c.textContent.startsWith('South Bank Satellites')).click()
go('#/create-guild')
check('full account form', !q('form') && q('.empty').textContent.includes('a guild of each faction'))

const tymfId = saved().guilds.find((g) => g.faction === 'Horde').id
go(`#/create/${sbs2.id}`)
check('guild preselected', q(`input[name=guildId][value="${sbs2.id}"]`).checked)
check('no create-guild link on full account', !q('.character-form a[href="#/create-guild"]'))
check('other faction races dimmed', q('input[name=characterRace][value="Orc"]').closest('.tile').classList.contains('unavailable') && !q('input[name=characterRace][value="Human"]').closest('.tile').classList.contains('unavailable'))
click('characterRace', 'Orc')
check('other faction race swaps to the Horde guild', q(`input[name=guildId][value="${tymfId}"]`).checked && q('.preview .guild-tags').textContent === '<TYMF>')
click('guildId', sbs2.id)
check('picking Alliance guild clears Orc', !q('input[name=characterRace]:checked'))
click('characterRace', 'Human'); click('characterClass', 'Warrior'); click('characterSpec', 'Arms')
q('#characterName').value = 'Anduin'
submit()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('character saved into chosen guild', saved().guilds.find((g) => g.guildName === 'South Bank Satellites').characters.map((c) => c.characterName).join() === 'Anduin' && location.hash === '#/roster')

go('#/create')
q('#characterName').value = 'Nobody'
click('characterClass', 'Warrior'); click('characterSpec', 'Arms')
submit()
check('guild required', q('#guildId-error').textContent === 'Choose a guild.', q('#guildId-error').textContent)

go('#/roster')
const footerButtons = () => qa('.view-footer button').map((b) => b.textContent).join()
check('Save to file for everyone, no reset', footerButtons() === 'Save to file,Load from file' && !qa('button').some((b) => b.textContent.includes('Reset to default')), footerButtons())
let downloaded
const realURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:save' }
URL.revokeObjectURL = () => {}
const clicked = []
w.HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('download')) }
q('.view-footer button').click()
Object.assign(URL, { createObjectURL: realURL.create, revokeObjectURL: realURL.revoke })
const text = await downloaded?.text()
check('Save to file downloads gmrl-save.json', clicked.join() === 'gmrl-save.json' && JSON.parse(text).saveVersion === SAVE_VERSION && Account.fromJSON(JSON.parse(text)).characters.length === saved().characters.length && q('#notices')?.textContent.includes('Saved gmrl-save.json to your downloads.'), clicked.join())
check('no dev mode', !('devMode' in def) && !('devMode' in Account.prototype))

// Load from file. Without file pickers (Firefox, Safari) it's a file input.
w.HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
w.HTMLDialogElement.prototype.close ??= function () { this.open = false; this.dispatchEvent(new w.Event('close')) }
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const button = (text) => qa('button').find((b) => b.textContent === text)
const notices = () => q('#notices').textContent
let nextFile = null
w.HTMLInputElement.prototype.click = function () {
  if (this.type !== 'file') return
  Object.defineProperty(this, 'files', { value: nextFile ? [nextFile] : [] })
  this.dispatchEvent(new w.Event(nextFile ? 'change' : 'cancel'))
}
const loadFile = async (name, text) => {
  nextFile = text === null ? null : new File([text], name)
  button('Load from file').click()
  await settle()
}
const backupJson = JSON.stringify(sampleAccount())
const before = JSON.stringify(saved())
go('#/roster')
await loadFile('backup.json', null)
check('cancelled load does nothing', !q('dialog') && JSON.stringify(saved()) === before)
await loadFile('notes.txt', 'hello')
check('not a save file', notices().includes("notes.txt isn't a save file.") && !q('dialog') && JSON.stringify(saved()) === before, notices())
await loadFile('other.json', '{"a":1}')
check('JSON that is not a save', notices().includes("other.json isn't a save file.") && JSON.stringify(saved()) === before)
await loadFile('future.json', JSON.stringify({ ...JSON.parse(backupJson), saveVersion: SAVE_VERSION + 1 }))
check('newer save refused', notices().includes('future.json was made by a newer version') && !q('dialog') && JSON.stringify(saved()) === before)
await loadFile('backup.json', backupJson)
const dialogText = q('dialog[open]')?.textContent ?? ''
check('load asks first, describing both', dialogText.includes('Load backup.json?') && dialogText.includes('It has 3 characters in <TYMF> and <South Bank Satellites>') && dialogText.includes('replaces your 1 character in <TYMF> and <South Bank Satellites>.'), dialogText)
button('Cancel').click()
check('cancel keeps the account', !q('dialog') && JSON.stringify(saved()) === before)
await loadFile('backup.json', backupJson)
button('Load save').click()
const restored = saved()
check('load replaces the account', summary(restored) === summary(sampleAccount()) && restored.id === JSON.parse(backupJson).id && !q('dialog') && q('#view-title').textContent === 'All Characters' && notices().includes('Loaded backup.json.'), summary(restored))

// A save with no guilds sends you to Create Guild, where a new player can load without being asked.
await loadFile('empty.json', JSON.stringify(new Account('')))
button('Load save').click()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('empty save: Create Guild', saved().guilds.length === 0 && location.hash === '#/create-guild' && q('.welcome'), location.hash)
await loadFile('backup.json', backupJson)
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('new player loads without a prompt', !q('dialog') && summary(saved()) === summary(sampleAccount()) && location.hash === '#/roster' && q('#view-title').textContent === 'All Characters', location.hash)

// With file pickers (Chrome, Edge), saving and loading share a picker id, so both open in the folder used last.
const pickerIds = []
let written = ''
const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })
let cancelPicker = false
w.showSaveFilePicker = async (options) => {
  pickerIds.push(options.id)
  if (cancelPicker) throw abort()
  return { name: 'my backup.json', createWritable: async () => ({ write: async (text) => { written = text }, close: async () => {} }) }
}
w.showOpenFilePicker = async (options) => {
  pickerIds.push(options.id)
  if (cancelPicker) throw abort()
  return [{ getFile: async () => new File([written], 'my backup.json') }]
}
const noticeCount = () => qa('#notices .notice').length
button('Save to file').click()
await settle()
check('picker save writes the file', JSON.parse(written).id === saved().id && notices().includes('Saved my backup.json.') && !notices().includes('my backup.json to your downloads'), notices())
button('Load from file').click()
await settle()
button('Load save').click()
check('picker load', notices().includes('Loaded my backup.json.') && summary(saved()) === summary(sampleAccount()))
check('save and load share a picker id', pickerIds.length === 2 && pickerIds.every((id) => id === 'gmrl-save'), pickerIds.join())
cancelPicker = true
q('#notices').replaceChildren()
button('Save to file').click()
button('Load from file').click()
await settle()
check('cancelled pickers do nothing', noticeCount() === 0 && !q('dialog'), notices())
delete w.showSaveFilePicker
delete w.showOpenFilePicker

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
