import { CLASSES, MAX_LEVEL, MIN_LEVEL, NAME_PATTERN, RACES, ROLES, classIcon, xpToNextLevel } from './data.js'
import { getZone } from './zones.js'
import { averageItemLevel, characterPower } from './power.js'
import { SLOTS, baseId, bestLoadout, getItem, getQuest, itemKey, levelToUse, offSpecGear, questRewardsFor, rollMobLoot, specOptions } from './gear.js'
import { farmRates, questXp } from './combat.js'
import { activeQuests, creditKill, nextAction, objectivesOf, pickUpQuests, tidyQuestLog, workable } from './quests.js'
import { isClassSpell, startingSpells, trainSpells } from './spells.js'
import { autoSpend, learnTalent, sanitizeTalents, talentPoints, unlearnTalent } from './talents.js'
import { nextZone } from './leveling.js'
import { grindPlan, huntedMobs } from './value.js'
import { canHold, getDungeon, dungeonLockReason, nextErrand, runErrand } from './dungeons.js'
import { MAX_RANK, maxRpAtLevel, rankOf, rankTitle } from './honor.js'
import { RESET_DAYS } from './reset.js'
import { owns, wantable } from './wanted.js'

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined)
const BAG_SIZE = 16
const LOG_SIZE = 20
const MIN_TIME_BANK = -12 * 3600 // owed after a long dungeon run
const HUNTED_NAMES = 3 // mob names in farmStatus
const KEPT_SIZE = 8

export default class Character {
  #planned = null // the next action in the current zone, kept until there's time to do it
  #rethink = null // a nextZone reason to look for a better zone at the next chance, after the wanted item changed
  #gotWanted = null // the wanted item's key once got, until it's in the loot log

  constructor({ id = crypto.randomUUID(), characterName, characterClass, characterSpec, characterRace, characterRole, characterLevel = MIN_LEVEL, characterXp = 0, zone = null, copper = 0, spells, talents, equipment = {}, bag = [], questsDone = [], questLog = {}, timeBank = 0, lootLog = [], honorableKills = 0, honor = 0, honorToday = null, honorPeriod = null, rankPoints = 0, highestRank = 0, honorLastPeriod = null, pvpKills = 0, pvpDeaths = 0, pvpLog = [], pvpReadyAt = 0, hearthReadyAt = 0, dungeonQuests = [], dungeonQueue = null, dungeonClears = {}, queueDeclined = null, restingAfter = null, wanted = null, kept = [] }) {
    this.id = id
    this.characterName = Character.formatName(characterName)
    this.characterClass = characterClass
    this.characterSpec = characterSpec
    this.characterRace = characterRace
    this.characterRole = characterRole
    this.characterLevel = Number(characterLevel)
    this.characterXp = characterXp // progress toward the next level
    this.zone = zone // name of the zone being farmed, or null when idle
    this.copper = copper // the character's own money
    this.spells = spells ?? startingSpells(characterClass) // known class spell ids, every rank
    this.talents = talents ?? {} // { talent key: rank }; see talents.js
    if (!talents) autoSpend(this) // the spec's default build
    this.equipment = equipment // { slot: itemId }
    this.bag = bag // item ids: the best gear for the character's other specs, then gear kept until it's high enough level
    this.questsDone = questsDone // quest ids
    this.questLog = questLog // { questId: [count per objective] } for the zone quests held; see quests.js
    this.timeBank = timeBank // farmed seconds not yet spent on a kill or quest; below zero after world PvP
    this.lootLog = lootLog // newest first: { item, source, at, equipped, quest? }
    this.honorableKills = honorableKills // players killed for honor
    this.honor = honor // honor points, unrounded
    this.honorToday = honorToday // { day (Eastern day, reset.js), kills: honorable, points: honor, victims: { characterId: kills for honor } }
    this.honorPeriod = honorPeriod // { period (reset.js), kills: honorable, points: honor } toward the next honor reset
    this.rankPoints = rankPoints // PvP rank points, unrounded; see honor.js
    this.highestRank = highestRank
    this.honorLastPeriod = honorLastPeriod // { kills, points, standing } for the period before the last honor reset, or null
    this.pvpKills = pvpKills // all players killed
    this.pvpDeaths = pvpDeaths
    this.pvpLog = pvpLog // newest first: see worldPvp in pvp.js
    this.pvpReadyAt = pvpReadyAt // ms time until which the character neither spots nor is spotted
    this.hearthReadyAt = hearthReadyAt // ms time the Hearthstone is back
    this.dungeonQuests = dungeonQuests // dungeon quest ids picked up and not yet turned in; they share the quest log
    this.dungeonQueue = dungeonQueue // { dungeon, since (ms), manual } while waiting for a group, else null
    this.dungeonClears = dungeonClears // { dungeon name: successful runs }
    this.queueDeclined = queueDeclined // { level, quests } when last taken out of the queue by hand
    this.restingAfter = restingAfter // name of the dungeon whose run it's still paying back time for (negative timeBank), or null
    this.wanted = wanted // base item id a player set the character to go after (one at a time), or null; see wanted.js
    this.kept = kept // item ids got by wanting them, newest first: never vendored, at most KEPT_SIZE
  }

