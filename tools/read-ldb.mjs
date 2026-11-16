// Finds the newest gmrl.account for 127.0.0.1:8080 in copied Chrome localStorage .ldb files.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const varint = (b, p) => { let v = 0, m = 1; for (;;) { const x = b[p++]; v += (x & 127) * m; m *= 128; if (x < 128) return [v, p] } }
function snappy(src) {
  let [len, p] = varint(src, 0)
  const out = Buffer.alloc(len); let o = 0
  while (p < src.length) {
    const tag = src[p++], t = tag & 3
    if (t === 0) {
      let l = tag >> 2
      if (l >= 60) { const n = l - 59; l = 0; for (let i = 0; i < n; i++) l |= src[p++] << (8 * i) }
      l += 1; src.copy(out, o, p, p + l); o += l; p += l
    } else {
      let l, off
      if (t === 1) { l = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[p++] }
      else if (t === 2) { l = (tag >> 2) + 1; off = src.readUInt16LE(p); p += 2 }
      else { l = (tag >> 2) + 1; off = src.readUInt32LE(p); p += 4 }
      for (let i = 0; i < l; i++) out[o + i] = out[o - off + i]
      o += l
    }
  }
  return out
}
function block(file, off, size) {
  const raw = file.subarray(off, off + size)
  return file[off + size] === 1 ? snappy(raw) : raw
}
function* entries(b) {
  const restarts = b.readUInt32LE(b.length - 4)
  const end = b.length - 4 - restarts * 4
  let p = 0, key = Buffer.alloc(0)
  while (p < end) {
    let shared, ns, vl
    ;[shared, p] = varint(b, p); [ns, p] = varint(b, p); [vl, p] = varint(b, p)
    key = Buffer.concat([key.subarray(0, shared), b.subarray(p, p + ns)]); p += ns
    yield [key, b.subarray(p, p + vl)]; p += vl
  }
}
const best = []
for (const name of readdirSync(process.argv[2]).filter((n) => n.endsWith('.ldb'))) {
  const file = readFileSync(`${process.argv[2]}/${name}`)
  const footer = file.subarray(file.length - 48)
  let p = 0, x
  ;[x, p] = varint(footer, p); [x, p] = varint(footer, p)
  let io, is; [io, p] = varint(footer, p); [is, p] = varint(footer, p)
  for (const [, handle] of entries(block(file, io, is))) {
    let [bo, q] = varint(handle, 0); const [bs] = varint(handle, q)
    for (const [ikey, val] of entries(block(file, bo, bs))) {
      const user = ikey.subarray(0, ikey.length - 8).toString('latin1')
      if (process.env.LIST && user.includes('127.0.0.1:8080')) { const s = Number(ikey.readBigUInt64LE(ikey.length - 8) >> 8n); (globalThis.keys ??= new Map()).set(user, Math.max(globalThis.keys.get(user)?.[0] ?? 0, s) === s ? [s, val.length] : globalThis.keys.get(user)) }
      if (!user.includes('127.0.0.1:8080') || !user.endsWith('gmrl.account')) continue
      const seq = Number(ikey.readBigUInt64LE(ikey.length - 8) >> 8n)
      best.push({ seq, name, val: Buffer.from(val) })
    }
  }
}
best.sort((a, b) => b.seq - a.seq)
console.log(best.slice(0, 5).map((b) => `${b.name} seq ${b.seq} ${b.val.length}B`).join('\n'))
const v = best[0].val
const text = v[0] === 1 ? v.subarray(1).toString('latin1') : v.subarray(1).toString('utf16le')
writeFileSync('/tmp/browser-save.json', text)
const d = JSON.parse(text)
console.log('lastTick', new Date(d.lastTick).toISOString(), 'runs', d.dungeonRuns?.length, 'encounters', d.encounters?.length, 'chars', d.characters.length, 'size', text.length)
if (process.env.LIST) for (const [k, [s, l]] of globalThis.keys) console.log(JSON.stringify(k), l)
