// Minimal parsers for the source data used by build-gear-data.mjs.

// Column names of `table` from its CREATE TABLE statement in a MySQL dump.
function columnsOf(sql, table) {
  let start = sql.indexOf(`CREATE TABLE \`${table}\``)
  if (start === -1) start = sql.indexOf(`CREATE TABLE IF NOT EXISTS \`${table}\``)
  if (start === -1) throw new Error(`No CREATE TABLE for ${table}`)
  const end = sql.indexOf(') ENGINE', start)
  return [...sql.slice(start, end).matchAll(/^\s+`(\w+)`/gm)].map((m) => m[1])
}

// Rows of `table` from a MySQL dump's INSERT statements, as objects keyed by column name.
export function sqlRows(sql, table) {
  let columns = columnsOf(sql, table)
  const rows = []
  const marker = `INSERT INTO \`${table}\` `
  let at = sql.indexOf(marker)
  while (at !== -1) {
    let i = at + marker.length
    if (sql[i] === '(') {
      const end = sql.indexOf(')', i)
      columns = [...sql.slice(i, end).matchAll(/`(\w+)`/g)].map((m) => m[1])
      i = end + 1
    }
    i = sql.indexOf('VALUES', i) + 6
    for (;;) {
      while (sql[i] !== '(') i++
      i++
      const row = {}
      let col = 0
      for (;;) {
        let value
        while (sql[i] === ' ') i++
        if (sql[i] === "'") {
          let text = ''
          let run = ++i
          for (;;) {
            const ch = sql[i]
            if (ch === '\\') {
              text += sql.slice(run, i)
              const next = sql[i + 1]
              text += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next === '0' ? '\0' : next
              i += 2
              run = i
            } else if (ch === "'") {
              text += sql.slice(run, i)
              if (sql[i + 1] === "'") {
                text += "'"
                i += 2
                run = i
              } else {
                i++
                break
              }
            } else i++
          }
          value = text
        } else {
          let j = i
          while (sql[j] !== ',' && sql[j] !== ')') j++
          const raw = sql.slice(i, j).trim()
          value = raw === 'NULL' ? null : Number(raw)
          i = j
        }
        row[columns[col++]] = value
        if (sql[i] === ',') {
          i++
          continue
        }
        i++ // ')'
        break
      }
      rows.push(row)
      while (/\s/.test(sql[i])) i++
      if (sql[i] === ';') break
      i++ // ','
    }
    at = sql.indexOf(marker, i)
  }
  return rows
}

// Parses the first table constructor in a Lua data file (pfQuest format) into plain JS.
// Tables with only positional values become arrays; others become objects.
export function luaTable(text) {
  let i = text.indexOf('{')
  const n = text.length

  const skip = () => {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i++
      else if (c === '-' && text[i + 1] === '-') while (i < n && text[i] !== '\n') i++
      else break
    }
  }
  const string = () => {
    const quote = text[i++]
    let out = ''
    while (text[i] !== quote) {
      if (text[i] === '\\') {
        const next = text[i + 1]
        out += next === 'n' ? '\n' : next
        i += 2
      } else out += text[i++]
    }
    i++
    return out
  }
  const value = () => {
    skip()
    const c = text[i]
    if (c === '{') return table()
    if (c === '"' || c === "'") return string()
    const m = /^(-?[\d.]+(?:e-?\d+)?|true|false|nil)/.exec(text.slice(i, i + 40))
    if (!m) throw new Error(`Unexpected Lua at ${i}: ${text.slice(i, i + 30)}`)
    i += m[0].length
    return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'nil' ? null : Number(m[0])
  }
  const table = () => {
    i++ // '{'
    const positional = []
    const keyed = {}
    let hasKeys = false
    for (;;) {
      skip()
      if (text[i] === '}') {
        i++
        break
      }
      if (text[i] === '[') {
        i++
        const key = value()
        skip()
        i++ // ']'
        skip()
        i++ // '='
        keyed[key] = value()
        hasKeys = true
      } else {
        positional.push(value())
      }
      skip()
      if (text[i] === ',' || text[i] === ';') i++
    }
    if (!hasKeys) return positional
    positional.forEach((v, index) => (keyed[index + 1] = v))
    return keyed
  }
  return table()
}