  get xpToNextLevel() {
    return xpToNextLevel(this.characterLevel)
  }

  // { solo, party, base }: see power.js. The UI calls solo power "power level".
  get power() {
    return characterPower(this)
  }

  get itemLevel() {
    return averageItemLevel(this)
  }

  // Hourly grinding rates in the current zone (see farmRates and grindPlan), or undefined when idle.
  get rates() {
    const zone = getZone(this.zone)
    return zone ? farmRates(this, zone, grindPlan(this, zone.name)) : undefined
  }

  // What it's doing: "Resting after Wailing Caverns" while paying back a dungeon run's time, "Picking up
  // dungeon quests in Orgrimmar" on a pickup trip, "Questing in The Barrens: Raptor Thieves" on a quest, else
  // e.g. "Farming in Winterspring: Frostsaber Stalker, Winterfall Ursa", naming the mobs it grinds when it
  // hunts only some (see grindPlan).
  get farmStatus() {
    if (!this.zone) return 'Idle'
    if (this.restingAfter && this.timeBank < 0) return `Resting after ${this.restingAfter}`
    const action = getZone(this.zone) ? this.plannedAction : undefined
    if (action?.errand) return `Picking up dungeon quests ${action.errand.zone === null ? 'in town' : `in ${action.errand.zone}`}`
    if (action?.questId) return `Questing in ${this.zone}: ${getQuest(action.questId).title}`
    const hunted = getZone(this.zone) ? huntedMobs(this, this.zone) : []
    const names = hunted.length > HUNTED_NAMES ? [...hunted.slice(0, HUNTED_NAMES - 1), `${hunted.length - HUNTED_NAMES + 1} more`] : hunted
    return `Farming in ${this.zone}${names.length ? `: ${names.join(', ')}` : ''}`
  }

  get xpPerHour() {
    return this.rates?.xpPerHour ?? 0
  }

  get copperPerHour() {
    return this.rates?.copperPerHour ?? 0
  }

  // Hours until the next level at the current zone's rate, or Infinity if not gaining XP.
  get hoursToLevel() {
    const rate = this.xpPerHour
    return rate > 0 ? (this.xpToNextLevel - this.characterXp) / rate : Infinity
  }

  // Quest ids being worked on in the current zone.
  get activeQuests() {
    return this.zone ? activeQuests(this, this.zone) : []
  }

