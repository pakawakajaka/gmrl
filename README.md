# gmrl
Guild Master Raid Leader


    npm install
    npm start

This runs `dev-server.js` (live-server on http://127.0.0.1:8080 plus a save endpoint) and opens main.html.

Characters and guild memberships are saved in the browser's localStorage. On the roster, "Save to file" writes that data to `gmrl-save.json` in this folder, and "Reset to default data" restores the starting characters.

## Gear

Characters farming a zone kill about 60 mobs an hour and roll each mob's real Classic loot table. Every 15 minutes in a zone completes that zone's next available quest that has gear rewards (the best choice reward is taken). The best usable gear for the character's spec is equipped automatically; items that need a higher level wait in the bag and the rest is sold. Clicking a character on the roster opens their character page, which shows the equipped items, Classic tooltips and stats. Characters can't be edited after creation; they can be deleted from their character page. Stats use Classic 1.12 formulas without talents or buffs. Random-enchant items ("of the Bear", "of Power", ...) drop from mobs and roll their suffix with the real Classic odds for that item. "of Regeneration" (health per 5 sec) is skipped because there's no source data for its values. Dungeon loot isn't included.

`gear-data.js` is generated. To rebuild it, put the source data in a folder and run:

    node tools/build-gear-data.mjs /path/to/data

Data sources: items, loot, quests, creatures and base stats from [CMaNGOS classic-db](https://github.com/cmangos/classic-db) and [mangos-classic](https://github.com/cmangos/mangos-classic) (GPL-2.0); quest and creature zones from [pfQuest](https://github.com/shagu/pfQuest) (MIT); item icons and tooltip text from [wow-classic-items](https://github.com/nexus-devs/wow-classic-items) (MIT); random suffix stats from [wowsims/classic](https://github.com/wowsims/classic) (MIT). Item icons are loaded from Wowhead's image CDN when it can be reached.