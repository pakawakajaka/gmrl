// Dev server: live-server plus POST /api/save, which writes the browser's save data to gmrl-save.json in this folder.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import liveServer from 'live-server'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SAVE_FILE_NAME = 'gmrl-save.json'
const SAVE_FILE = fileURLToPath(new URL(SAVE_FILE_NAME, import.meta.url))
const MAX_BYTES = 1_000_000

function reply(res, code, body) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function saveToFile(req, res, next) {
  if (req.url !== '/api/save') return next()
  if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST.' })
  // Requiring JSON forces a CORS preflight that this server never approves, so other websites can't write here.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    return reply(res, 415, { error: 'Expected application/json.' })
  }

  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size <= MAX_BYTES) chunks.push(chunk)
  })
  req.on('end', async () => {
    if (size > MAX_BYTES) return reply(res, 413, { error: 'Save data is too large.' })
    let data
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return reply(res, 400, { error: 'Save data is not valid JSON.' })
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return reply(res, 400, { error: 'Save data must be a JSON object.' })
    }
    try {
      await writeFile(SAVE_FILE, `${JSON.stringify(data, null, 2)}\n`)
      reply(res, 200, { file: SAVE_FILE_NAME })
    } catch (error) {
      console.error('Could not write the save file.', error)
      reply(res, 500, { error: 'Could not write the save file.' })
    }
  })
}

liveServer.start({
  root: ROOT,
  host: '127.0.0.1',
  port: Number(process.env.PORT) || 8080,
  open: process.env.NO_BROWSER ? false : '/main.html',
  ignore: [SAVE_FILE, fileURLToPath(new URL('node_modules', import.meta.url))],
  middleware: [saveToFile],
})
