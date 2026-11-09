// Renders the PWA icons from public/favicon.svg (the WM mark): white on the app's dark
// ground, #242424. Run after changing the favicon:  node scripts/make-pwa-icons.mjs
//   icon-192 / icon-512   the mark at 62% of the square ("any" -- iOS and launchers round it)
//   icon-maskable-512     the mark at 50%, inside the 80% safe circle Android crops to
//   apple-touch-icon      180 px, same as "any"
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'

const BG = '#242424', FG = '#ffffff'
const src = readFileSync('public/favicon.svg', 'utf-8')
const [, , , vw, vh] = src.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number).reduce((a, n) => [...a, n], [0])
const inner = src
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<style>[\s\S]*?<\/style>/, '')

function icon(size, scale) {
  const w = size * scale, h = w * vh / vw
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${w / vw})" fill="${FG}">${inner}</g>
</svg>`
  return new Resvg(svg).render().asPng()
}

mkdirSync('public/icons', { recursive: true })
for (const [file, size, scale] of [
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  ['icon-maskable-512.png', 512, 0.5],
  ['apple-touch-icon.png', 180, 0.62],
]) {
  writeFileSync(`public/icons/${file}`, icon(size, scale))
  console.log(`public/icons/${file}`)
}
