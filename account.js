import Character from './character.js'
import Guild from './guild.js'
import { MIN_LEVEL, defaultSpec } from './data.js'
import { getZone, zoneLockReason } from './zones.js'
import { startZone } from './leveling.js'
import { encounterRecord, restoreEncounter, worldPvp } from './pvp.js'
import { RUN_LOG_SIZE, autoQueue, formGroups, joinQueue, leaveQueue, restoreRun } from './dungeons.js'
import { honorResets } from './honor.js'
import { periodOf, periodStart } from './reset.js'
import { baseId } from './gear.js'

const ID_PATTERN = /^[\w-]+$/
const MS_PER_HOUR = 3600 * 1000
const SLICE_HOURS = 1 // long catch-ups run in slices so PvP sees levels change along the way
export const MAX_AWAY_HOURS = 30 // time away beyond this isn't paid out
export const ENCOUNTER_LOG_SIZE = 50
export const ENCOUNTER_DETAIL_SIZE = 10 // the newest encounters that keep their combat log
// Bump when the save format changes, and upgrade older saves in fromJSON.
// 1: guilds hold characters. Saves without a saveVersion are from before versioning: either that format or
//    the older one (account-wide characters, guilds listing characterIds).
// 2: characters have PvP ranks (rankPoints, highestRank, honorLastDay; honorToday counts kills and points).
//    Older saves start at rank 0.
// 3: the honor reset is every 3 days: honorPeriod counts kills and points toward it, honorLastPeriod
//    replaces honorLastDay. Older saves count honorToday toward its period and drop honorLastDay.
// 4: characters can want an item (wanted) and keep what they got by wanting it (kept), and remember the
//    dungeon they're back from (restingAfter). Older saves want nothing and rest after nothing.
export const SAVE_VERSION = 4
// Accounts that get dev tools (e.g. Save to file). Not a security boundary: the save endpoint is dev-server only.
const DEV_ACCOUNT_IDS = new Set(['379d1f11-f7ac-4e09-ab3c-b51930ba2aa8'])

// Drops the combat log from all but the newest encounters.
function trimLogs(encounters) {
  for (const e of encounters.slice(ENCOUNTER_DETAIL_SIZE)) e.log = null
}

// Account -> guilds -> characters. Each guild is of one faction and every character is in exactly one guild.
export default class Account {
  constructor(accountName, guilds = [], lastTick = Date.now(), encounters = [], dungeonRuns = [], id = crypto.randomUUID()) {
    this.id = id
    this.accountName = accountName
    this.guilds = guilds
    this.lastTick = lastTick // ms timestamp up to which farming has been paid out
    this.encounters = encounters // world PvP, newest first: see encounterRecord in pvp.js
    this.dungeonRuns = dungeonRuns // newest first: see runDungeon in dungeons.js
  }

  // Every character in every guild. A getter, so it isn't saved twice.
  get characters() {
    return this.guilds.flatMap((g) => g.characters)
  }

  get devMode() {
    return DEV_ACCOUNT_IDS.has(this.id)
  }

  toJSON() {
    return { saveVersion: SAVE_VERSION, ...this }
  }

