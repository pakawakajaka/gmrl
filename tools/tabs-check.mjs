// Two tabs on one save in a throwaway Chrome profile: they should end up showing the same runs as storage.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const url = 'http://127.0.0.1:8080/main.html'
const port = 9335
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tabs-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let first
for (let i = 0; i < 50 && !first; i++) { await sleep(200); first = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null) }
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let n = 0; const pending = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  return { ws, send, evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result?.value }
}
const a = await connect(first)
await a.send('Page.navigate', { url: new URL('/package.json', url).href }); await sleep(800)
await a.evaluate(`localStorage.setItem('gmrl.account', ${JSON.stringify(readFileSync(process.argv[2], 'utf8'))})`)
const second = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(new URL('/package.json', url).href)}`, { method: 'PUT' }).then((r) => r.json())
const b = await connect(second)
await sleep(500)
await Promise.all([a.send('Page.navigate', { url: url + '#/dungeons' }), b.send('Page.navigate', { url: url + '#/dungeons' })])
await sleep(Number(process.env.WAIT ?? 6000))
const shown = (t) => t.evaluate(`[...document.querySelectorAll('.encounter-row')].map((e) => e.getAttribute('href').slice(-8)).join(',')`)
const stored = `JSON.parse(localStorage.getItem('gmrl.account')).dungeonRuns.map((r) => r.id.slice(-8)).join(',')`
const [ra, rb, rs] = [await shown(a), await shown(b), await a.evaluate(stored)]
console.log('A', ra, '\nB', rb, '\nS', rs)
console.log(ra === rb && rb === rs ? 'SAME' : 'DIFFERENT')
a.ws.close(); b.ws.close(); chrome.kill()
