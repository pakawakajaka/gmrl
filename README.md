# gmrl
Guild Master Raid Leader


    npm install
    npm start

This runs `dev-server.js` (live-server on http://127.0.0.1:8080 plus a save endpoint) and opens main.html.

Characters and guild memberships are saved in the browser's localStorage. On the roster, "Save to file" writes that data to `gmrl-save.json` in this folder, and "Reset to default data" restores the starting characters.

## Gear

Characters farming a zone fight its real Classic mobs (see Mobs and quests) and roll each kill's real loot table. Quest rewards come on turn-in (the best choice reward is taken). The best usable gear for the character's spec is equipped automatically; items that need a higher level wait in the bag and the rest is sold. Clicking a character on the roster opens their character page, which shows the equipped items, Classic tooltips, stats and power. Characters can't be edited after creation; they can be deleted from their character page. Stats use Classic 1.12 formulas without talents or buffs. Random-enchant items ("of the Bear", "of Power", ...) drop from mobs and roll their suffix with the real Classic odds for that item. "of Regeneration" (health per 5 sec) is skipped because there's no source data for its values. Dungeon loot isn't included.

## Power

Gear and farming connect through power (`power.js`). Players see two numbers:

- **Item level**: the average item level of worn gear (every slot except shirt and tabard, empty slots as 0, a two-hander for both hands). It's display only, a quick read on how good the gear is.
- **Power level** (`solo` in the code) = (level power × level share + gear power) × class and role factors.
  - Level share is what a naked character has from spells, talents and base stats: 40% for melee and tanks, 50% for hunters, 60% for casters and healers.
  - Gear power is the sum of what each worn item adds from its actual stats, weapon damage and armor, valued with the spec's stat weights (the same ones used to pick gear). Better items add more power whatever the character's level.
  - Hunters and warlocks solo fastest; tanks and healers solo slowest.

**Party power** uses the same level and gear but rewards tanks and healers (1.5×) instead. It isn't shown yet; it's for future dungeon and raid grouping.

Balance constants are at the top of `power.js` and `combat.js`.

## Mobs and quests

Each zone has the mobs that spawn there in Classic (`combat.js`), with their level range, health, damage, armor, coin and loot table. Elites (other than rare spawns), bosses, critters, NPCs and event mobs are left out, as are border spawns well outside the zone's level range.

- **Fights**: damage per second comes from power level, so a fight lasts mob health ÷ DPS. The mob hits back for its own DPS, reduced by the character's armor (Classic armor formula) and by class (pets, ranged and kiting take less). Casters also spend mana while fighting. After each fight the character eats and drinks back what they lost, using the best Classic vendor food and water for their level (free, nothing to buy) on top of their spirit regen (Classic per-class formulas, ×1.5 while sitting) and any health or mana per 5 sec; regen while finding the next mob counts too. A mob that would deal more than the character's health is too strong and skipped.
- **Quests** (`quests.js`): characters keep up to 5 of the zone's available quests (level, faction, race, class and quest chains respected). They turn in finished quests first, then hunt the mob that finishes the next objective fastest (kill counts, or item drops at their real drop chance), then grind. Kills count for every quest that needs them. Quests that only need talking or delivering finish in 5 minutes. Turning in pays Classic quest XP, money and gear.
- **Grinding**: random mobs from green to orange con, weighted by how many spawn. If the zone has too few, the nearest common mobs instead.
- **XP** follows Classic: more for higher-level mobs, falling off below the character's level and none once they're gray; quest XP drops once the character is 6 levels over the quest. Both are doubled (`XP_RATE`), so 1 to 60 takes about 75 to 125 hours depending on class. Gold isn't reduced by outleveling, so outleveled zones still pay.

The farm table shows grinding rates; questing adds to them.

`gear-data.js` is generated. To rebuild it, put the source data in a folder and run:

    node tools/build-gear-data.mjs /path/to/data

Data sources: items, loot, quests, creatures and base stats from [CMaNGOS classic-db](https://github.com/cmangos/classic-db) and [mangos-classic](https://github.com/cmangos/mangos-classic) (GPL-2.0); quest and creature zones from [pfQuest](https://github.com/shagu/pfQuest) (MIT); item icons and tooltip text from [wow-classic-items](https://github.com/nexus-devs/wow-classic-items) (MIT); random suffix stats from [wowsims/classic](https://github.com/wowsims/classic) (MIT). Item icons are loaded from Wowhead's image CDN when it can be reached.