  // Pays out farming from `lastTick` to `now`, with world PvP in contested zones and dungeon runs along the
  // way, and the honor reset (honor.js) at the end of each period (reset.js) in between. Returns who leveled up, new
  // gear still worn, the PvP fights (each with the `id` of its encounter record), zone moves
  // ({ character, from, to, reason, level }), dungeon quest pickup trips ({ character, zone, quests, steps }),
  // dungeon runs (records, see runDungeon), PvP rank changes ({ character, from, to }) and wanted items got
  // ({ character, item }). Pays out at most
  // the last MAX_AWAY_HOURS: `awayHours` is the whole time since the last tick, `hours` the part paid out.
  // Resets in the unpaid part still happen, with no honor earned.
  tick(now = Date.now(), random = Math.random) {
    const awayHours = Math.max(0, now - this.lastTick) / MS_PER_HOUR
    const hours = Math.min(awayHours, MAX_AWAY_HOURS)
    const start = now - hours * MS_PER_HOUR
    const resetFrom = this.lastTick // resets are done up to here
    this.lastTick = Math.max(this.lastTick, now)
    const result = { awayHours, hours, levelUps: [], upgrades: [], fights: [], travels: [], errands: [], runs: [], ranks: [], wanted: [] }
    const leveled = new Set()
    const upgraded = new Map(this.characters.map((c) => [c, new Set()]))
    const ranks = new Map(this.characters.map((c) => [c, c.rank]))
    const wanted = new Map(this.characters.filter((c) => c.wanted).map((c) => [c, c.wanted]))
    honorResets(this.characters, resetFrom, start)
    // Slices end at each reset, so a period's honor is all in before it.
    for (let from = start; from < now;) {
      const sliceEnd = Math.min(from + SLICE_HOURS * MS_PER_HOUR, now, periodStart(periodOf(from) + 1))
      const slice = (sliceEnd - from) / MS_PER_HOUR
      const fights = worldPvp(this.characters, slice, sliceEnd, random)
      for (const fight of fights) {
        fight.id = crypto.randomUUID()
        this.encounters.unshift(encounterRecord(fight, fight.id))
      }
      result.fights.push(...fights)
      for (const character of this.characters) {
        const { levels, upgrades, travels, errands } = character.farm(slice, now)
        if (levels > 0) leveled.add(character)
        for (const item of upgrades) upgraded.get(character).add(item)
        for (const travel of travels) result.travels.push({ character, ...travel })
        for (const errand of errands) result.errands.push({ character, ...errand })
        autoQueue(character, sliceEnd)
      }
      for (const run of formGroups(this.characters, sliceEnd, random)) {
        this.dungeonRuns.unshift(run.record)
        result.runs.push(run.record)
        run.members.forEach((character, i) => {
          const { levels, upgrades, travel } = run.results[i]
          if (levels > 0) leveled.add(character)
          for (const item of upgrades) upgraded.get(character).add(item)
          if (travel) result.travels.push({ character, ...travel })
        })
      }
      honorResets(this.characters, from, sliceEnd)
      from = sliceEnd
    }
    result.levelUps = [...leveled]
    for (const [character, from] of ranks) if (character.rank !== from) result.ranks.push({ character, from, to: character.rank })
    for (const [character, id] of wanted) {
      const item = character.kept.find((key) => baseId(key) === id)
      if (character.wanted !== id && item) result.wanted.push({ character, item })
    }
    if (this.encounters.length > ENCOUNTER_LOG_SIZE) this.encounters.length = ENCOUNTER_LOG_SIZE
    if (this.dungeonRuns.length > RUN_LOG_SIZE) this.dungeonRuns.length = RUN_LOG_SIZE
    trimLogs(this.encounters)
    for (const [character, items] of upgraded) {
      const worn = new Set(Object.values(character.equipment))
      for (const item of items) if (worn.has(item)) result.upgrades.push({ character, item })
    }
    return result
  }

