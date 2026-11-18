// Renders the app icons (PNG) from icons/app-icon.svg in headless Chrome: icons/app-192.png and app-512.png for
// the web app manifest, icons/apple-touch-icon.png for iPhone and iPad home screens. Run after editing the SVG:
// node tools/make-app-icons.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICONS = fileURLToPath(new URL('../icons/', import.meta.url))
const SIZES = { 'app-192.png': 192, 'app-512.png': 512, 'apple-touch-icon.png': 180 }
const svg = readFileSync(join(ICONS, 'app-icon.svg'), 'base64')

const port = 9334
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'icons-'))}`,
  '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let n = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })

await send('Page.enable')
for (const [file, size] of Object.entries(SIZES)) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
  const page = `<body style="margin:0"><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display:block">`
  await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(page).toString('base64')}` })
  await sleep(500)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } })
  writeFileSync(join(ICONS, file), Buffer.from(shot.result.data, 'base64'))
  console.log(`icons/${file} ${size}x${size}`)
}
ws.close()
chrome.kill()
