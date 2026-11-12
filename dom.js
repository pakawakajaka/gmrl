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