  sendToZone(characterId, zoneName, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character || zoneLockReason(character, getZone(zoneName))) return false
    this.tick(now)
    character.zone = zoneName
    return true
  }

  recall(characterId, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character) return
    this.tick(now)
    character.zone = null
    character.timeBank = Math.min(0, character.timeBank)
  }

  // Puts the character in the queue for the dungeon; a group forms on the next tick. Returns false if it
  // can't enter it.
  queueDungeon(characterId, dungeonName, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character) return false
    this.tick(now)
    return joinQueue(character, dungeonName, now)
  }

  leaveDungeonQueue(characterId, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character) return
    this.tick(now)
    leaveQueue(character)
  }

  // Sets the item the character goes after (see Character.setWanted), or clears it with null. Returns false
  // if it can't.
  wantItem(characterId, key, now = Date.now()) {
    const character = this.getCharacter(characterId)
    if (!character) return false
    this.tick(now)
    return character.setWanted(key)
  }

  getCharacter(id) {
    return this.characters.find((c) => c.id === id)
  }

  getGuild(id) {
    return this.guilds.find((g) => g.id === id)
  }

  guildOf(characterId) {
    return this.guilds.find((g) => g.has(characterId))
  }

  isNameTaken(name) {
    const wanted = name.trim().toLowerCase()
    return this.characters.some((c) => c.characterName.toLowerCase() === wanted)
  }

  isGuildNameTaken(name) {
    const wanted = Guild.formatName(name).toLowerCase()
    return this.guilds.some((g) => g.guildName.toLowerCase() === wanted)
  }

  // For alpha testing an account may have one guild per faction. Later it will be one guild in all.
  canFoundGuild(faction) {
    return !this.guilds.some((g) => g.faction === faction)
  }

  // Adds a new, empty guild. Returns false if it's invalid, its name is taken or the account already has a
  // guild of its faction. Guilds can't be renamed and characters can't move between guilds.
  addGuild(guild) {
    if (Object.keys(Guild.validate(guild)).length > 0 || this.isGuildNameTaken(guild.guildName)) return false
    if (!this.canFoundGuild(guild.faction)) return false
    if (this.getGuild(guild.id)) return false
    guild.guildName = Guild.formatName(guild.guildName)
    this.guilds.push(guild)
    return true
  }

  // Adds a new character to the guild. New characters always start at level 1 with no XP or gear, farming
  // in their race's starting zone. Characters can't be edited after creation. Returns false if there's no
  // such guild or it's of the other faction.
  addCharacter(character, guildId, now = Date.now()) {
    const guild = this.getGuild(guildId)
    if (!guild || guild.faction !== character.faction) return false
    this.tick(now)
    character.characterLevel = MIN_LEVEL
    character.characterXp = 0
    character.talents = {}
    character.zone = startZone(character)
    return guild.add(character)
  }

  deleteCharacter(id) {
    for (const guild of this.guilds) guild.remove(id)
  }

  // Rebuilds an Account from untrusted saved data, dropping anything invalid.
  // Reads both the current format (guilds holding characters) and the old one (account-wide characters with
  // guilds listing characterIds; an old guild takes its members' majority faction).
  static fromJSON(data, now = Date.now()) {
    const seen = new Set()
    const restore = (saved) => {
      if (!saved || typeof saved.id !== 'string' || !ID_PATTERN.test(saved.id) || seen.has(saved.id)) return null
      const c = { ...saved, characterSpec: saved.characterSpec ?? defaultSpec(saved.characterClass, saved.characterRole) }
      if (Object.keys(Character.validate(c)).length > 0) return null
      seen.add(c.id)
      const character = new Character({ ...c, characterXp: 0, zone: null, copper: 0, spells: undefined, talents: {}, equipment: {}, bag: [], questsDone: [], questLog: {}, timeBank: 0, lootLog: [], honorableKills: 0, honor: 0, honorToday: null, honorPeriod: null, rankPoints: 0, highestRank: 0, honorLastPeriod: null, pvpKills: 0, pvpDeaths: 0, pvpLog: [], pvpReadyAt: 0, hearthReadyAt: 0, dungeonQuests: [], dungeonQueue: null, dungeonClears: {}, queueDeclined: null, restingAfter: null, wanted: null, kept: [] })
      const xp = Number(c.characterXp)
      if (Number.isFinite(xp) && xp > 0 && xp < character.xpToNextLevel) character.characterXp = xp
      if (!zoneLockReason(character, getZone(c.zone))) character.zone = c.zone
      character.restoreGear(c)
      return character
    }

    const guilds = []
    const homeless = []
    const nameTaken = (name) => guilds.some((g) => g.guildName.toLowerCase() === name.toLowerCase())
    // Keeps the guild if it's valid, its name is free and its faction has no guild yet (see canFoundGuild);
    // a clashing id gets a new one.
    const keep = (guild) => {
      if (Object.keys(Guild.validate(guild)).length > 0 || nameTaken(guild.guildName)) return false
      if (guilds.some((g) => g.faction === guild.faction)) return false
      if (typeof guild.id !== 'string' || !ID_PATTERN.test(guild.id) || guilds.some((g) => g.id === guild.id)) {
        guild.id = crypto.randomUUID()
      }
      guilds.push(guild)
      return true
    }
    const savedGuilds = (Array.isArray(data.guilds) ? data.guilds : []).filter((g) => g && typeof g === 'object')
    const legacy = !(Number(data.saveVersion) >= 1) && Array.isArray(data.characters)

    if (legacy) {
      const characters = data.characters.map(restore).filter(Boolean)
      const members = new Map()
      for (const g of savedGuilds) {
        const ids = new Set(Array.isArray(g.characterIds) ? g.characterIds : [])
        const counts = {}
        for (const c of characters) if (ids.has(c.id)) counts[c.faction] = (counts[c.faction] ?? 0) + 1
        const faction = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
        const guild = new Guild({ guildName: Guild.formatName(g.guildName), faction })
        if (keep(guild)) members.set(guild, ids)
      }
      for (const c of characters) {
        const home = guilds.find((g) => g.faction === c.faction && members.get(g).has(c.id))
        if (home) home.add(c)
        else homeless.push(c)
      }
      // Saves from before characters kept their own money have account-wide gold instead.
      const gold = data.characters.some((c) => c?.copper !== undefined) ? 0 : Number(data.gold)
      if (Number.isFinite(gold) && gold > 0) for (const c of characters) c.copper += gold / characters.length
    } else {
      for (const g of savedGuilds) {
        const characters = (Array.isArray(g.characters) ? g.characters : []).map(restore).filter(Boolean)
        const guild = new Guild({ id: g.id, guildName: Guild.formatName(g.guildName), faction: g.faction })
        if (!keep(guild)) homeless.push(...characters)
        else for (const c of characters) if (!guild.add(c)) homeless.push(c)
      }
    }

    // Characters whose guild was dropped (invalid, or a second guild of its faction) or of the other faction
    // join the account's guild of their faction. No guild is made for them; without one they're dropped.
    for (const c of homeless) guilds.find((g) => g.faction === c.faction)?.add(c)

    const lastTick = Number(data.lastTick)
    const encounters = (Array.isArray(data.encounters) ? data.encounters.slice(0, ENCOUNTER_LOG_SIZE) : []).map(restoreEncounter).filter(Boolean)
    trimLogs(encounters)
    const runs = (Array.isArray(data.dungeonRuns) ? data.dungeonRuns.slice(0, RUN_LOG_SIZE) : []).map(restoreRun).filter(Boolean)
    return new Account(
      String(data.accountName),
      guilds,
      Number.isFinite(lastTick) && lastTick > 0 ? Math.min(lastTick, now) : now,
      encounters,
      runs,
      typeof data.id === 'string' && ID_PATTERN.test(data.id) ? data.id : undefined,
    )
  }
}