  // What the character does next in its zone: a dungeon quest pickup trip (see nextErrand in dungeons.js),
  // else see nextAction in quests.js. Undefined when there's nothing to do.
  get plannedAction() {
    if (!this.zone) return undefined
    if (this.#planned?.zone !== this.zone) this.#planned = { zone: this.zone, action: nextErrand(this) ?? nextAction(this, this.zone) }
    return this.#planned.action
  }

  // Farms for `hours`: one fight or quest turn-in after another, each taking its own time. Leftover time
  // carries over to the next call. Kills and quests pay XP, money and gear at the character's level when
  // they happen; the money buys new spell ranks as soon as they're affordable, and talent points from new
  // levels go into the spec's default build. The character moves to a better zone (see nextZone in
  // leveling.js) when it levels up, runs out of quests worth doing, can't beat anything, or (at max level)
  // wears an upgrade; the trip takes time. Pickups for dungeons it wants to run come first.
  // Returns the copper earned, levels gained, newly equipped item ids, zone moves ({ from, to, reason, level })
  // and pickup trips ({ zone, quests: dungeon quest ids picked up, steps: chain quests done }).
  farm(hours, now = Date.now()) {
    if (!getZone(this.zone) || hours <= 0) {
      if (hours > 0) this.timeBank = Math.min(0, this.timeBank + hours * 3600) // time owed for a dungeon run
      if (this.timeBank >= 0) this.restingAfter = null
      return { copper: 0, levels: 0, upgrades: [], travels: [], errands: [] }
    }

    const wornBefore = new Set(Object.values(this.equipment))
    let levels = 0
    let copper = 0
    const acquired = []
    const travels = []
    const errands = []
    this.timeBank += hours * 3600
    if (this.timeBank >= 0) this.restingAfter = null
    const travel = (move) => {
      travels.push({ from: this.zone, to: move.zone, reason: move.reason, level: this.characterLevel })
      this.zone = move.zone
      this.timeBank -= move.seconds
    }
    for (;;) {
      if (this.#rethink) {
        const move = nextZone(this, this.#rethink)
        this.#rethink = null
        if (move) travel(move)
      }
      pickUpQuests(this, this.zone)
      const action = this.plannedAction
      if (!action) {
        const move = nextZone(this, 'stuck') // nothing here the character can beat
        if (move) {
          travel(move)
          continue
        }
        this.timeBank = 0
        break
      }
      const seconds = action.seconds ?? action.fight.seconds
      if (seconds > this.timeBank) break
      this.timeBank -= seconds
      this.#planned = null

      const found = []
      let xp
      let earned
      if (action.fight) {
        const { entry, mob } = action.fight
        creditKill(this, this.zone, entry)
        xp = action.fight.xp
        earned = action.fight.copper
        for (const item of rollMobLoot(entry)) {
          if (levelToUse(this, getItem(item)) < Infinity) found.push({ item, source: mob.name })
        }
      } else if (action.errand) {
        const trip = runErrand(this, action.errand)
        xp = trip.xp
        earned = trip.copper
        found.push(...trip.found)
        errands.push({ zone: action.errand.zone, quests: trip.picked, steps: trip.steps })
      } else {
        const quest = getQuest(action.questId)
        this.questsDone.push(action.questId)
        delete this.questLog[action.questId]
        xp = questXp(this.characterLevel, quest)
        earned = quest.money ?? 0
        for (const item of questRewardsFor(this, quest)) found.push({ item, source: quest.title, quest: true })
      }
      copper += earned
      const gained = this.#gainXp(xp)
      levels += gained
      if (gained) autoSpend(this, talentPoints(this.characterLevel) - talentPoints(this.characterLevel - gained))
      const worn = Object.values(this.equipment).join()
      if (found.length || gained) this.equipBest(found.map((a) => a.item))
      const upgraded = worn !== Object.values(this.equipment).join()
      if (gained || upgraded) tidyQuestLog(this)
      acquired.push(...found)
      this.copper += earned
      trainSpells(this)
      const ranOut = !action.fight && !action.errand && !activeQuests(this, this.zone).some((id) => workable(this, id))
      const reason = gained ? 'level' : ranOut ? 'quests' : upgraded && this.characterLevel >= MAX_LEVEL ? 'gear' : undefined
      const move = reason && nextZone(this, reason)
      if (move) travel(move)
    }
    const upgrades = [...new Set(Object.values(this.equipment))].filter((id) => !wornBefore.has(id))
    this.#log(acquired, upgrades, now)
    return { copper, levels, upgrades, travels, errands }
  }

  // Pays out the end of a dungeon run (see runDungeon in dungeons.js): the kills' XP and money, then turning in
  // `quests`. Gear won in the run is already worn or bagged; `found` is only for the loot log. Returns
  // { xp, questCopper, levels, upgrades (vs `wornBefore`), travel }.
  finishDungeon({ xp, copper, found, quests, wornBefore }, now = Date.now()) {
    const fromLevel = this.characterLevel
    const acquired = [...found]
    let questCopper = 0
    let total = xp
    for (const id of quests) {
      const quest = getQuest(id)
      this.questsDone.push(id)
      total += questXp(this.characterLevel, quest)
      questCopper += quest.money ?? 0
      for (const item of questRewardsFor(this, quest)) acquired.push({ item, source: quest.title, quest: true })
    }
    this.dungeonQuests = this.dungeonQuests.filter((id) => !quests.includes(id))
    const levels = this.#gainXp(total)
    if (levels) autoSpend(this, talentPoints(this.characterLevel) - talentPoints(fromLevel))
    this.equipBest(acquired.filter((a) => a.quest).map((a) => a.item))
    this.copper += copper + questCopper
    trainSpells(this)
    tidyQuestLog(this)
    const upgrades = [...new Set(Object.values(this.equipment))].filter((id) => !wornBefore.has(id))
    this.#log(acquired, upgrades, now)
    this.#planned = null
    const move = levels > 0 && nextZone(this, 'level')
    const travel = move ? { from: this.zone, to: move.zone, reason: move.reason, level: this.characterLevel } : undefined
    if (move) {
      this.zone = move.zone
      this.timeBank -= move.seconds
    }
    return { xp: total, questCopper, levels, upgrades, travel }
  }

  // Sets the item a player wants the character to go after (any key of it; see wanted.js), or clears it with
  // null. It counts as a big upgrade wherever the character weighs loot, and the character looks for a
  // better zone at its next chance. Returns false if it can't be wanted or the character already has it.
  setWanted(key) {
    const id = key === null ? null : wantable(this, key)
    if (id === undefined || id === this.wanted || (id !== null && owns(this, id))) return false
    this.wanted = id
    this.#planned = null
    this.#rethink = id === null ? 'unwanted' : 'wanted'
    return true
  }

  // Talent changes from the talent selector. Each returns false if not allowed.
  learnTalent(key) {
    this.#planned = null
    return learnTalent(this, key)
  }

  unlearnTalent(key) {
    this.#planned = null
    return unlearnTalent(this, key)
  }

  // Takes every point back (talents are free to change).
  resetTalents() {
    this.#planned = null
    this.talents = {}
  }

  // Respends all points on the spec's default build.
  useDefaultTalents() {
    this.resetTalents()
    autoSpend(this)
  }

  // Switches to another spec (and role) of the class for free: respends talents on its default build and
  // puts on its best gear, keeping the old spec's gear in the bag. Returns false if the class can't play it.
  changeSpec(spec, role) {
    if (!specOptions(this.characterClass).some((o) => o.spec === spec && o.role === role)) return false
    this.characterSpec = spec
    this.characterRole = role
    this.useDefaultTalents()
    this.equipBest()
    return true
  }

  // Adds XP, leveling up as many times as it covers. Returns the levels gained.
  #gainXp(xp) {
    if (!xp || this.characterLevel >= MAX_LEVEL) return 0
    this.characterXp += xp
    let levels = 0
    while (this.characterLevel < MAX_LEVEL && this.characterXp >= this.xpToNextLevel) {
      this.characterXp -= this.xpToNextLevel
      this.characterLevel += 1
      levels += 1
    }
    if (this.characterLevel >= MAX_LEVEL) this.characterXp = 0
    return levels
  }

  // Puts on the best gear from what's worn, the bag, `kept` and `newItems`. Keeps the best gear for the
  // character's other specs and items that need a higher level in the bag; the rest is vendored, except
  // `kept`. Getting the wanted item puts it in `kept` and stops wanting it. Returns the item ids that were
  // newly put on.
  equipBest(newItems = []) {
    const before = new Set(Object.values(this.equipment))
    const held = [...Object.values(this.equipment), ...this.bag]
    const owned = [...held, ...newItems, ...this.kept.filter((key) => !held.includes(key) && !newItems.includes(key))]
    const got = this.wanted && newItems.find((key) => baseId(key) === this.wanted)
    if (got) {
      this.kept = [got, ...this.kept.filter((key) => key !== got)].slice(0, KEPT_SIZE)
      this.wanted = null
      this.#gotWanted = got
      this.#planned = null
      this.#rethink = 'found'
    }
    const { equipment, leftovers } = bestLoadout(this, owned)
    this.equipment = Object.fromEntries(Object.keys(SLOTS).filter((s) => equipment[s]).map((s) => [s, equipment[s]]))
    const worn = new Set(Object.values(this.equipment))
    const kept = new Set(this.kept)
    const offSpec = [...offSpecGear(this, owned).keys()].filter((id) => !worn.has(id) && !kept.has(id))
    const waiting = (id) => !worn.has(id) && !kept.has(id) && levelToUse(this, getItem(id)) > this.characterLevel && levelToUse(this, getItem(id)) < Infinity
    const later = [...new Set(leftovers.filter(waiting))]
      .sort((a, b) => getItem(b).itemLevel - getItem(a).itemLevel)
      .slice(0, BAG_SIZE)
    this.bag = [...new Set([...offSpec, ...later])]
    return [...worn].filter((id) => !before.has(id))
  }

  #log(acquired, upgrades, now) {
    const got = this.#gotWanted
    this.#gotWanted = null
    const notable = acquired.filter(({ item, quest }) => quest || item === got || getItem(item).quality >= 2 || upgrades.includes(item))
    const entries = notable.map(({ item, source, quest }) => ({ item, source, at: now, equipped: upgrades.includes(item), ...(quest && { quest }), ...(item === got && { wanted: true }) }))
    this.lootLog = [...entries.reverse(), ...this.lootLog].slice(0, LOG_SIZE)
  }

