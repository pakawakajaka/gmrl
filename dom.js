// Builds a DOM element. Children are appended as nodes/text, never parsed as HTML.
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue
    if (name === 'class') node.className = value
    else if (name === 'style') for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v)
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value === true ? '' : value)
  }
  node.append(...children.flat(Infinity).filter((child) => child != null && child !== false))
  return node
}

export function badge(text) {
  return el('span', { class: `badge badge-${text.toLowerCase()}` }, text)
}

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const formatNumber = (n) => numberFormat.format(Math.floor(n))

function moneyParts(copper) {
  const total = Math.floor(copper)
  const parts = [
    ['gold', Math.floor(total / 10000), 'g'],
    ['silver', Math.floor(total / 100) % 100, 's'],
    ['copper', total % 100, 'c'],
  ].filter(([, amount]) => amount > 0)
  return parts.length ? parts : [['copper', 0, 'c']]
}

// e.g. "12g 5s 3c"
export const formatMoney = (copper) =>
  moneyParts(copper).map(([, amount, unit]) => `${formatNumber(amount)}${unit}`).join(' ')

export function money(copper) {
  return el('span', { class: 'money' }, moneyParts(copper).map(([kind, amount, unit], i) => [
    i > 0 && ' ',
    el('span', { class: `coin coin-${kind}` }, `${formatNumber(amount)}${unit}`),
  ]))
}

// A probability, e.g. "42%", "< 1%", "> 99%"
export function formatChance(p) {
  if (p < 0.005) return '< 1%'
  if (p > 0.995) return '> 99%'
  return `${Math.round(p * 100)}%`
}

// e.g. "3d 4h", "2h 13m", "45m", "< 1m"
export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return '—'
  const minutes = Math.floor(hours * 60)
  if (minutes < 1) return '< 1m'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d) return `${d}d ${h}h`
  return h ? `${h}h ${m}m` : `${m}m`
}
