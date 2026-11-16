import { writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
globalThis.document = dom.window.document; globalThis.window = dom.window
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { default: Character } = await import(root + 'character.js')
const { default: Account } = await import(root + 'account.js')
const { default: Guild } = await import(root + 'guild.js')
const specs = [['Warrior', 'Protection', 'Orc', 'Tank'], ['Shaman', 'Restoration', 'Tauren', 'Healer'], ['Mage', 'Frost', 'Undead', 'DPS'], ['Rogue', 'Combat', 'Undead', 'DPS'], ['Hunter', 'Marksmanship', 'Troll', 'DPS']]
const chars = specs.map(([cls, spec, race, role], i) => new Character({ id: `c${i}`, characterName: `${cls}${'abcde'[i]}`, characterClass: cls, characterSpec: spec, characterRace: race, characterRole: role, characterLevel: 1, zone: 'Durotar' }))
const now = Date.now(), start = now - 40 * 3600e3
const acc = new Account('Shots', [new Guild({ guildName: 'Shots', faction: 'Horde', characters: chars })], start)
for (let t = start; t < now; t += 3600e3) acc.tick(Math.min(now, t + 3600e3))
acc.tick(now)
writeFileSync('/tmp/run-save.json', JSON.stringify(acc))
console.log(acc.dungeonRuns.length, 'runs', acc.dungeonRuns.map((r) => `${r.dungeon}:${r.success}`).join(' '))
