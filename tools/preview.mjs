// Serves the hosted build (dist/, see tools/build.mjs) the way Cloudflare Pages does, to try it before pushing:
// the _headers file applies, /index.html redirects to /, unknown paths get the page, and nothing is cached
// without checking. Unlike `npm start` (the source, live-reloaded), the update check and the service worker run.
// Run: npm run preview (builds first). PORT and HOST change where it listens (default 127.0.0.1:8081).
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = Number(process.env.PORT ?? 8081)
const HOST = process.env.HOST || '127.0.0.1'
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No build in dist/: run npm run build first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

// _headers: a path pattern (* matches anything) followed by indented "Name: value" lines.
const rules = []
for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue
  if (!/^\s/.test(line)) {
    const pattern = line.trim().split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    rules.push({ path: new RegExp(`^${pattern}$`), headers: [] })
  } else {
    const at = line.indexOf(':')
    rules.at(-1)?.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
  }
}

// The file under dist/ for a URL path, or null. Never anything outside dist/, a dotfile or _headers.
function fileFor(path) {
  const file = join(DIST, path.endsWith('/') ? `${path}index.html` : path)
  if (!file.startsWith(DIST) || file === join(DIST, '_headers') || file.slice(DIST.length).split(sep).some((part) => part.startsWith('.'))) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const url = new URL(request.url, 'http://localhost')
  let path
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400).end()
    return
  }
  for (const rule of rules) if (rule.path.test(path)) for (const [name, value] of rule.headers) response.setHeader(name, value)
  if (path.endsWith('/index.html')) {
    response.writeHead(308, { Location: path.slice(0, -'index.html'.length) + url.search }).end()
    return
  }
  // With no 404.html, Cloudflare Pages treats the site as a single page app and answers every path with it.
  const file = fileFor(path) ?? join(DIST, 'index.html')
  const body = readFileSync(file)
  response.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=0, must-revalidate',
  })
  response.end(request.method === 'HEAD' ? undefined : body)
})

server.listen(PORT, HOST, () => {
  const { port } = server.address()
  console.log(`Serving dist/ at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${port}/ (Ctrl+C to stop)`)
})
