// Forgiving route URLs (Cloudflare Pages Function, runs before the static files).
//
// Pages paths are case-sensitive and each route's page lives in a lowercase folder
// (/calcom/calsansflex/). A link typed any other way (/calcom/CalSansFlex, /wordmark/aileronVF,
// /calcom/calsans-vf) used to fall through to the root page, so it opened the right font in
// the app but its title and link-preview image were the root's. This sends such a link to
// the route's own page with a 301, so the preview is the font's.
//
// What matches: the client by name, the font by slug, both ignoring case and - _ . spaces;
// the font also ignoring a trailing "vf" / "var" / "variable" on either side (aileron ->
// aileronvf, calsansVF -> calsans). An exact slug always wins; a loose match must be the
// only one for that client. Anything else, and every file request, passes straight through.
import routes from '../src/routes.config.js'

const norm = s => s.toLowerCase().replace(/[-_.\s]/g, '')
const loose = s => norm(s).replace(/(vf|var|variable)$/, '')
const clients = new Set(routes.map(r => r.clientSlug))

export function canonicalPath(pathname) {
  let segs
  try { segs = pathname.split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
  if (segs.length < 1 || segs.length > 2) return null
  const client = norm(segs[0])
  if (!clients.has(client)) return null
  if (segs.length === 1) return `/${client}/`
  const mine = routes.filter(r => r.clientSlug === client)
  const exact = mine.filter(r => r.fontSlug === norm(segs[1]))
  const hits = exact.length ? exact : mine.filter(r => loose(r.fontSlug) === loose(segs[1]))
  return hits.length === 1 ? `/${client}/${hits[0].fontSlug}/` : null
}

export async function onRequest({ request, next }) {
  try {
    const url = new URL(request.url)
    const to = canonicalPath(url.pathname)
    // the lowercase route without its slash is left to Pages' own slash redirect
    if (to && to !== url.pathname && to !== url.pathname + '/') {
      return Response.redirect(url.origin + to + url.search, 301)
    }
  } catch { /* never let a redirect nicety break a page */ }
  return next()
}
