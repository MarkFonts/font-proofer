#!/usr/bin/env node
/* Cache Google Fonts' axis registry as one JSON, committed.

   The registry (github.com/googlefonts/axisregistry, Lib/axisregistry/data/*.textproto)
   is one small text file per registered axis: tag, display name, range, precision, the
   named fallback stops, a paragraph of description. font-proofer names a rail row from
   the font's own name table first; a font that ships a bare tag with no name record --
   or a tag the app had never met -- used to fall through a six-entry table to the tag
   itself. Now it falls through this file, which knows fifty-odd, and nothing at
   runtime touches the network.

   `npm run registry:sync` rewrites src/axisRegistry.json from the registry's main branch.
   Run it when Google adds an axis; commit the result. */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://api.github.com/repos/googlefonts/axisregistry/contents/Lib/axisregistry/data'
const RAW = 'https://raw.githubusercontent.com/googlefonts/axisregistry/main/Lib/axisregistry/data/'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/axisRegistry.json')

/* The textproto subset the registry uses: `key: value` scalars, `fallback { … }` blocks,
   and a `description:` whose value is one or more adjacent quoted strings on the lines
   that follow. Enough for these files; not a protobuf parser. */
function parse(text) {
  const out = { fallbacks: [] }
  let fb = null, desc = null
  for (let raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    if (desc !== null) {
      const m = line.match(/^"(.*)"\s*$/)
      if (m) { desc += m[1]; continue }
      out.description = desc; desc = null
    }
    if (line === 'fallback {') { fb = {}; continue }
    if (line === '}') { if (fb) out.fallbacks.push(fb); fb = null; continue }
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    const [, key, val] = m
    const v = val === '' ? '' : val.startsWith('"') ? val.replace(/^"|"\s*$/g, '') : val === 'true' ? true : val === 'false' ? false : Number(val)
    if (key === 'description') { desc = typeof v === 'string' ? v : ''; continue }
    if (fb) fb[key] = v; else out[key] = v
  }
  if (desc !== null) out.description = desc
  return out
}

const files = (await (await fetch(API, { headers: { 'User-Agent': 'font-proofer' } })).json())
  .map(f => f.name).filter(n => n.endsWith('.textproto')).sort()
const registry = {}
for (const f of files) {
  const p = parse(await (await fetch(RAW + f)).text())
  if (!p.tag) continue
  registry[p.tag] = {
    name: p.display_name,
    min: p.min_value, default: p.default_value, max: p.max_value,
    precision: p.precision,
    fallbacks: p.fallbacks.map(x => ({ name: x.name, value: x.value })),
    fallbackOnly: !!p.fallback_only,
    description: p.description ?? '',
  }
}
writeFileSync(OUT, JSON.stringify({ _: 'Google Fonts axis registry, cached by scripts/sync-axis-registry.mjs. Do not edit; `npm run registry:sync`.', synced: new Date().toISOString().slice(0, 10), axes: registry }, null, 2) + '\n')
console.log(`axisRegistry.json: ${Object.keys(registry).length} axes from ${files.length} files`)
