import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-404',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
      },
    },
    {
      name: 'og-routes',
      closeBundle() {
        // Dynamically require the routes config (CommonJS-safe read)
        const routesPath = new URL('./src/routes.config.js', import.meta.url).pathname
        // Read routes by eval-ing the ES module source
        const src = readFileSync(routesPath, 'utf-8')
        const routes = Function(
          src
            .replace(/export default/, 'return')
            .replace(/^import.*$/gm, '')
        )()

        const base = readFileSync('dist/index.html', 'utf-8')

        for (const { clientSlug, fontSlug } of routes) {
          const dir = `dist/${clientSlug}/${fontSlug}`
          mkdirSync(dir, { recursive: true })

          const title = `${fontSlug.charAt(0).toUpperCase() + fontSlug.slice(1)} — Font Proofer`
          const ogImage = `/font-proofer/og/${fontSlug}.png`

          const html = base
            .replace('<title>Font Proofer</title>', `<title>${title}</title>`)
            .replace(/(<meta property="og:title"[^>]*>)/, `<meta property="og:title" content="${title}" />`)
            .replace(/<meta property="og:image" [^>]+>/, `<meta property="og:image" content="${ogImage}" />`)

          writeFileSync(`${dir}/index.html`, html)
        }
      },
    },
  ],
  base: '/font-proofer/',
})
