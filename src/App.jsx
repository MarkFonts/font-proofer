import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import {
  StyleScopeList, InlineEmphasisBubble,
  placeCaretAtStart as placeCursorAtStart,
  placeCaretAtEnd as placeCursorAtEnd,
  splitInlineMarkup, isPlainRun,
  AxisSlider as SliderRow,
  makeGlyphSets, parseCmapRanges, isSupported,
  nbMinus, EditableTextBlock, GlyphPicker, measureGlyphMetrics, enumerateCmap,
  FLATTERSATZ_DEFAULTS as FIT_DEFAULTS,
  FittingControls, fittingMode, AlignmentButtons, FittedParagraph,
  loadSpecimen, specimenChunks, SpecimenNav,
} from '../shared/index' // wm-primitives (git submodule)
// Lazy chunk — the ~40-component UI board only loads when the UI tab is opened
const UiPreview = lazy(() => import('../shared/src/UiKitBoard')) // wm-primitives UiKitBoard
import fontAxesData from 'virtual:font-axes'
import logoGif from '/public/logo.gif'
import logoGifDark from '/public/logo_darkmode.gif'
import peerAvatar from '/public/peer-richelsen.png'
import calcomIcon from '/public/calcom-icon.svg'
import calcomBanner from '/public/calcom-banner.png'
import cossCalAvatar from '/public/coss-cal-avatar.jpg'
import cossUserAvatar from '/public/coss-user-avatar.jpg'

// ── Logo mode ─────────────────────────────────────────────────────────────────
// Set to true to show the client's SVG logo in the sidebar instead of the WM gif
const SHOW_CLIENT_LOGO = true

const _rawLogos = import.meta.glob('./logos/*.svg', { query: '?raw', import: 'default', eager: true })
const CLIENT_LOGOS = Object.fromEntries(
  Object.entries(_rawLogos).map(([path, svg]) => {
    const key = path.replace('./logos/', '').replace(/\.svg$/i, '').toLowerCase()
    const clean = svg
      .replace(/<\?xml[^?]*\?>\s*/i, '')       // strip XML declaration
      .replace(/<style[\s\S]*?<\/style>/gi, '') // strip embedded styles (prevent global bleed)
      .replace(/(<svg\b[^>]*?)(\s*fill="[^"]*")?(\s*>)/i, '$1 fill="currentColor"$3') // ensure currentColor
    return [key, clean]
  })
)
function fuzzyClientLogo(slug) {
  if (!slug) return null
  const n = slug.toLowerCase()
  if (CLIENT_LOGOS[n]) return CLIENT_LOGOS[n]
  const key = Object.keys(CLIENT_LOGOS).find(k => k.includes(n) || n.includes(k))
  return key ? CLIENT_LOGOS[key] : null
}
function ClientLogo({ slug, clientLabel }) {
  const svg = fuzzyClientLogo(slug)
  if (svg) return <div className="client-logo-svg" dangerouslySetInnerHTML={{ __html: svg }} />
  return <span className="client-logo-text">{clientLabel}</span>
}

// ── URL route parsing ────────────────────────────────────────────────────────
const BASE = '/font-proofer'
const SLUG_REDIRECTS = { calsansui: 'calsans', calsans2: 'calsans' }
function parseRoute() {
  const params = new URLSearchParams(window.location.search)
  const routeParam = params.get('route')
  if (routeParam) {
    window.history.replaceState(null, null, routeParam)
  }
  const path = window.location.pathname.startsWith(BASE)
    ? window.location.pathname.slice(BASE.length)
    : window.location.pathname
  const segments = path.split('/').filter(Boolean)
  let [clientSlug, fontSlug] = segments
  if (fontSlug && SLUG_REDIRECTS[fontSlug]) {
    fontSlug = SLUG_REDIRECTS[fontSlug]
    window.history.replaceState(null, null, `${BASE}/${clientSlug}/${fontSlug}${window.location.hash}`)
  }
  return { clientSlug: clientSlug || null, fontSlug: fontSlug || null }
}

function toDisplayName(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ── Hash ↔ mode mapping ───────────────────────────────────────────────────────
const HASH_TO_MODE = { '#big': 'big', '#paragraph': 'paragraph', '#glyphs': 'glyphs', '#type-scale': 'scale', '#calcom': 'calcom', '#coss': 'coss', '#ui': 'ui' }
const MODE_TO_HASH = { big: '#big', paragraph: '#paragraph', glyphs: '#glyphs', scale: '#type-scale', calcom: '#calcom', coss: '#coss', ui: '#ui' }

function resolveInitialMode(isCalcom) {
  const fromHash = HASH_TO_MODE[window.location.hash]
  if (fromHash === 'calcom' || fromHash === 'coss') return isCalcom ? fromHash : 'paragraph'
  return fromHash ?? 'paragraph'
}

// ── Font fuzzy matching ──────────────────────────────────────────────────────
const fontModules = import.meta.glob('/src/fonts/*.{ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' })

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

// ── Special built-in fonts (UI fonts, not from src/fonts/) ───────────────────
const SPECIAL_FONTS = {
  calsans: { name: 'CalSans', file: 'CalSansVF.ttf' },
  calsansflex: { name: 'CalSans Flex', file: 'CalSansFlexVF.ttf' },
  switzerland2038: { name: 'Switzerland 2038', file: 'Switzerland2038-500.ttf' },
  sbromievf: { name: 'SB Romie', file: 'SBRomieVF.ttf' },
}

function matchSpecial(slug) {
  return SPECIAL_FONTS[slug.toLowerCase().replace(/[-_\s]/g, '')] || null
}

const fontNameOf = path => normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))

function matchFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  if (!entries.length) return null
  const matches = entries
    .filter(([path]) => { const n = fontNameOf(path); return n.includes(needle) || needle.includes(n) })
    // Closest match wins (fewest extra chars beyond the slug), so 'geist' resolves to
    // Geist[wght] rather than GeistSerif…, and 'geistserif' resolves to the serif.
    .sort(([a], [b]) => Math.abs(fontNameOf(a).length - needle.length) - Math.abs(fontNameOf(b).length - needle.length))
  const upright = matches.find(([path]) => !/italic|oblique/i.test(path))
  const match = upright ?? matches[0] ?? null
  return match ? { url: match[1], filename: match[0].split('/').pop() } : null
}

function matchItalicFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  const matches = entries.filter(([path]) => {
    const name = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return name.includes(needle) || needle.includes(name)
  })
  const italic = matches.find(([path]) => /italic|oblique/i.test(path))
  return italic ? { url: italic[1], filename: italic[0].split('/').pop() } : null
}

// ── Static family style picker ───────────────────────────────────────────────
// A static family ships one file per weight×slant (e.g. SBRomie-BoldItalic.ttf).
// getFamilyStyles groups the slug-matching files by weight so the UI can offer a
// "Style" dropdown; each entry pairs a roman file with its italic companion.
const WEIGHT_ORDER = ['thin', 'extralight', 'ultralight', 'light', 'book', 'regular', 'normal', 'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'heavy', 'black']

function parseWeightSlant(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  const italic = /italic|oblique/i.test(base)
  let weight = (base.split(/[-_ ]/).pop() || base).replace(/italic|oblique/gi, '').trim()
  if (!weight) weight = 'Regular'
  return { weight, italic }
}

function getFamilyStyles(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules).filter(([path]) => {
    const n = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return n.includes(needle) || needle.includes(n)
  })
  const byWeight = new Map()
  for (const [path, url] of entries) {
    const filename = path.split('/').pop()
    const { weight, italic } = parseWeightSlant(filename)
    const key = weight.toLowerCase()
    // Only recognized weight names count — this keeps variable fonts (Geist,
    // Kloten: filenames like "Geist[wght]") from being misread as a static family.
    if (!WEIGHT_ORDER.includes(key)) continue
    if (!byWeight.has(key)) byWeight.set(key, { key, label: weight, roman: null, italic: null })
    const slot = byWeight.get(key)
    if (italic) slot.italic = { url, filename }
    else slot.roman = { url, filename }
  }
  const rank = (k) => { const i = WEIGHT_ORDER.indexOf(k); return i === -1 ? 999 : i }
  return Array.from(byWeight.values()).sort((a, b) => rank(a.key) - rank(b.key))
}

function defaultStyleKey(styles) {
  return (styles.find(s => s.key === 'regular') ?? styles.find(s => s.key === 'normal' || s.key === 'book') ?? styles[Math.floor(styles.length / 2)])?.key ?? null
}

// ── Sample content ──────────────────────────────────────────────────────────
const SAMPLE_BIG = 'Hand gloves'

// Every preset is a specimen now: one authored file per work in wm-primitives, fetched
// in chunks, identical in both apps. Nothing here holds prose — the shortest sample and
// the whole novel arrive by exactly the same route, which is the point. The label is UI
// copy and stays; the text is not.
const TEXT_PRESETS = {
  'Sample': { specimen: 'sample' },
  'A Tale of Two Cities': { specimen: 'tale-of-two-cities' },
  'Staatliche Bauhaus': { specimen: 'staatliche-bauhaus' },
  'Kern King': { specimen: 'kern-king' },
}


// ── Cal.com type role model ───────────────────────────────────────────────────
// nbMinus (typographic minus for spec chips) now imported from wm-primitives.

const CALCOM_ROLE_LABELS = {
  eventHost: 'Host', eventTitle: 'Title', eventDesc: 'Desc',
  eventMeta: 'Meta', calHeader: 'Cal',   calDay: 'Day', timeSlot: 'Time',
}
const DEFAULT_CALCOM_ROLES = {
  eventHost:  { size: 14, tracking: 0,      leading: 1.4, axisOverrides: {} },
  eventTitle: { size: 28, tracking: 0, interTracking: -0.015, leading: 1.1, axisOverrides: { wght: 700, opsz: 'auto', GEOM: 50 } },
  eventDesc:  { size: 13, tracking: 0,      leading: 1.5, axisOverrides: {} },
  eventMeta:  { size: 13, tracking: 0,      leading: 1.4, axisOverrides: {} },
  calHeader:  { size: 11, tracking: 0.05,   leading: 1,   axisOverrides: { wght: 500 } },
  calDay:     { size: 13, tracking: 0,      leading: 1,   axisOverrides: {} },
  timeSlot:   { size: 14, tracking: 0,      leading: 1,   axisOverrides: {} },
}

// ── Coss (booking events) type role model ────────────────────────────────────
const COSS_ROLE_LABELS = {
  navLabel: 'Nav', pageTitle: 'Title', cardTitle: 'Event',
  cardSlug: 'Slug', cardDesc: 'Desc', badge: 'Badge',
}
const DEFAULT_COSS_ROLES = {
  navLabel:  { size: 14, tracking: 0,      leading: 1.4, axisOverrides: {} },
  pageTitle: { size: 20, tracking: -0.01,  leading: 1.2, axisOverrides: { wght: 700, opsz: 'auto', GEOM: 50 } },
  cardTitle: { size: 14, tracking: 0,      leading: 1.3, axisOverrides: { wght: 500 } },
  cardSlug:  { size: 12, tracking: 0,      leading: 1.4, axisOverrides: {} },
  cardDesc:  { size: 13, tracking: 0,      leading: 1.5, axisOverrides: {} },
  badge:     { size: 11, tracking: 0,      leading: 1,   axisOverrides: {} },
}

// ── Paragraph style model ────────────────────────────────────────────────────
// Per-block overrides (weight/italic/ss04/ss05) default to null = inherit the
// global control, mirroring how axisOverrides inherit axisValues.
const DEFAULT_PARA_STYLES = {
  // align / swissRag / hyphenate are the style's OWN, like size and leading and unlike
  // the axes: they inherit nothing. A heading is ranged left and is not hyphenated, and
  // justifying the body text is not a statement about the headings above it. The H&J
  // bands they are fitted to stay global — those belong to the typeface, not the style.
  h1: { size: 57, leading: 1.1, tracking: 0,     axisOverrides: { wght: 700, opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null, align: 'left', swissRag: false, hyphenate: false },
  h2: { size: 32, leading: 1.2, tracking: 0,     axisOverrides: { wght: 400, opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null, align: 'left', swissRag: false, hyphenate: false },
  h3: { size: 22, leading: 1.3, tracking: 0,     axisOverrides: { opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null, align: 'left', swissRag: false, hyphenate: false },
  p:  { size: 18, leading: 1.6, tracking: 0,     axisOverrides: { opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null, align: 'left', swissRag: false, hyphenate: false },
}

// Shared feature string. ss04 fires only in italic, ss05 only in roman.
function featureStr(italic, s04, s05) {
  const feats = ['"calt" 0', '"ss20" 0']
  if (s04 && italic) feats.push('"ss04" 1')
  if (s05 && !italic) feats.push('"ss05" 1')
  return feats.join(', ')
}

// ── Tailwind type scale ───────────────────────────────────────────────────────
const TAILWIND_SCALE = [
  { key: 'text-xs',   pxSize: 12,  lh: 1 / 0.75 },
  { key: 'text-sm',   pxSize: 14,  lh: 1.25 / 0.875 },
  { key: 'text-base', pxSize: 16,  lh: 1.5 },
  { key: 'text-lg',   pxSize: 18,  lh: 1.75 / 1.125 },
  { key: 'text-xl',   pxSize: 20,  lh: 1.75 / 1.25 },
  { key: 'text-2xl',  pxSize: 24,  lh: 2 / 1.5 },
  { key: 'text-3xl',  pxSize: 30,  lh: 2.25 / 1.875 },
  { key: 'text-4xl',  pxSize: 36,  lh: 2.5 / 2.25 },
  { key: 'text-5xl',  pxSize: 48,  lh: 1 },
  { key: 'text-6xl',  pxSize: 60,  lh: 1 },
  { key: 'text-7xl',  pxSize: 72,  lh: 1 },
  { key: 'text-8xl',  pxSize: 96,  lh: 1 },
  { key: 'text-9xl',  pxSize: 128, lh: 1 },
]
// xs–lg are always visible; xl–9xl are controlled by scaleMaxXl
const TAILWIND_BASE = TAILWIND_SCALE.slice(0, 4)
const TAILWIND_XL   = TAILWIND_SCALE.slice(4)

const SCALE_PAIR_TEXT = 'A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with my whole heart. I am alone, and feel the charm of existence in this spot, which was created for the bliss of souls like mine.'

const DEFAULT_SCALE_AXIS_OVERRIDES = Object.fromEntries(TAILWIND_SCALE.map(s => [s.key, { opsz: 'auto' }]))

// ── Cursor utilities ─────────────────────────────────────────────────────────
// caret helpers (placeCursor* aliases) imported from wm-primitives.

// Inline semi-markup → styled React nodes: **bold**, *italic*, __underline__.
// Parsing is shared (splitInlineMarkup from wm-primitives); `italicStyle` /
// `boldStyle` are per-font CSS style objects (resolved from blockStyle) so each
// font renders its own italic/bold — variable axis or separate face alike.
function renderInline(text, italicStyle, boldStyle) {
  const toks = splitInlineMarkup(text)
  if (isPlainRun(toks)) return text
  return toks.map((t, k) =>
    t.type === 'bold' ? <strong key={k} style={boldStyle}>{t.value}</strong>
      : t.type === 'italic' ? <em key={k} style={italicStyle}>{t.value}</em>
        : t.type === 'underline' ? <u key={k}>{t.value}</u>
          : t.value)
}

// parseCmapRanges now imported from wm-primitives (shared/src/glyphset.ts).

// Base groups (Uppercase/Lowercase/Numerals/Symbols) come from the shared factory;
// Miscellaneous (spacing modifiers + dotted-circle combining marks) is font-proofer's
// own extra group, folded into "All" by makeGlyphSets.
const GLYPH_SETS = makeGlyphSets({
  'Miscellaneous': [
    ...'´¨¯˜ˆˇ˘˙˚˛˝¸',
    '◌̀', '◌́', '◌̂', '◌̃',
    '◌̄', '◌̆', '◌̇', '◌̈',
    '◌̉', '◌̊', '◌̋', '◌̌',
    '◌̛', '◌̣', '◌̤', '◌̥',
    '◌̦', '◌̧', '◌̨', '◌̩',
    '◌̮', '◌̰', '◌̱', '◌̲',
    '◌̶', '◌̸',
  ],
})

// Minimal GSUB scan: returns the set of feature tags present (e.g. 'ss04').
function gsubFeatureTags(ab) {
  try {
    const d = new DataView(ab)
    const numTables = d.getUint16(4)
    let g = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(d.getUint8(12+i*16), d.getUint8(13+i*16), d.getUint8(14+i*16), d.getUint8(15+i*16))
      if (t === 'GSUB') { g = d.getUint32(12+i*16+8); break }
    }
    if (!g) return []
    const flOff = g + d.getUint16(g + 6)
    const count = d.getUint16(flOff)
    const tags = []
    for (let i = 0; i < count; i++) {
      const rec = flOff + 2 + i*6
      tags.push(String.fromCharCode(d.getUint8(rec), d.getUint8(rec+1), d.getUint8(rec+2), d.getUint8(rec+3)))
    }
    return tags
  } catch { return [] }
}

// ── TTC helpers ──────────────────────────────────────────────────────────────
function parseTTCOffsets(buffer) {
  const data = new DataView(buffer)
  const numFonts = data.getUint32(8)
  return Array.from({ length: numFonts }, (_, i) => data.getUint32(12 + i * 4))
}

function getFontNameInTTC(buffer, fontOffset) {
  const data = new DataView(buffer)
  const numTables = data.getUint16(fontOffset + 4)
  let nameOff = 0
  for (let i = 0; i < numTables; i++) {
    const r = fontOffset + 12 + i * 16
    const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
    if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
  }
  if (!nameOff) return null
  const count = data.getUint16(nameOff + 2)
  const base = nameOff + data.getUint16(nameOff + 4)
  for (const targetId of [4, 1]) {
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12
      if (data.getUint16(r + 6) !== targetId) continue
      if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
        const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
        return Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
      }
    }
  }
  return null
}

// nameID priority: 16 (Preferred Family) → 1 (Family) → 4 (Full Name)
function readFamilyNameFromBuffer(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    let nameOff = 0
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
      if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
    }
    if (!nameOff) return null
    const count = data.getUint16(nameOff + 2)
    const base = nameOff + data.getUint16(nameOff + 4)
    for (const targetId of [16, 1, 4]) {
      for (let i = 0; i < count; i++) {
        const r = nameOff + 6 + i * 12
        if (data.getUint16(r + 6) !== targetId) continue
        if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
          const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
          return Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
        }
      }
    }
  } catch {}
  return null
}

