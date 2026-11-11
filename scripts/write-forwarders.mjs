// Wordproof (the font proofer) lives at wordproof.app. wordmark.nyc/font-proofer/ keeps one small page
// per route the app used to serve, each forwarding to the same path there -- query and
// hash kept, so a shared link like /font-proofer/calcom/calsans/#glyphs still opens the
// glyphs view. GitHub Pages has no server redirects, so it is a canonical link, a meta
// refresh and location.replace (the same forwarder wordmark.nyc/calsans/ uses).
// Anything without a page here hits wordmark.nyc's 404.html, which forwards the same way.
//   node scripts/write-forwarders.mjs <built dist> <out dir>
import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, relative } from 'path'

const [dist, out] = process.argv.slice(2)
if (!dist || !out) { console.error('usage: write-forwarders.mjs <dist> <out>'); process.exit(1) }
const ORIGIN = 'https://wordproof.app'

function dirsWithIndex(dir) {
  const found = existsSync(join(dir, 'index.html')) ? [dir] : []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory() && name !== 'assets') found.push(...dirsWithIndex(p))
  }
  return found
}

const page = to => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wordproof</title>
<link rel="canonical" href="${ORIGIN}${to}">
<meta http-equiv="refresh" content="0; url=${ORIGIN}${to}">
<script>location.replace('${ORIGIN}${to}' + location.search + location.hash)</script>
</head>
<body>
<p>The font proofer is now Wordproof, at <a href="${ORIGIN}${to}">wordproof.app</a>.</p>
</body>
</html>
`

const write = (rel, to) => {
  mkdirSync(join(out, rel), { recursive: true })
  writeFileSync(join(out, rel, 'index.html'), page(to))
  console.log(`font-proofer/${rel ? rel + '/' : ''} -> ${ORIGIN}${to}`)
}

for (const d of dirsWithIndex(dist)) {
  const rel = relative(dist, d).split('\\').join('/')
  write(rel, rel ? `/${rel}/` : '/')
}

// Old slugs (App.jsx SLUG_REDIRECTS) that Google still crawls. Without a page here they
// reach the 404 forwarder, which works for people but returns a 404 status to Google;
// a page of their own reads as a redirect and goes straight to the current route.
const LEGACY = { 'calcom/calsans2': '/calcom/calsans/', 'calcom/calsansui': '/calcom/calsans/' }
for (const [rel, to] of Object.entries(LEGACY)) write(rel, to)
