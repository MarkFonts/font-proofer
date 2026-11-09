import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { createRequire } from 'module'
import routes from './src/routes.config.js'
import AXIS_REGISTRY from './src/axisRegistry.json' with { type: 'json' }

// OG/Twitter image URLs must be absolute (https://…) — scrapers drop root-relative ones.
/* WHERE THE BUILD LIVES. Production is wordproof.app's root: deploy.yml builds with
   WORDPROOF_BASE=/ . Everything else -- `npm run build` on a laptop, and above all
   wm-primitives' consumers.yml, which builds this app and serves dist/ at /font-proofer/
   for the behaviour tests that gate every primitive dispatch (calbuild --bump included)
   -- keeps the old /font-proofer/ subpath by default, so none of that had to change.
   The PWA is on only for the root build: a service worker scoped to a test server's
   subpath would be noise. */
/* FONTS THE INSTALLED APP MAY KEEP. Deny by default: a face is saved for offline use only
   if it is named here, so a client's retail font (TWK, Weltkern, Ernest, the next one) is
   never written into anyone's app storage -- it is fetched like any web page asset and
   that is all. Only open-licensed faces go on this list: OFL (name ID 13 says so, or for
   Cal Sans, the family's own license) and Apache for Material Symbols, the UI icons.
   Entries are the hashed asset's name stem as Vite writes it ('[wght]' becomes '_wght_').
   Fonts a visitor drops in are read from their disk, never fetched, so never cached. */
const OFFLINE_FONTS = [
  'CalSansVF', 'CalSansFlexVF', 'CalSans-Bold',                          // OFL
  'Geist_wght_', 'Geist-Italic_wght_', 'GeistMono_wght_', 'GeistMono-Italic_wght_',
  'GeistSerifVF',                                                         // OFL
  'InterVariable', 'InterVariable-Italic',                                // OFL
  'GoogleSansFlex-VariableFont_GRAD_ROND_opsz_slnt_wdth_wght',            // OFL
  'TikTokSans-VariableFont_opsz_slnt_wdth_wght',                          // OFL
  'MaterialSymbolsOutlined',                                              // Apache 2.0
]
// <stem>-<8-char Vite hash>.<ext>, the stem exact: 'InterVariable' cannot match the italic.
// A RegExp, not a function: workbox writes urlPattern into sw.js as source, and a function
// that closed over this list would reach the service worker without it.
const OFFLINE_FONT_RE = new RegExp(
  `/assets/(${OFFLINE_FONTS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-[A-Za-z0-9_-]{8}\\.(ttf|otf|woff2?)(\\?.*)?$`)

/* ROUTES SEARCH ENGINES MAY INDEX. Deny by default, like OFFLINE_FONTS: a client route is
   in the sitemap and indexable only if its font is open-licensed and named here. Every
   other route (a client's retail face, a beta, the next client) gets
   <meta name="robots" content="noindex"> and stays out of sitemap.xml -- reachable by its
   link, never in search. robots.txt must NOT disallow them, or Google cannot read the
   noindex. */
const INDEXED_FONTS = new Set(['calsans', 'calsansflex', 'geist', 'geistserif'])   // OFL

const BASE = process.env.WORDPROOF_BASE ?? '/font-proofer/'
const ROOT_BUILD = BASE === '/'
const SITE_ORIGIN = ROOT_BUILD ? 'https://wordproof.app' : 'https://wordmark.nyc'
const SITE_BASE = BASE.replace(/\/$/, '')

/* CAL SANS LIVES IN THE SUBMODULE. shared/ IS wm-primitives, and deploy.yml already
   advances its pointer on every `primitive-updated` dispatch -- so keeping the face there
   and nowhere else means the app follows a font bump with no sync step and no second copy
   to go stale. src/fonts/CalSansVF.ttf was that second copy: it sat at 2.000 while the
   package shipped 2.001, because nothing pushes into src/fonts and bump-font.yml only
   fires on that path.
   src/fonts stays the SPECIMEN directory -- it is what the proofer enumerates, and most
   faces genuinely live there. Rather than move them all, shared/fonts is a second source
   dir for the few faces that are ours: resolve through fontPath(), enumerate through
   listFontFiles(), and nothing else in the build has to know. */