function readVersionFromBuffer(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    let nameOff = 0
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
      if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
    }
    if (!nameOff) return null
    const count = data.getUint16(nameOff + 2)
    const base = nameOff + data.getUint16(nameOff + 4)
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12
      if (data.getUint16(r + 6) !== 5) continue
      if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
        const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
        const str = Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
        return str.replace(/^Version\s+/i, '').trim()
      }
    }
  } catch {}
  return null
}

function extractFontFromTTC(buffer, fontOffset) {
  const data = new DataView(buffer)
  const src = new Uint8Array(buffer)
  const numTables = data.getUint16(fontOffset + 4)
  const tables = Array.from({ length: numTables }, (_, i) => {
    const r = fontOffset + 12 + i * 16
    return {
      tag: String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3)),
      checksum: data.getUint32(r + 4),
      offset: data.getUint32(r + 8),
      length: data.getUint32(r + 12),
    }
  })
  const headerSize = 12 + numTables * 16
  let cursor = headerSize
  const newOffsets = tables.map(t => { const o = cursor; cursor = o + ((t.length + 3) & ~3); return o })
  const out = new Uint8Array(cursor)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, data.getUint32(fontOffset))       // sfVersion
  outView.setUint16(4, numTables)
  outView.setUint16(6, data.getUint16(fontOffset + 6))   // searchRange
  outView.setUint16(8, data.getUint16(fontOffset + 8))   // entrySelector
  outView.setUint16(10, data.getUint16(fontOffset + 10)) // rangeShift
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    t.tag.split('').forEach((c, j) => { out[r + j] = c.charCodeAt(0) })
    outView.setUint32(r + 4, t.checksum)
    outView.setUint32(r + 8, newOffsets[i])
    outView.setUint32(r + 12, t.length)
    out.set(src.subarray(t.offset, t.offset + t.length), newOffsets[i])
  })
  return out.buffer
}

// ── Slider row component ─────────────────────────────────────────────────────
// SliderRow now imported from wm-primitives as AxisSlider (see import above).

