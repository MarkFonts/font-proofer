#!/usr/bin/env node
// Add or update a bundled font. Usage:
//   npm run font:add -- "src/fonts/GeistSerif-Regular 2.95.ttf"
//
// Fonts here go stale — calbuild is the source of truth for Cal Sans:
//   calbuild/fonts/calsans-var-flex/CalSansFlexVF.ttf
//   calbuild/fonts/calsans-var-full/CalSansVF.ttf
// Copy over the existing file, then run this with no args to just rebuild.
//
// What it does: strips the version off the filename (a space/dot in the name
// breaks FontFace family serialization, and the version would show as the UI
// font name next to the font's own name-table version), records the version in
// font-versions.json, builds, and commits. Push separately — that deploys.

import { execSync } from 'node:child_process'
import { renameSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const run = (c) => execSync(c, { stdio: 'inherit' })
const src = process.argv[2]

let name = null, version = null
if (src) {
  if (!existsSync(src)) { console.error(`not found: ${src}`); process.exit(1) }
  const base = basename(src)
  // "GeistSerif-Regular 2.95.ttf" -> family "GeistSerif-Regular", version "2.95"
  const m = base.match(/^(.*?)[\s_-]*v?(\d+\.\d+)(\.[^.]+)$/i)
  if (!m) { console.error(`no version in filename: ${base}\nexpected e.g. "Name 2.95.ttf"`); process.exit(1) }
  const [, stem, ver, ext] = m
  version = ver
  const dest = join(dirname(src), stem.trim() + ext)
  renameSync(src, dest)
  console.log(`renamed  ${base}  ->  ${basename(dest)}`)
  // "GeistSerif-Regular" -> "Geist Serif"
  name = stem.trim().replace(/-(Regular|Roman)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim()

  const vf = 'font-versions.json'
  const versions = JSON.parse(readFileSync(vf, 'utf8'))
  versions[name] = version
  writeFileSync(vf, JSON.stringify(versions, null, 2) + '\n')
  console.log(`recorded ${name} = ${version}`)
}

run('npm run build')
run('node shared/scripts/lint-tokens.mjs')

if (name) {
  run('git add -A src/fonts font-versions.json')
  run(`git commit -q -m ${JSON.stringify(`${name} ${version}`)} -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`)
  console.log(`\ncommitted. push to deploy:\n  git push origin main`)
}