  // Restores gear, money, spell, talent, quest and PvP fields from untrusted saved data, dropping anything
  // that doesn't exist. Talents that aren't a legal build (or saves from before talents) get the default.
  restoreGear(data) {
    const ids = (list) => (Array.isArray(list) ? list.map(itemKey).filter((key) => key !== undefined) : [])
    const fraction = (value, max) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), 0), max) : 0)
    const equipped = data.equipment && typeof data.equipment === 'object' ? Object.values(data.equipment) : []
    this.copper = Math.floor(fraction(data.copper, Number.MAX_SAFE_INTEGER))
    const spells = Array.isArray(data.spells) ? data.spells.map(Number).filter((id) => isClassSpell(this.characterClass, id)) : []
    this.spells = [...new Set([...startingSpells(this.characterClass), ...spells])]
    const talents = sanitizeTalents(this.characterClass, this.characterLevel, data.talents)
    if (talents) this.talents = talents
    else this.useDefaultTalents()
    this.questsDone = [...new Set(Array.isArray(data.questsDone) ? data.questsDone.map(Number).filter((id) => getQuest(id)) : [])]
    const done = new Set(this.questsDone)
    this.questLog = {}
    for (const [key, counts] of Object.entries(data.questLog && typeof data.questLog === 'object' ? data.questLog : {})) {
      const id = Number(key)
      if (!getQuest(id) || done.has(id) || !Array.isArray(counts)) continue
      const objectives = objectivesOf(id)
      if (counts.length === objectives.length) this.questLog[id] = objectives.map((o, i) => Math.floor(fraction(counts[i], o.count)))
    }
    this.timeBank = Number.isFinite(Number(data.timeBank)) ? Math.min(Math.max(Number(data.timeBank), MIN_TIME_BANK), 3600) : 0
    this.lootLog = (Array.isArray(data.lootLog) ? data.lootLog : [])
      .filter((e) => e && itemKey(e.item) !== undefined && typeof e.source === 'string' && Number.isFinite(Number(e.at)))
      .slice(0, LOG_SIZE)
      .map((e) => ({ item: itemKey(e.item), source: e.source.slice(0, 100), at: Number(e.at), equipped: e.equipped === true, ...(e.quest === true && { quest: true }), ...(e.wanted === true && { wanted: true }) }))
    const count = (value) => Math.floor(fraction(value, Number.MAX_SAFE_INTEGER))
    this.honorableKills = count(data.honorableKills)
    this.honor = fraction(data.honor, Number.MAX_SAFE_INTEGER)
    const today = data.honorToday
    this.honorToday = today && typeof today === 'object' && Number.isInteger(today.day) && today.victims && typeof today.victims === 'object'
      ? {
          day: today.day,
          kills: count(today.kills),
          points: fraction(today.points, Number.MAX_SAFE_INTEGER),
          victims: Object.fromEntries(Object.entries(today.victims).filter(([id, n]) => id.length <= 64 && Number.isInteger(n) && n >= 1 && n <= 10).slice(0, 1000)),
        }
      : null
    // Saves before version 3 only counted the day: that day goes toward its period.
    const period = data.honorPeriod ?? (this.honorToday && { period: Math.floor(this.honorToday.day / RESET_DAYS), kills: this.honorToday.kills, points: this.honorToday.points })
    this.honorPeriod = period && typeof period === 'object' && Number.isInteger(period.period)
      ? { period: period.period, kills: count(period.kills), points: fraction(period.points, Number.MAX_SAFE_INTEGER) }
      : null
    this.rankPoints = fraction(data.rankPoints, maxRpAtLevel(MAX_LEVEL))
    this.highestRank = Math.max(Math.floor(fraction(data.highestRank, MAX_RANK)), this.rank)
    const last = data.honorLastPeriod
    this.honorLastPeriod = last && typeof last === 'object'
      ? { kills: count(last.kills), points: fraction(last.points, Number.MAX_SAFE_INTEGER), standing: count(last.standing) }
      : null
    this.pvpKills = Math.max(count(data.pvpKills), this.honorableKills)
    this.pvpDeaths = count(data.pvpDeaths)
    this.pvpLog = (Array.isArray(data.pvpLog) ? data.pvpLog : [])
      .filter((e) => e && Number.isFinite(Number(e.at)) && typeof e.foe === 'string' && lookup(CLASSES, e.foeClass) && lookup(RACES, e.foeRace) && typeof e.zone === 'string')
      .slice(0, LOG_SIZE)
      .map((e) => ({
        at: Number(e.at),
        foe: e.foe.slice(0, 12),
        foeLevel: Math.floor(fraction(e.foeLevel, MAX_LEVEL)) || MIN_LEVEL,
        foeClass: e.foeClass,
        foeRace: e.foeRace,
        zone: e.zone.slice(0, 100),
        attacked: e.attacked === true,
        ...(e.joined === true && { joined: true }),
        won: typeof e.won === 'boolean' ? e.won : null,
        ...(e.odds !== undefined && { odds: fraction(e.odds, 1) }),
        ...(e.guess !== undefined && { guess: fraction(e.guess, 1) }),
        ...(Array.isArray(e.size) && { size: [0, 1].map((i) => Math.floor(fraction(e.size[i], 5)) || 1) }),
        ...(e.kills !== undefined && { kills: Math.floor(fraction(e.kills, 5)) }),
        ...(e.honor === true && { honor: true }),
        ...(e.honor === true && e.points !== undefined && { points: fraction(e.points, 10000) }),
        ...(['ran', 'hid', 'hearth'].includes(e.fled) && { fled: e.fled }),
        ...(e.caught === true && { caught: true }),
      }))
    const later = (value) => fraction(value, Date.now() + 24 * 3600 * 1000)
    this.pvpReadyAt = later(data.pvpReadyAt)
    this.hearthReadyAt = later(data.hearthReadyAt)
    this.dungeonQuests = [...new Set(Array.isArray(data.dungeonQuests) ? data.dungeonQuests.map(Number).filter((id) => canHold(this, id) && !done.has(id)) : [])]
    const clears = data.dungeonClears && typeof data.dungeonClears === 'object' ? data.dungeonClears : {}
    this.dungeonClears = Object.fromEntries(Object.entries(clears).filter(([name]) => getDungeon(name)).map(([name, n]) => [name, count(n)]).filter(([, n]) => n > 0))
    const queue = data.dungeonQueue
    const queued = Array.isArray(queue?.dungeons) ? [...new Set(queue.dungeons)].filter((name) => typeof name === 'string' && !dungeonLockReason(this, getDungeon(name))) : []
    this.dungeonQueue = queued.length
      ? { dungeons: queued, since: fraction(queue.since, Date.now()), manual: queue.manual === true }
      : null
    const declined = data.queueDeclined
    this.queueDeclined = declined && typeof declined === 'object' && Number.isInteger(declined.level) && Number.isInteger(declined.quests)
      ? { level: declined.level, quests: declined.quests }
      : null
    this.restingAfter = this.timeBank < 0 && getDungeon(data.restingAfter) ? data.restingAfter : null
    this.equipment = {}
    this.bag = []
    this.wanted = null
    this.kept = [...new Set(ids(data.kept))].slice(0, KEPT_SIZE)
    this.equipBest([...ids(equipped), ...ids(data.bag)])
    const wanted = data.wanted == null ? undefined : wantable(this, itemKey(data.wanted))
    if (wanted !== undefined && !owns(this, wanted)) this.wanted = wanted
    tidyQuestLog(this)
  }

  get faction() {
    return RACES[this.characterRace].faction
  }

  // PvP rank, 0 (none) to 14; see honor.js.
  get rank() {
    return rankOf(this.rankPoints)
  }

  // The faction's title for the rank, or null at rank 0.
  get rankTitle() {
    return rankTitle(this.faction, this.rank)
  }

  get classColor() {
    return CLASSES[this.characterClass].color
  }

  get classIcon() {
    return classIcon(this.characterClass)
  }

  static formatName(name) {
    const trimmed = String(name ?? '').trim()
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }

  // Returns { field: message } for each invalid field; empty object when valid.
  static validate({ characterName, characterRace, characterClass, characterSpec, characterRole, characterLevel }) {
    const errors = {}
    const race = lookup(RACES, characterRace)
    const cls = lookup(CLASSES, characterClass)
    const level = Number(characterLevel)

    if (!NAME_PATTERN.test(String(characterName ?? '').trim())) {
      errors.characterName = 'Name must be 2 to 12 letters (A to Z only).'
    }
    if (!race) errors.characterRace = 'Choose a race.'
    if (!cls) errors.characterClass = 'Choose a class.'
    else if (race && !race.classes.includes(characterClass)) {
      errors.characterClass = `${characterRace} can't be a ${characterClass}.`
    }
    if (!ROLES.includes(characterRole)) errors.characterRole = 'Choose a role.'
    else if (cls && !cls.roles.includes(characterRole)) {
      errors.characterRole = `${characterClass} can't fill the ${characterRole} role.`
    }
    if (cls) {
      const specRoles = lookup(cls.specs, characterSpec)
      if (!characterSpec) errors.characterSpec = 'Choose a spec.'
      else if (!specRoles) errors.characterSpec = `${characterClass} has no ${characterSpec} spec.`
      else if (!errors.characterRole && !specRoles.includes(characterRole)) {
        errors.characterSpec = `${characterSpec} ${characterClass} can't fill the ${characterRole} role.`
      }
    }
    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      errors.characterLevel = `Level must be a whole number from ${MIN_LEVEL} to ${MAX_LEVEL}.`
    }
    return errors
  }
}
