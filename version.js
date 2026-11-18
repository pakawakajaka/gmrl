// The game's version and what changed in each one, newest first. The first entry is the current version and must
// match package.json (tests/build-test.mjs checks). For each update you deploy, bump the version in both places
// and add an entry: players see it after they reload, under What's new (#/changes).
export const CHANGES = [
  {
    version: '0.1.0',
    date: '2026-11-18',
    notes: [
      'First version online.',
      'Install the game as an app from your browser (in Chrome or Edge, the install icon in the address bar; in Safari, Share, then Add to Home Screen or Add to Dock) and it also works offline.',
      'Save to file keeps a backup of your account, and Load from file brings one back. The roster shows when you last saved one.',
    ],
  },
]

export const VERSION = CHANGES[0].version

// Which deploy this is: tools/build.mjs replaces 'dev' with the commit it was built from. Running from source
// ('dev'), the page doesn't check for updates or install the service worker (see updates.js).
export const BUILD = 'dev'
