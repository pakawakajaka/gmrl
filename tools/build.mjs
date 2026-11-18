// Builds the site for hosting into dist/ (or the folder given as the first argument): only the files the game
// loads, with this deploy's id stamped into version.js and sw.js, plus version.json for the in-game update
// check and _headers (Cloudflare Pages response headers). Run: npm run build
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist'))

function fail(message) {
  console.error(`Build failed: ${message}`)
  process.exit(1)
}

// The output folder is emptied first, so it must be dist/ or somewhere outside the project.
if (OUT !== join(ROOT, 'dist') && !relative(ROOT, OUT).startsWith('..')) fail(`won't build into ${OUT}: use dist/ or a folder outside the project`)

const read = (file) => readFileSync(join(ROOT, file), 'utf8')
const { version } = JSON.parse(read('package.json'))
const { VERSION } = await import(pathToFileURL(join(ROOT, 'version.js')).href)
if (version !== VERSION) fail(`package.json is at ${version} but version.js at ${VERSION}. Bump both, and add the version's notes to CHANGES in version.js.`)

// The commit being deployed (Cloudflare Pages and GitHub Actions say which), else the checked-out one.
function buildId() {
  const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || (() => {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' }
  })()
  return sha ? sha.slice(0, 12) : `local-${Date.now().toString(36)}`
}
const BUILD = buildId()

// Everything the page loads: index.html and what it links, the class icons, the service worker, and every
// module interface.js imports, directly or not.
const files = new Set(['index.html', 'sw.js'])
for (const name of readdirSync(join(ROOT, 'icons'))) if (!name.startsWith('.')) files.add(`icons/${name}`)
const html = read('index.html')
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(#|[a-z]+:|\/\/)/i.test(ref)) continue
  if (!existsSync(join(ROOT, ref))) fail(`index.html links ${ref}, which doesn't exist`)
  files.add(posix.normalize(ref))
}
const manifest = JSON.parse(read('manifest.webmanifest'))
for (const { src } of manifest.icons) {
  if (!files.has(src)) fail(`manifest.webmanifest lists ${src}, which isn't in icons/`)
}
const modules = [...files].filter((f) => f.endsWith('.js'))
while (modules.length) {
  const file = modules.pop()
  for (const [, ref] of read(file).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = posix.normalize(posix.join(posix.dirname(file), ref))
    if (files.has(target)) continue
    if (!existsSync(join(ROOT, target))) fail(`${file} imports ${ref}, which doesn't exist`)
    files.add(target)
    modules.push(target)
  }
}

// Replaces `from` (which must be there) in a file's text.
function stamp(text, from, to, file) {
  if (!text.includes(from)) fail(`${file} no longer has ${from}`)
  return text.replace(from, () => to)
}

const cached = ['./', ...[...files].filter((f) => f !== 'index.html' && f !== 'sw.js')].sort()
const output = {
  'version.js': (text) => stamp(text, "export const BUILD = 'dev'", `export const BUILD = ${JSON.stringify(BUILD)}`, 'version.js'),
  'sw.js': (text) => stamp(stamp(text, "const BUILD = 'dev'", `const BUILD = ${JSON.stringify(BUILD)}`, 'sw.js'),
    'const FILES = []', `const FILES = ${JSON.stringify(cached)}`, 'sw.js'),
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true })
for (const file of [...files].sort()) {
  const to = join(OUT, file)
  mkdirSync(dirname(to), { recursive: true })
  if (output[file]) writeFileSync(to, output[file](read(file)))
  else copyFileSync(join(ROOT, file), to)
}
writeFileSync(join(OUT, 'version.json'), `${JSON.stringify({ version, build: BUILD })}\n`)

// Security headers for every response. The only other site the page uses is Wowhead's icon server.
const CSP = [
  "default-src 'self'",
  "img-src 'self' https://wow.zamimg.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
writeFileSync(join(OUT, '_headers'), `/*
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`)

console.log(`Built v${version} (${BUILD}): ${files.size + 2} files in ${OUT}`)
