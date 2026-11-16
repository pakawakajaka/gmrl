// Screenshots the talent page in headless Chrome via CDP. Usage: node tools/shot.mjs <url> <out.png> [selector to hover]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, out, hover] = process.argv.slice(2)
const port = 9333
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-'))}`,
  '--window-size=1500,1100', '--no-first-run', 'about:blank',
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
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value

await send('Page.enable')
if (process.env.SAVEFILE) {
  await send('Page.navigate', { url: new URL('/package.json', url).href })
  await sleep(1000)
  const text = (await import('node:fs')).readFileSync(process.env.SAVEFILE, 'utf8')
  await evaluate(`localStorage.setItem('gmrl.account', ${JSON.stringify(text)})`)
} else if (process.env.SAVE) {
  await send('Page.navigate', { url: new URL('/package.json', url).href })
  await sleep(1000)
  console.log('save', await evaluate(`fetch('/gmrl-save.json').then((r) => r.text()).then((t) => (localStorage.setItem('gmrl.account', t), t.length))`))
}
await send('Page.navigate', { url })
await sleep(2500)
const id = await evaluate(`((d) => d?.characters ?? d?.guilds?.flatMap((g) => g.characters))(JSON.parse(localStorage.getItem('gmrl.account') ?? 'null'))?.[${process.env.CHAR ?? 0}]?.id`)
await evaluate(`location.hash = ${JSON.stringify(process.env.HASH ?? '')} || '#/character/${id}${process.env.PAGE ?? '/talents'}'`)
await sleep(1500)
if (process.env.SCROLL) await evaluate(`document.querySelector(${JSON.stringify(process.env.SCROLL)}).scrollIntoView({ block: 'center' })`)
console.log('icons loaded', await evaluate(`[...document.querySelectorAll('.talent-icon img')].filter((i) => i.naturalWidth > 0).length + '/' + document.querySelectorAll('.talent-icon img').length + '/' + document.querySelectorAll('.talent').length`))
if (hover) {
  const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(hover)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1] })
  await sleep(300)
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
ws.close()
chrome.kill()
