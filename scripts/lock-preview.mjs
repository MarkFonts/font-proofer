#!/usr/bin/env node
/* LOCK A CLIENT PREVIEW. `npm run lock:harvey` = `node scripts/lock-preview.mjs harvey`.

   The readable preview lives in private/<name>/ (gitignored: the repo is public). This builds
   it into one encrypted file, src/locked/<name>.bin, which is what gets committed and deployed.
   The app fetches it only when the preview's tab is opened, and the passphrase typed there is
   the key: nothing in the shipped code compares a password, a wrong one simply fails AES-GCM's
   authentication. No server is involved (Wordproof is static, DEPLOY.md).

   private/<name>/manifest.json names what goes in:
     { module, export, faces: [{ key, label, roman, italic? }], roles: { [role]: faceKey } }
   The module is built with Vite as CommonJS with react, react-dom and react/jsx-runtime left
   external: the app evaluates it with its own React handed in (one React, its hooks work).
   Its CSS is extracted. Fonts are packed as they are, with each one's axes in the header.

   Format (all integers big-endian):
     "WPL1" | u32 PBKDF2 iterations | 16-byte salt | 12-byte iv | AES-256-GCM ciphertext+tag
   Plaintext: u32 header length | header JSON | blobs. The header is
     { v: 1, js, css, export, faces: [{ key, label, roman: { filename, off, len, axes }, italic? }], roles }
   Key: PBKDF2-SHA-256(passphrase, salt, iterations) -> 256 bits. Salt and iv are fresh each run.

   The passphrase comes from a hidden prompt (asked twice) or WORDPROOF_LOCK_PASS. It is never
   written anywhere and never printed. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, basename, join } from 'path'
import { webcrypto as crypto } from 'crypto'
import { build } from 'vite'

const ITERATIONS = 310000   // OWASP's PBKDF2-SHA-256 figure; about a third of a second in a browser
const name = process.argv[2]
if (!name || !/^[a-z0-9-]+$/.test(name)) { console.error('usage: node scripts/lock-preview.mjs <name>'); process.exit(1) }
const dir = resolve('private', name)
if (!existsSync(join(dir, 'manifest.json'))) {
  console.error(`lock-preview: private/${name}/manifest.json is missing -- nothing to lock (the committed src/locked/${name}.bin is left as it is)`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))

// ── The passphrase ──────────────────────────────────────────────────────────
const ask = (prompt) => new Promise((done, fail) => {
  const { stdin, stdout } = process
  if (!stdin.isTTY) return fail(new Error('no terminal to ask on; set WORDPROOF_LOCK_PASS'))
  stdout.write(prompt)
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
  let s = ''
  const on = (ch) => {
    for (const c of ch) {
      if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); return done(s) }
      if (c === '\u0003') { stdout.write('\n'); process.exit(130) }
      if (c === '\u007f' || c === '\b') s = s.slice(0, -1)
      else s += c
    }
  }
  stdin.on('data', on)
})
let pass = process.env.WORDPROOF_LOCK_PASS
if (!pass) {
  pass = await ask(`Passphrase for ${name}: `)
  if ((await ask('Again: ')) !== pass) { console.error('lock-preview: the two did not match; nothing written'); process.exit(1) }
}
if (!pass || pass.length < 8) { console.error('lock-preview: use a passphrase of 8 characters or more'); process.exit(1) }

// ── Build the module ────────────────────────────────────────────────────────
const out = await build({
  configFile: false,
  root: dir,
  logLevel: 'warn',
  esbuild: { jsx: 'automatic', legalComments: 'none' },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: join(dir, manifest.module), formats: ['cjs'], fileName: () => 'preview.js' },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
})
const files = (Array.isArray(out) ? out : [out]).flatMap(o => o.output)
const js = files.find(f => f.type === 'chunk' && f.isEntry)?.code
const css = files.filter(f => f.type === 'asset' && f.fileName.endsWith('.css')).map(f => String(f.source)).join('\n')
if (!js) { console.error('lock-preview: the build produced no module'); process.exit(1) }

// ── Pack ────────────────────────────────────────────────────────────────────
// Fonts go in as they are (woff2 stays woff2: a third of the TrueType's size). The app's loader
// cannot read a woff2's tables in the browser, so a variable font's axes ride in the header,
// read here from the decompressed tables -- the same thing the font-axes build step does for
// src/fonts.
const { decompress } = await import('wawoff2')
const AXIS_NAMES = { wght: 'Weight', wdth: 'Width', slnt: 'Slant', ital: 'Italic', opsz: 'Optical Size', GRAD: 'Grade' }
const readAxes = (buf) => {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const n = v.getUint16(4)
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    if (String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3)) !== 'fvar') continue
    const o = v.getUint32(r + 8), axOff = v.getUint16(o + 4), cnt = v.getUint16(o + 8), sz = v.getUint16(o + 10)
    return Array.from({ length: cnt }, (_, k) => {
      const a = o + axOff + k * sz
      const tag = String.fromCharCode(v.getUint8(a), v.getUint8(a + 1), v.getUint8(a + 2), v.getUint8(a + 3))
      return { tag, name: AXIS_NAMES[tag] ?? tag, min: v.getInt32(a + 4) / 65536, defaultVal: v.getInt32(a + 8) / 65536, max: v.getInt32(a + 12) / 65536 }
    })
  }
  return []
}
const blobs = []
let off = 0
const pack = async (rel) => {
  const buf = readFileSync(join(dir, rel))
  const tables = rel.endsWith('.woff2') ? Buffer.from(await decompress(buf)) : buf
  blobs.push(buf)
  const entry = { filename: basename(rel), off, len: buf.length, axes: readAxes(tables) }
  off += buf.length
  return entry
}
const faces = []
for (const f of manifest.faces ?? []) {
  faces.push({ key: f.key, label: f.label, roman: await pack(f.roman), ...(f.italic && { italic: await pack(f.italic) }) })
}
const header = Buffer.from(JSON.stringify({ v: 1, js, css, export: manifest.export, faces, roles: manifest.roles ?? {} }))
const len = Buffer.alloc(4); len.writeUInt32BE(header.length)
const plain = Buffer.concat([len, header, ...blobs])

// ── Encrypt ─────────────────────────────────────────────────────────────────
const salt = crypto.getRandomValues(new Uint8Array(16))
const iv = crypto.getRandomValues(new Uint8Array(12))
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
const head = Buffer.alloc(8); head.write('WPL1', 0, 'ascii'); head.writeUInt32BE(ITERATIONS, 4)
mkdirSync('src/locked', { recursive: true })
const target = `src/locked/${name}.bin`
writeFileSync(target, Buffer.concat([head, salt, iv, sealed]))
console.log(`lock-preview: wrote ${target} (${(36 + sealed.length).toLocaleString()} bytes: module ${js.length.toLocaleString()}, css ${css.length.toLocaleString()}, ${faces.length} faces). Commit it; private/${name}/ stays out.`)