const SHARED_FACES = ['CalSansVF.ttf', 'CalSansFlexVF.ttf']
const fontPath = file =>
  existsSync(`src/fonts/${file}`) ? `src/fonts/${file}` : `shared/fonts/${file}`
const listFontFiles = () => [
  ...readdirSync('src/fonts').filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f)),
  ...SHARED_FACES.filter(f => existsSync(`shared/fonts/${f}`)),
]

const SPECIAL_SLUG_NAMES = {
  calsans: 'Cal Sans',
  calsansflex: 'Cal Sans Flex',
  switzerland2038: 'Switzerland 2038',
}

// Trailing weight/style words to drop from a display name (e.g. "Foo Regular" -> "Foo")
const WEIGHT_RE = /\s+(Thin|Extra ?Light|Ultra ?Light|Light|Book|Regular|Medium|Semi ?Bold|Demi ?Bold|Bold|Extra ?Bold|Heavy|Black)(\s+Italic)?$/i

const SPECIAL_SLUG_FILES = {
  calsans: 'CalSansVF.ttf',
  calsansflex: 'CalSansFlexVF.ttf',
  switzerland2038: 'Switzerland2038-500.ttf',
}

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

function fileToDisplayName(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/VarDemo|VariableFont|Variable|BETAVF|VF/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\[.*$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function findFontFile(fontSlug) {
  const needle = normalize(fontSlug)
  const files = listFontFiles()
  const nameOf = f => normalize(f.replace(/\.[^.]+$/, ''))
  const matches = files.filter(f => {
    const n = nameOf(f)
    return n.includes(needle) || needle.includes(n)
  })
    // Closest match first, as matchFont does in the app: 'geist' is Geist[wght], not
    // GeistMono[wght], which also contains it.
    .sort((a, b) => Math.abs(nameOf(a).length - needle.length) - Math.abs(nameOf(b).length - needle.length))
  const upright = matches.filter(f => !/italic|oblique/i.test(f))
  // Prefer the Regular weight so a static family's OG image isn't rendered in Black.
  return upright.find(f => /regular/i.test(f)) ?? upright[0] ?? matches[0] ?? null
}

function parseFontAxesFromBuffer(ab) {
  try {
    const data = new DataView(ab)
    const numTables = data.getUint16(4)
    let fvarOffset = 0, nameOffset = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
      if (t === 'fvar') fvarOffset = data.getUint32(12+i*16+8)
      if (t === 'name') nameOffset = data.getUint32(12+i*16+8)
    }
    if (!fvarOffset) return { axes: [], instances: [] }
    const getStr = (id) => {
      if (!nameOffset) return null
      const count = data.getUint16(nameOffset+2), base = nameOffset+data.getUint16(nameOffset+4)
      for (let i = 0; i < count; i++) {
        const r = nameOffset+6+i*12
        if (data.getUint16(r+6) !== id) continue
        if (data.getUint16(r) === 3 && data.getUint16(r+2) === 1) {
          const len = data.getUint16(r+8), off = data.getUint16(r+10)
          return Array.from({ length: len/2 }, (_, j) => String.fromCharCode(data.getUint16(base+off+j*2))).join('')
        }
      }
      return null
    }
    // Same fallback as App.jsx's detectAxes: name table, then the cached registry, then the tag.
    const registryName = tag => AXIS_REGISTRY.axes[tag]?.name
    const axOff = data.getUint16(fvarOffset+4), axCnt = data.getUint16(fvarOffset+8)
    const axSz = data.getUint16(fvarOffset+10), instCnt = data.getUint16(fvarOffset+12), instSz = data.getUint16(fvarOffset+14)
    const tags = [], axes = []
    for (let i = 0; i < axCnt; i++) {
      const o = fvarOffset+axOff+i*axSz
      const tag = String.fromCharCode(data.getUint8(o), data.getUint8(o+1), data.getUint8(o+2), data.getUint8(o+3))
      tags.push(tag)
      axes.push({ tag, name: getStr(data.getUint16(o+18)) || registryName(tag) || tag, min: data.getInt32(o+4)/65536, max: data.getInt32(o+12)/65536, defaultVal: data.getInt32(o+8)/65536 })
    }
    const instStart = fvarOffset+axOff+axCnt*axSz, instances = []
    for (let i = 0; i < instCnt; i++) {
      const o = instStart+i*instSz, name = getStr(data.getUint16(o))
      if (!name) continue
      const coordinates = {}
      tags.forEach((tag, j) => { coordinates[tag] = data.getInt32(o+4+j*4)/65536 })
      instances.push({ name, coordinates })
    }
    return { axes, instances }
  } catch { return { axes: [], instances: [] } }
}

// Returns merged, sorted [start, end] codepoint ranges the font's cmap supports,
// or null if no usable Unicode cmap is found. Handles formats 0, 4, 6, 12.
function parseCmapRangesFromBuffer(ab) {
  try {
    const data = new DataView(ab)
    const numTables = data.getUint16(4)
    let cmapOffset = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
      if (t === 'cmap') { cmapOffset = data.getUint32(12+i*16+8); break }
    }
    if (!cmapOffset) return null
    const numSub = data.getUint16(cmapOffset + 2)
    const subOffsets = []
    for (let i = 0; i < numSub; i++) subOffsets.push(cmapOffset + data.getUint32(cmapOffset + 4 + i*8 + 4))
    const cps = new Set()
    for (const off of subOffsets) {
      const format = data.getUint16(off)
      if (format === 0) {
        for (let c = 0; c < 256; c++) if (data.getUint8(off + 6 + c) !== 0) cps.add(c)
      } else if (format === 4) {
        const segX2 = data.getUint16(off + 6)
        const endBase = off + 14, startBase = endBase + segX2 + 2
        const deltaBase = startBase + segX2, rangeBase = deltaBase + segX2
        for (let s = 0; s < segX2/2; s++) {
          const end = data.getUint16(endBase + s*2), start = data.getUint16(startBase + s*2)
          const delta = data.getInt16(deltaBase + s*2), ro = data.getUint16(rangeBase + s*2)
          if (start === 0xFFFF) continue
          for (let c = start; c <= end && c !== 0xFFFF; c++) {
            let g
            if (ro === 0) g = (c + delta) & 0xFFFF
            else { g = data.getUint16(rangeBase + s*2 + ro + (c - start)*2); if (g !== 0) g = (g + delta) & 0xFFFF }
            if (g !== 0) cps.add(c)
          }
        }
      } else if (format === 6) {
        const first = data.getUint16(off + 6), count = data.getUint16(off + 8)
        for (let i = 0; i < count; i++) if (data.getUint16(off + 10 + i*2) !== 0) cps.add(first + i)
      } else if (format === 12) {
        const nGroups = data.getUint32(off + 12)
        for (let gi = 0; gi < nGroups; gi++) {
          const g = off + 16 + gi*12
          const startC = data.getUint32(g), endC = data.getUint32(g + 4), startGID = data.getUint32(g + 8)
          for (let c = startC; c <= endC; c++) if (startGID + (c - startC) !== 0) cps.add(c)
        }
      }
    }
    if (cps.size === 0) return null
    const sorted = Array.from(cps).sort((a, b) => a - b)
    const ranges = []
    let s = sorted[0], p = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === p + 1) { p = sorted[i]; continue }
      ranges.push([s, p]); s = p = sorted[i]
    }
    ranges.push([s, p])
    return ranges
  } catch { return null }
}

