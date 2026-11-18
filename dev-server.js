// Dev server: live-server for this folder. It ignores gmrl-save.json, the file the roster's Save to file
// downloads, so dropping one in here doesn't reload the page, and dist/, the build output (see tools/build.mjs).
import { fileURLToPath } from 'node:url'
import liveServer from 'live-server'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SAVE_FILE = fileURLToPath(new URL('gmrl-save.json', import.meta.url))

liveServer.start({
  root: ROOT,
  host: '127.0.0.1',
  port: Number(process.env.PORT) || 8080,
  open: process.env.NO_BROWSER ? false : '/',
  ignore: [SAVE_FILE, ...['node_modules', 'dist'].map((dir) => fileURLToPath(new URL(dir, import.meta.url)))],
})
