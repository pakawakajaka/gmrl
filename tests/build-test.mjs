// Run: node tests/build-test.mjs
// tools/build.mjs: the hosted site has every file the game loads and nothing else, stamped with the deploy id.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = mkdtempSync(join(tmpdir(), 'gmrl-build-'))
let fails = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`); if (!ok) fails++ }

const run = (out, env = {}) => {
  try {
    return { ok: true, log: execFileSync('node', [ROOT + 'tools/build.mjs', out], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { ok: false, log: String(error.stderr) }
  }
}

const built = run(OUT, { CF_PAGES_COMMIT_SHA: '0123456789abcdef0123' })
check('builds', built.ok && built.log.includes('Built v'), built.log.trim())

const list = (dir, prefix = '') => readdirSync(join(OUT, dir)).flatMap((name) => {
  const file = prefix + name
  return statSync(join(OUT, file)).isDirectory() ? list(file, `${file}/`) : [file]
})
const files = new Set(list(''))
const text = (file) => readFileSync(join(OUT, file), 'utf8')
const { version } = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'))

check('has the page, its modules and assets', ['index.html', 'interface.js', 'gear-data.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'version.js', 'updates.js', 'icons/warrior.jpg', 'icons/app-512.png'].every((f) => files.has(f)))
const devFiles = [...files].filter((f) => /^(tests|tools|node_modules)\/|^(dev-server\.js|package(-lock)?\.json|README\.md|gmrl-save\.json)$|(^|\/)\./.test(f))
check('no dev or test files', devFiles.length === 0, devFiles.join())

// Every relative import in the output resolves to a shipped file.
const missing = []
for (const file of [...files].filter((f) => f.endsWith('.js'))) {
  for (const [, ref] of text(file).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = posix.normalize(posix.join(posix.dirname(file), ref))
    if (!files.has(target)) missing.push(`${file} -> ${ref}`)
  }
}
check('every import ships', missing.length === 0, missing.join())

const html = text('index.html')
const links = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => !/^(#|[a-z]+:|\/\/)/i.test(ref))
check('everything index.html links ships', links.length > 0 && links.every((ref) => files.has(posix.normalize(ref))), links.join())
const manifest = JSON.parse(text('manifest.webmanifest'))
check('manifest icons ship', manifest.icons.length > 0 && manifest.icons.every((i) => files.has(i.src)) && manifest.start_url === './')

check('version.json', text('version.json').trim() === JSON.stringify({ version, build: '0123456789ab' }), text('version.json'))
check('version.js stamped with the deploy', text('version.js').includes('export const BUILD = "0123456789ab"') && !text('version.js').includes("BUILD = 'dev'"))
const { VERSION } = await import(ROOT + 'version.js')
check('package.json and version.js agree', VERSION === version, `${version} / ${VERSION}`)

// The service worker caches every file but itself, with the page as ./ (Cloudflare redirects /index.html to /).
const sw = text('sw.js')
const cached = JSON.parse(sw.match(/const FILES = (\[.*\])/)?.[1] ?? '[]')
const expected = ['./', ...[...files].filter((f) => !['index.html', 'sw.js', '_headers', 'version.json'].includes(f))].sort()
check('sw.js stamped', sw.includes('const BUILD = "0123456789ab"'))
check('sw.js caches every shipped file', JSON.stringify(cached) === JSON.stringify(expected), cached.length)

const headers = text('_headers')
check('_headers: CSP for every path', headers.startsWith('/*\n') && /Content-Security-Policy: default-src 'self';.*img-src 'self' https:\/\/wow\.zamimg\.com/.test(headers) && headers.includes("frame-ancestors 'none'"))
check('_headers: nosniff', headers.includes('X-Content-Type-Options: nosniff'))

// A rebuild empties the folder first; the project folder itself is refused.
const again = run(OUT, { CF_PAGES_COMMIT_SHA: 'fedcba9876543210' })
check('rebuild restamps', again.ok && text('version.json').includes('fedcba987654'))
const inside = join(ROOT, 'zz-tmp-build')
const refused = run(inside)
check('won\'t build into the project', !refused.ok && refused.log.includes("won't build into") && !existsSync(inside), refused.log.trim())
rmSync(inside, { recursive: true, force: true })

rmSync(OUT, { recursive: true })
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
