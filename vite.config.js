import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import routes from './src/routes.config.js'

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

function findFontFile(fontSlug) {
  const needle = normalize(fontSlug)
  const files = readdirSync('src/fonts').filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f))
  const matches = files.filter(f => {
    const n = normalize(f.replace(/\.[^.]+$/, ''))
    return n.includes(needle) || needle.includes(n)
  })
  return matches.find(f => !/italic|oblique/i.test(f)) ?? matches[0] ?? null
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
    const tagLabels = { wght:'Weight', wdth:'Width', ital:'Italic', slnt:'Slant', opsz:'Optical Size', GRAD:'Grade' }
    const axOff = data.getUint16(fvarOffset+4), axCnt = data.getUint16(fvarOffset+8)
    const axSz = data.getUint16(fvarOffset+10), instCnt = data.getUint16(fvarOffset+12), instSz = data.getUint16(fvarOffset+14)
    const tags = [], axes = []
    for (let i = 0; i < axCnt; i++) {
      const o = fvarOffset+axOff+i*axSz
      const tag = String.fromCharCode(data.getUint8(o), data.getUint8(o+1), data.getUint8(o+2), data.getUint8(o+3))
      tags.push(tag)
      axes.push({ tag, name: getStr(data.getUint16(o+18)) || tagLabels[tag] || tag, min: data.getInt32(o+4)/65536, max: data.getInt32(o+12)/65536, defaultVal: data.getInt32(o+8)/65536 })
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

  const calsansuiFile = findFontFile('calsansui')
  const uiFont = calsansuiFile
    ? await loadFontForSatori(`src/fonts/${calsansuiFile}`)
    : null

  mkdirSync('dist/og', { recursive: true })

  const done = new Set()
  for (const { fontSlug } of routes) {
    if (done.has(fontSlug)) continue
    done.add(fontSlug)

    const file = findFontFile(fontSlug)
    if (!file) {
      console.warn(`[og] No font file found for slug "${fontSlug}" — skipping`)
      continue
    }

    const fontBuffer = await loadFontForSatori(`src/fonts/${file}`)
    // Display name: strip known suffixes, clean up separators
    const displayName = file
      .replace(/\.[^.]+$/, '')
      .replace(/VarDemo|VariableFont|Variable|BETAVF|VF/gi, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s*\[.*$/, '')
      .trim()

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
    {
      name: 'font-axes-virtual',
      resolveId(id) {
        if (id === 'virtual:font-axes') return '\0virtual:font-axes'
      },
      async load(id) {
        if (id !== '\0virtual:font-axes') return
        const files = readdirSync('src/fonts').filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f))
        const result = {}
        for (const file of files) {
          try {
            const rawBuf = await loadFontForSatori(`src/fonts/${file}`)
            const ab = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)
            result[file] = parseFontAxesFromBuffer(ab)
          } catch {
            result[file] = { axes: [], instances: [] }
          }
        }
        return `export default ${JSON.stringify(result)}`
      },
    },
    {
      name: 'copy-404',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
      },
    },
    {
      name: 'og-routes',
      async closeBundle() {
        // Generate per-route HTML with correct OG tags
        const base = readFileSync('dist/index.html', 'utf-8')
        for (const { clientSlug, fontSlug } of routes) {
          const dir = `dist/${clientSlug}/${fontSlug}`
          mkdirSync(dir, { recursive: true })
          const title = `${fontSlug.charAt(0).toUpperCase() + fontSlug.slice(1)} — Font Proofer`
          const html = base
            .replace('<title>Font Proofer</title>', `<title>${title}</title>`)
            .replace(/(<meta property="og:title"[^>]*>)/, `<meta property="og:title" content="${title}" />`)
            .replace(/<meta property="og:image" [^>]+>/, `<meta property="og:image" content="/font-proofer/og/${fontSlug}.png" />`)
          writeFileSync(`${dir}/index.html`, html)
        }

        // Generate OG images for all routes
        await generateOgImages()
      },
    },
  ],
  base: '/font-proofer/',
})