async function loadFontForSatori(filePath) {
  const buf = readFileSync(filePath)
  if (filePath.endsWith('.woff2')) {
    const { decompress } = await import('wawoff2')
    return Buffer.from(await decompress(buf))
  }
  return buf
}

async function generateOgImages() {
  const { default: satori } = await import('satori')
  const { Resvg } = await import('@resvg/resvg-js')

  const calsansuiFile = SPECIAL_SLUG_FILES.calsans ?? findFontFile('calsans')
  const uiFont = calsansuiFile
    ? await loadFontForSatori(fontPath(calsansuiFile))
    : null

  mkdirSync('dist/og', { recursive: true })

  const done = new Set()
  for (const { fontSlug } of routes) {
    if (done.has(fontSlug)) continue
    done.add(fontSlug)

    const file = SPECIAL_SLUG_FILES[fontSlug] ?? findFontFile(fontSlug)
    if (!file) {
      console.warn(`[og] No font file found for slug "${fontSlug}" — skipping`)
      continue
    }

    const fontBuffer = await loadFontForSatori(fontPath(file))
    const displayName = SPECIAL_SLUG_NAMES[fontSlug]
      ?? (fileToDisplayName(file).replace(WEIGHT_RE, '').trim() || fileToDisplayName(file))

    const fonts = [{ name: 'Preview', data: fontBuffer, weight: 400, style: 'normal' }]
    if (uiFont) fonts.push({ name: 'CalSansUI', data: uiFont, weight: 400, style: 'normal' })

    try {
      const svg = await satori(
        {
          type: 'div',
          props: {
            style: {
              width: '1200px',
              height: '630px',
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#242424',
              padding: '0 80px',
              position: 'relative',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    fontFamily: 'Preview',
                    fontSize: 380,
                    color: '#ffffff',
                    lineHeight: 1,
                  },
                  children: 'Aa',
                },
              },
              ...(uiFont ? [{
                type: 'div',
                props: {
                  style: {
                    position: 'absolute',
                    bottom: 36,
                    right: 48,
                    fontFamily: 'CalSansUI',
                    fontSize: 20,
                    color: 'rgba(255,255,255,0.45)',
                    letterSpacing: '0.04em',
                  },
                  children: displayName,
                },
              }] : []),
            ],
          },
        },
        { width: 1200, height: 630, fonts }
      )

      const png = new Resvg(svg).render().asPng()
      writeFileSync(`dist/og/${fontSlug}.png`, png)
      console.log(`[og] Generated dist/og/${fontSlug}.png`)
    } catch (err) {
      console.warn(`[og] Failed to generate OG for "${fontSlug}":`, err.message)
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    /* THE PWA. Installable from wordproof.app, works offline once opened.
       Precache is the app shell only (JS, CSS, HTML, icons) and never a font. Open-licensed
       faces (OFFLINE_FONTS) are cached the first time they are fetched (CacheFirst; a font
       file's name changes when its version does); client faces never are. OG images never.
       A new deploy (a wm-primitives bump included) is picked up on the next launch with
       no prompt (skipWaiting below). public/_headers keeps sw.js uncached so that
       check is never stale. */
    VitePWA({
      disable: !ROOT_BUILD,
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'favicon-light.svg', 'favicon-dark.svg'],
      manifest: {
        id: '/',
        name: 'Wordproof',
        short_name: 'Wordproof',
        description: 'Variable font proofing by WORDMARK.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#242424',
        theme_color: '#242424',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Desktop Chrome/Edge: an installed Wordproof shows up under Finder's "Open With"
        // for font files. The launch lands in App.jsx's launchQueue consumer.
        file_handlers: [{
          action: '/',
          accept: {
            'font/ttf': ['.ttf'],
            'font/otf': ['.otf'],
            'font/woff': ['.woff'],
            'font/woff2': ['.woff2'],
            'font/collection': ['.ttc'],
          },
        }],
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        // A new deploy takes over as soon as it is fetched, not after every Wordproof
        // window has closed (injectRegister 'script-defer' has no prompt to send
        // SKIP_WAITING). Old precaches are dropped.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}', 'icons/*.png'],
        globIgnores: ['_dial*.html', 'og/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/_dial/, /^\/og\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [{
          // OFFLINE_FONTS only. Any other font falls through to the network, uncached.
          urlPattern: OFFLINE_FONT_RE,
          handler: 'CacheFirst',
          options: {
            cacheName: 'wordproof-fonts',
            // The same file arrives twice, once from @font-face (a CORS request, with
            // Origin) and once from the app's fetch() (without). A Vary on the response
            // makes those two different cache keys, and the second missed offline.
            matchOptions: { ignoreVary: true },
            expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
          },
        }, {
          // Logos, avatars, the WORDMARK gif: cached as they are first shown, so the
          // chrome is whole offline. Refreshed in the background when online.
          urlPattern: ({ request, url }) => request.destination === 'image' && !url.pathname.startsWith('/og/'),
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'wordproof-images',
            matchOptions: { ignoreVary: true },
            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 90 },
          },
        }],
      },
    }),
    {
      name: 'font-axes-virtual',
      resolveId(id) {
        if (id === 'virtual:font-axes') return '\0virtual:font-axes'
      },
      async load(id) {
        if (id !== '\0virtual:font-axes') return
        const files = listFontFiles()
        const result = {}
        for (const file of files) {
          try {
            const rawBuf = await loadFontForSatori(fontPath(file))
            const ab = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)
            result[file] = { ...parseFontAxesFromBuffer(ab), chars: parseCmapRangesFromBuffer(ab) }
          } catch (e) {
            console.warn(`[font-axes] Failed to parse ${file}:`, e.message)
            result[file] = { axes: [], instances: [], chars: null }
          }
          if (result[file].axes.length === 0) console.warn(`[font-axes] No axes found for ${file}`)
        }
        return `export default ${JSON.stringify(result)}`
      },
    },
    /* No 404.html: Cloudflare Pages serves index.html for any path it has no file for
       (its SPA mode), with a 200. A 404.html would switch that off. The old copy existed
       for GitHub Pages, which had no fallback. */
    {
      name: 'og-routes',
      async closeBundle() {
        // Generate per-route HTML with correct OG tags
        const base = readFileSync('dist/index.html', 'utf-8')
        for (const { clientSlug, fontSlug } of routes) {
          const dir = `dist/${clientSlug}/${fontSlug}`
          mkdirSync(dir, { recursive: true })
          const fontFile = findFontFile(fontSlug)
          const rawName = SPECIAL_SLUG_NAMES[fontSlug]
            ?? (fontFile ? fileToDisplayName(fontFile) : fontSlug.charAt(0).toUpperCase() + fontSlug.slice(1))
          // Drop a trailing weight/style word so a static family reads "Foo",
          // not "Foo Black" (findFontFile picks a single weight file).
          const fontDisplayName = rawName.replace(/\s+(Thin|Extra ?Light|Ultra ?Light|Light|Book|Regular|Medium|Semi ?Bold|Demi ?Bold|Bold|Extra ?Bold|Heavy|Black)(\s+Italic)?$/i, '').trim() || rawName
          const title = `${fontDisplayName} — Wordproof`
          const imageUrl = `${SITE_ORIGIN}${SITE_BASE}/og/${fontSlug}.png`
          const pageUrl = `${SITE_ORIGIN}${SITE_BASE}/${clientSlug}/${fontSlug}/`
          const robots = INDEXED_FONTS.has(fontSlug) ? '' : '\n    <meta name="robots" content="noindex" />'
          const html = base
            .replace(/\s*<meta property="og:url"[^>]*>/, '')   // the root's; this page writes its own below
            .replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />${robots}`)
            .replace('<title>Wordproof</title>', `<title>${title}</title>`)
            .replace(/(<meta property="og:title"[^>]*>)/, `<meta property="og:title" content="${title}" />`)
            .replace(/<meta property="og:image" [^>]+>/,
              `<meta property="og:image" content="${imageUrl}" />\n`
              + `    <meta property="og:url" content="${pageUrl}" />\n`
              + `    <meta name="twitter:card" content="summary_large_image" />\n`
              + `    <meta name="twitter:image" content="${imageUrl}" />`)
          writeFileSync(`${dir}/index.html`, html)
        }

        // sitemap.xml + robots.txt for wordproof.app: the root and the INDEXED_FONTS routes
        // from routes.config.js. Root build only; the
        // /font-proofer/ test build is never served to a search engine.
        if (ROOT_BUILD) {
          const today = new Date().toISOString().slice(0, 10)
          const urls = ['/', ...[...new Set(routes.filter(r => INDEXED_FONTS.has(r.fontSlug)).map(r => `/${r.clientSlug}/${r.fontSlug}/`))]]
          writeFileSync('dist/sitemap.xml',
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + urls.map(u => `  <url><loc>${SITE_ORIGIN}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')
            + '\n</urlset>\n')
          writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)
        }

        // Generate OG images for all routes
        await generateOgImages()
      },
    },
  ],
  base: BASE,
})
