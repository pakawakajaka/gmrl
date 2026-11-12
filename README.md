# gmrl
Guild Master Raid Leader


    npm install
    npm start

This runs `dev-server.js` (live-server on http://127.0.0.1:8080 plus a save endpoint) and opens main.html.

Characters and guild memberships are saved in the browser's localStorage. On the roster, "Save to file" writes that data to `gmrl-save.json` in this folder, and "Reset to default data" restores the starting characters.