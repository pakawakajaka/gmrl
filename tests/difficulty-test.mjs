// Run: node tests/difficulty-test.mjs
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const { ZONES, zoneDifficulty } = await import(ROOT + 'zones.js')
const z = (n) => ZONES.find((x) => x.name === n)
const cases = [
  [1, 'Elwynn Forest'], [3, 'Elwynn Forest'], [8, 'Elwynn Forest'], [15, 'Elwynn Forest'], [16, 'Elwynn Forest'],
  [10, 'Westfall'], [11, 'Westfall'], [13, 'Westfall'], [18, 'Westfall'], [25, 'Westfall'], [26, 'Westfall'],
  [30, 'Stranglethorn Vale'], [33, 'Stranglethorn Vale'], [55, 'Winterspring'], [60, 'Winterspring'],
]
for (const [level, name] of cases) console.log(`L${level} in ${name} (max ${z(name).maxLevel}):`, zoneDifficulty({ characterLevel: level }, z(name)))
