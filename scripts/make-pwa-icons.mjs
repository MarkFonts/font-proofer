// Renders the PWA icons from public/favicon.svg (the WP mark): white on the app's dark
// ground, #242424 (PWA icons); apple-touch, favicon-96 and favicon.ico are dark ink #111111 on
// opaque white. Run after changing the favicon:  node scripts/make-pwa-icons.mjs
//   icon-192 / icon-512   the mark at 62% of the square ("any" -- iOS and launchers round it)
//   icon-maskable-512     the mark at 50%, inside the 80% safe circle Android crops to
//   favicon-96.png        96 px, for Google Search (multiple of 48), ink on white
//   favicon.ico (public/) 16/32/48, PNG-in-ICO, ink on white, root-served
//   apple-touch-icon      180 px, same size as "any", dark ink on white
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'

const BG = '#242424', FG = '#ffffff', LIGHT_BG = '#ffffff', INK = '#111111'
const src = readFileSync('public/favicon.svg', 'utf-8')
const [, , vw, vh] = src.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number)
const inner = src
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<style>[\s\S]*?<\/style>/, '')

function icon(size, scale, bg = BG, fg = FG) {
  const w = size * scale, h = w * vh / vw
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${w / vw})" fill="${fg}">${inner}</g>
</svg>`
  return new Resvg(svg).render().asPng()
}

mkdirSync('public/icons', { recursive: true })
for (const [file, size, scale, bg, fg] of [
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  ['icon-maskable-512.png', 512, 0.5],
  ['apple-touch-icon.png', 180, 0.62, LIGHT_BG, INK],
  ['favicon-96.png', 96, 0.88, LIGHT_BG, INK],
]) {
  writeFileSync(`public/icons/${file}`, icon(size, scale, bg, fg))
  console.log(`public/icons/${file}`)
}

// favicon.ico: PNG-compressed entries (16, 32, 48), valid in every current browser and crawler
const sizes = [16, 32, 48]
const pngs = sizes.map((n) => icon(n, 0.88, LIGHT_BG, INK))
const head = Buffer.alloc(6 + 16 * sizes.length)
head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let off = head.length
sizes.forEach((n, i) => {
  const o = 6 + 16 * i
  head[o] = n; head[o + 1] = n; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6)
  head.writeUInt32LE(pngs[i].length, o + 8); head.writeUInt32LE(off, o + 12)
  off += pngs[i].length
})
writeFileSync('public/favicon.ico', Buffer.concat([head, ...pngs]))
console.log('public/favicon.ico')
