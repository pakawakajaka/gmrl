# gmrl
Guild Master Raid Leader


    npm install
    npm start

This runs `dev-server.js` (live-server on http://127.0.0.1:8080 plus a save endpoint) and opens main.html.

Characters and guild memberships are saved in the browser's localStorage. On the roster, "Save to file" writes that data to `gmrl-save.json` in this folder, and "Reset to default data" restores the starting characters.

## Gear

Characters farming a zone kill about 60 mobs an hour (faster or slower depending on power level) and roll each mob's real Classic loot table. Every 15 minutes at that pace completes that zone's next available quest that has gear rewards (the best choice reward is taken). The best usable gear for the character's spec is equipped automatically; items that need a higher level wait in the bag and the rest is sold. Clicking a character on the roster opens their character page, which shows the equipped items, Classic tooltips, stats and power. Characters can't be edited after creation; they can be deleted from their character page. Stats use Classic 1.12 formulas without talents or buffs. Random-enchant items ("of the Bear", "of Power", ...) drop from mobs and roll their suffix with the real Classic odds for that item. "of Regeneration" (health per 5 sec) is skipped because there's no source data for its values. Dungeon loot isn't included.

## Power

Gear and farming connect through power (`power.js`). Players see two numbers:

- **Item level**: the average item level of worn gear (every slot except shirt and tabard, empty slots as 0, a two-hander for both hands). It's display only, a quick read on how good the gear is.
- **Power level** (`solo` in the code) = (level power × level share + gear power) × class and role factors.
  - Level share is what a naked character has from spells, talents and base stats: 40% for melee and tanks, 50% for hunters, 60% for casters and healers.
  - Gear power is the sum of what each worn item adds from its actual stats, weapon damage and armor, valued with the spec's stat weights (the same ones used to pick gear). Better items add more power whatever the character's level.
  - Hunters and warlocks solo fastest; tanks and healers solo slowest.

**Party power** uses the same level and gear but rewards tanks and healers (1.5×) instead. It isn't shown yet; it's for future dungeon and raid grouping.

Power level against the zone's mobs (at the character's level, within the zone's range) sets the kill speed, which scales kills, quests, XP and gold. XP also follows Classic's rules for lower-level mobs: it falls off as mobs get lower than the character and stops once they're gray (Classic gray levels). Gold isn't reduced by outleveling, so outleveled zones still pay, and faster. Balance constants are at the top of `power.js` and `zones.js`.

`gear-data.js` is generated. To rebuild it, put the source data in a folder and run:

    node tools/build-gear-data.mjs /path/to/data

Data sources: items, loot, quests, creatures and base stats from [CMaNGOS classic-db](https://github.com/cmangos/classic-db) and [mangos-classic](https://github.com/cmangos/mangos-classic) (GPL-2.0); quest and creature zones from [pfQuest](https://github.com/shagu/pfQuest) (MIT); item icons and tooltip text from [wow-classic-items](https://github.com/nexus-devs/wow-classic-items) (MIT); random suffix stats from [wowsims/classic](https://github.com/wowsims/classic) (MIT). Item icons are loaded from Wowhead's image CDN when it can be reached.