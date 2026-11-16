// Loads a save into a throwaway Chrome profile, lets the page run, reloads, and reports runs before/after.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const url = 'http://127.0.0.1:8080/main.html'
const port = 9334
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rl-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) { await sleep(200); target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let n = 0; const pending = new Map(); const logs = []
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400)); pending.get(m.id)?.(m); pending.delete(m.id) })
const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result?.value
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: new URL('/package.json', url).href }); await sleep(800)
await evaluate(`localStorage.setItem('gmrl.account', ${JSON.stringify(readFileSync(process.argv[2], 'utf8'))})`)
const stored = () => evaluate(`(() => { const d = JSON.parse(localStorage.getItem('gmrl.account')); return 'runs ' + d.dungeonRuns.length + ' clears ' + d.characters.filter((c) => Object.keys(c.dungeonClears).length).length + ' tick ' + new Date(d.lastTick).toISOString() })()`)
await send('Page.navigate', { url: url + '#/dungeons' }); await sleep(4000)
console.log('page rows', await evaluate(`document.querySelectorAll('.encounter-row').length`), 'stored', await stored())
await sleep(Number(process.env.WAIT ?? 3000))
console.log('stored before reload', await stored())
await send('Page.reload'); await sleep(4000)
console.log('after reload page rows', await evaluate(`document.querySelectorAll('.encounter-row').length`), 'stored', await stored())
console.log(logs.slice(0, 20).join('\n'))
ws.close(); chrome.kill()
