// Run: node tests/guild-test.mjs
// Account -> guilds -> characters: structure, faction locking, old-save migration, and the create screens.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const html = readFileSync(ROOT + 'main.html', 'utf8').replace(/<script[^>]*><\/script>/, '')
const dom = new JSDOM(html, { url: 'http://localhost/main.html#/roster', pretendToBeVisual: true })
const w = dom.window
w.scrollTo = () => {}
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, confirm: () => true })
globalThis.addEventListener = w.addEventListener.bind(w)
globalThis.setInterval = () => {}

const { default: Account } = await import(ROOT + 'account.js')
const { default: Character } = await import(ROOT + 'character.js')
const { default: Guild } = await import(ROOT + 'guild.js')
const { createDefaultAccount } = await import(ROOT + 'storage.js')

let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }
const make = (name, race, cls, spec, role) => new Character({ characterName: name, characterRace: race, characterClass: cls, characterSpec: spec, characterRole: role })
const summary = (acc) => acc.guilds.map((g) => `${g.guildName}/${g.faction}:${g.characters.map((c) => c.characterName).join(',')}`).join(' | ')

// Structure.
const def = createDefaultAccount()
check('default guilds', summary(def) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(def))
check('characters come from guilds', def.characters.length === 3 && def.characters[2].characterName === 'Bassor')
const json = JSON.parse(JSON.stringify(def))
check('save nests characters in guilds', !('characters' in json) && json.guilds.every((g) => g.id && g.faction && Array.isArray(g.characters)) && typeof json.id === 'string')
const back = Account.fromJSON(json)
check('round-trip keeps guilds', summary(back) === summary(def) && back.guilds.every((g, i) => g.id === def.guilds[i].id) && back.id === def.id)
check('guildOf', def.guildOf(def.characters[2].id).guildName === 'South Bank Satellites')

// Gold belongs to guilds (worked out from their characters), not the account.
{
  const acc = createDefaultAccount()
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
const [troll, paka, bassor] = JSON.parse(JSON.stringify(createDefaultAccount().characters))
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
const stray = JSON.parse(JSON.stringify(createDefaultAccount()))
stray.guilds[0].characters.push({ ...stray.guilds[1].characters[0], id: 'stray', characterName: 'Strayhuman' })
check('wrong-faction character joins the existing guild of its faction', summary(Account.fromJSON(stray)) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor,Strayhuman')
const oldGold = Account.fromJSON({ ...legacy, characters: legacy.characters.map(({ copper, ...c }) => c), gold: 300 })
check('old account gold is split', oldGold.characters.every((c) => c.copper === 100), oldGold.characters.map((c) => c.copper).join())
const twoHorde = Account.fromJSON({ ...legacy, guilds: [{ guildName: 'TYMF', characterIds: [troll.id] }, { guildName: 'Iron Horde', characterIds: [paka.id] }, { guildName: 'South Bank Satellites', characterIds: [bassor.id] }] })
check('old second Horde guild merges into the first', summary(twoHorde) === 'TYMF/Horde:Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(twoHorde))

// Tampered new-format saves.
const bad = JSON.parse(JSON.stringify(createDefaultAccount()))
bad.guilds[1].characters.push(bad.guilds[0].characters.shift()) // a Horde character in the Alliance guild
bad.guilds.push({ id: bad.guilds[0].id, guildName: 'tymf', faction: 'Horde', characters: [] }) // clashing name
bad.guilds.push({ id: 'x y', guildName: 'Ok Guild', faction: 'Alliance', characters: [{ ...bad.guilds[1].characters[0] }] }) // bad id, duplicate character
bad.guilds.push({ guildName: '<b>', faction: 'Horde', characters: [{ ...bad.guilds[0].characters[0], id: 'moved' }] }) // invalid name
const fixed = Account.fromJSON(bad)
check('tampered save repaired', summary(fixed) === 'TYMF/Horde:Pakawakajaka,Trollwarrior,Pakawakajaka | South Bank Satellites/Alliance:Bassor', summary(fixed))
const extra = JSON.parse(JSON.stringify(createDefaultAccount()))
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

// Screens, starting with no guilds.
localStorage.setItem('gmrl.account', JSON.stringify({ accountName: 'empty', guilds: [], lastTick: Date.now() }))
await import(ROOT + 'interface.js')
const q = (s) => document.querySelector(s)
const qa = (s) => [...document.querySelectorAll(s)]
const go = (hash) => { location.hash = hash; w.dispatchEvent(new w.HashChangeEvent('hashchange')) }
const submit = () => q('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))
const click = (name, value) => q(`input[name=${name}][value="${value}"]`).closest('label').querySelector('.tile-body').click()
const saved = () => Account.fromJSON(JSON.parse(localStorage.getItem('gmrl.account')))
const createGuildLink = () => qa('.view-header a').some((a) => a.getAttribute('href') === '#/create-guild')

const createChar = () => qa('.view-header .button.primary').find((b) => b.textContent === '+ Create Character')
check('no guilds: only All Characters chip', qa('.guild-filter .chip').length === 1 && qa('.guild-chip').length === 0)
check('no guilds: Create Character greyed out', createChar()?.tagName === 'BUTTON' && createChar().disabled, createChar()?.outerHTML)
check('no guilds: empty text points to Create Guild', q('.empty a')?.getAttribute('href') === '#/create-guild')
go('#/create')
check('no guilds: create screen asks for a guild', !q('form') && q('.empty a')?.getAttribute('href') === '#/create-guild')

// Found a Horde guild.
go('#/create-guild')
check('both factions free, none preselected', qa('input[name=faction]').every((i) => !i.disabled && !i.checked))
click('faction', 'Horde')
q('#guildName').value = 'TYMF'
submit()
w.dispatchEvent(new w.HashChangeEvent('hashchange'))
check('roster chips by faction', qa('.guild-chip').map((c) => c.className).join() === 'chip guild-chip faction-horde')
check('roster has Create Guild', createGuildLink())
check('header shows guild gold, no account total', qa('#gold .guild-gold').map((s) => s.querySelector('strong').textContent).join() === 'TYMF' && !q('.account').textContent.includes('Gold:'), q('.account').textContent)
check('header shows whole gold only', qa('#gold .coin').every((c) => c.classList.contains('coin-gold') && /^[\d,]+g$/.test(c.textContent)), q('#gold').textContent)
check('Create Character enabled once a guild exists', createChar()?.tagName === 'A')
go('#/create')
check('picker shows only existing guilds', [...q('#guildId').querySelectorAll('.faction-name')].map((p) => p.textContent).join() === 'Horde' && qa('input[name=guildId]').length === 1 && !q('.character-form').textContent.includes('guild yet'))

go('#/create-guild')
check('guild form', q('#view-title').textContent === 'Create Guild' && qa('input[name=faction]').length === 2)
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
check('no dev tools or reset for players', footerButtons() === '' && !qa('button').some((b) => b.textContent.includes('Reset to default')), footerButtons())
check('dev mode only for listed accounts', !def.devMode && new Account('Dev', [], 0, [], [], '379d1f11-f7ac-4e09-ab3c-b51930ba2aa8').devMode && !('devMode' in JSON.parse(JSON.stringify(def))))

console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