// ── Mode button ──────────────────────────────────────────────────────────────
function ModeBtn({ active, onClick, children }) {
  return (
    <button className={`mode-btn ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { clientSlug, fontSlug } = parseRoute()
  const clientLabel = clientSlug ? toDisplayName(clientSlug) : null
  const isCalcom = clientSlug?.toLowerCase() === 'calcom'
  const calcomFontPrimary = 'calsans'
  const calcomFontPrimaryLabel = 'CalSans'

  // Font loading
  const [fontName, setFontName] = useState(null)
  const [fontVersion, setFontVersion] = useState(null)
  const [fontFace, setFontFace] = useState(null)
  const [italicFontFace, setItalicFontFace] = useState(null)
  const [isItalic, setIsItalic] = useState(false)
  // Stylistic-set toggles. ss04 substitutes italic-only glyphs; ss05 roman-only.
  const [ss04, setSs04] = useState(false)
  const [ss05, setSs05] = useState(false)
  // Static-family weight picker (null → default weight for the family)
  const [activeStyleKey, setActiveStyleKey] = useState(null)
  const [variationAxes, setVariationAxes] = useState([]) // [{tag, name, min, max, defaultVal}]
  const [axisValues, setAxisValues] = useState({})
  const [namedInstances, setNamedInstances] = useState([]) // [{name, coordinates: {tag: value}}]
  const [supportedRanges, setSupportedRanges] = useState(null) // [[start,end],...] cmap codepoint ranges, or null = show all
  const [glyphMatchUnavailable, setGlyphMatchUnavailable] = useState(false) // true when a compressed (woff/woff2) upload blocks glyph matching
  const [isDragging, setIsDragging] = useState(false)
  const [ttcFonts, setTtcFonts] = useState([])
  const [ttcIndex, setTtcIndex] = useState(0)
  const fontObjectUrl = useRef(null)
  const ttcBufferRef = useRef(null)
  const ttcOffsetsRef = useRef([])
  const fontFamilyRef = useRef('')

  // View mode
  const [fit, setFit] = useState(FIT_DEFAULTS)   // paragraph line fitting (flattersatz.js)
  // Justify is an ALIGNMENT; Swiss Rag is a rag treatment that rides on any of the
  // other three. Only one fitting mode can be live, so it is derived, never stored.
  const [mode, setMode] = useState(() => resolveInitialMode(isCalcom)) // 'big' | 'paragraph' | 'glyphs' | 'scale' | 'calcom' | 'coss'

  // Cal.com preview state
  const [calcomFont, setCalcomFont] = useState(calcomFontPrimary)
  const [calcomRoles, setCalcomRoles] = useState(DEFAULT_CALCOM_ROLES)
  const [activeCalcomRole, setActiveCalcomRole] = useState(null)

  // Coss (booking events) preview state
  const [cossRoles, setCossRoles] = useState(DEFAULT_COSS_ROLES)
  const [activeCossRole, setActiveCossRole] = useState(null)

  // Text content
  const [bigText, setBigText] = useState(SAMPLE_BIG)
  const [blocks, setBlocks] = useState([])   // filled by the specimen load below
  // Which work is on screen and how much of it has been fetched. Null for the short
  // presets, which are just arrays. Edits to loaded blocks live in `blocks` and nowhere
  // else, so leaving the preset and coming back re-fetches clean text — a reader's
  // italics are real while they are there and gone when they return, on purpose.
  const [spec, setSpec] = useState(null)

  const withIds = (bs, offset = 0) => bs.map((b, i) => ({ ...b, id: String(Date.now() + offset + i) }))

  const PRESET_NAMES = Object.keys(TEXT_PRESETS)
  const nextPreset = () => PRESET_NAMES[(PRESET_NAMES.indexOf(activeTextPreset) + 1) % PRESET_NAMES.length]

  const selectPreset = (k) => {
    setActiveTextPreset(k)
    Object.values(blockRefs.current).forEach(el => { if (el) el.textContent = '' })
    // Back to the top: after a few "read more"s you are thousands of words down, and a
    // new work that starts where the last one left off reads as the same page.
    previewAreaRef.current?.scrollTo({ top: 0 })
    const slug = TEXT_PRESETS[k].specimen
    setSpec({ slug, loaded: 1 })
    setBlocks([])
    loadSpecimen(slug, 0).then(bs => setBlocks(withIds(bs)))
  }

  // The opening preset arrives the same way as every other one.
  useEffect(() => { selectPreset(activeTextPreset) }, [])

  const readMore = () => {
    if (!spec || spec.loaded >= specimenChunks(spec.slug)) return
    const next = spec.loaded
    setSpec(s => ({ ...s, loaded: s.loaded + 1 }))
    loadSpecimen(spec.slug, next).then(bs => setBlocks(prev => [...prev, ...withIds(bs, prev.length)]))
  }
  const [activeTextPreset, setActiveTextPreset] = useState('Sample')

  const [paraStyles, setParaStyles] = useState(DEFAULT_PARA_STYLES)

  // Paragraph styles panel
  const [paraStylesPanelOpen, setParaStylesPanelOpen] = useState(false)
  const [activeParaStyle, setActiveParaStyle] = useState(null)

  // Cal.com roles panel
  const [calcomPanelOpen, setCalcomPanelOpen] = useState(false)
  // Coss roles panel
  const [cossPanelOpen, setCossPanelOpen] = useState(false)

  // Mobile sidebar collapse
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)

  // Measure, in em — the same control ReCal carries, so the two proofs agree on what a
  // column IS. em rather than px is the whole point: characters-per-line then stays put
  // as size changes, which is what a measure means. The old px right-margin needed a
  // companion size cap to stay readable; a proportional column needs none.
  const [measure, setMeasure] = useState(34)

  // The measure range is the reason this app is interesting: a newspaper column runs
  // 35-45 characters, and that is where justification opens holes and hyphenation earns
  // its keep. 16em floors it below that; past ~52em everything looks fine and the
  // controls have nothing to say. Same bounds as ReCal.

  // Typography controls
  const [fontSize, setFontSize] = useState(200)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.1)

  // Alignment
  const [textAlign, setTextAlign] = useState('left')
  // Fitting is per BLOCK, from its style: alignment, the rag and hyphenation are the
  // style's own. Only the H&J bands come from `fit`, which is one set per typeface.
  // There is no document-wide fitting mode any more — paragraph mode is the only mode
  // that fits anything, and every block in it answers for itself.
  // Defaults FIRST: a renamed budget (or a session held open across a rename) would
  // otherwise leave the key undefined and take the whole app down on .toFixed.
  const fitOptsFor = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    return { ...FIT_DEFAULTS, ...fit, hyphenate: s.hyphenate,
             mode: fittingMode(s.align, s.swissRag), align: s.align, center: s.align === 'center' }
  }

  // Glyph set selection
  const [activeGlyphSet, setActiveGlyphSet] = useState('All')
  // Per-style GSUB stylistic-set tags + whether the italic has the PUA glyphs
  const [glyphFeatures, setGlyphFeatures] = useState({ roman: [], italic: [] })

  // Parsed PS family name for scale label default
  const [fontFamilyLabel, setFontFamilyLabel] = useState('')

  // Scale mode state
  const [scaleMaxXl, setScaleMaxXl] = useState(9)
  const [scalePairSizes, setScalePairSizes] = useState(new Set()) // active body pair sizes
  const [scaleLabelText, setScaleLabelText] = useState('')
  const [scalePairText, setScalePairText] = useState(SCALE_PAIR_TEXT)
  const [scaleAxisOverrides, setScaleAxisOverrides] = useState(() => ({ ...DEFAULT_SCALE_AXIS_OVERRIDES }))
  const [activeScaleStep, setActiveScaleStep] = useState(null)
  const [scaleStepRangeEnd, setScaleStepRangeEnd] = useState(null)
  const [extraScaleSteps, setExtraScaleSteps] = useState(new Set())
  const [scaleMultiSelectMode, setScaleMultiSelectMode] = useState(false)
  const [scaleStepsPanelOpen, setScaleStepsPanelOpen] = useState(false)

  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const previewAreaRef = useRef(null)
  const bigEditorRef = useRef(null)
  const blockRefs = useRef({})
  // Which paragraph block is being edited. Focused → contentEditable owns the raw
  // markup text; blurred → we render *italic* / **bold** as styled spans.
  const [focusedBlockId, setFocusedBlockId] = useState(null)
  const stylesPanelBtnRef = useRef(null)
  const mobileStylesBtnRef = useRef(null)
  const stylesPanelPopoverRef = useRef(null)
  const calcomPanelBtnRef = useRef(null)
  const calcomPanelPopoverRef = useRef(null)
  const cossPanelBtnRef = useRef(null)
  const cossPanelPopoverRef = useRef(null)
  const scaleRowRefs = useRef({})
  const scalePairRefs = useRef({})
  const scalePanelBtnRef = useRef(null)
  const scalePanelPopoverRef = useRef(null)

  const bigEditorCallback = useCallback(el => {
    bigEditorRef.current = el
    if (el && !el.textContent) el.textContent = SAMPLE_BIG
  }, [])

  // ── Sync URL hash with active mode ───────────────────────────────────────
  useEffect(() => {
    const hash = MODE_TO_HASH[mode]
    if (hash) window.history.replaceState(null, null, window.location.pathname + hash)
  }, [mode])

  // ── Sync scale label text with parsed PS family name ─────────────────────
  useEffect(() => {
    setScaleLabelText(fontFamilyLabel)
    Object.values(scaleRowRefs.current).forEach(el => { if (el) el.textContent = fontFamilyLabel })
  }, [fontFamilyLabel])

  // ── Auto-fit font size to preview width ────────────────────────────────────
  const autoFitSize = useCallback((fontFamily) => {
    if (window.innerWidth > 768) return
    const area = previewAreaRef.current
    if (!area) return
    const availWidth = area.clientWidth - 128
    if (!availWidth) return
    const span = document.createElement('span')
    span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:"${fontFamily}";font-size:100px`
    span.textContent = 'gloves'
    document.body.appendChild(span)
    const w = span.offsetWidth
    document.body.removeChild(span)
    if (!w) return
    setFontSize(Math.min(400, Math.max(20, Math.floor(100 * availWidth / w))))
  }, [])

  // Static-family weight list for the current route (empty for single/variable fonts)
  const familyStyles = useMemo(
    () => (fontSlug && !matchSpecial(fontSlug)) ? getFamilyStyles(fontSlug) : [],
    [fontSlug]
  )
  const isFamily = familyStyles.length >= 2
  const currentStyleKey = isFamily ? (activeStyleKey ?? defaultStyleKey(familyStyles)) : null

  // Per-block weight support: load every family weight under its own font-family
  // (roman + italic), so different paragraph blocks can show different weights.
  const [weightFamilies, setWeightFamilies] = useState({}) // { weightKey: cssFamilyName }
  useEffect(() => {
    if (!isFamily) { setWeightFamilies({}); return }
    let cancelled = false
    const nameBase = fontSlug.replace(/\s+/g, '')
    ;(async () => {
      const fams = {}
      for (const st of familyStyles) {
        const famName = `${nameBase}_${st.key}Preview`
        try {
          if (st.roman) { const f = new FontFace(famName, `url(${st.roman.url})`); await f.load(); document.fonts.add(f) }
          if (st.italic) { const f = new FontFace(famName, `url(${st.italic.url})`, { style: 'italic' }); await f.load(); document.fonts.add(f) }
          fams[st.key] = famName
        } catch { /* skip a weight that fails to load */ }
      }
      if (!cancelled) setWeightFamilies(fams)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSlug, isFamily])

  // ── Auto-load font from URL route ──────────────────────────────────────────
  useEffect(() => {
    if (!fontSlug) return

    const special = matchSpecial(fontSlug)
    let matched, italicMatch, resolvedSlug
    if (special?.file) {
      const entry = Object.entries(fontModules).find(([path]) => path.endsWith('/' + special.file))
      matched = entry ? { url: entry[1], filename: special.file } : null
      italicMatch = null
      resolvedSlug = fontSlug
    } else if (isFamily) {
      // Static family: pick the roman + italic files for the selected weight.
      const st = familyStyles.find(s => s.key === currentStyleKey) ?? familyStyles[0]
      matched = st.roman ?? st.italic
      italicMatch = st.italic
      resolvedSlug = fontSlug
    } else {
      resolvedSlug = special ? 'calsans' : fontSlug
      matched = matchFont(resolvedSlug)
      italicMatch = matchItalicFont(resolvedSlug)
    }
    if (!matched) return

    const loadRouteFont = async () => {
      // Families keep a constant family name across weights, so switching style
      // just re-points the same CSS font-family.
      const baseName = special ? special.name
        : isFamily ? fontSlug
        : matched.filename.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName.replace(/[^a-zA-Z0-9]/g, '')}Preview` // alphanumeric only: any space/dot/dash makes FontFace.family serialize quoted, which then double-quotes in CSS and gets dropped (e.g. "GeistSerifV0.2-Regular")

      // Load roman face
      const face = new FontFace(name, `url(${matched.url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(matched.filename.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)

      // Parse PS family name, version, and GSUB stylistic-set tags (roman)
      fetch(matched.url).then(r => r.arrayBuffer()).then(buf => {
        setFontFamilyLabel(readFamilyNameFromBuffer(buf) ?? special?.name ?? baseName)
        setFontVersion(readVersionFromBuffer(buf))
        setGlyphFeatures(prev => ({ ...prev, roman: gsubFeatureTags(buf) }))
      }).catch(() => { setFontFamilyLabel(special?.name ?? baseName); setFontVersion(null) })

      // Load italic companion (registers under same family with style:'italic')
      if (italicMatch) {
        const italicFace = new FontFace(name, `url(${italicMatch.url})`, { style: 'italic' })
        const loadedItalic = await italicFace.load()
        document.fonts.add(loadedItalic)
        setItalicFontFace(loadedItalic)
        // Detect the italic's stylistic sets for the glyph tabs
        fetch(italicMatch.url).then(r => r.arrayBuffer())
          .then(buf => setGlyphFeatures(prev => ({ ...prev, italic: gsubFeatureTags(buf) })))
          .catch(() => {})
      } else {
        setItalicFontFace(null)
        setIsItalic(false)
        setGlyphFeatures(prev => ({ ...prev, italic: [] }))
      }

      // Axes + instances from virtual module (covers TTF and woff2)
      const { axes, instances, chars } = fontAxesData[matched.filename] ?? { axes: [], instances: [] }
      setVariationAxes(axes)
      setNamedInstances(instances)
      setSupportedRanges(chars ?? null)
      setGlyphMatchUnavailable(false)
      const defaults = {}
      axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
    }
    loadRouteFont().catch(console.error)
  }, [fontSlug, currentStyleKey])


  // ── Font loading ───────────────────────────────────────────────────────────
  const loadFont = useCallback(async (file) => {
    try {
      if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)

      const buffer = await file.arrayBuffer()
      const isTTC = new DataView(buffer).getUint32(0) === 0x74746366

      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName.replace(/[^a-zA-Z0-9]/g, '')}Preview` // alphanumeric only: any space/dot/dash makes FontFace.family serialize quoted, which then double-quotes in CSS and gets dropped (e.g. "GeistSerifV0.2-Regular")
      fontFamilyRef.current = name

      if (isTTC) {
        const offsets = parseTTCOffsets(buffer)
        const fonts = offsets.map((off, i) => getFontNameInTTC(buffer, off) || `Font ${i + 1}`)
        ttcBufferRef.current = buffer
        ttcOffsetsRef.current = offsets
        setTtcFonts(fonts)
        setTtcIndex(0)
        const extracted = extractFontFromTTC(buffer, offsets[0])
        const url = URL.createObjectURL(new Blob([extracted], { type: 'font/ttf' }))
        fontObjectUrl.current = url
        const face = new FontFace(name, `url(${url})`)
        const loaded = await face.load()
        document.fonts.add(loaded)
        setFontFace(loaded)
        setFontName(file.name.replace(/\.[^/.]+$/, ''))
        setFontFamilyLabel(readFamilyNameFromBuffer(buffer, offsets[0]) ?? baseName)
        setFontVersion(readVersionFromBuffer(buffer, offsets[0]))
        autoFitSize(name)
        await detectAxes(new File([extracted], 'extracted.ttf'))
      } else {
        ttcBufferRef.current = null
        ttcOffsetsRef.current = []
        setTtcFonts([])
        setTtcIndex(0)
        const url = URL.createObjectURL(file)
        fontObjectUrl.current = url
        const face = new FontFace(name, `url(${url})`)
        const loaded = await face.load()
        document.fonts.add(loaded)
        setFontFace(loaded)
        setFontName(file.name.replace(/\.[^/.]+$/, ''))
        setFontFamilyLabel(readFamilyNameFromBuffer(buffer) ?? baseName)
        setFontVersion(readVersionFromBuffer(buffer))
        autoFitSize(name)
        await detectAxes(file)
      }
    } catch (err) {
      console.error('Font load error', err)
    }
  }, [autoFitSize])

  const selectTTCFont = useCallback(async (index) => {
    try {
      const buffer = ttcBufferRef.current
      const offsets = ttcOffsetsRef.current
      if (!buffer || !offsets[index]) return
      if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)
      const extracted = extractFontFromTTC(buffer, offsets[index])
      const url = URL.createObjectURL(new Blob([extracted], { type: 'font/ttf' }))
      fontObjectUrl.current = url
      const face = new FontFace(fontFamilyRef.current, `url(${url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setTtcIndex(index)
      const familyName = readFamilyNameFromBuffer(buffer, offsets[index])
      if (familyName) setFontFamilyLabel(familyName)
      setFontVersion(readVersionFromBuffer(buffer, offsets[index]))
      await detectAxes(new File([extracted], 'extracted.ttf'))
    } catch (err) {
      console.error('TTC font switch error', err)
    }
  }, [])

  const detectAxes = async (file) => {
    setSupportedRanges(null)
    setGlyphMatchUnavailable(false)
    // Try virtual module first (covers all font formats including woff2)
    const known = fontAxesData[file.name]
    if (known) {
      setVariationAxes(known.axes)
      setNamedInstances(known.instances)
      setSupportedRanges(known.chars ?? null)
      const defaults = {}
      known.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
      return
    }
    // Fallback: parse TTF/OTF inline (woff2 will return empty)
    try {
      const buffer = await file.arrayBuffer()
      const data = new DataView(buffer)
      const sig = data.getUint32(0)
      if (sig === 0x774F4646 || sig === 0x774F4632) { setVariationAxes([]); setNamedInstances([]); setAxisValues({}); setGlyphMatchUnavailable(true); return }
      setSupportedRanges(parseCmapRanges(buffer))
      const numTables = data.getUint16(4)
      let fvarOffset = 0, nameOffset = 0
      for (let i = 0; i < numTables; i++) {
        const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
        if (t === 'fvar') fvarOffset = data.getUint32(12+i*16+8)
        if (t === 'name') nameOffset = data.getUint32(12+i*16+8)
      }
      if (!fvarOffset) { setVariationAxes([]); setNamedInstances([]); setAxisValues({}); return }
      const getStr = (id) => {
        if (!nameOffset) return null
        const count = data.getUint16(nameOffset+2), base = nameOffset+data.getUint16(nameOffset+4)
        for (let i = 0; i < count; i++) {
          const r = nameOffset+6+i*12
          if (data.getUint16(r+6) !== id) continue
          if (data.getUint16(r) === 3 && data.getUint16(r+2) === 1) {
            const len = data.getUint16(r+8), off = data.getUint16(r+10)
            return Array.from({length:len/2}, (_,j) => String.fromCharCode(data.getUint16(base+off+j*2))).join('')
          }
        }
        return null
      }
      const tagLabels = { wght:'Weight', wdth:'Width', ital:'Italic', slnt:'Slant', opsz:'Optical Size', GRAD:'Grade' }
      const axOff=data.getUint16(fvarOffset+4), axCnt=data.getUint16(fvarOffset+8), axSz=data.getUint16(fvarOffset+10)
      const instCnt=data.getUint16(fvarOffset+12), instSz=data.getUint16(fvarOffset+14)
      const tags=[], axes=[]
      for (let i=0; i<axCnt; i++) {
        const o=fvarOffset+axOff+i*axSz, tag=String.fromCharCode(data.getUint8(o),data.getUint8(o+1),data.getUint8(o+2),data.getUint8(o+3))
        tags.push(tag)
        axes.push({ tag, name: getStr(data.getUint16(o+18)) || tagLabels[tag] || tag, min: data.getInt32(o+4)/65536, max: data.getInt32(o+12)/65536, defaultVal: data.getInt32(o+8)/65536 })
      }
      const instStart=fvarOffset+axOff+axCnt*axSz, instances=[]
      for (let i=0; i<instCnt; i++) {
        const o=instStart+i*instSz, name=getStr(data.getUint16(o))
        if (!name) continue
        const coords={}; tags.forEach((t,j) => { coords[t]=data.getInt32(o+4+j*4)/65536 })
        instances.push({ name, coordinates: coords })
      }
      setVariationAxes(axes); setNamedInstances(instances)
      const defaults={}; axes.forEach(a => { defaults[a.tag]=a.defaultVal }); setAxisValues(defaults)
    } catch { setVariationAxes([]); setNamedInstances([]); setAxisValues({}) }
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFont(file)
  }, [loadFont])

  const handleDragEnter = useCallback((e) => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true) }, [])
  const handleDragOver  = useCallback((e) => { e.preventDefault() }, [])
  const handleDragLeave = useCallback(() => { if (--dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragging(false) } }, [])

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover',  handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover',  handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop])
  // ── Font variation string ─────────────────────────────────────────────────
  const fontVariationSettings = Object.entries(axisValues)
    .filter(([, val]) => val !== 'auto')
    .map(([tag, val]) => `"${tag}" ${val}`)
    .join(', ') || 'normal'

  const fontStyle = isItalic && italicFontFace ? 'italic' : 'normal'

  // Shared feature string for the proofing text. ss04 only fires in italic, ss05
  // only in roman — matching each stylistic set's glyph coverage.
  const proofFeatureSettings = featureStr(isItalic, ss04, ss05)

  // Glyph sets for the Glyphs view — the static cmap-derived groups.
  const glyphSets = GLYPH_SETS
  const activeGlyphKey = glyphSets[activeGlyphSet] ? activeGlyphSet : 'All'

  // Live design metrics for the Glyphs picker specimen — measured off the rendered
  // instance (any uploaded font, any axis position; re-measured as axes move).
  const [glyphMetrics, setGlyphMetrics] = useState(null)
  useEffect(() => {
    if (mode !== 'glyphs' || !fontFace) return
    const m = () => { const r = measureGlyphMetrics(previewStyle.fontFamily, fontVariationSettings); if (r) setGlyphMetrics(r) }
    m()
    document.fonts?.ready.then(m).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fontFace, currentStyleKey, fontVariationSettings])

  const previewStyle = {
    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
    fontStyle,
    fontSize: `${fontSize}px`,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: lineHeight,
    fontVariationSettings,
    fontOpticalSizing: axisValues['opsz'] === 'auto' ? 'auto' : 'none',
    fontSynthesis: 'none',
    fontFeatureSettings: proofFeatureSettings,
    textAlign,
    color: 'var(--text)',
    wordBreak: 'break-word',
    transition: 'font-variation-settings 0.15s ease',
  }

  // ── Active style for sidebar controls in paragraph/scale mode ────────────
  const effectiveParaStyle = mode === 'paragraph'
    ? (activeParaStyle ?? 'p')
    : mode === 'scale'
    ? activeParaStyle   // null unless user picks one from the dropdown
    : null

  // Weight / Roman-Italic / ss04 / ss05 scope to the selected block (P by default
  // in paragraph mode); with no block selected they edit the global control.
  const styleScope = effectiveParaStyle
  const scopedWeight = styleScope ? (paraStyles[styleScope].weight ?? currentStyleKey) : currentStyleKey
  const scopedItalic = styleScope ? (paraStyles[styleScope].italic ?? isItalic) : isItalic
  const scopedSs04 = styleScope ? (paraStyles[styleScope].ss04 ?? ss04) : ss04
  const scopedSs05 = styleScope ? (paraStyles[styleScope].ss05 ?? ss05) : ss05
  const setScopedField = (field, value) =>
    setParaStyles(prev => ({ ...prev, [styleScope]: { ...prev[styleScope], [field]: value } }))
  const setScopedWeight = (v) => styleScope ? setScopedField('weight', v) : setActiveStyleKey(v)
  const setScopedItalic = (v) => styleScope ? setScopedField('italic', v) : setIsItalic(v)
  const toggleScopedSs04 = () => styleScope ? setScopedField('ss04', !scopedSs04) : setSs04(v => !v)
  const toggleScopedSs05 = () => styleScope ? setScopedField('ss05', !scopedSs05) : setSs05(v => !v)

  // ── Active role for calcom mode ───────────────────────────────────────────
  const effectiveCalcomRole = mode === 'calcom' ? activeCalcomRole : null
  const effectiveCossRole = mode === 'coss' ? activeCossRole : null
  const effectiveScaleStep = mode === 'scale' ? activeScaleStep : null
  const selectedScaleSteps = useMemo(() => {
    if (!effectiveScaleStep) return []
    const keys = TAILWIND_SCALE.map(s => s.key)
    const rangeKeys = (() => {
      if (!scaleStepRangeEnd) return [effectiveScaleStep]
      const a = keys.indexOf(effectiveScaleStep), b = keys.indexOf(scaleStepRangeEnd)
      return keys.slice(...(a < b ? [a, b + 1] : [b, a + 1]))
    })()
    const all = new Set([...rangeKeys, ...extraScaleSteps])
    return keys.filter(k => all.has(k))
  }, [effectiveScaleStep, scaleStepRangeEnd, extraScaleSteps])

  const roleStyle = (role) => {
    const r = calcomRoles[role] ?? calcomRoles.eventDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const opszAuto = merged['opsz'] === 'auto'
    if (role === 'eventTitle' && calcomFont !== 'calsans') {
      return {
        fontFamily: "'CalSansBold', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.interTracking ?? r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontOpticalSizing: 'none',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsans'
      ? (fontFace ? `"${fontFace.family}"` : '"Inter", system-ui, sans-serif')
      : calcomFont === 'calsans'
        ? '"CalSans"'
        : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
      fontOpticalSizing: (calcomFont === 'calsans') && opszAuto ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "liga" 0, "ss20" 0',
    }
  }

  const cossRoleStyle = (role) => {
    const r = cossRoles[role] ?? cossRoles.cardDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const opszAuto = merged['opsz'] === 'auto'
    if (role === 'pageTitle' && calcomFont !== 'calsans') {
      return {
        fontFamily: "'CalSansBold', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontOpticalSizing: 'none',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsans'
      ? (fontFace ? `"${fontFace.family}"` : '"Inter", system-ui, sans-serif')
      : calcomFont === 'calsans'
        ? '"CalSans"'
        : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
      fontOpticalSizing: (calcomFont === 'calsans') && opszAuto ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "liga" 0, "ss20" 0',
    }
  }

  // No comfortable-max any more. It existed to stop a FIXED px column from being filled
  // by oversized type; with the column set in em it scales with the size, so the
  // characters-per-line the cap was protecting is now held by construction.

  // The scale's body column is the same measure, so its clamp follows the same number.
  const scaleBaseClampPx = useMemo(() => measure / 2.4, [measure])

  // ── Per-block style (paragraph mode) ─────────────────────────────────────
  const blockStyle = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    const merged = { ...axisValues, ...s.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    // Per-block weight/italic/ss resolve to the block's override, or the global control.
    const weight = s.weight ?? currentStyleKey
    const italic = s.italic ?? isItalic
    const s04 = s.ss04 ?? ss04
    const s05 = s.ss05 ?? ss05
    const family = (weight && weightFamilies[weight]) ? `"${weightFamilies[weight]}"` : (fontFace ? `"${fontFace.family}"` : 'serif')
    return {
      fontFamily: family,
      fontStyle: (italic && (isFamily || italicFontFace)) ? 'italic' : 'normal',
      fontSize: `${s.size}px`,
      letterSpacing: `${s.tracking}em`,
      lineHeight: s.leading,
      fontVariationSettings: fvs,
      fontOpticalSizing: merged['opsz'] === 'auto' ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: featureStr(italic, s04, s05),
      textAlign: s.align,
      color: 'var(--text)',
      wordBreak: 'break-word',
      display: 'block',
      width: '100%',
      minHeight: '1em',
      outline: 'none',
      cursor: 'text',
      transition: 'font-variation-settings 0.15s ease',
    }
  }

  // Style for an inline *italic* / **bold** span. Resolves through the same
  // face/axis logic as blockStyle, so each deployment's font renders its own
  // italic (variable axis OR separate face) and bold (weight family OR wght).
  // Only font-varying props are set; size/leading/tracking inherit from the block.
  const inlineStyle = (type, kind) => {
    const s = paraStyles[type] ?? paraStyles.p
    const s04 = s.ss04 ?? ss04
    const s05 = s.ss05 ?? ss05
    const italic = kind === 'italic' ? true : (s.italic ?? isItalic)
    let weight = s.weight ?? currentStyleKey
    const merged = { ...axisValues, ...s.axisOverrides }
    if (kind === 'italic') {
      // Variable italic: drive the font's own axis (Cal Sans 'ital', or a 'slnt'
      // slant). Fonts whose italic is a separate face fall through to fontStyle below.
      const italAx = variationAxes.find(a => a.tag === 'ital')
      const slntAx = variationAxes.find(a => a.tag === 'slnt')
      if (italAx) merged.ital = italAx.max
      else if (slntAx) merged.slnt = slntAx.min
    }
    if (kind === 'bold') {
      const boldKey = Object.keys(weightFamilies).find(k => /bold|black|heavy|semibold|700|800|900/i.test(k))
      if (boldKey) weight = boldKey
      else {
        const wghtAx = variationAxes.find(a => a.tag === 'wght')
        if (wghtAx) merged.wght = Math.min(wghtAx.max, 700)
      }
    }
    const family = (weight && weightFamilies[weight]) ? `"${weightFamilies[weight]}"` : (fontFace ? `"${fontFace.family}"` : 'serif')
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: family,
      fontStyle: (italic && (isFamily || italicFontFace)) ? 'italic' : 'normal',
      fontVariationSettings: fvs,
      fontFeatureSettings: featureStr(italic, s04, s05),
      fontSynthesis: 'none',
    }
  }

  // ── Scale mode helpers ────────────────────────────────────────────────────
  const scaleStepStyle = (step, effectivePxSize) => {
    const overrides = scaleAxisOverrides[step.key] ?? { opsz: 'auto' }
    const merged = { opsz: 'auto', ...axisValues, ...overrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
      fontStyle,
      fontSize: `${effectivePxSize ?? step.pxSize}px`,
      lineHeight: step.lh,
      letterSpacing: 0,
      fontVariationSettings: fvs,
      fontOpticalSizing: merged.opsz === 'auto' ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: proofFeatureSettings,
      color: 'var(--text)',
      transition: 'font-variation-settings 0.15s ease',
    }
  }

  const visibleScaleSteps = [
    ...TAILWIND_XL.slice(0, scaleMaxXl).reverse(),
    ...[...TAILWIND_BASE].reverse(),
  ]

  // Descending (lg → xs), matching the button order in the sidebar
  const scalePairSteps = [...TAILWIND_SCALE].filter(s => scalePairSizes.has(s.key)).reverse()

  const handleScaleLabelInput = useCallback((key, e) => {
    const text = e.currentTarget.textContent
    setScaleLabelText(text)
    Object.entries(scaleRowRefs.current).forEach(([k, el]) => {
      if (k !== key && el) el.textContent = text
    })
  }, [])

  const handleScalePairInput = useCallback((key, e) => {
    const text = e.currentTarget.textContent
    setScalePairText(text)
    Object.entries(scalePairRefs.current).forEach(([k, el]) => {
      if (k !== key && el) el.textContent = text
    })
  }, [])

  const handleBlockInput = useCallback((id, e) => {
    const text = e.currentTarget.textContent
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, text } : b))
  }, [])

  const handleBlockKeyDown = useCallback((id, e) => {
    if (e.key === ' ') {
      const el = blockRefs.current[id]
      const text = el?.textContent ?? ''
      const mdType = text === '#' ? 'h1' : text === '##' ? 'h2' : text === '###' ? 'h3' : null
      if (mdType) {
        e.preventDefault()
        el.textContent = ''
        setBlocks(prev => prev.map(b => b.id === id ? { ...b, type: mdType, text: '' } : b))
        requestAnimationFrame(() => { el.focus(); placeCursorAtStart(el) })
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const newId = String(Date.now())
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === id)
        const next = [...prev]
        next.splice(idx + 1, 0, { id: newId, type: 'p', text: '' })
        return next
      })
      requestAnimationFrame(() => {
        const el = blockRefs.current[newId]
        if (el) { el.focus(); placeCursorAtStart(el) }
      })
    }
    if (e.key === 'Backspace') {
      const el = blockRefs.current[id]
      if (el && !el.textContent) {
        e.preventDefault()
        setBlocks(prev => {
          if (prev.length <= 1) return prev
          const idx = prev.findIndex(b => b.id === id)
          const next = prev.filter(b => b.id !== id)
          const targetId = next[Math.max(0, idx - 1)]?.id
          requestAnimationFrame(() => {
            const targetEl = blockRefs.current[targetId]
            if (targetEl) { targetEl.focus(); placeCursorAtEnd(targetEl) }
          })
          return next
        })
      }
    }
  }, [])

  // Caret capture/restore on focus now lives inside the shared EditableTextBlock.

  // ── Close styles popover on outside click ──────────────────────────────────
  useEffect(() => {
    if (!paraStylesPanelOpen) return
    const handler = (e) => {
      if (
        stylesPanelBtnRef.current?.contains(e.target) ||
        mobileStylesBtnRef.current?.contains(e.target) ||
        stylesPanelPopoverRef.current?.contains(e.target)
      ) return
      setParaStylesPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [paraStylesPanelOpen])

  useEffect(() => {
    if (!calcomPanelOpen) return
    const handler = (e) => {
      if (
        calcomPanelBtnRef.current?.contains(e.target) ||
        calcomPanelPopoverRef.current?.contains(e.target)
      ) return
      setCalcomPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [calcomPanelOpen])

  useEffect(() => {
    if (!cossPanelOpen) return
    const handler = (e) => {
      if (
        cossPanelBtnRef.current?.contains(e.target) ||
        cossPanelPopoverRef.current?.contains(e.target)
      ) return
      setCossPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [cossPanelOpen])

  useEffect(() => {
    if (!scaleStepsPanelOpen) return
    const handler = (e) => {
      if (
        scalePanelBtnRef.current?.contains(e.target) ||
        scalePanelPopoverRef.current?.contains(e.target)
      ) return
      setScaleStepsPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scaleStepsPanelOpen])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`layout ${isDragging ? 'dragging' : ''}`}
    >
      <ThemeToggle />
      {/* Drop overlay */}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <span className="drop-icon">↓</span>
            <span>Drop font file</span>
          </div>
        </div>
      )}

      {/* Mobile tab bar */}
      <nav className="mobile-tabs">
        {isCalcom && <button className={`mobile-tab ${mode === 'calcom' ? 'active' : ''}`} onClick={() => setMode('calcom')}><CalIcon /> cal.com/peer</button>}
        {isCalcom && <button className={`mobile-tab ${mode === 'coss' ? 'active' : ''}`} onClick={() => setMode('coss')}><CalIcon /> booking events</button>}
        <button className={`mobile-tab ${mode === 'big' ? 'active' : ''}`} onClick={() => setMode('big')}><BigIcon className={mode === 'big' ? 'aa-animated' : undefined} /> Big Word</button>
        <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><ParaIcon /> Paragraph</button>
        <button className={`mobile-tab ${mode === 'ui' ? 'active' : ''}`} onClick={() => setMode('ui')}><CalIcon /> UI</button>
        <button className={`mobile-tab ${mode === 'scale' ? 'active' : ''}`} onClick={() => setMode('scale')}><ScaleIcon /> Type Scale</button>
        <button className={`mobile-tab ${mode === 'glyphs' ? 'active' : ''}`} onClick={() => setMode('glyphs')}><GlyphIcon /> Glyphs</button>
      </nav>

      {/* Mobile sub-bar: context-sensitive chips */}
      {fontName && (mode === 'glyphs' || mode === 'paragraph' || mode === 'scale') && (
        <div className="mobile-sub-bar">
          {mode === 'glyphs' && Object.keys(glyphSets).map(k => (
            <button
              key={k}
              className={`mobile-sub-btn ${activeGlyphKey === k ? 'active' : ''}`}
              onClick={() => setActiveGlyphSet(k)}
            >
              {k}
            </button>
          ))}
          {mode === 'paragraph' && (['h1', 'h2', 'h3', 'p']).map(type => (
            <button
              key={type}
              className={`mobile-sub-btn ${activeParaStyle === type ? 'active' : ''}`}
              onClick={() => setActiveParaStyle(prev => prev === type ? null : type)}
            >
              {type === 'p' ? 'P' : type.toUpperCase()}
            </button>
          ))}
          {mode === 'paragraph' && <span className="mobile-sub-divider" />}
          {mode === 'paragraph' && Object.keys(TEXT_PRESETS).map(k => (
            <button
              key={k}
              className={`mobile-sub-btn ${activeTextPreset === k ? 'active' : ''}`}
              onClick={() => selectPreset(k)}
            >
              {k}
            </button>
          ))}
          {mode === 'scale' && (
            <button
              className={`mobile-multi-btn ${scaleMultiSelectMode ? 'active' : ''}`}
              onClick={() => setScaleMultiSelectMode(p => !p)}
              title="Select multiple steps"
            ><MultiSelectIcon /></button>
          )}
          {mode === 'scale' && visibleScaleSteps.map(step => {
            const isSelected = selectedScaleSteps.includes(step.key) || activeScaleStep === step.key
            return (
              <button
                key={step.key}
                className={`mobile-sub-btn ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  if (scaleMultiSelectMode) {
                    if (!activeScaleStep) {
                      setActiveScaleStep(step.key)
                    } else if (step.key === activeScaleStep) {
                      const next = new Set(extraScaleSteps)
                      if (next.size > 0) {
                        const first = [...next][0]
                        setActiveScaleStep(first)
                        next.delete(first)
                        setExtraScaleSteps(next)
                      } else {
                        setActiveScaleStep(null)
                      }
                      setScaleStepRangeEnd(null)
                    } else {
                      setExtraScaleSteps(prev => {
                        const next = new Set(prev)
                        next.has(step.key) ? next.delete(step.key) : next.add(step.key)
                        return next
                      })
                    }
                  } else {
                    setActiveScaleStep(prev => prev === step.key ? null : step.key)
                    setScaleStepRangeEnd(null)
                    setExtraScaleSteps(new Set())
                    setActiveParaStyle(null)
                  }
                }}
              >
                {scaleMultiSelectMode && <span className={`mobile-sub-radio ${isSelected ? 'selected' : ''}`} />}
                {step.key}
              </button>
            )
          })}
          {mode === 'scale' && scalePairSizes.size > 0 && <span className="mobile-sub-divider" />}
          {mode === 'scale' && ['lg', 'base', 'sm', 'xs'].map(opt => {
            const key = `text-${opt}`
            return (
              <button
                key={opt}
                className={`mobile-sub-btn ${scalePairSizes.has(key) ? 'active' : ''}`}
                onClick={() => setScalePairSizes(prev => {
                  const next = new Set(prev)
                  next.has(key) ? next.delete(key) : next.add(key)
                  return next
                })}
              >
                {key}
              </button>
            )
          })}
        </div>
      )}

      {/* Sidebar */}
      <button
        className="sidebar-bumpout"
        style={{ left: desktopSidebarOpen ? 'var(--sidebar-width)' : '0' }}
        onClick={() => setDesktopSidebarOpen(p => !p)}
        title={desktopSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {desktopSidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>
      {!mobileSidebarOpen && (
        <button className="mobile-sidebar-lift-tab" onClick={() => setMobileSidebarOpen(true)}>
          <ChevronUpIcon />
        </button>
      )}
      <aside className={`sidebar${mobileSidebarOpen ? '' : ' mobile-collapsed'}${desktopSidebarOpen ? '' : ' desktop-collapsed'}`}>
        <button className="mobile-sidebar-handle" onClick={() => setMobileSidebarOpen(false)}>
          <ChevronDownIcon />
        </button>
        {/* Logo */}
        <div className="sidebar-logo">
          {SHOW_CLIENT_LOGO && clientSlug && clientSlug !== 'wordmark' ? (
            <ClientLogo slug={clientSlug} clientLabel={clientLabel} />
          ) : (
            <>
              <img src={logoGif} alt="Logo" className="logo-gif logo-gif--dark" />
              <img src={logoGifDark} alt="Logo" className="logo-gif logo-gif--light" />
              {clientLabel && clientSlug !== 'wordmark' && <span className="client-label">{clientLabel}</span>}
            </>
          )}
        </div>

        {/* Font upload — hidden when font is pre-selected via URL */}
        {!fontSlug && (
          <div className="sidebar-section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,.ttc"
              style={{ display: 'none' }}
              onChange={e => e.target.files[0] && loadFont(e.target.files[0])}
            />
            <button
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {fontName ? (
                <>
                  <span className="upload-icon">↺</span>
                  <span className="upload-name">{fontName}</span>
                </>
              ) : (
                <>
                  <span className="upload-icon">+</span>
                  <span>Open Font</span>
                </>
              )}
            </button>
            {!fontName && (
              <p className="upload-hint">or drag & drop a font file</p>
            )}
          </div>
        )}

        <div className="sidebar-divider sidebar-divider-before-mode" />

        {/* Mode switcher */}
        <div className="sidebar-section sidebar-mode-section">
          <div className="section-label">Preview Mode</div>
          <div className="mode-group">
            {isCalcom && (
              <div className="mode-btn-row">
                <ModeBtn active={mode === 'calcom'} onClick={() => setMode('calcom')}>
                  <CalIcon /> cal.com/peer
                </ModeBtn>
                {fontName && mode === 'calcom' && (
                  <button
                    ref={calcomPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${calcomPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCalcomPanelOpen(p => !p)}
                  >
                    <SlidersIcon />
                  </button>
                )}
              </div>
            )}
            {isCalcom && (
              <div className="mode-btn-row">
                <ModeBtn active={mode === 'coss'} onClick={() => setMode('coss')}>
                  <CalIcon /> booking events
                </ModeBtn>
                {fontName && mode === 'coss' && (
                  <button
                    ref={cossPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${cossPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCossPanelOpen(p => !p)}
                  >
                    <SlidersIcon />
                  </button>
                )}
              </div>
            )}
            <ModeBtn active={mode === 'big'} onClick={() => setMode('big')}>
              <BigIcon className={mode === 'big' ? 'aa-animated' : undefined} /> Big Word
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'paragraph'} onClick={() => setMode('paragraph')}>
                <ParaIcon /> Paragraph
              </ModeBtn>
              {fontName && mode === 'paragraph' && (
                <button
                  ref={stylesPanelBtnRef}
                  className={`align-btn styles-toggle-btn ${paraStylesPanelOpen ? 'active' : ''}`}
                  title="Styles panel"
                  onClick={() => setParaStylesPanelOpen(p => !p)}
                >
                  <SlidersIcon />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'ui'} onClick={() => setMode('ui')}>
              <CalIcon /> UI
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'scale'} onClick={() => setMode('scale')}>
                <ScaleIcon /> Type Scale
              </ModeBtn>
              {fontName && mode === 'scale' && (
                <button
                  ref={scalePanelBtnRef}
                  className={`align-btn styles-toggle-btn ${scaleStepsPanelOpen ? 'active' : ''}`}
                  title="Scale steps panel"
                  onClick={() => setScaleStepsPanelOpen(p => !p)}
                >
                  <SlidersIcon />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        {/* Scale mode controls */}
        {mode === 'scale' && fontName && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Type Scale</div>
              <div className="slider-label">
                <span className="slider-label-left">
                  <span className="slider-label-text">Max xl tier</span>
                </span>
                <input
                  className="slider-number"
                  type="number"
                  min={1}
                  max={9}
                  step={1}
                  value={scaleMaxXl}
                  onChange={e => setScaleMaxXl(Math.min(9, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                />
              </div>
              <div className="section-label" style={{ marginTop: 4 }}>Body Pairing</div>
              <div className="scale-pair-seg">
                {['lg', 'base', 'sm', 'xs'].map(opt => {
                  const key = `text-${opt}`
                  const active = scalePairSizes.has(key)
                  return (
                    <button
                      key={opt}
                      className={`scale-pair-btn ${active ? 'active' : ''}`}
                      onClick={() => setScalePairSizes(prev => {
                        const next = new Set(prev)
                        next.has(key) ? next.delete(key) : next.add(key)
                        return next
                      })}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div className="sidebar-divider" />

        {/* Cal.com font radio */}
        {mode === 'calcom' && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Font</div>
              <label className="calcom-radio-label">
                <input type="radio" name="calcom-font" value={calcomFontPrimary} checked={calcomFont === calcomFontPrimary} onChange={() => setCalcomFont(calcomFontPrimary)} />
                {calcomFontPrimaryLabel}
              </label>
              <label className="calcom-radio-label">
                <input type="radio" name="calcom-font" value="inter" checked={calcomFont === 'inter'} onChange={() => setCalcomFont('inter')} />
                Inter 4.1
              </label>
            </div>
          </>
        )}

        {/* Typography controls */}
        {mode !== 'calcom' && (
        <div className="sidebar-section">
          <div className="typography-header">
            <div className="section-label">
              Typography
              {effectiveParaStyle && activeParaStyle && (
                <span className="section-label-sub">
                  {activeParaStyle === 'p' ? 'P' : activeParaStyle.toUpperCase()}
                </span>
              )}
            </div>
            {mode !== 'scale' && (
            <div className="align-group">
              {(() => {
                const isDirty = effectiveParaStyle
                  ? paraStyles[effectiveParaStyle].size !== DEFAULT_PARA_STYLES[effectiveParaStyle].size ||
                    paraStyles[effectiveParaStyle].tracking !== DEFAULT_PARA_STYLES[effectiveParaStyle].tracking ||
                    paraStyles[effectiveParaStyle].leading !== DEFAULT_PARA_STYLES[effectiveParaStyle].leading ||
                    paraStyles[effectiveParaStyle].align !== DEFAULT_PARA_STYLES[effectiveParaStyle].align ||
                    paraStyles[effectiveParaStyle].swissRag || paraStyles[effectiveParaStyle].hyphenate
                  : fontSize !== 200 || letterSpacing !== 0 || lineHeight !== 1.1 || textAlign !== 'left'
                // Fitting counts as typography: a rag or a spent budget is a change to
                // the setting, so it lights the reset and clears with it. The rag and the
                // alignment are the STYLE's now and are counted above; the bands here are
                // the font's, and clearing them is a document-wide act either way.
                const fitDirty =
                  Object.keys(FIT_DEFAULTS).some(k => JSON.stringify(fit[k]) !== JSON.stringify(FIT_DEFAULTS[k]))
                return (
                  <button
                    className={`align-btn ${isDirty || fitDirty ? 'active' : 'reset-clean'}`}
                    title="Reset typography"
                    style={isDirty || fitDirty ? {} : { pointerEvents: 'none' }}
                    onClick={() => {
                      if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], ...DEFAULT_PARA_STYLES[effectiveParaStyle] }
                        }))
                      } else {
                        setFontSize(200)
                        setLetterSpacing(0)
                        setLineHeight(1.1)
                        setTextAlign('left')
                      }
                      setFit(FIT_DEFAULTS)
                    }}
                  ><ResetIcon /></button>
                )
              })()}
              {/* In paragraph mode alignment belongs to the SELECTED style, the same as
                  its size does; everywhere else there is one block of text and one
                  alignment. */}
              <AlignmentButtons
                value={effectiveParaStyle ? paraStyles[effectiveParaStyle].align : textAlign}
                onChange={a => effectiveParaStyle ? setScopedField('align', a) : setTextAlign(a)} />
            </div>
            )}
          </div>
          {isFamily && (
            <select
              className="instance-select"
              value={scopedWeight ?? ''}
              onChange={e => setScopedWeight(e.target.value)}
              title="Style"
            >
              {familyStyles.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          )}
          {(italicFontFace || variationAxes.some(a => a.tag === 'ital')) && (() => {
            const italAxis = variationAxes.find(a => a.tag === 'ital')
            return (
              <div className="roman-italic-toggle">
                <button
                  className={`roman-italic-btn${!scopedItalic ? ' active' : ''}`}
                  onClick={() => {
                    setScopedItalic(false)
                    if (italAxis) setAxisValues(prev => ({ ...prev, ital: italAxis.min ?? 0 }))
                  }}
                >Roman</button>
                <button
                  className={`roman-italic-btn${scopedItalic ? ' active' : ''}`}
                  onClick={() => {
                    setScopedItalic(true)
                    if (italAxis) setAxisValues(prev => ({ ...prev, ital: italAxis.max ?? 1 }))
                  }}
                >Italic</button>
              </div>
            )
          })()}
          {fontFace && (/sb\s*romie/i.test(fontFamilyLabel) || /romie/i.test(fontName || '')) && (glyphFeatures.italic?.includes('ss04') || glyphFeatures.roman?.includes('ss05')) && (
            <div className="feature-toggles">
              {glyphFeatures.italic?.includes('ss04') && (
                <button
                  className={`roman-italic-btn${scopedSs04 ? ' active' : ''}`}
                  disabled={!scopedItalic}
                  title={scopedItalic ? 'Stylistic Set 4 (italic)' : 'ss04 applies to italic only'}
                  onClick={toggleScopedSs04}
                >ss04</button>
              )}
              {glyphFeatures.roman?.includes('ss05') && (
                <button
                  className={`roman-italic-btn${scopedSs05 ? ' active' : ''}`}
                  disabled={scopedItalic}
                  title={!scopedItalic ? 'Stylistic Set 5 (roman)' : 'ss05 applies to roman only'}
                  onClick={toggleScopedSs05}
                >ss05</button>
              )}
            </div>
          )}
          {ttcFonts.length > 1 && (
            <select
              className="instance-select"
              value={ttcIndex}
              onChange={e => selectTTCFont(Number(e.target.value))}
            >
              {ttcFonts.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          )}
          {namedInstances.length > 0 && (() => {
            const currentCoords = effectiveScaleStep
              ? { ...axisValues, ...scaleAxisOverrides[effectiveScaleStep] }
              : effectiveParaStyle
              ? { ...axisValues, ...paraStyles[effectiveParaStyle].axisOverrides }
              : axisValues
            const activeInst = namedInstances.find(inst =>
              variationAxes.every(a => (currentCoords[a.tag] ?? a.defaultVal) === inst.coordinates[a.tag])
            )
            const applyInstance = (name) => {
              const inst = namedInstances.find(i => i.name === name)
              if (!inst) return
              if (effectiveScaleStep) {
                setScaleAxisOverrides(prev => {
                  const next = { ...prev }
                  selectedScaleSteps.forEach(k => { next[k] = { ...inst.coordinates } })
                  return next
                })
              } else if (effectiveParaStyle) {
                setParaStyles(prev => ({
                  ...prev,
                  [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...inst.coordinates } }
                }))
              } else {
                setAxisValues({ ...inst.coordinates })
              }
            }
            return (
              <select
                className="instance-select"
                value={activeInst?.name ?? ''}
                onChange={e => applyInstance(e.target.value)}
              >
                {!activeInst && <option value="" disabled>—</option>}
                {namedInstances.map(inst => (
                  <option key={inst.name} value={inst.name}>{inst.name}</option>
                ))}
              </select>
            )
          })()}
          {/* Size/Tracking/Leading are per-step in Type Scale, so hide them there */}
          {(mode === 'paragraph' || mode === 'scale') && (
            <SliderRow
              label="Measure"
              value={measure}
              min={16}
              max={52}
              step={1}
              suffix="em"
              onChange={setMeasure}
            />
          )}
          {mode !== 'scale' && (<>
          {effectiveParaStyle ? (
            <SliderRow
              label="Size"
              value={paraStyles[effectiveParaStyle].size}
              min={8}
              max={400}
              step={1}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], size: v } }))}
            />
          ) : (
            <SliderRow
              label="Size"
              value={fontSize}
              min={8}
              max={400}
              step={1}
              onChange={setFontSize}
            />
          )}
          {effectiveParaStyle ? (
            <SliderRow
              label="Tracking"
              value={paraStyles[effectiveParaStyle].tracking}
              min={-0.2}
              max={0.5}
              step={0.001}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], tracking: v } }))}
              display={paraStyles[effectiveParaStyle].tracking.toFixed(3)}
            />
          ) : (
            <SliderRow
              label="Tracking"
              value={letterSpacing}
              min={-0.2}
              max={0.5}
              step={0.001}
              onChange={setLetterSpacing}
              display={letterSpacing.toFixed(3)}
            />
          )}
          {mode === 'paragraph' && (
            <>
              <FittingControls
                value={fit}
                onChange={setFit}
                mode={fittingMode(paraStyles[effectiveParaStyle].align, paraStyles[effectiveParaStyle].swissRag)}
                swissRag={paraStyles[effectiveParaStyle].swissRag}
                onSwissRag={on => setScopedField('swissRag', on)}
                hyphenate={paraStyles[effectiveParaStyle].hyphenate}
                onHyphenate={on => setScopedField('hyphenate', on)}
                widthAxis={variationAxes.some(a => a.tag === 'wdth')}
              />
            </>
          )}
          {effectiveParaStyle ? (
            <SliderRow
              label="Leading"
              value={paraStyles[effectiveParaStyle].leading}
              min={0.6}
              max={3}
              step={0.01}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], leading: v } }))}
              display={paraStyles[effectiveParaStyle].leading.toFixed(2)}
            />
          ) : (
            <SliderRow
              label="Leading"
              value={lineHeight}
              min={0.6}
              max={3}
              step={0.01}
              onChange={setLineHeight}
              display={lineHeight.toFixed(2)}
            />
          )}
          </>)}
        </div>
        )}

        {/* Variable font axes */}
        {variationAxes.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="typography-header">
                <div className="section-label">
                  Variable Axes
                  {effectiveScaleStep && (
                    <button className="section-label-exit" onClick={() => { setActiveScaleStep(null); setScaleStepRangeEnd(null); setExtraScaleSteps(new Set()) }}>
                      {selectedScaleSteps.length > 1 ? `${selectedScaleSteps.length} steps` : effectiveScaleStep} ×
                    </button>
                  )}
                  {mode === 'scale' && effectiveParaStyle && (
                    <button className="section-label-exit" onClick={() => setActiveParaStyle(null)}>
                      {effectiveParaStyle === 'p' ? 'Para' : effectiveParaStyle.toUpperCase()} ×
                    </button>
                  )}
                  {effectiveCalcomRole && (
                    <button className="section-label-exit" onClick={() => setActiveCalcomRole(null)} title="Back to master">
                      {CALCOM_ROLE_LABELS[effectiveCalcomRole]} ×
                    </button>
                  )}
                  {effectiveCossRole && (
                    <button className="section-label-exit" onClick={() => setActiveCossRole(null)} title="Back to master">
                      {COSS_ROLE_LABELS[effectiveCossRole]} ×
                    </button>
                  )}
                </div>
                {(() => {
                  const axesDirty = effectiveScaleStep
                    ? JSON.stringify(scaleAxisOverrides[effectiveScaleStep]) !== JSON.stringify(DEFAULT_SCALE_AXIS_OVERRIDES[effectiveScaleStep])
                    : effectiveParaStyle
                    ? JSON.stringify(paraStyles[effectiveParaStyle].axisOverrides) !== JSON.stringify(DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides)
                    : effectiveCalcomRole
                    ? JSON.stringify(calcomRoles[effectiveCalcomRole].axisOverrides) !== JSON.stringify(DEFAULT_CALCOM_ROLES[effectiveCalcomRole].axisOverrides)
                    : effectiveCossRole
                    ? JSON.stringify(cossRoles[effectiveCossRole].axisOverrides) !== JSON.stringify(DEFAULT_COSS_ROLES[effectiveCossRole].axisOverrides)
                    : variationAxes.some(a => axisValues[a.tag] !== a.defaultVal)
                  return (
                    <button
                      className={`align-btn ${axesDirty ? 'active' : 'reset-clean'}`}
                      title="Reset axes"
                      style={axesDirty ? {} : { pointerEvents: 'none' }}
                      onClick={() => {
                        if (effectiveScaleStep) {
                          setScaleAxisOverrides(prev => {
                            const next = { ...prev }
                            selectedScaleSteps.forEach(k => { next[k] = { ...DEFAULT_SCALE_AXIS_OVERRIDES[k] } })
                            return next
                          })
                        } else if (effectiveParaStyle) {
                          setParaStyles(prev => ({
                            ...prev,
                            [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides } }
                          }))
                        } else if (effectiveCalcomRole) {
                          setCalcomRoles(prev => ({
                            ...prev,
                            [effectiveCalcomRole]: { ...prev[effectiveCalcomRole], axisOverrides: { ...DEFAULT_CALCOM_ROLES[effectiveCalcomRole].axisOverrides } }
                          }))
                        } else if (effectiveCossRole) {
                          setCossRoles(prev => ({
                            ...prev,
                            [effectiveCossRole]: { ...prev[effectiveCossRole], axisOverrides: { ...DEFAULT_COSS_ROLES[effectiveCossRole].axisOverrides } }
                          }))
                        } else {
                          const defaults = {}
                          variationAxes.forEach(a => { defaults[a.tag] = a.defaultVal })
                          setAxisValues(defaults)
                        }
                      }}
                    ><ResetIcon /></button>
                  )
                })()}
              </div>
              {variationAxes.map(axis => {
                const val = effectiveScaleStep
                  ? (scaleAxisOverrides[effectiveScaleStep]?.[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveParaStyle
                  ? (paraStyles[effectiveParaStyle].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCalcomRole
                  ? (calcomRoles[effectiveCalcomRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCossRole
                  ? (cossRoles[effectiveCossRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : (mode === 'scale' && axis.tag === 'opsz')
                  ? (() => { const v = scaleAxisOverrides[TAILWIND_SCALE[0].key]?.opsz ?? 'auto'; return TAILWIND_SCALE.every(s => (scaleAxisOverrides[s.key]?.opsz ?? 'auto') === v) ? v : 'auto' })()
                  : (axisValues[axis.tag] ?? axis.defaultVal)
                const autoOpszValue = effectiveScaleStep
                  ? (TAILWIND_SCALE.find(s => s.key === effectiveScaleStep)?.pxSize ?? fontSize)
                  : effectiveCalcomRole
                  ? calcomRoles[effectiveCalcomRole].size
                  : effectiveCossRole
                  ? cossRoles[effectiveCossRole].size
                  : effectiveParaStyle
                  ? paraStyles[effectiveParaStyle].size
                  : fontSize
                return (
                  <SliderRow
                    key={axis.tag}
                    label={axis.name}
                    tag={axis.tag}
                    value={val}
                    min={axis.min}
                    max={axis.max}
                    step={axis.tag === 'opsz' ? 0.25 : (axis.max - axis.min) > 10 ? 1 : 0.01}
                    onChange={v => {
                      if (effectiveScaleStep) {
                        setScaleAxisOverrides(prev => {
                          const next = { ...prev }
                          selectedScaleSteps.forEach(k => { next[k] = { ...next[k], [axis.tag]: v } })
                          return next
                        })
                      } else if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...prev[effectiveParaStyle].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (effectiveCalcomRole) {
                        setCalcomRoles(prev => ({
                          ...prev,
                          [effectiveCalcomRole]: { ...prev[effectiveCalcomRole], axisOverrides: { ...prev[effectiveCalcomRole].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (effectiveCossRole) {
                        setCossRoles(prev => ({
                          ...prev,
                          [effectiveCossRole]: { ...prev[effectiveCossRole], axisOverrides: { ...prev[effectiveCossRole].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (mode === 'scale' && axis.tag === 'opsz') {
                        setScaleAxisOverrides(prev => {
                          const next = { ...prev }
                          TAILWIND_SCALE.forEach(s => { next[s.key] = { ...next[s.key], opsz: v } })
                          return next
                        })
                      } else {
                        setAxisValues(prev => ({ ...prev, [axis.tag]: v }))
                      }
                    }}
                    allowAuto={axis.tag === 'opsz'}
                    autoValue={axis.tag === 'opsz' ? autoOpszValue : undefined}
                    display={axis.tag === 'opsz' && val === 'auto' ? 'auto' : Math.round(val)}
                  />
                )
              })}
            </div>
          </>
        )}

        {/* Glyph set tabs — only shown in glyphs mode */}
        {mode === 'glyphs' && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Glyph Set</div>
              <div className="glyph-set-group">
                {Object.keys(glyphSets).map(k => (
                  <button
                    key={k}
                    className={`glyph-set-btn ${activeGlyphKey === k ? 'active' : ''}`}
                    onClick={() => setActiveGlyphSet(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {/* Copyright footer */}
        <div className="sidebar-footer">
          {fontVersion && <div className="font-version">v{fontVersion}</div>}
          {clientSlug && clientSlug !== 'wordmark'
            ? `\u00A9${new Date().getFullYear()} ${clientLabel}, courtesy of WORDMARK. Please do not distribute without approval and understanding of IP holder.`
            : `\u00A9${new Date().getFullYear()} WORDMARK.`
          }
        </div>
      </aside>

      {/* Desktop preset bar — top-left of preview, paragraph mode only */}
      {fontName && mode === 'paragraph' && (
        <div className="preview-preset-bar">
          {Object.keys(TEXT_PRESETS).map(k => (
            <button
              key={k}
              className={`preview-preset-btn ${activeTextPreset === k ? 'active' : ''}`}
              onClick={() => selectPreset(k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {/* Main preview area */}
      {/* Inline-emphasis bubble — shared wm-primitives component; labels use the font's real italic/bold */}
      <InlineEmphasisBubble
        selector=".para-block, .scale-row-text, .scale-pair-text"
        italicLabelStyle={inlineStyle('p', 'italic')}
        boldLabelStyle={inlineStyle('p', 'bold')}
      />

      <main className="preview-area" ref={previewAreaRef}>
        {!fontName && (
          <div className="empty-state">
            <img src={logoGif} alt="Logo" className="empty-logo" />
            <p className="empty-hint">Open a font file to begin proofing</p>
          </div>
        )}

        {mode === 'calcom' && (
          <CalcomPreview key={calcomFont} roleStyle={roleStyle} activeRole={activeCalcomRole} onRoleClick={setActiveCalcomRole} />
        )}

        {mode === 'coss' && (
          <CossPreview key={calcomFont} roleStyle={cossRoleStyle} activeRole={activeCossRole} onRoleClick={setActiveCossRole} />
        )}

        {fontName && mode === 'ui' && (
          <div className="preview-ui">
            <Suspense fallback={<div className="preview-ui-loading">Loading UI kit…</div>}>
              <UiPreview
                /* only the font IDENTITY — NOT the proofing size/leading/tracking,
                   which would otherwise be inherited by the UI kit and blow up every
                   inline element's line box (the kit sets its own type sizes) */
                fontStyle={{
                  fontFamily: previewStyle.fontFamily,
                  fontVariationSettings,
                  fontFeatureSettings: proofFeatureSettings,
                  fontStyle,
                  fontOpticalSizing: previewStyle.fontOpticalSizing,
                }}
                weight={Number(axisValues.wght) || 400}
                boldWeight={Math.min(900, (Number(axisValues.wght) || 400) + 300)}
              />
            </Suspense>
          </div>
        )}

        {fontName && mode === 'big' && (
          <div className="preview-big">
            <div
              ref={bigEditorCallback}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="editable-big edit-rail"
              style={previewStyle}
              onInput={e => setBigText(e.currentTarget.textContent)}
            />
          </div>
        )}

        {fontName && mode === 'paragraph' && (
          <div className="preview-paragraph" style={{ maxWidth: `${measure}em` }}>
              {blocks.map((block, i) => (
                <EditableTextBlock
                  key={block.id}
                  value={block.text}
                  focused={focusedBlockId === block.id}
                  onFocusChange={f => setFocusedBlockId(cur => f ? block.id : (cur === block.id ? null : cur))}
                  onCommit={t => setBlocks(prev => prev.map(x => x.id === block.id ? { ...x, text: t } : x))}
                  className={`para-block para-block--${block.type} edit-rail${activeParaStyle === block.type ? ' edit-rail--target' : ''}`}
                  style={blockStyle(block.type)}
                  innerRef={el => { if (el) blockRefs.current[block.id] = el; else delete blockRefs.current[block.id] }}
                  onInput={e => handleBlockInput(block.id, e)}
                  onKeyDown={e => handleBlockKeyDown(block.id, e)}
                  render={v => {
                    const inline = renderInline(v, inlineStyle(block.type, 'italic'), inlineStyle(block.type, 'bold'))
                    // A marked-up block used to fall back to browser flow here, because a
                    // fitted line was one span and a span cannot carry italic in its
                    // middle. Lines are runs now, so emphasis and fitting coexist and the
                    // only thing that opts out is fitting being off.
                    const blockOpts = fitOptsFor(block.type)
                    if (blockOpts.mode === 'off') return inline
                    return (
                      <FittedParagraph
                        text={v}
                        opts={blockOpts}
                        indentPx={i === 0 ? fit.firstIndent : blockOpts.indent}
                        runStyle={kind => inlineStyle(block.type, kind)}
                        fallback={inline}
                      />
                    )
                  }}
                />
              ))}
              {/* The tail of a part-loaded work fades instead of stopping dead, so the
                  cut reads as "more of this" rather than the end of the specimen. The
                  gradient is an overlay, not a mask: the text under it stays clickable
                  and editable, which a mask would have taken away. */}
              <SpecimenNav
                more={!!spec && spec.loaded < specimenChunks(spec.slug)}
                onMore={readMore}
                nextLabel={nextPreset()}
                onNext={() => selectPreset(nextPreset())}
              />
          </div>
        )}

        {fontName && mode === 'scale' && (() => {
          return (
            <div className="preview-scale" style={{ maxWidth: `${measure}em` }}>
              {visibleScaleSteps.map(step => (
                <div
                  key={step.key}
                  className={`scale-row${selectedScaleSteps.includes(step.key) || activeScaleStep === step.key ? ' scale-row--selected' : ''}`}
                  onClick={() => {
                    setActiveScaleStep(k => k === step.key ? null : step.key)
                    setScaleStepRangeEnd(null)
                    setExtraScaleSteps(new Set())
                    setActiveParaStyle(null)
                  }}
                >
                  <div className="scale-row-meta">
                    <span className="scale-row-tag">
                      {step.key}
                      {scalePairSteps.length > 0 && (
                        <span className="scale-row-with">
                          {' with '}
                          {scalePairSteps.map(p => p.key).join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="scale-row-px">
                      {step.pxSize}px
                      {scalePairSteps.length > 0 && (
                        <span> / {scalePairSteps.map(p => `${p.pxSize}px`).join(', ')}</span>
                      )}
                    </span>
                  </div>
                  <div
                    ref={el => {
                      if (el) {
                        scaleRowRefs.current[step.key] = el
                        if (!el.textContent) el.textContent = scaleLabelText
                      } else {
                        delete scaleRowRefs.current[step.key]
                      }
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    className="scale-row-text edit-rail"
                    style={scaleStepStyle(step)}
                    onInput={e => handleScaleLabelInput(step.key, e)}
                    onClick={e => e.stopPropagation()}
                  />
                  {scalePairSteps.map(pairStep => {
                    const clamped = scaleBaseClampPx != null ? Math.min(pairStep.pxSize, scaleBaseClampPx) : null
                    const effective = clamped != null && clamped < pairStep.pxSize ? clamped : null
                    return (
                      <div
                        key={pairStep.key}
                        ref={el => {
                          const refKey = `${step.key}__${pairStep.key}`
                          if (el) {
                            scalePairRefs.current[refKey] = el
                            if (!el.textContent) el.textContent = scalePairText
                          } else {
                            delete scalePairRefs.current[refKey]
                          }
                        }}
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        className="scale-pair-text edit-rail"
                        data-pair-size={pairStep.key}
                        style={scaleStepStyle(pairStep, effective)}
                        onInput={e => handleScalePairInput(`${step.key}__${pairStep.key}`, e)}
                        onClick={e => e.stopPropagation()}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })()}

        {fontName && mode === 'glyphs' && (
          <div className="preview-glyphs">
            {glyphMatchUnavailable && (
              <div className="glyph-match-note">
                Showing every glyph in the set. To trim this to the characters this font actually contains, import an uncompressed <strong>.ttf</strong> or <strong>.otf</strong>.
              </div>
            )}
            <GlyphPicker
              groups={[{
                label: activeGlyphKey,
                // explicit cells: Miscellaneous entries are ◌-composites (multi-codepoint),
                // so the chars-string shorthand would split them; filter app-side.
                // "All" = the font's OWN cmap, fully enumerated — curated sets are
                // hand-picked subsets for quick browsing.
                cells: (activeGlyphKey === 'All' && supportedRanges
                  ? enumerateCmap(supportedRanges)
                  : glyphSets[activeGlyphKey].filter(g => isSupported(g, supportedRanges, g.charCodeAt(0) === 0x25CC))
                ).map(ch => ({ ch })),
              }]}
              fontFamily={previewStyle.fontFamily}
              fontVariationSettings={fontVariationSettings}
              fontFeatureSettings={proofFeatureSettings}
              fontOpticalSizing="none"
              metrics={glyphMetrics ?? undefined}
              names="nice"
              layout="side"
              style={{ fontStyle }}
            />
          </div>
        )}
      </main>

      {/* Cal.com roles popover */}
      {calcomPanelOpen && mode === 'calcom' && (() => {
        const rect = calcomPanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={calcomPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: rect.left,
              '--caret-x': `${rect.width / 2}px`,
            }}
          >
            {/* migrated to shared StyleScopeList (single-select); panel keeps its own
                trigger/positioning. Rows show every axis (denser than the type pickers)
                — kept as tight as the old .para-styles-row via .ssd-list--dense. */}
            <StyleScopeList
              inline
              mode="single"
              className="ssd-list--dense"
              onSelect={key => { setActiveCalcomRole(prev => prev === key ? null : key); setCalcomPanelOpen(false) }}
              rows={Object.entries(CALCOM_ROLE_LABELS).map(([key, label]) => {
                const r = calcomRoles[key]
                const merged = { ...axisValues, ...r.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                const family = calcomFont === 'inter'
                  ? '"Inter", system-ui, sans-serif'
                  : calcomFont === 'calsans'
                    ? '"CalSans"'
                    : fontFace ? `"${fontFace.family}"` : 'serif'
                return {
                  id: key,
                  label,
                  labelStyle: {
                    fontFamily: family,
                    fontSize: `${Math.min(r.size, 22)}px`,
                    fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${r.size}px`, kind: 'size' },
                    { text: nbMinus(r.tracking < 0 ? r.tracking.toFixed(2) : r.tracking.toFixed(3)), kind: 'size' }, // negative: real minus + drop a trailing zero so the char count stays equal
                    ...(calcomFont !== 'inter' ? variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return {
                        text: `${axis.tag} ${val === 'auto' ? 'A ' : nbMinus(Number.isInteger(val) ? val : val.toFixed(1))}`,
                        kind: isLocal ? 'local' : 'axis',
                      }
                    }) : []),
                  ],
                  selected: activeCalcomRole === key,
                }
              })}
            />
          </div>
        )
      })()}

      {cossPanelOpen && mode === 'coss' && (() => {
        const rect = cossPanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={cossPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: rect.left,
              '--caret-x': `${rect.width / 2}px`,
            }}
          >
            {/* migrated to shared StyleScopeList (single-select); mirrors the calcom
                role picker — every axis shown, kept tight via .ssd-list--dense. */}
            <StyleScopeList
              inline
              mode="single"
              className="ssd-list--dense"
              onSelect={key => { setActiveCossRole(prev => prev === key ? null : key); setCossPanelOpen(false) }}
              rows={Object.entries(COSS_ROLE_LABELS).map(([key, label]) => {
                const r = cossRoles[key]
                const merged = { ...axisValues, ...r.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                const family = calcomFont === 'inter'
                  ? '"Inter", system-ui, sans-serif'
                  : calcomFont === 'calsans'
                    ? '"CalSans"'
                    : fontFace ? `"${fontFace.family}"` : 'serif'
                return {
                  id: key,
                  label,
                  labelStyle: {
                    fontFamily: family,
                    fontSize: `${Math.min(r.size, 22)}px`,
                    fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${r.size}px`, kind: 'size' },
                    { text: nbMinus(r.tracking < 0 ? r.tracking.toFixed(2) : r.tracking.toFixed(3)), kind: 'size' }, // negative: real minus + drop a trailing zero so the char count stays equal
                    ...(calcomFont !== 'inter' ? variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return {
                        text: `${axis.tag} ${val === 'auto' ? 'A ' : nbMinus(Number.isInteger(val) ? val : val.toFixed(1))}`,
                        kind: isLocal ? 'local' : 'axis',
                      }
                    }) : []),
                  ],
                  selected: activeCossRole === key,
                }
              })}
            />
          </div>
        )
      })()}

      {/* Scale steps panel popover */}
      {scaleStepsPanelOpen && mode === 'scale' && fontName && (() => {
        const rect = scalePanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={scalePanelPopoverRef}
            className="para-styles-panel scale-steps-panel"
            style={{ top: rect.bottom + 8, left: rect.left, '--caret-x': `${rect.width / 2}px` }}
          >
            <div className="scale-steps-header">
              <button
                className={`scale-multi-btn ${scaleMultiSelectMode ? 'active' : ''}`}
                onClick={() => setScaleMultiSelectMode(p => !p)}
                title="Select multiple steps"
              ><MultiSelectIcon /></button>
            </div>
            {/* migrated to shared StyleScopeList (multi-select); keeps this panel's own
                trigger/positioning and the shift-range / multi-mode selection logic */}
            <StyleScopeList
              inline
              mode="multi"
              onSelect={(key, e) => {
                if (e.shiftKey && activeScaleStep && activeScaleStep !== key) {
                  setScaleStepRangeEnd(key)
                } else if (scaleMultiSelectMode) {
                  if (!activeScaleStep) {
                    setActiveScaleStep(key)
                  } else if (key === activeScaleStep) {
                    const next = new Set(extraScaleSteps)
                    if (next.size > 0) {
                      const first = [...next][0]
                      setActiveScaleStep(first)
                      next.delete(first)
                      setExtraScaleSteps(next)
                    } else {
                      setActiveScaleStep(null)
                    }
                    setScaleStepRangeEnd(null)
                  } else {
                    setExtraScaleSteps(prev => {
                      const next = new Set(prev)
                      next.has(key) ? next.delete(key) : next.add(key)
                      return next
                    })
                  }
                } else {
                  setActiveScaleStep(prev => prev === key ? null : key)
                  setScaleStepRangeEnd(null)
                  setExtraScaleSteps(new Set())
                  setActiveParaStyle(null)
                }
              }}
              rows={visibleScaleSteps.map(step => {
                const isActive = selectedScaleSteps.includes(step.key) || activeScaleStep === step.key
                const overrides = scaleAxisOverrides[step.key] ?? {}
                const localOverrides = Object.entries(overrides).filter(([tag]) => tag !== 'opsz' || overrides[tag] !== 'auto')
                return {
                  id: step.key,
                  label: step.key,
                  labelStyle: { ...scaleStepStyle(step), fontSize: `${Math.min(step.pxSize, 20)}px`, lineHeight: 1.3 },
                  chips: [
                    { text: `${step.pxSize}px`, kind: 'size' },
                    ...localOverrides.map(([tag, val]) => ({
                      text: `${tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                      kind: 'local',
                    })),
                  ],
                  selected: isActive,
                }
              })}
            />
          </div>
        )
      })()}

      {/* Styles popover */}
      {paraStylesPanelOpen && mode === 'paragraph' && fontName && (() => {
        const mobileRect = mobileStylesBtnRef.current?.getBoundingClientRect()
        const desktopRect = stylesPanelBtnRef.current?.getBoundingClientRect()
        const isMobile = mobileRect && mobileRect.width > 0
        const rect = isMobile ? mobileRect : desktopRect
        if (!rect) return null
        const margin = 16
        const popoverLeft = isMobile ? margin : rect.left
        const popoverRight = isMobile ? margin : undefined
        const caretX = isMobile
          ? rect.left + rect.width / 2 - margin
          : rect.width / 2
        return (
          <div
            ref={stylesPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: popoverLeft,
              ...(popoverRight !== undefined ? { right: popoverRight, minWidth: 'unset' } : {}),
              '--caret-x': `${caretX}px`,
            }}
          >
            {/* migrated to the shared StyleScopeList primitive (rows + chips); this
                panel keeps its own portal trigger/positioning */}
            <StyleScopeList
              inline
              mode="single"
              onSelect={type => setActiveParaStyle(prev => prev === type ? null : type)}
              rows={(['h1', 'h2', 'h3', 'p']).map(type => {
                const s = paraStyles[type]
                const merged = { ...axisValues, ...s.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                return {
                  id: type,
                  label: type === 'p' ? 'Paragraph' : `Heading ${type[1]}`,
                  labelStyle: {
                    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
                    fontStyle,
                    fontSize: `${Math.min(s.size, 22)}px`,
                    fontVariationSettings: fvs,
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${s.size}px`, kind: 'size' },
                    ...Object.entries(s.axisOverrides).map(([tag, val]) => ({
                      text: `${tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                      kind: 'axis',
                    })),
                  ],
                  selected: activeParaStyle === type,
                }
              })}
            />
          </div>
        )
      })()}
    </div>
  )
}

