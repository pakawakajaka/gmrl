# gmrl
Guild Master Raid Leader


    npm install
    npm start

This runs `dev-server.js` (live-server on http://127.0.0.1:8080 plus a save endpoint) and opens main.html.

Characters and guild memberships are saved in the browser's localStorage. On the roster, "Save to file" writes that data to `gmrl-save.json` in this folder, and "Reset to default data" restores the starting characters.

## Gear

Characters farming a zone fight its real Classic mobs (see Mobs and quests) and roll each kill's real loot table. Quest rewards come on turn-in (the best choice reward is taken). The best usable gear for the character's spec is equipped automatically. The bag keeps the best set for each of the class's other specs that values gear differently, labeled "Off-spec: <specs>" (Arms and Fury share one set; mage specs add nothing), plus items that need a higher level ("For later levels", up to 16); the rest is sold. Recent loot is listed under the bag. Clicking a character on the roster opens their character page, which shows the equipped items, Classic tooltips, stats and power. Characters can't be edited after creation; they can be deleted from their character page. Stats use Classic 1.12 formulas and include passive talents but not buffs. Random-enchant items ("of the Bear", "of Power", ...) drop from mobs and roll their suffix with the real Classic odds for that item. "of Regeneration" (health per 5 sec) is skipped because there's no source data for its values. Dungeon loot isn't included.

## Talents

Characters get one talent point per level from 10 to 60 (51 total), using the real Classic trees (`talents.js`). Each spec has a default build. Points earned while leveling idly are spent along that build automatically. The Talents panel on the character page shows the current split and opens the talent selector (`#/character/<id>/talents`), where default-build talents are highlighted in gold. Click a talent to learn a rank; Shift+click or right-click removes one. "Use default build" and "Reset" respec for free. The Spec picker changes spec for free too: it respends on the new spec's default build and swaps in that spec's gear from the bag (Feral has Tank and DPS options). Once you change a build by hand, idle leveling keeps spending along the default order wherever it's still legal.

The fights simulate passive talents that change stats, damage, crit, hit, costs, cast times, cooldowns and similar values. The tooltip on each talent shows whether it's simulated fully, partly or not at all. Active abilities granted by talents, proc effects (Flurry, Deep Wounds, ...), scripted talents (Anger Management, Ignite, ...) and pet talents aren't simulated yet.

## Power

Gear is summed up in two numbers (`power.js`). They're for display; fights are simulated from the actual stats (see Fights below).

- **Item level**: the average item level of worn gear (every slot except shirt and tabard, empty slots as 0, a two-hander for both hands). It's display only, a quick read on how good the gear is.
- **Power level** (`solo` in the code) = (level power × level share + gear power) × class and role factors.
  - Level share is what a naked character has from spells, talents and base stats: 40% for melee and tanks, 50% for hunters, 60% for casters and healers.
  - Gear power is the sum of what each worn item adds from its actual stats, weapon damage and armor, valued with the spec's stat weights (the same ones used to pick gear). Better items add more power whatever the character's level.
  - Hunters and warlocks solo fastest; tanks and healers solo slowest.

**Party power** uses the same level and gear but rewards tanks and healers (1.5×) instead. It isn't shown yet; it's for future dungeon and raid grouping.

Balance constants are at the top of `combat.js`. Power level is shown for comparison only; fights don't use it.

## Mobs and quests

Each zone has the mobs that spawn there in Classic (`combat.js`), with their level range, health, damage, armor, run speed, resistances, coin and loot table. Elites (other than rare spawns), bosses, critters, NPCs and event mobs are left out, as are border spawns well outside the zone's level range.

- **Fights** (`sim.js`) are simulated event by event with CMaNGOS formulas: weapon swings, hit tables (miss, dodge, parry, glancing, block, crit, crushing), armor, spell hit, crit and partial resists, spell power coefficients and low-level penalties, cast times, GCD, cooldowns, DoT ticks, pushback, rage, energy, combo points, mana and the five-second rule. The mob runs in from pull range (slowed by Frostbolt and the like) unless pulled in melee. Each class tries a few rotations with its best trained ranks (e.g. Heroic Strike thresholds, Slice and Dice or not, which filler spell, wand or not, dots or not, cat form, bear form or caster) and keeps whichever gets through the fight, rest and next pull fastest. Druids get Bear Form and Maul at 10 and Aquatic Form at 16 from their class quests, then train Cat Form at 20, Travel Form at 30 and Dire Bear Form at 40; in form they fight with paws (by level, swing 1.0 for cats and 2.5 for bears) and get the form's passive attack power, and bears its health and armor and rage from hits dealt and taken. Self-buffs (armors, auras, blessings, shouts, shields) are kept up and their mana counted; hunter and warlock pets fight and tank, and heal up after. After each fight the character eats and drinks back what they lost, using the best Classic vendor food and water for their level (free) on top of their spirit regen (×1.5 while sitting) and any health or mana per 5 sec; warlocks Life Tap spare health first. A mob the character can't kill in any rotation is too strong and skipped. Not modeled yet: talents, kiting, procs from gear, ammo.
- **Gold and spells**: each character keeps its own gold. Every class starts with its level-1 spells and buys new ranks from its trainer (Classic costs) as soon as it can afford them, most important abilities first. The header shows the account's total.
- **Quests** (`quests.js`): characters keep up to 5 of the zone's available quests (level, faction, race, class and quest chains respected). They turn in finished quests first, then hunt the mob that finishes the next objective fastest (kill counts, or item drops at their real drop chance), then grind. Kills count for every quest that needs them. Quests that only need talking or delivering finish in 5 minutes; each object to use, item to loot from an object in the world or spell to cast on something adds 30 seconds. Turning in pays Classic quest XP, money and gear.
- **Grinding**: random mobs from green to orange con, weighted by how many spawn. If the zone has too few, the nearest common mobs instead.
- **XP** follows Classic: more for higher-level mobs, falling off below the character's level and none once they're gray; quest XP drops once the character is 6 levels over the quest. Both are doubled (`XP_RATE`), so 1 to 60 takes about 75 to 125 hours depending on class. Gold isn't reduced by outleveling, so outleveled zones still pay.

The farm table shows grinding rates; questing adds to them.

## Leveling paths

Each race has a default leveling path (`leveling.js`): a list of zones, each with the level the character heads there. Orcs and Trolls both start in Durotar, and Dwarves and Gnomes both start in Dun Morogh, but each pair splits up after that. A farming character below 60 follows its path on its own:

- When it reaches a step's level, it moves to that step's zone. If that zone has no quests for it yet, it goes to the next zone on the path that does.
- When it turns in the last quest available in its zone, it moves on to the next zone on the path (from its current level's step on) that still has quests.

Idle characters stay idle. You can still send a character anywhere; it stays there until it hits the next step's level or runs out of quests. Level 60 characters stay wherever they're sent. Moves show up as notices. The character page lists the path with the current step in gold, and the farm table marks that step's zone with "Path". Following the path takes about as long as always picking the best-XP zone (78 to 105 hours to 60 in the simulation).

## World PvP

It's a PvP server (`pvp.js`). Two characters of opposite factions farming the same contested zone come across each other about every 2 hours (`MEETS_PER_HOUR`). One notices first, and half the time the other notices too.

- **The decision**: the spotter sees only the enemy's level, not gear or talents, and never attacks anyone more than 2 levels above it. Otherwise it guesses its chance from the level gap, adds a lot of bravado and some random drunken noise, and attacks if the guess is 40% or better. An even fight looks like about 69%, so players gank enemies they can't beat.
- **Getting away**: a player who won't attack a higher-level enemy hides or runs, whichever is less likely to get it caught. Rogues, Night Elves and Druids from 20 hide in stealth. A hider is found if the enemy noticed and spots it anyway; a runner is caught by speed. Mounts (40), Ghost Wolf (20), Travel Form (trained at 30) and Aspect of the Cheetah (20) make a player faster and more likely to notice; the character sheet shows which one a character has. A caught player fights; one that gets away loses a minute of farming.
- **Others join**: a fight is much easier to notice than a player farming. Anyone else in the zone, friend or foe, may notice it and decide once whether to join, counting levels and heads. Each side holds at most 5 players, counting anyone who has ever joined it: at 5 on 5 the fight is locked, and nobody else gets in even after players die or leave.
- **The fight** is simulated with the same engine as mob fights, all players at once, with PvP rules from CMaNGOS: no glancing or crushing blows, player defense and resistances, and the PvP spell hit table. The attacker opens; the victim fights back after 0.5 to 2.5 seconds, more if it has to run in at a caster. Healers heal when a few seconds from death at the rate they're being hit. One on one, every pairing of the two sides' rotations is fought; the attacker picks the one with the best worst case and the victim answers with the best counter. That gives both kill times, how much each can swing, and the attacker's real chance to win, and one roll at that chance decides it. The fight is then played out blow by blow, each player's luck nudged just enough that it ends the way the roll went, which also sets how hurt the winner is. Once others join it's a brawl: everyone attacks the enemy with the least health left, healers heal whoever needs it most, and each player gets a roll for how well it plays. It goes on until one side is gone or 10 minutes pass.
- **Bubble hearth**: a Paladin from 34 that's losing casts Divine Shield and hearths out. It counts as neither a death nor a kill, costs 10 minutes of getting back, and works once an hour.
- **The cost**: the fight's time, plus eating and drinking for survivors, or a 2-minute corpse run and reviving at half health and mana for the dead, is taken from farming time.
- **Limits**: a player is in at most 4 fights an hour. For 15 minutes after joining one, and until it has recovered, it neither spots nor is spotted. With about a dozen players per faction in a zone, each one fights about twice an hour.
- **Honor**: each player killed gives a kill to every enemy there when it fell, and honor split evenly between them, as in Classic 1.12 (vmangos `GetHonorGain`, everyone at rank 0): 188.3 × a killer-level coefficient (1 at 60, 0.9545 at 50+, 0.5707 at 40+, 0.3434 at 30+, 0.207 at 20+, 0.1212 below) × the kill-XP level factor (+5% per level the victim is above, up to +20%; fading to nothing at gray) × 10% less for each earlier kill of the same player that UTC day. A kill worth honor is an honorable kill; past 10 a day on one player, kills give none. The character page shows honor, honorable kills, kills, deaths and the last 20 encounters; the Roster and Farm pages can sort by honor and honorable kills. The World PvP page lists the account's last 200 fights and escapes; each opens a page with both sides, who added, who died or bubble-hearthed out and when, the ganker's guess against its real odds, and each player's damage, healing and damage taken by ability. The newest 20 fights also keep their combat log, every blow and heal with the target's health after it; older ones show a timeline. As on Warcraft Logs, players show in their class color and abilities in their spell school's. Blows land for their average: the sim has no crits or misses.

Not modeled: stuns, fears, roots, kiting, stealth openers, trinkets, and running away mid-fight (except bubble hearth). The game data has no mounts, stealth or Divine Shield, so they're given by class and level; Travel Form's speed comes from its spell data. Tuning constants are at the top of `pvp.js`.

`gear-data.js` is generated. To rebuild it, put the source data in a folder and run:

    node tools/build-gear-data.mjs /path/to/data

Data sources: items, loot, quests, creatures and base stats from [CMaNGOS classic-db](https://github.com/cmangos/classic-db) and [mangos-classic](https://github.com/cmangos/mangos-classic) (GPL-2.0); quest and creature zones from [pfQuest](https://github.com/shagu/pfQuest) (MIT); item icons and tooltip text from [wow-classic-items](https://github.com/nexus-devs/wow-classic-items) (MIT); random suffix stats from [wowsims/classic](https://github.com/wowsims/classic) (MIT). Item icons are loaded from Wowhead's image CDN when it can be reached.