// ── Cal.com preview ───────────────────────────────────────────────────────────
function CalcomPreview({ roleStyle, activeRole, onRoleClick }) {
  const [selectedDate, setSelectedDate] = useState(22)
  const [selectedDur, setSelectedDur] = useState(15)

  // April 2026: April 1 = Wednesday → startOffset 2 (Mon=0, Tue=1, Wed=2)
  const startOffset = 2
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= 30; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const times = ['4:15am','4:20am','4:25am','4:30am','6:00am','6:05am','6:15am','6:30am','6:45am','7:00am','11:30am','1:15pm','1:30pm']

  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''

  return (
    <div className="calcom-page">
      <div className="calcom-card">
        {/* Left panel */}
        <div className="calcom-left">
          <div className="calcom-cover">
            <div className="calcom-cover-img-wrap">
              <img src={calcomBanner} alt="" className="calcom-cover-img" />
            </div>
            <div className="calcom-avatar">
              <img src={peerAvatar} alt="Peer Richelsen" className="calcom-avatar-img" />
            </div>
          </div>
          <div className="calcom-left-body">
          <div className={`calcom-event-host ${roleClass('eventHost')}`} style={roleStyle('eventHost')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventHost' ? null : 'eventHost')}>
            Peer Richelsen
          </div>
          <div className={`calcom-event-title ${roleClass('eventTitle')}`} style={roleStyle('eventTitle')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventTitle' ? null : 'eventTitle')}>
            Meeting
          </div>
          <div className={`calcom-event-desc ${roleClass('eventDesc')}`} style={roleStyle('eventDesc')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventDesc' ? null : 'eventDesc')}>
            A quick screen share demo or longer conversation.
          </div>
          <div className={`calcom-meta-item ${roleClass('eventDesc')}`} style={roleStyle('eventDesc')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            Requires confirmation
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <div className="calcom-durations">
              {[15, 30].map(d => (
                <button
                  key={d}
                  className={`calcom-dur-btn ${selectedDur === d ? 'active' : ''}`}
                  style={roleStyle('eventMeta')}
                  onClick={e => { e.stopPropagation(); setSelectedDur(d) }}
                >{d}m</button>
              ))}
            </div>
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <img src={calcomIcon} alt="" className="calcom-meta-icon-img" /> Cal Video
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            America/New York
          </div>
          </div>{/* end calcom-left-body */}
        </div>

        {/* Calendar panel */}
        <div className="calcom-right">
          <div className="calcom-calendar-wrap">
            <div className="calcom-month-nav">
              <div className="calcom-month-label">
                <span style={{...roleStyle('calHeader'), fontSize: '14px'}}>April</span>
                <span style={{...roleStyle('calHeader'), fontSize: '14px', color: 'rgba(245,250,255,0.4)'}}>2026</span>
              </div>
              <div className="calcom-nav-btns">
                <button className="calcom-nav-btn">‹</button>
                <button className="calcom-nav-btn">›</button>
              </div>
            </div>
            <div className="calcom-cal-grid">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className={`calcom-weekday ${roleClass('calHeader')}`} style={roleStyle('calHeader')}
                  onClick={() => onRoleClick(r => r === 'calHeader' ? null : 'calHeader')}>
                  {d}
                </div>
              ))}
              {cells.map((day, i) => (
                <div
                  key={i}
                  className={`calcom-day${day === null ? ' empty' : ''}${day === 22 ? ' today' : ''}${day === selectedDate ? ' selected' : ''}${day !== null && day < 22 ? ' past' : ''} ${day !== null ? roleClass('calDay') : ''}`}
                  style={day !== null ? roleStyle('calDay') : {}}
                  onClick={() => {
                    if (day !== null && day >= 22) setSelectedDate(day)
                    onRoleClick(r => r === 'calDay' ? null : 'calDay')
                  }}
                >
                  {day}
                </div>
              ))}
            </div>
          </div>

          {/* Time slots */}
          {selectedDate && (
            <div className="calcom-times-wrap">
              <div className="calcom-time-date" style={{...roleStyle('calHeader'), fontSize: '14px', textTransform: 'none'}}>
                Wed {selectedDate}
              </div>
              <div className="calcom-time-list">
                {times.map(t => (
                  <button
                    key={t}
                    className={`calcom-time-btn ${roleClass('timeSlot')}`}
                    style={roleStyle('timeSlot')}
                    onClick={() => onRoleClick(r => r === 'timeSlot' ? null : 'timeSlot')}
                  >{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Booking Events (coss.com) preview ────────────────────────────────────────
function CossPreview({ roleStyle, activeRole, onRoleClick }) {
  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''
  const [openMenu, setOpenMenu] = useState(null)
  const [cossPage, setCossPage] = useState('eventTypes')
  const [bookingsTab, setBookingsTab] = useState('past')

  useEffect(() => {
    if (openMenu === null) return
    const handler = (e) => {
      if (!e.target.closest('.coss-ctx-menu') && !e.target.closest('.coss-icon-btn--menu')) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  const LucideIcon = ({ children }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-icon" aria-hidden="true">{children}</svg>
  )

  const PAGED = new Set(['eventTypes', 'bookings'])
  const handleNavClick = (key) => {
    if (PAGED.has(key)) {
      if (cossPage !== key) { setCossPage(key); return }
    }
    onRoleClick(r => r === 'navLabel' ? null : 'navLabel')
  }

  const navItems = [
    { key: 'eventTypes', label: 'Event Types', icon: (
      <LucideIcon><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="11" y1="12" x2="13" y2="12"/></LucideIcon>
    )},
    { key: 'bookings', label: 'Bookings', icon: (
      <LucideIcon><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></LucideIcon>
    )},
    { key: 'availability', label: 'Availability', icon: (
      <LucideIcon><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="M12 6v6l4 2"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></LucideIcon>
    )},
    { key: 'members', label: 'Members', icon: (
      <LucideIcon><path d="M16 2v2"/><path d="M17.915 22a6 6 0 0 0-12 0"/><path d="M8 2v2"/><circle cx="12" cy="12" r="4"/><rect x="3" y="4" width="18" height="18" rx="2"/></LucideIcon>
    )},
    { key: 'teams', label: 'Teams', icon: (
      <LucideIcon><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></LucideIcon>
    )},
    { key: 'apps', label: 'Apps', chevron: true, icon: (
      <LucideIcon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></LucideIcon>
    )},
    { key: 'routing', label: 'Routing', icon: (
      <LucideIcon><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></LucideIcon>
    )},
    { key: 'workflows', label: 'Workflows', badge: 'Cal AI', icon: (
      <LucideIcon><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></LucideIcon>
    )},
    { key: 'insights', label: 'Insights', icon: (
      <LucideIcon><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></LucideIcon>
    )},
  ]

  const eventTypes = [
    { id: 1, title: '15 Min Meeting', slug: '/pasquale/15min',  desc: 'A quick 15 minute call to discuss anything.', duration: '15m', badges: [], enabled: true },
    { id: 2, title: '30 Min Meeting', slug: '/pasquale/30min',  desc: 'A standard 30 minute meeting for detailed discussions.', duration: '30m', badges: [], enabled: true },
    { id: 3, title: '60 Min Consultation', slug: '/pasquale/consultation', desc: 'An in-depth consultation for complex topics requiring detailed discussion and planning.', duration: '1h', badges: ['confirmation'], enabled: true },
    { id: 4, title: 'Secret Meeting', slug: '/pasquale/secret', desc: 'A private meeting only accessible via direct link.', duration: '30m', badges: ['hidden'], enabled: false },
    { id: 5, title: 'Paid Consultation', slug: '/pasquale/paid-consultation', desc: 'Premium consultation with payment required.', duration: '45m', badges: ['paid'], enabled: true },
  ]

  return (
    <div className="coss-shell">
      {/* Mobile top bar */}
      <div className="coss-mobile-bar">
        <span className="coss-mobile-wordmark">Cal.com</span>
        <div className="coss-logo-actions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-logo-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
          <img src={cossCalAvatar} alt="" className="coss-avatar-img" />
        </div>
      </div>

      {/* Sidebar */}
      <aside className="coss-sidebar">
        <div className="coss-sidebar-top">
          <div className="coss-logo-row">
            <svg className="coss-wordmark" viewBox="0 0 1953.76354 400" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M196.05736,399.28317C84.22939,399.28317,0,312.18638,0,204.65949,0,96.77419,79.92832,8.96057,196.05736,8.96057c61.64874,0,104.30107,18.638,137.63442,61.29033l-53.76344,44.08603c-22.58066-23.65591-49.8208-35.48388-83.87098-35.48388-75.62724,0-117.20431,56.98925-117.20431,125.80645s45.51972,124.7312,117.20431,124.7312c33.69176,0,62.3656-11.82797,84.94623-35.48388l53.04661,45.87815c-31.89965,40.86022-75.62726,59.4982-137.99284,59.4982Z"/><path d="M565.59139,112.90322h72.40142v279.5699h-72.40142v-40.86022c-15.05375,29.03225-40.14336,48.3871-88.17207,48.3871-76.70252,0-137.99284-65.59141-137.99284-146.23657s61.29032-146.23656,137.99284-146.23656c47.67026,0,73.11826,19.35484,88.17207,48.3871v-43.01074ZM567.74194,253.76345c0-43.72759-30.46595-79.92832-78.4946-79.92832-46.23654,0-76.3441,36.55914-76.3441,79.92832,0,42.29392,30.10751,79.9283,76.3441,79.9283,47.67021,0,78.4946-36.55913,78.4946-79.9283Z"/><path d="M689.2473,0h72.40142v392.11471h-72.40142V0Z"/><path d="M793.90685,355.19713c0-22.93907,18.63798-42.29392,44.08603-42.29392s43.36914,19.35484,43.36914,42.29392c0,23.65591-18.27959,43.01075-43.3692,43.01075s-44.08598-19.35482-44.08598-43.01075Z"/><path d="M1158.42292,347.31184c-26.88172,32.25807-67.74192,52.68816-116.12901,52.68816-86.37995,0-149.82075-65.59141-149.82075-146.23657s63.44091-146.23656,149.82075-146.23656c46.59498,0,87.09673,19.35484,113.97845,49.82078l-55.914,46.23657c-13.97847-17.2043-32.25807-30.10753-58.06456-30.10753-46.23654,0-76.34404,36.55913-76.34404,79.9283s30.10751,79.92833,76.34404,79.92833c27.95695,0,47.31187-14.33692,61.64879-33.69176l54.48033,47.67029Z"/><path d="M1164.51616,253.76345c0-80.64516,63.44091-146.23656,149.82075-146.23656s149.82075,65.5914,149.82075,146.23656-63.44091,146.23655-149.82075,146.23655c-86.37984-.35842-149.82075-65.59138-149.82075-146.23655ZM1390.68106,253.76345c0-43.72759-30.10751-79.92832-76.34404-79.92832-46.23665-.35843-76.34415,36.2007-76.34415,79.92832,0,43.36917,30.10751,79.9283,76.34404,79.9283s76.34415-36.55913,76.34415-79.9283Z"/><path d="M1953.76354,221.50539v170.60932h-72.40148v-153.04659c0-48.3871-22.93916-69.17563-57.34767-69.17563-32.25807,0-55.19711,15.77062-55.19711,69.17563v153.04659h-72.40148v-153.04659c0-48.3871-23.29749-69.17563-57.34767-69.17563-32.25807,0-60.57346,15.77062-60.57346,69.17563v153.04659h-72.40148V112.5448h72.40148v38.70968c15.05381-30.10752,42.29386-45.1613,84.22939-45.1613,39.78497,0,73.11826,19.35484,91.39785,51.97133,18.27959-33.33333,45.1612-51.97133,93.90686-51.97133,59.49812.35843,105.73477,44.80288,105.73477,115.41221Z"/></svg>
            <div className="coss-logo-actions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-logo-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
              <img src={cossCalAvatar} alt="" className="coss-avatar-img" />
              <img src={cossUserAvatar} alt="" className="coss-avatar-img" />
            </div>
          </div>
          <nav className="coss-nav">
            {navItems.map(item => (
              <button
                key={item.key}
                className={`coss-nav-item ${cossPage === item.key ? 'active' : ''} ${roleClass('navLabel')}`}
                style={roleStyle('navLabel')}
                onClick={() => handleNavClick(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && (
                  <span className="coss-ai-badge">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-sparkle-icon"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>
                    {item.badge}
                  </span>
                )}
                {item.chevron && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-chevron"><path d="m9 18 6-6-6-6"/></svg>}
              </button>
            ))}
          </nav>
        </div>
        <div className="coss-sidebar-bottom">
          {[
            { label: 'View public page',      icon: <><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></> },
            { label: 'Copy public page link', icon: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></> },
            { label: 'Refer and earn',        icon: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></> },
            { label: 'Settings',              icon: <><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></> },
          ].map(({ label, icon }) => (
            <button key={label} className={`coss-sidebar-link ${roleClass('navLabel')}`} style={roleStyle('navLabel')}
              onClick={() => onRoleClick(r => r === 'navLabel' ? null : 'navLabel')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-icon">{icon}</svg>
              {label}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="coss-main">
        {/* ── Event Types page ── */}
        {cossPage === 'eventTypes' && (<>
        <div className="coss-page-header">
          <div>
            <div className={`coss-page-title ${roleClass('pageTitle')}`} style={roleStyle('pageTitle')}
              onClick={() => onRoleClick(r => r === 'pageTitle' ? null : 'pageTitle')}>
              Event Types
            </div>
            <div className={`coss-page-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              Create events to share for people to book on your calendar.
            </div>
          </div>
          <div className="coss-header-actions">
            <div className="coss-search-bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-search-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            </div>
            <button className="coss-new-btn">+ New</button>
          </div>
        </div>

        <div className="coss-card-list">
          {eventTypes.map(et => (
            <div key={et.id} className={`coss-event-card${et.badges.includes('paid') ? ' coss-event-card--paid' : et.badges.includes('hidden') ? ' coss-event-card--hidden' : ''}`}>
              <div className="coss-card-left">
                <div className="coss-card-title-row">
                  <span className={`coss-card-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
                    onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
                    {et.title}
                  </span>
                  <span className={`coss-card-slug ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {et.slug}
                  </span>
                </div>
                <div className={`coss-card-desc ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
                  onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
                  {et.desc}
                </div>
                <div className="coss-card-badges">
                  <span className={`coss-badge coss-badge--duration ${roleClass('badge')}`} style={roleStyle('badge')}
                    onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>
                    {et.duration}
                  </span>
                  {et.badges.includes('confirmation') && (
                    <span className={`coss-badge coss-badge--confirm ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
                      Requires confirmation
                    </span>
                  )}
                  {et.badges.includes('hidden') && (
                    <span className={`coss-badge coss-badge--hidden ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.8 10.8 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/></svg>
                      Hidden
                    </span>
                  )}
                  {et.badges.includes('paid') && (
                    <span className={`coss-badge coss-badge--paid ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
                      $99
                    </span>
                  )}
                </div>
              </div>
              <div className="coss-card-right">
                <div className={`coss-toggle ${et.enabled ? 'on' : 'off'}`}>
                  <div className="coss-toggle-thumb" />
                </div>
                <button className="coss-icon-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <div className="coss-menu-wrap">
                  <button
                    className={`coss-icon-btn coss-icon-btn--menu ${openMenu === et.id ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === et.id ? null : et.id) }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </button>
                  {openMenu === et.id && (
                    <div className="coss-ctx-menu">
                      <div className="coss-ctx-section">Edit event</div>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
                        Reschedule booking
                      </button>
                      <button className="coss-ctx-item coss-ctx-item--muted">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
                        Request reschedule
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M20 10c0 4.418-8 12-8 12s-8-7.582-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Edit location
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        Add guests
                      </button>
                      <div className="coss-ctx-divider" />
                      <div className="coss-ctx-section">After event</div>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                        View recordings
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        View Session Details
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        Mark as no-show
                      </button>
                      <div className="coss-ctx-divider" />
                      <button className="coss-ctx-item coss-ctx-item--danger">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        Report booking
                      </button>
                      <div className="coss-ctx-divider" />
                      <button className="coss-ctx-item coss-ctx-item--danger">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Cancel event
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div className={`coss-no-more ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}>
            No more results
          </div>
        </div>
        </>)}

        {/* ── Bookings page ── */}
        {cossPage === 'bookings' && (<>
        <div className="coss-page-header">
          <div>
            <div className={`coss-page-title ${roleClass('pageTitle')}`} style={roleStyle('pageTitle')}
              onClick={() => onRoleClick(r => r === 'pageTitle' ? null : 'pageTitle')}>
              Bookings
            </div>
            <div className={`coss-page-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              See upcoming and past events booked through your event type links.
            </div>
          </div>
        </div>
        <div className="coss-bookings-tabs-row">
          <div className="coss-bookings-tabs">
            {['Upcoming','Unconfirmed','Recurring','Past','Cancelled'].map(t => (
              <button key={t}
                className={`coss-bookings-tab ${roleClass('badge')} ${bookingsTab === t.toLowerCase() ? 'active' : ''}`}
                style={roleStyle('badge')}
                onClick={() => { setBookingsTab(t.toLowerCase()); onRoleClick(r => r === 'badge' ? null : 'badge') }}>
                {t}
              </button>
            ))}
          </div>
          <button className="coss-bookings-filter-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/><line x1="20" y1="20" x2="20" y2="14"/><line x1="17" y1="17" x2="23" y2="17"/></svg>
            Add Filter
          </button>
        </div>
        {bookingsTab === 'upcoming' ? (
          <div className="coss-bookings-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="coss-empty-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            <div className={`coss-empty-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
              onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
              No upcoming bookings
            </div>
            <div className={`coss-empty-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              You have no upcoming bookings found. As soon as someone books a time with you, it will show up here.
            </div>
          </div>
        ) : (
          <div className="coss-booking-list">
            {[
              { date: 'November 25, 2025', time: '2:40 PM – 3:00 PM', title: 'Engineering Chat between Keith Williams and Pasquale Vitiello', people: 'Keith Williams and Pasquale Vitiello', platform: 'Cal Video', badge: 'Rescheduled', accent: false },
              { date: 'November 7, 2025',  time: '11:30 AM – 12:00 PM', title: 'Platform onboarding roadmap', people: 'Carina Wollheim, Jonathan Djalo and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: true },
              { date: 'November 6, 2025',  time: '3:00 PM – 3:20 PM', title: 'Engineering Chat between Keith Williams and Pasquale Vitiello', people: 'Keith Williams and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: false },
              { date: 'November 3, 2025',  time: '3:00 PM – 3:30 PM', title: '30 Min Meeting between Susan Moeller and Pasquale Vitiello', people: 'Susan Moeller and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: false },
              { date: 'October 13, 2025',  time: '3:30 PM – 4:00 PM', title: '30 Min Meeting between Pasquale Vitiello and David Borenius', people: 'Pasquale Vitiello and David Borenius', platform: 'Google Meet', badge: 'Rescheduled', accent: false },
              { date: 'October 10, 2025',  time: '5:00 PM – 5:30 PM', title: '@cossful migration', people: 'Peer Richelsen, Keith Williams and Pasquale Vitiello', platform: 'Google Meet', badge: null, accent: false, calBadge: true },
            ].map((b, i) => (
              <div key={i} className={`coss-booking-row ${b.accent ? 'accent' : ''}`}>
                <div className="coss-booking-grid">
                  {/* row 1: date | title */}
                  <div className={`coss-booking-date-label ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {b.date}
                  </div>
                  <div className={`coss-booking-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
                    onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
                    {b.title}
                  </div>
                  {/* row 2: time | people */}
                  <div className={`coss-booking-time ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {b.time}
                  </div>
                  <div className={`coss-booking-people ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
                    onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
                    {b.people}
                  </div>
                  {/* row 3: platform badge | status badges */}
                  <div className="coss-booking-left-badge">
                    {b.platform && (
                      <span className={`coss-badge coss-badge--platform ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={e => { e.stopPropagation(); onRoleClick(r => r === 'badge' ? null : 'badge') }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.361a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/></svg>
                        {b.platform === 'Cal Video' ? 'Join Cal Video' : `Join ${b.platform}`}
                      </span>
                    )}
                  </div>
                  <div className="coss-booking-badges">
                    {b.badge && (
                      <span className={`coss-badge coss-badge--reschedule ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg>
                        {b.badge}
                      </span>
                    )}
                    {b.calBadge && (
                      <span className={`coss-badge coss-badge--cal ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                        Cal.com
                      </span>
                    )}
                  </div>
                </div>
                <button className="coss-icon-btn" style={{alignSelf:'flex-start', marginTop: 2}}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

      </main>

      {/* Mobile bottom nav */}
      <nav className="coss-bottom-nav">
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </button>
        <button className="coss-bottom-btn coss-bottom-btn--fab">+</button>
      </nav>
    </div>
  )
}

// ── Theme Toggle ──────────────────────────────────────────────────────────────
function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('wm-theme') || 'auto')
  const apply = (t) => {
    setTheme(t)
    localStorage.setItem('wm-theme', t)
    document.documentElement.dataset.theme = t
  }
  return (
    <div id="theme-toggle" className="ui-seg" role="group" aria-label="Color scheme">
      {['auto', 'light', 'dark'].map(t => (
        <button key={t} data-mode={t} className={theme === t ? 'active' : ''} onClick={() => apply(t)}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <rect width="20" height="20" rx="3" ry="3" fill="currentColor" fillOpacity="0.15"/>
      <path fill="currentColor" d="M5.155 12.422c-.43-.25-.769-.587-1.016-1.012-.247-.425-.371-.893-.371-1.402 0-.515.12-.987.36-1.417.24-.43.574-.77 1.001-1.02.427-.25.914-.375 1.459-.375.405 0 .777.071 1.117.214.34.143.635.358.885.648l-.772.735c-.17-.18-.35-.314-.54-.401-.19-.087-.42-.131-.69-.131-.345 0-.646.076-.904.229-.257.153-.456.361-.596.626-.14.265-.21.562-.21.892 0 .33.07.625.21.885.14.26.341.465.604.615.262.15.568.225.918.225.235 0 .456-.042.664-.128.207-.085.383-.21.529-.375l.795.698c-.22.265-.498.476-.832.633-.335.157-.728.236-1.177.236-.525 0-1.002-.125-1.432-.375ZM9.835 12.516c-.3-.193-.534-.449-.701-.769-.168-.32-.251-.665-.251-1.035 0-.37.084-.715.251-1.035.167-.32.401-.576.701-.769.3-.193.64-.289 1.02-.289.285 0 .542.064.772.191.23.128.383.3.458.514h.052v-.6h1.027v3.974h-1.027v-.585h-.052c-.075.205-.228.371-.458.499-.23.127-.487.191-.772.191-.38 0-.72-.096-1.02-.288Zm1.743-.833c.162-.097.29-.231.382-.401.092-.17.139-.36.139-.57 0-.215-.047-.407-.139-.577-.092-.17-.22-.304-.382-.401-.163-.097-.346-.146-.551-.146-.31 0-.568.106-.772.319-.205.213-.307.478-.307.799 0 .21.046.401.139.574.092.172.221.307.386.405.165.097.35.146.555.146.205 0 .389-.049.551-.146ZM15.391 12.7h-1.057v-.877l.007-4.53h1.058l-.008 5.406Z"/>
    </svg>
  )
}
function BigIcon({ className }) {
  return <svg className={className} width="20" height="14" viewBox="0 0 20 14" fill="none"><text x="10" y="12" textAnchor="middle" fontSize="13" fill="currentColor" fontFamily="'Face', system-ui, sans-serif" style={{fontSynthesis:'none'}}>Aa</text></svg>
}
function ParaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.5" rx="0.75" fill="currentColor"/>
      <rect x="1" y="5.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
      <rect x="1" y="9" width="8" height="1.5" rx="0.75" fill="currentColor"/>
    </svg>
  )
}
function GlyphIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}
function ScaleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1.5" width="12" height="3" rx="0.75" fill="currentColor"/>
      <rect x="1" y="6.5" width="12" height="2" rx="0.75" fill="currentColor"/>
      <rect x="1" y="10.5" width="12" height="1.25" rx="0.625" fill="currentColor"/>
    </svg>
  )
}
function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <line x1="1" y1="3" x2="11" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="4" cy="3" r="1.5" fill="currentColor"/>
      <line x1="1" y1="9" x2="11" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="8" cy="9" r="1.5" fill="currentColor"/>
    </svg>
  )
}
function AlignLeftIcon() {
  // One long and one short length across every alignment icon, so the row reads as a set.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="1.6" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="5.0" width="6" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="8.4" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="11.8" width="6" height="1.2" rx="0.6" fill="currentColor"/>
    </svg>
  )
}
function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2.0" y="1.6" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="4.0" y="5.0" width="6" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2.0" y="8.4" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="4.0" y="11.8" width="6" height="1.2" rx="0.6" fill="currentColor"/>
    </svg>
  )
}
function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="1.6" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="6" y="5.0" width="6" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="8.4" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="6" y="11.8" width="6" height="1.2" rx="0.6" fill="currentColor"/>
    </svg>
  )
}
function AlignJustifyIcon() {
  // Three flush lines and a short last one: justification never forces the final line.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="1.6" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="5.0" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="8.4" width="10" height="1.2" rx="0.6" fill="currentColor"/>
      <rect x="2" y="11.8" width="6" height="1.2" rx="0.6" fill="currentColor"/>
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9,2 4,7 9,12" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5,2 10,7 5,12" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,6 8,11 13,6" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,10 8,5 13,10" />
    </svg>
  )
}

function MultiSelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="3" cy="4" r="1.5" />
      <line x1="6.5" y1="4" x2="12" y2="4" />
      <circle cx="3" cy="10" r="1.5" />
      <line x1="6.5" y1="10" x2="12" y2="10" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <defs>
        <style>{`.rst0{stroke-miterlimit:10}.rst0,.rst1{display:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-width:1.4px}.rst1{stroke-linejoin:round}`}</style>
      </defs>
      <path className="rst0" d="M8,2.39906c3.09331,0,5.60094,2.50763,5.60094,5.60094s-2.50763,5.60094-5.60094,5.60094-5.60094-2.50763-5.60094-5.60094c0-1.74259.7958-3.29931,2.04381-4.32656"/>
      <polyline className="rst1" points="2.04069 3.38941 4.84717 3.38941 4.84717 6.19617"/>
      <path d="M8,14.2909c-3.47461,0-6.30127-2.81629-6.30127-6.2909,0-2.57326,1.51851-3.90145,2.46222-4.67831.19366-.15897.47817-.12995.6365.06182.15865.19272.10866.45416-.06182.6365-.72266.77296-1.63651,1.99428-1.63651,3.97999,0,2.70215,2.19824,4.91247,4.90088,4.91247,2.70215,0,4.90039-2.21033,4.90039-4.91247,0-2.70264-2.19824-4.90088-4.90039-4.90088-.38672,0-.7002-.31348-.7002-.7002s.31348-.7002.7002-.7002c3.47461,0,6.30078,2.82666,6.30078,6.30127s-2.82617,6.2909-6.30078,6.2909Z"/>
      <path d="M4.84717,6.89648c-.38672,0-.7002-.31348-.7002-.7002v-2.12169h-2.10645c-.38672,0-.7002-.31032-.7002-.69704s.31348-.68811.7002-.68811h2.80664c.38672,0,.7002.31348.7002.7002v2.80664c0,.38672-.31348.7002-.7002.7002Z"/>
    </svg>
  )
}
