import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useDrag } from '@use-gesture/react'
import { spring } from 'motion'
import './App.css'
import {
  StyleScopeList, InlineEmphasisBubble,
  placeCaretAtStart as placeCursorAtStart,
  placeCaretAtEnd as placeCursorAtEnd,
  splitInlineMarkup, isPlainRun,
  AxisSlider as SliderRow,
  Icon,
  ThemeSwitch,
  makeGlyphSets, parseCmapRanges, isSupported,
  nbMinus, EditableTextBlock, BlockStyleRail, Chevron, GlyphPicker, measureGlyphMetrics, enumerateCmap,
  FLATTERSATZ_DEFAULTS as FIT_DEFAULTS,
  FittingControls, fittingMode, AlignmentButtons, FittedParagraph,
  PARA_STYLE_DEFAULTS, fitOptionsFor,
  loadSpecimen, specimenChunks, SpecimenNav,
} from '../shared/index' // wm-primitives (git submodule)
// Lazy chunk — the ~40-component UI board only loads when the UI tab is opened
const UiPreview = lazy(() => import('../shared/src/UiKitBoard')) // wm-primitives UiKitBoard
import fontAxesData from 'virtual:font-axes'
import AXIS_REGISTRY from './axisRegistry.json'   // Google's axis registry, cached (scripts/sync-axis-registry.mjs)
import logoGif from '/public/logo.gif'
import logoGifDark from '/public/logo_darkmode.gif'
import peerAvatar from '/public/peer-richelsen.png'
import calcomIcon from '/public/calcom-icon.svg'
import calcomBanner from '/public/calcom-banner.png'
import calcomLogo from '/public/calcom-logo.svg'
import cossCalAvatar from '/public/coss-cal-avatar.jpg'
import cossUserAvatar from '/public/coss-user-avatar.jpg'

// ── Logo mode ─────────────────────────────────────────────────────────────────
// Set to true to show the client's SVG logo in the sidebar instead of the WM gif
const SHOW_CLIENT_LOGO = true

const _rawLogos = import.meta.glob('./logos/*.svg', { query: '?raw', import: 'default', eager: true })

// Logos are sized by height, never stretched to the sidebar width — a wordmark
// told to fill the width gets as tall as its aspect ratio says, which is how
// Vercel's ended up looking huge. Wordmarks (wide) sit at LOGO_HEIGHT; a mark
// that is squarish or taller than wide would be tiny at that height, so it gets
// LOGO_HEIGHT_COMPACT instead.
const LOGO_HEIGHT = 20
const LOGO_HEIGHT_COMPACT = 32
const WORDMARK_ASPECT = 2.5

function logoAspect(svg) {
  const vb = svg.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i)
  if (vb) return Number(vb[1]) / Number(vb[2])
  const w = svg.match(/\bwidth="([\d.]+)"/i)
  const h = svg.match(/\bheight="([\d.]+)"/i)
  return w && h ? Number(w[1]) / Number(h[1]) : WORDMARK_ASPECT
}

const CLIENT_LOGOS = Object.fromEntries(
  Object.entries(_rawLogos).map(([path, svg]) => {
    const key = path.replace('./logos/', '').replace(/\.svg$/i, '').toLowerCase()
    const clean = svg
      .replace(/<\?xml[^?]*\?>\s*/i, '')       // strip XML declaration
      .replace(/<style[\s\S]*?<\/style>/gi, '') // strip embedded styles (prevent global bleed)
      .replace(/(<svg\b[^>]*?)(\s*fill="[^"]*")?(\s*>)/i, '$1 fill="currentColor"$3') // ensure currentColor
    const aspect = logoAspect(clean)
    return [key, { svg: clean, height: aspect < WORDMARK_ASPECT ? LOGO_HEIGHT_COMPACT : LOGO_HEIGHT }]
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
  const logo = fuzzyClientLogo(slug)
  if (logo) return (
    <div
      className="client-logo-svg"
      style={{ '--logo-height': `${logo.height}px` }}
      dangerouslySetInnerHTML={{ __html: logo.svg }}
    />
  )
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

// ── A/B screenshot mode ──────────────────────────────────────────────────────
// Reachable only by hash: ...#calcom#abtest is variant A (Inter), ...#calcom#abtest=b is
// variant B (Cal Sans VF at AB_CALSANS_AXES). It exists to produce two clean captures --
// the sidebar is hidden and the hash, not any persisted font or axis state, decides what
// renders. The hash is read as a raw string: it is not one well-formed fragment.
export const AB_CALSANS_AXES = { opsz: 'auto', GEOM: 25, wght: 400, YTAS: 720, SHRP: 0, ital: 0 }
const abVariantFromHash = h => !/abtest/.test(h) ? null : /abtest=b/.test(h) ? 'b' : 'a'
const abFragmentFromHash = h => (h.match(/#abtest(=b)?/) || [''])[0]
// The first '#…' token is the mode; anything after it (the abtest fragment) is not.
const modeFragment = h => '#' + (h.split('#').filter(Boolean)[0] || '')

// The axes rail starts opsz on `auto`, not on the font's fvar default. Every style
// preset here already does -- PARA_STYLE_DEFAULTS, the calcom rows, the Tailwind scale
// all set opsz:'auto' -- so the rail was the one place that pinned it, and a pinned
// opsz stops the browser deriving optical size from font-size. On Cal Sans that also
// freezes the avar2 YTAS cross-map, which only moves across opsz 8-14, so small text
// silently lost the ascender shift it is supposed to pick up. Every other axis keeps
// its shipped default.
// Axis names come from the font. The REGISTERED ones ship sentence case -- opsz is
// "Optical size" in the spec and in Cal Sans -- while this family's custom axes are
// title case ("Geometric Form", "Ascender Height"), so one row in the rail read as if
// someone else had typed it. Capitalise each word for display only, leaving the rest of
// each word as authored so acronyms and the font's own spelling survive. Not an
// override map: this app proofs arbitrary fonts, and what a font calls its own axis is
// its business.
const titleCaseAxis = name => String(name).replace(/\b[a-z]/g, c => c.toUpperCase())

function axisDefaults(axes) {
  const out = {}
  axes.forEach(a => { out[a.tag] = a.tag === 'opsz' ? 'auto' : a.defaultVal })
  return out
}

function resolveInitialMode(isCalcom) {
  if (isCalcom && abVariantFromHash(window.location.hash)) return 'calcom'
  const fromHash = HASH_TO_MODE[modeFragment(window.location.hash)]
  if (fromHash === 'calcom' || fromHash === 'coss') return isCalcom ? fromHash : 'paragraph'
  return fromHash ?? 'paragraph'
}

// ── Font fuzzy matching ──────────────────────────────────────────────────────
/* Cal Sans comes from the SUBMODULE, not from a copy in src/fonts. shared/ IS
   wm-primitives, and deploy.yml already advances its pointer on every
   `primitive-updated` dispatch -- so the face follows the bump with no sync step and
   no second file to go stale. src/fonts/CalSansVF.ttf was that second file: it sat at
   2.000 while the package shipped 2.001, because nothing pushes into src/fonts and
   bump-font.yml only fires on that path. */
import calSansUrl from '../shared/fonts/CalSansVF.ttf?url'
import calSansFlexUrl from '../shared/fonts/CalSansFlexVF.ttf?url'

const fontModules = import.meta.glob('/src/fonts/*.{ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' })

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

// ── Special built-in fonts (UI fonts, not from src/fonts/) ───────────────────
const SPECIAL_FONTS = {
  calsans: { name: 'CalSans', file: 'CalSansVF.ttf', url: calSansUrl },
  calsansflex: { name: 'CalSans Flex', file: 'CalSansFlexVF.ttf', url: calSansFlexUrl },
  switzerland2038: { name: 'Switzerland 2038', file: 'Switzerland2038-500.ttf' },
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
// A static family ships one file per weight×slant (e.g. Foo-BoldItalic.ttf).
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
// Sizes, weights and tracking are cal.com/peer's computed values (Sept 2026 capture in
// references/), not approximations: host 14/600, title 20/600, desc 16/400, meta 14/500,
// weekday 12/500 at 1.2px tracking, day 14, slot 14/500. Desc is 14, not 16: the
// first pass measured its wrapper.
const DEFAULT_CALCOM_ROLES = {
  eventHost:  { size: 14, tracking: 0,      leading: 1.4286, axisOverrides: { wght: 600 } },
  eventTitle: { size: 20, tracking: 0,      leading: 1.4,  axisOverrides: { wght: 600, opsz: 'auto', GEOM: 50 } },
  eventDesc:  { size: 14, tracking: 0,      leading: 1.4286, axisOverrides: {} },
  eventMeta:  { size: 14, tracking: 0,      leading: 1.4286, axisOverrides: { wght: 500 } },
  calHeader:  { size: 12, tracking: 0.1,    leading: 1.33, axisOverrides: { wght: 500 } },
  calDay:     { size: 14, tracking: 0,      leading: 1.4286, axisOverrides: {} },
  timeSlot:   { size: 14, tracking: 0,      leading: 1,    axisOverrides: { wght: 500 } },
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
// global control, mirroring how axisOverrides inherit axisValues. `face` is the same
// rule for the font itself: null draws in the active face, a face id draws in that one.
const DEFAULT_PARA_STYLES = {
  // size / leading / tracking / align / swissRag / hyphenate come from the primitive
  // (wm-primitives PARA_STYLE_DEFAULTS) -- both paragraph views show the same four
  // styles with the same numbers. What is added here is what this app draws with: the
  // family's axes, and the weight/italic/ssXX that scope to a style.
  h1: { ...PARA_STYLE_DEFAULTS.h1, axisOverrides: { wght: 700, opsz: 'auto' }, face: null, weight: null, italic: null, ss04: null, ss05: null },
  h2: { ...PARA_STYLE_DEFAULTS.h2, axisOverrides: { wght: 400, opsz: 'auto' }, face: null, weight: null, italic: null, ss04: null, ss05: null },
  h3: { ...PARA_STYLE_DEFAULTS.h3, axisOverrides: { opsz: 'auto' }, face: null, weight: null, italic: null, ss04: null, ss05: null },
  p:  { ...PARA_STYLE_DEFAULTS.p,  axisOverrides: { opsz: 'auto' }, face: null, weight: null, italic: null, ss04: null, ss05: null },
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

/* Is this face italic, by its own account: OS/2 fsSelection bit 0, head.macStyle bit 1,
   or a non-zero post.italicAngle. Any one says yes. The filename is not consulted --
   a pair is a pair because the fonts say so, not because someone named them well. */
function readItalicFlag(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    const off = {}
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      off[String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))] = data.getUint32(r + 8)
    }
    if (off['OS/2'] && (data.getUint16(off['OS/2'] + 62) & 1)) return true
    if (off.head && (data.getUint16(off.head + 44) & 2)) return true
    if (off.post && data.getInt32(off.post + 4) !== 0) return true
  } catch {}
  return false
}

// The sfnt table directory as {tag: offset}. woff/woff2 compress it, so they read as empty:
// a woff2 has no family, no fvar and no weight here, and so is its own static face.
function fontTableOffsets(buffer, fontOffset = 0) {
  const off = {}
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      off[String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))] = data.getUint32(r + 8)
    }
  } catch {}
  return off
}

/* The optical size a font declares for itself, in points: OS/2 version 5's lower and upper
   (stored in twips). Null when the font says nothing -- an older OS/2, or an upper of
   0xFFFF, which is the spec's "no limit" and so no evidence of a display cut. */
function readOpticalPoints(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const os2 = fontTableOffsets(buffer, fontOffset)['OS/2']
    if (os2 && data.getUint16(os2) >= 5) {
      const lo = data.getUint16(os2 + 96), hi = data.getUint16(os2 + 98)
      if (hi !== 0xFFFF) return [lo / 20, hi / 20]
    }
  } catch {}
  return null
}

const WEIGHT_CLASS_OF_WORD = { thin: 100, extralight: 200, ultralight: 200, light: 300, book: 400, regular: 400, normal: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900 }
const WEIGHT_WORD_OF_CLASS = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }

/* usWeightClass from OS/2; when a font has no OS/2 (or a nonsense value), the weight word
   in its style name (ID 17, else 2) through the same word list the bundled families use. */
function readWeightClass(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const os2 = fontTableOffsets(buffer, fontOffset)['OS/2']
    if (os2) {
      const w = data.getUint16(os2 + 4)
      if (w >= 1 && w <= 1000) return w
    }
    const name = readNameString(buffer, [17, 2], fontOffset)
    if (name) return WEIGHT_CLASS_OF_WORD[parseWeightSlant(name.replace(/\s+/g, '')).weight.toLowerCase()] ?? 400
  } catch {}
  return 400
}

function readNameString(buffer, ids, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const nameOff = fontTableOffsets(buffer, fontOffset).name
    if (!nameOff) return null
    const count = data.getUint16(nameOff + 2)
    const base = nameOff + data.getUint16(nameOff + 4)
    for (const id of ids) {
      for (let i = 0; i < count; i++) {
        const r = nameOff + 6 + i * 12
        if (data.getUint16(r + 6) !== id) continue
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

// ── Faces ────────────────────────────────────────────────────────────────────
// What loading a font reads out of it, with nothing set: the virtual module's answer
// first (it covers every format, woff2 included), else a parse of the TTF/OTF inline.
// A woff/woff2 upload has no axes here and blocks glyph matching.
const parseAxes = async (file) => {
  let chars = null
  // Try virtual module first (covers all font formats including woff2)
  const known = fontAxesData[file.name]
  if (known) return { axes: known.axes, instances: known.instances, chars: known.chars ?? null, glyphMatchUnavailable: false }
  // Fallback: parse TTF/OTF inline (woff2 will return empty)
  try {
    const buffer = await file.arrayBuffer()
    const data = new DataView(buffer)
    const sig = data.getUint32(0)
    if (sig === 0x774F4646 || sig === 0x774F4632) return { axes: [], instances: [], chars: null, glyphMatchUnavailable: true }
    chars = parseCmapRanges(buffer)
    const numTables = data.getUint16(4)
    let fvarOffset = 0, nameOffset = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
      if (t === 'fvar') fvarOffset = data.getUint32(12+i*16+8)
      if (t === 'name') nameOffset = data.getUint32(12+i*16+8)
    }
    if (!fvarOffset) return { axes: [], instances: [], chars, glyphMatchUnavailable: false }
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
    // A row is named from the font's own name table; a bare tag falls through the cached
    // registry (fifty-odd axes, src/axisRegistry.json) before it is shown as itself.
    const registryName = tag => AXIS_REGISTRY.axes[tag]?.name
    const axOff=data.getUint16(fvarOffset+4), axCnt=data.getUint16(fvarOffset+8), axSz=data.getUint16(fvarOffset+10)
    const instCnt=data.getUint16(fvarOffset+12), instSz=data.getUint16(fvarOffset+14)
    const tags=[], axes=[]
    for (let i=0; i<axCnt; i++) {
      const o=fvarOffset+axOff+i*axSz, tag=String.fromCharCode(data.getUint8(o),data.getUint8(o+1),data.getUint8(o+2),data.getUint8(o+3))
      tags.push(tag)
      axes.push({ tag, name: getStr(data.getUint16(o+18)) || registryName(tag) || tag, min: data.getInt32(o+4)/65536, max: data.getInt32(o+12)/65536, defaultVal: data.getInt32(o+8)/65536 })
    }
    const instStart=fvarOffset+axOff+axCnt*axSz, instances=[]
    for (let i=0; i<instCnt; i++) {
      const o=instStart+i*instSz, name=getStr(data.getUint16(o))
      if (!name) continue
      const coords={}; tags.forEach((t,j) => { coords[t]=data.getInt32(o+4+j*4)/65536 })
      instances.push({ name, coordinates: coords })
    }
    return { axes, instances, chars, glyphMatchUnavailable: false }
  } catch { return { axes: [], instances: [], chars, glyphMatchUnavailable: false } }
}

/* A FACE is one family as the proofer holds it: a variable font (its axes, one style, an
   italic companion if there is one) or a static family (no axes, a style per weight, each
   with its italic). Everything dropped at once is sorted into faces by groupFiles, and
   buildFace turns one group into a record without touching any state:
     { id, label, familyLabel, version, cssFamily, fontFace, italicFontFace, axes,
       namedInstances, opticalPoints, supportedRanges, glyphMatchUnavailable, glyphFeatures, kind,
       styles, weightFamilies, ttc, objectUrls, file, italicFile }
   A group is { family, styles: [{ key, label, weightClass, roman, italic }] }; a source
   is a File, or {url, filename} for a bundled font (the route path fetches instead of
   reads). The face's own FontFace/italicFontFace are its default style's. cssFamily is
   unique per face so two faces from one filename never collide in document.fonts. */
let faceSeq = 0
const NO_STYLES = []   // a stable empty list for "no active face / not a family"
async function buildFace(group, { baseName: baseOverride } = {}) {
  const seq = ++faceSeq
  const objectUrls = []
  const open = async (src, allowTTC) => {
    const filename = src instanceof File ? src.name : src.filename
    const buffer = src instanceof File ? await src.arrayBuffer() : await fetch(src.url).then(r => r.arrayBuffer())
    if (allowTTC && new DataView(buffer).getUint32(0) === 0x74746366) {
      const offsets = parseTTCOffsets(buffer)
      const names = offsets.map((off, i) => getFontNameInTTC(buffer, off) || `Font ${i + 1}`)
      const extracted = extractFontFromTTC(buffer, offsets[0])
      const url = URL.createObjectURL(new Blob([extracted], { type: 'font/ttf' }))
      objectUrls.push(url)
      return { src, filename, buffer, offset: offsets[0], fontBuffer: extracted, axesFile: new File([extracted], 'extracted.ttf'), url, ttc: { buffer, offsets, names } }
    }
    let url = src.url
    if (src instanceof File) { url = URL.createObjectURL(src); objectUrls.push(url) }
    return { src, filename, buffer, offset: 0, fontBuffer: buffer, axesFile: src instanceof File ? src : new File([buffer], filename), url, ttc: null }
  }
  try {
    const multi = group.styles.length >= 2
    const defKey = defaultStyleKey(group.styles)
    const defStyle = group.styles.find(s => s.key === defKey)
    const defSrc = defStyle.roman ?? defStyle.italic
    const baseName = baseOverride ?? (multi && group.family ? group.family
      : (defSrc instanceof File ? defSrc.name : defSrc.filename).replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim())
    const cssFamily = `${baseName.replace(/[^a-zA-Z0-9]/g, '')}Preview${seq}` // alphanumeric only: any space/dot/dash makes FontFace.family serialize quoted, which then double-quotes in CSS and gets dropped (e.g. "GeistSerifV0.2-Regular")
    const styles = []
    let def = null   // the default style's reads: what the face's own fields are made from
    for (const st of group.styles) {
      // A style with no roman draws its italic file as its normal face, as a bundled one does.
      const primary = await open(st.roman ?? st.italic, !multi)
      const italicOpen = st.italic ? (st.roman ? await open(st.italic, false) : primary) : null
      const familyName = multi ? `${cssFamily}_${st.key}` : cssFamily
      const fontFace = await new FontFace(familyName, `url(${primary.url})`).load()
      document.fonts.add(fontFace)
      let italicFontFace = null
      if (italicOpen) {
        italicFontFace = await new FontFace(familyName, `url(${italicOpen.url})`, { style: 'italic' }).load()
        document.fonts.add(italicFontFace)
      }
      const style = {
        key: st.key, label: st.label, weightClass: st.weightClass,
        roman: st.roman ? { url: primary.url, file: primary.src instanceof File ? primary.src : null, filename: primary.filename } : null,
        italic: italicOpen ? { url: italicOpen.url, file: italicOpen.src instanceof File ? italicOpen.src : null, filename: italicOpen.filename } : null,
        fontFace, italicFontFace,
        fontName: primary.filename.replace(/\.[^/.]+$/, ''),   // what the header shows for this style
        version: readVersionFromBuffer(primary.buffer, primary.offset),
        familyName,
      }
      styles.push(style)
      if (st.key === defKey) def = { style, primary, italicOpen }
    }
    const { style: ds, primary, italicOpen } = def
    const { axes, instances, chars, glyphMatchUnavailable } = await parseAxes(primary.axesFile)
    // The family each style is registered under, for the per-level weight picker.
    const weightFamilies = multi ? Object.fromEntries(styles.map(s => [s.key, s.familyName])) : {}
    return {
      id: `face${seq}`,
      label: ds.fontName,
      familyLabel: readFamilyNameFromBuffer(primary.buffer, primary.offset) ?? baseName,
      version: ds.version,
      cssFamily,
      fontFace: ds.fontFace,
      italicFontFace: ds.italicFontFace,
      axes, namedInstances: instances,
      opticalPoints: readOpticalPoints(primary.buffer, primary.offset),
      supportedRanges: chars, glyphMatchUnavailable,
      glyphFeatures: {
        roman: gsubFeatureTags(primary.fontBuffer),
        italic: italicOpen ? gsubFeatureTags(italicOpen.fontBuffer) : [],
      },
      kind: axes.length ? 'variable' : 'static',
      styles, weightFamilies,
      ttc: primary.ttc,
      objectUrls,
      file: primary.src instanceof File ? primary.src : null,
      italicFile: italicOpen && italicOpen.src instanceof File ? italicOpen.src : null,
    }
  } catch (err) {
    objectUrls.forEach(u => URL.revokeObjectURL(u))
    throw err
  }
}

/* Of everything dropped or picked at once: one FACE per family, in the order each family
   first appears. A family is read from the fonts themselves (name ID 16, else 1), never
   from filenames; inside it a style is a weight (OS/2 usWeightClass) with its italic
   paired to its roman by readItalicFlag. So a roman/italic pair is just a family with one
   weight, and 64 statics are one face with a weight picker. A variable font is a face of
   its own even beside statics of the same family (it has axes, they do not), and a file
   with no readable family -- a woff2, a ttc -- is a face by itself. Two files of the same
   family, weight and slant are one slot: the later wins, and it says so. */
const groupFiles = async (list) => {
  const files = [...list].filter(f => /\.(ttf|otf|woff2?|ttc)$/i.test(f.name))
  const infos = await Promise.all(files.map(async f => {
    const buf = await f.arrayBuffer()
    return {
      f,
      family: (readFamilyNameFromBuffer(buf) ?? '').replace(/\s+/g, ' ').trim(),
      italic: readItalicFlag(buf),
      variable: 'fvar' in fontTableOffsets(buf),
      weightClass: readWeightClass(buf),
    }
  }))
  const groups = new Map()
  infos.forEach((info, i) => {
    const bucket = info.family ? `${info.family.toLowerCase()}|${info.variable ? 'v' : 's'}` : `#${i}`
    if (!groups.has(bucket)) groups.set(bucket, { family: info.family, slots: new Map() })
    const { slots } = groups.get(bucket)
    const slotKey = info.variable ? 'vf' : info.weightClass
    if (!slots.has(slotKey)) slots.set(slotKey, { weightClass: info.weightClass, roman: null, italic: null })
    const slot = slots.get(slotKey), side = info.italic ? 'italic' : 'roman'
    if (slot[side]) console.info(`font-proofer: ${slot[side].name} and ${info.f.name} are the same family, weight and slant; loading ${info.f.name}`)
    slot[side] = info.f
  })
  return [...groups.values()].map(({ family, slots }) => ({
    family,
    styles: [...slots.values()].sort((a, b) => a.weightClass - b.weightClass).map(sl => {
      const label = WEIGHT_WORD_OF_CLASS[sl.weightClass] ?? String(sl.weightClass)
      return { key: label.toLowerCase(), label, weightClass: sl.weightClass, roman: sl.roman, italic: sl.italic }
    }),
  }))
}

/* Which face draws which ¶ level in a NEW set (a replace of two or more faces; an add never
   asks). A guess, in order of evidence, stopping at the first that splits the set into
   heading faces and text faces: the words in a face's names (Display/Headline/Poster/Title
   against Text/Book/Caption/Body), then the optical size it declares (OS/2 v5, else its
   opsz axis: a top of 36pt or more is a display cut), then weight (one face a clear step --
   200 -- heavier than every other is the heading one; a 400 beside a 500 is no evidence).
   A face the evidence is silent on takes the side the others leave. H1 gets the first
   heading face and H2 the second, or the same one; P and H3 get the first text face.
   Returns { h1, h2, h3, p } of face ids, or null when nothing splits: everything then
   inherits the active face, as it does for a set of one. */
function defaultLevels(faces) {
  const names = f => [f.familyLabel, ...f.styles.map(s => s.fontName)].join(' ')
  const weight = f => f.styles.find(s => s.key === defaultStyleKey(f.styles))?.weightClass ?? 400
  const heaviest = Math.max(...faces.map(weight))
  const clear = faces.filter(f => weight(f) === heaviest).length === 1
    && faces.every(f => weight(f) === heaviest || weight(f) <= heaviest - 200)
  const evidence = [
    f => /display|headline|poster|title/i.test(names(f)) ? 'head' : /text|book|caption|body/i.test(names(f)) ? 'text' : null,
    f => (f.opticalPoints?.[1] ?? f.axes.find(a => a.tag === 'opsz')?.max ?? 0) >= 36 ? 'head' : 'text',
    f => clear ? (weight(f) === heaviest ? 'head' : 'text') : null,
  ]
  for (const kindOf of evidence) {
    const kinds = faces.map(kindOf)
    const rest = kinds.includes('head') && !kinds.includes('text') ? 'text' : kinds.includes('text') && !kinds.includes('head') ? 'head' : null
    const sides = kinds.map(k => k ?? rest)
    if (!sides.includes('head') || !sides.includes('text')) continue
    const heads = faces.filter((f, i) => sides[i] === 'head'), text = faces.find((f, i) => sides[i] === 'text')
    return { h1: heads[0].id, h2: (heads[1] ?? heads[0]).id, h3: text.id, p: text.id }
  }
  return null
}

/* The FACE PALETTE: a tile per face in the set, each a "Rag" set in that face (the g in its
   italic, when it has one -- single storey against double is where an italic differs most),
   and a dim "+" that adds. "Rag" is the styles panel's specimen word: ascender, descender,
   round and diagonal in four characters. It sits in the stage's bottom-right corner the
   way the theme marks sit top right, and it is furniture, not a toolbar: the active face's tile is the one thing in it at full ink, every other tile and
   the "+" sit at the bottom of the ladder until pointed at.
   WHEN IT SHOWS. Two or more faces: always. One face: only while ⌥ is held, which is how
   it is found -- a route's single bundled font looks exactly as it did without it. None:
   nothing. Holding ⌥ also puts a corner mark on every tile but a lone one; the mark removes
   that face. ⌥ pressed WITH another key is a modifier being used (typing é in an edited
   paragraph), not a reach for the palette, so that hides it again.
   The "+" picker has its own input, mounted whether or not the tiles are: with one face
   the palette vanishes the moment ⌥ comes up -- which is when the picker opens -- and an
   input that unmounted with it would never hear what was picked.
   TWO LOOKS, ON TRIAL. `?palette=panel` swaps the strip of small "Rag"s for a column of
   large tiles, each a "Rag" at display size over the face's name, with a "+" tile of the
   same size under them. Same placement, same visibility, same handlers -- only the look
   changes, so the two can be judged side by side. One of them goes once Mark has chosen.
   Read once, here, like the route: it is a look, not state.
   THE COIN (FACES.md, step 3b). A click picks a face and the scope says where it goes; a
   drag says where. Hold a tile still for COIN_HOLD_MS, or drag it past the tap threshold,
   and the tile becomes a COIN under the pointer -- the cursor itself is hidden for the
   flight, the coin is the cursor. The coin is the PICKED tile's pill in flight, whichever
   tile it came off: black with white letters in light, the surface with full ink in dark.
   Pull away and it divides: the tile's ground is drawn in the goo layer at the tile's place
   for the whole flight, so the neck between it and the coin stretches and breaks there, and
   the tile's letters come back once the coin is COIN_NECK away -- the moment the neck has
   gone. Within COIN_REACH of a ¶ block a halo of the same ground appears behind it, the
   block's words invert on it as the picked tile's do, and the goo bridges coin and halo:
   that bridge is the "you will land here". The chrome takes the coin too, told with dotted outlines instead of goo: the ¶
   styles button springs its panel open after COIN_SPRING_MS under the coin, and each of the
   panel's rows takes a drop on its "Rag" (inside the row, nearest wins). Released on a
   block or a row, that level is assigned the face and the coin shrinks into it; anywhere
   else it travels back and merges into its tile, and nothing changed.
   POINTER EVENTS, NEVER AN HTML5 DRAG: the window listens for dragenter/drop to take FILE
   drops, and a native drag would wake that overlay. use-gesture's filterTaps keeps a click
   a click; a hold that lifted the coin eats the click its release would otherwise fire.
   Reduced motion: no goo and no spring -- the coin follows the pointer and is gone on
   release. The coin itself is FaceCoin, below. */
const PALETTE_PANEL = new URLSearchParams(window.location.search).get('palette') === 'panel'
const COIN_HOLD_MS = 250    // still for this long and the tile lifts
const COIN_REACH = 40       // about a tile's width: coin centre to a block's box
const COIN_NECK = 30        // coin centre to its tile's box when the neck breaks (blur 6, both looks)
const COIN_SIZE = 51        // the coin's diameter, --coin-size in App.css
const COIN_SPRING_MS = 300  // under the coin this long and the styles button opens its panel
const coinRect = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })
const insideRect = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
const rectDistance = (r, x, y) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
// The coin's two moves after a release, one frame loop: `at(ms)` gives { value, done }. Only
// motion's spring generator is taken (under 2 kB); its `animate` would bring ~23 kB with it.
const playCoin = (at, onUpdate, onDone) => {
  const t0 = performance.now()
  let id
  const step = (now) => { const { value, done } = at(now - t0); onUpdate(value); if (done) onDone(); else id = requestAnimationFrame(step) }
  id = requestAnimationFrame(step)
  return { stop: () => cancelAnimationFrame(id) }
}
// What the coin at (x, y) would land on, read off the page as it is: an open styles panel's
// row first (it floats over the stage), then the ¶ styles button, then the nearest ¶ block
// within reach -- never a block under the panel. { el, level } | { el, spring } | null.
function coinTarget(x, y) {
  for (const el of document.querySelectorAll('.para-styles-panel [data-level]')) {
    const row = el.closest('.ssd-row')
    if (row && insideRect(row.getBoundingClientRect(), x, y)) return { el, level: el.dataset.level }
  }
  const btn = document.querySelector('[data-coin-spring]')
  if (btn && insideRect(btn.getBoundingClientRect(), x, y)) return { el: btn, spring: true }
  const panel = document.querySelector('.para-styles-panel')
  if (panel && insideRect(panel.getBoundingClientRect(), x, y)) return null
  let best = null
  for (const el of document.querySelectorAll('.preview-paragraph .para-block')) {
    const r = el.getBoundingClientRect()
    const d = rectDistance(r, x, y)
    const level = el.className.match(/\bpara-block--(h1|h2|h3|p)\b/)?.[1]
    if (level && d <= COIN_REACH && (!best || d < best.d)) best = { el, level, d, halo: coinRect(r) }
  }
  return best
}
function FacePalette({ faces, activeFaceId, onPick, onAdd, onRemove, onDropFace, onSpring }) {
  const [alt, setAlt] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => {
    const down = (e) => setAlt(e.key === 'Alt')
    const up = (e) => { if (e.key === 'Alt') setAlt(false) }
    const off = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  // The coin: { face, x, y, home, target, phase: 'drag' | 'home' | 'land', scale, squeeze, reduced }.
  // The ref is the truth the gesture reads; the state is what renders.
  const [coin, setCoin] = useState(null)
  const coinRef = useRef(null)
  const pressRef = useRef(null)    // { el, timer } for the press under way
  const heldRef = useRef(false)    // this press lifted a coin: its click is not a pick
  const springRef = useRef(null)
  const animRef = useRef(null)
  const update = (patch) => { coinRef.current = patch && { ...coinRef.current, ...patch }; setCoin(coinRef.current) }
  const settle = () => { animRef.current?.stop(); animRef.current = null; clearTimeout(springRef.current); springRef.current = null; update(null) }
  useEffect(() => () => { clearTimeout(pressRef.current?.timer); clearTimeout(springRef.current); animRef.current?.stop() }, [])

  const lift = (face, x, y) => {
    clearTimeout(pressRef.current.timer)
    const el = pressRef.current.el
    heldRef.current = true
    update({
      face, x, y, target: null, phase: 'drag', scale: 1, squeeze: 1,
      home: { ...coinRect(el.getBoundingClientRect()), radius: getComputedStyle(el, '::before').borderRadius },
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
  }
  const move = (x, y) => {
    const target = coinTarget(x, y)
    if (target?.spring) springRef.current ??= setTimeout(onSpring, COIN_SPRING_MS)
    else { clearTimeout(springRef.current); springRef.current = null }
    update({ x, y, target })
  }
  const release = () => {
    const c = coinRef.current
    clearTimeout(springRef.current); springRef.current = null
    const level = c.target?.level
    if (level) onDropFace(c.face, level)
    if (c.reduced) { update(null); return }
    if (level) {
      // Landed: the coin (and a block's halo with it) shrinks into the target.
      update({ phase: 'land' })
      animRef.current = playCoin(ms => ({ value: 1 - Math.min(1, ms / 180) ** 2, done: ms >= 180 }), s => update({ scale: s }), settle)
    } else {
      // Missed: back to the tile on a spring, merging into it as it arrives.
      const { x, y, home } = c
      const hx = home.left + home.width / 2, hy = home.top + home.height / 2
      // Its ground narrows to the tile's height on the way, so what merges is the tile's own pill.
      const fit = Math.min(1, home.height / COIN_SIZE)
      update({ phase: 'home', target: null })
      const back = spring({ keyframes: [0, 1], visualDuration: 0.3, bounce: 0.2 })
      animRef.current = playCoin(ms => back.next(ms), t => update({ x: x + (hx - x) * t, y: y + (hy - y) * t, squeeze: 1 - (1 - fit) * t }), settle)
    }
  }
  const press = (face, e) => {
    if (e.button !== 0) return
    if (coinRef.current) settle()
    heldRef.current = false
    clearTimeout(pressRef.current?.timer)
    const el = e.currentTarget, x = e.clientX, y = e.clientY
    pressRef.current = { el, timer: setTimeout(() => { lift(face, x, y); move(x, y) }, COIN_HOLD_MS) }
  }
  const bindDrag = useDrag(({ args: [face], active, last, tap, xy: [x, y] }) => {
    if (tap) {
      // Let go without moving: a plain click, unless the hold already lifted the coin.
      clearTimeout(pressRef.current?.timer)
      if (coinRef.current?.phase === 'drag') release()
      return
    }
    if (active) {
      if (coinRef.current?.phase !== 'drag') lift(face, x, y)
      move(x, y)
    } else if (last && coinRef.current?.phase === 'drag') release()
  }, { filterTaps: true, threshold: 3, pointer: { keys: false } })

  // While a coin flies the cursor is hidden (the coin is the cursor) and, until it is let go,
  // the chrome's targets wear their dotted outlines; the one in reach steps up a rung.
  const flying = !!coin, aiming = coin?.phase === 'drag'
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('face-coin-flying', flying)
    root.classList.toggle('face-coin-aiming', aiming)
    return () => root.classList.remove('face-coin-flying', 'face-coin-aiming')
  }, [flying, aiming])
  // The target in reach is marked on the page itself: a chrome target for its solid outline
  // (until release), a block for lifting its words over its halo (until the coin is gone).
  const reach = coin?.target && (aiming || (coin.phase === 'land' && coin.target.halo)) ? coin.target : null
  const reachEl = reach?.el, reachAttr = reach?.halo ? 'data-coin-halo' : 'data-coin-reach'
  useEffect(() => {
    if (!reachEl) return
    reachEl.setAttribute(reachAttr, '')
    return () => reachEl.removeAttribute(reachAttr)
  }, [reachEl, reachAttr])
  // The tile a coin is off hands its ground to the goo for the whole flight, and its letters
  // to the coin while the two are still one blob.
  const joined = coin && !coin.reduced && rectDistance({ ...coin.home, right: coin.home.left + coin.home.width, bottom: coin.home.top + coin.home.height }, coin.x, coin.y) < COIN_NECK

  const shown = faces.length >= 2 || (faces.length === 1 && alt)
  const removable = alt && faces.length >= 2
  return (
    <div className="face-palette-anchor">
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,.ttc"
        multiple
        style={{ display: 'none' }}
        onChange={e => { const files = [...e.target.files]; e.target.value = ''; onAdd(files) }}
      />
      {/* The goo: blur every ground, then cut the blurred alpha at a steep threshold, so
          grounds that come within a blur of each other bridge and round into one. */}
      <svg className="face-coin-defs" width="0" height="0" aria-hidden="true">
        <filter id="wm-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
        </filter>
      </svg>
      {shown && (
        <div className={`face-palette${PALETTE_PANEL ? ' face-palette--panel' : ''}`} role="toolbar" aria-label="Faces">
          {faces.map(face => {
            const active = face.id === activeFaceId
            const drag = bindDrag(face)
            return (
              <div key={face.id} className="face-tile-slot">
                <button
                  className={`face-tile${active ? ' active' : ''}${coin && !coin.reduced && coin.face.id === face.id ? ` face-tile--source${joined ? ' face-tile--lifted' : ''}` : ''}`}
                  aria-pressed={active}
                  title={face.familyLabel}
                  {...drag}
                  onPointerDown={e => { drag.onPointerDown(e); press(face, e) }}
                  onClick={e => { if (heldRef.current && e.detail > 0) return; onPick(face) }}
                >
                  {/* The letters are a stage: the proofed face's own metrics, not the line's. */}
                  <span className="face-tile-rag" data-nosnap style={{ fontFamily: `"${face.fontFace.family}"` }}>
                    Ra{face.italicFontFace ? <i>g</i> : 'g'}
                  </span>
                  {PALETTE_PANEL && <span className="face-tile-name">{face.familyLabel}</span>}
                </button>
                {removable && (
                  <button className="face-tile-remove wm-icon-btn" aria-label={`Remove ${face.familyLabel}`} title={`Remove ${face.familyLabel}`} onClick={() => onRemove(face)}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            )
          })}
          <button className="face-tile face-tile--add wm-icon-btn" title="Add fonts to the set" onClick={() => inputRef.current?.click()}>
            <Icon name="add" size={PALETTE_PANEL ? 48 : 18} />
          </button>
        </div>
      )}
      {coin && <FaceCoin coin={coin} />}
    </div>
  )
}

/* FaceCoin: the coin in flight, a full-viewport overlay in a portal, in two layers.
   The GOO layer holds GROUNDS only -- the tile's, at its place, for the whole flight; the
   coin's, at the pointer; and a halo behind the ¶ block in reach -- all the PICKED pill's
   ground (ink in light, the surface in dark), opaque and one colour, so the filter melts
   them together. It is stacked over the stage's text and under the palette (App.css): the
   palette goes groundless for the flight so its tiles' letters stand on the goo, and the
   block in reach is lifted over the goo with its words in the pill's letter colour -- white
   on black in light, the "you will land here" the bridge draws.
   The LETTERS layer is above everything, unfiltered: the coin's face, a disc of the same
   ground under the face's "Rag". Anything inside the goo is blurred and thresholded, so text
   there would melt. */
function FaceCoin({ coin }) {
  const { face, x, y, home, target, scale, squeeze, reduced } = coin
  const at = { transform: `translate(${x}px, ${y}px)` }
  return createPortal(
    <>
      <div className={`face-coin-goo${reduced ? ' face-coin-goo--still' : ''}`} aria-hidden="true">
        {!reduced && <div className="face-coin-ground" style={{ left: home.left, top: home.top, width: home.width, height: home.height, borderRadius: home.radius }} />}
        {target?.halo && <div className="face-coin-ground face-coin-halo" style={target.halo} />}
        <div className="face-coin-at" style={at}><div className="face-coin-ground face-coin-disc" style={{ scale: scale * squeeze }} /></div>
      </div>
      <div className="face-coin-top" aria-hidden="true">
        <div className="face-coin-at" style={at}>
          <div className="face-coin-face" style={{ scale, '--coin-squeeze': squeeze, fontFamily: `"${face.fontFace.family}"` }}>
            Ra{face.italicFontFace ? <i>g</i> : 'g'}
          </div>
        </div>
      </div>
    </>,
    document.body,
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
  // ss04/ss05 were the ShopBop (SB Romie) stylistic-set toggles. There is no
  // app-wide UI for stylistic sets or character variants, so nothing exposes
  // these; they stay false and featureStr resolves to no features.
  const [ss04] = useState(false)
  const [ss05] = useState(false)
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
  // The set of faces (see buildFace) and which one is live. The single-font state above
  // and below -- fontFace, variationAxes, familyStyles and the rest -- is the ACTIVE face's
  // projection, written by activateFace; every reader of it stays as it was.
  const [faces, setFaces] = useState([])
  const [activeFaceId, setActiveFaceId] = useState(null)
  const facesRef = useRef([])   // the same set, for the drop handler's append-or-replace
  const fontObjectUrl = useRef(null)   // the active TTC member's URL, which selectTTCFont swaps and revokes
  const ttcBufferRef = useRef(null)
  const ttcOffsetsRef = useRef([])
  const fontFamilyRef = useRef('')

  // View mode
  const [fit, setFit] = useState(FIT_DEFAULTS)   // paragraph line fitting (flattersatz.js)
  // Justify is an ALIGNMENT; Swiss Rag is a rag treatment that rides on any of the
  // other three. Only one fitting mode can be live, so it is derived, never stored.
  const [mode, setMode] = useState(() => resolveInitialMode(isCalcom)) // 'big' | 'paragraph' | 'glyphs' | 'scale' | 'calcom' | 'coss'

  // UI tab: the board fills the whole preview area, so it can pan its top row up under
  // #theme-toggle (fixed, top-right — the only thing that floats over .preview-area here).
  // Measured rather than guessed since the toggle's own size isn't this component's to
  // assume; UiKitBoard uses it to rest row 0 clear of the toggle on load, same as before
  // there was any full-height board to worry about overlapping it.
  const [uiTopInset, setUiTopInset] = useState(0)
  useLayoutEffect(() => {
    if (mode !== 'ui') return
    const el = document.getElementById('theme-toggle')
    if (!el) return
    const measure = () => setUiTopInset(el.getBoundingClientRect().bottom + 16)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode])

  // Cal.com preview state
  const [calcomFont, setCalcomFont] = useState(calcomFontPrimary)
  // A/B screenshot mode. Derived from the hash alone; re-evaluated on hashchange.
  const [abVariant, setAbVariant] = useState(() => isCalcom ? abVariantFromHash(window.location.hash) : null)
  useEffect(() => {
    if (!isCalcom) return
    const onHash = () => {
      const v = abVariantFromHash(window.location.hash)
      setAbVariant(v)
      if (v) setMode('calcom')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [isCalcom])
  // Chrome hiding is scoped off the document root; the variant styles off the preview root.
  useEffect(() => {
    if (abVariant) document.documentElement.dataset.abtest = abVariant
    else delete document.documentElement.dataset.abtest
  }, [abVariant])
  // What the calcom preview renders with: the hash overrides the radio and the sliders.
  const abFont = abVariant === 'a' ? 'inter' : abVariant === 'b' ? 'calsans' : null
  const effCalcomFont = abFont ?? calcomFont
  const effAxisValues = abVariant === 'b' ? AB_CALSANS_AXES : axisValues
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

  // Measure, in PX — the column is a real width and stays put when the type grows, which
  // is the whole proof: you raise the size and watch the measure tighten. An em column
  // does the opposite (it grows with the type, so characters-per-line never moves and
  // the dial has nothing to show) and at large sizes it goes inert entirely — at 57px,
  // every measure past ~16em is wider than the pane and draws the same column.
  // This is the escape bar's job, unchanged, with a dial instead of a drag.
  const [measure, setMeasure] = useState(620)

  // How wide the pane can actually go, so the dial cannot ask for a column that will not
  // fit. 120px is a real floor: narrower than that and no face sets a line.
  const [measureMax, setMeasureMax] = useState(900)
  useEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    const read = () => {
      const w = el.clientWidth
      if (w > 0) setMeasureMax(Math.max(240, Math.round(w - 96)))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-run when the pane appears: on the first mount the ref is still null (or the
    // element is 0-wide), and an effect that only runs then observes nothing at all —
    // which pinned the dial's maximum to its own floor.
  }, [fontFace, mode])

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
  const fitOptsFor = (type) =>
    fitOptionsFor(paraStyles[type] ?? paraStyles.p, { ...FIT_DEFAULTS, ...fit })

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
    // Keep the abtest fragment: it rides after the mode and is not a mode. Keep the query
    // too (?palette=panel), or a reload would quietly drop the look it asked for.
    if (hash) window.history.replaceState(null, null, window.location.pathname + window.location.search + hash + abFragmentFromHash(window.location.hash))
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

  // Static-family weight list: the active face's styles (empty for single/variable fonts).
  // Bundled static families and dropped ones are the same thing once they are a face.
  const activeFace = faces.find(f => f.id === activeFaceId)
  const familyStyles = activeFace?.styles ?? NO_STYLES
  const isFamily = familyStyles.length >= 2
  const currentStyleKey = isFamily ? (activeStyleKey ?? defaultStyleKey(familyStyles)) : null

  // Per-block weight support: every family weight is registered under its own font-family
  // (roman + italic) by buildFace, so different paragraph blocks can show different weights.
  // activateFace hands the active face's map over.
  const [weightFamilies, setWeightFamilies] = useState({}) // { weightKey: cssFamilyName }

  // Picking a weight re-points the global font at that style's own faces and header.
  useEffect(() => {
    if (!isFamily) return
    const st = familyStyles.find(s => s.key === currentStyleKey) ?? familyStyles[0]
    setFontFace(st.fontFace)
    setFontName(st.fontName)
    setFontVersion(st.version)
    setItalicFontFace(st.italicFontFace)
    if (!st.italicFontFace) setIsItalic(false)
  }, [familyStyles, currentStyleKey, isFamily])

  // ── Auto-load font from URL route ──────────────────────────────────────────
  useEffect(() => {
    if (!fontSlug) return

    const special = matchSpecial(fontSlug)
    let matched, italicMatch, routeStyles = []
    if (special?.file) {
      // A `url` on the entry wins: that face is imported directly (see calSansUrl) and
      // so is not in the src/fonts glob at all.
      const entry = special.url ? null : Object.entries(fontModules).find(([path]) => path.endsWith('/' + special.file))
      matched = special.url ? { url: special.url, filename: special.file }
              : entry ? { url: entry[1], filename: special.file } : null
      italicMatch = null
    } else {
      // Static family: every weight is a style of one face (a family has two or more).
      const styles = getFamilyStyles(fontSlug)
      if (styles.length >= 2) routeStyles = styles
      matched = matchFont(fontSlug)
      italicMatch = matchItalicFont(fontSlug)
    }
    if (!matched && !routeStyles.length) return

    const loadRouteFont = async () => {
      // The route's font is built as a face like a dropped one, and replaces the set.
      // Families keep one face across weights: switching style re-points the font
      // (see the style effect above) instead of loading again.
      const group = routeStyles.length
        ? { family: fontSlug, styles: routeStyles.map(st => ({ key: st.key, label: st.label, weightClass: WEIGHT_CLASS_OF_WORD[st.key] ?? 400, roman: st.roman, italic: st.italic })) }
        : { family: null, styles: [{ key: 'regular', label: 'Regular', weightClass: 400, roman: matched, italic: italicMatch }] }
      const face = await buildFace(group, { baseName: special ? special.name : routeStyles.length ? fontSlug : undefined })
      replaceFaces([face])
      activateFace(face)
    }
    loadRouteFont().catch(console.error)
  }, [fontSlug])


  // ── Font loading ───────────────────────────────────────────────────────────
  // Loading a font and showing it are two steps. buildFace (module level) makes the face
  // record and sets nothing; activateFace is the only thing that pushes one into the
  // single-font state, so that state IS the active face. `italicFile` of old is now a
  // style's italic: the Google Fonts pair, Family-VariableFont_….ttf beside
  // Family-Italic-VariableFont_….ttf, joins its roman inside one face (groupFiles), with
  // style:'italic' on the same CSS family as the bundled families' italics.
  const activateFace = useCallback((face) => {
    setActiveFaceId(face.id)
    fontFamilyRef.current = face.cssFamily
    // A TTC is one face whose member can be switched; selectTTCFont writes the single-font
    // state directly rather than through the set, so re-activating a TTC face restarts at member 0.
    ttcBufferRef.current = face.ttc?.buffer ?? null
    ttcOffsetsRef.current = face.ttc?.offsets ?? []
    fontObjectUrl.current = face.ttc ? face.objectUrls[0] : null
    setTtcFonts(face.ttc?.names ?? [])
    setTtcIndex(0)
    setFontFace(face.fontFace)
    setItalicFontFace(face.italicFontFace)
    setFontName(face.label)
    setFontFamilyLabel(face.familyLabel)
    setFontVersion(face.version)
    setVariationAxes(face.axes)
    setNamedInstances(face.namedInstances)
    setSupportedRanges(face.supportedRanges)
    setGlyphMatchUnavailable(face.glyphMatchUnavailable)
    setAxisValues(axisDefaults(face.axes))
    setGlyphFeatures(face.glyphFeatures)
    setWeightFamilies(face.weightFamilies)
    setActiveStyleKey(null)
    setIsItalic(false)
    // A family's own cssFamily is only a prefix; the default style's family is the one drawn.
    autoFitSize(face.fontFace.family)
  }, [autoFitSize])

  const setFaceSet = (next) => { facesRef.current = next; setFaces(next) }
  // A new set: the faces that leave it give back their object URLs.
  const replaceFaces = (next) => {
    const gone = facesRef.current
    setFaceSet(next)
    gone.forEach(f => f.objectUrls.forEach(u => URL.revokeObjectURL(u)))
    if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)
  }
  // Every level's face at once: a map of level -> face id, or nothing to null them all.
  // A global pick and a new set both start from here; only a scoped pick builds on it.
  const setLevelFaces = (ids = {}) =>
    setParaStyles(prev => Object.fromEntries(Object.entries(prev).map(([t, st]) => [t, { ...st, face: ids[t] ?? null }])))
  // Adds are silent: the faces join the set and the active face stays as it is.
  const addFaces = (faceList) => setFaceSet([...facesRef.current, ...faceList])
  // One face leaves the set and gives back its object URLs (its FontFaces stay registered,
  // as a replaced set's do). If it was the active one, the first that remains takes over --
  // and a TTC member switched in by selectTTCFont has a URL of its own to give back too.
  // The last face is never removed: the palette offers no mark on a lone tile.
  const removeFace = (face) => {
    const rest = facesRef.current.filter(f => f !== face)
    if (!rest.length) return
    setFaceSet(rest)
    face.objectUrls.forEach(u => URL.revokeObjectURL(u))
    // A level that drew in this face goes back to inheriting the active one.
    setParaStyles(prev => Object.fromEntries(Object.entries(prev).map(([t, st]) => [t, st.face === face.id ? { ...st, face: null } : st])))
    if (face.id === activeFaceId) {
      if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)
      activateFace(rest[0])
    }
  }

  // Every group of a drop (or pick) becomes a face, in order. The set is replaced and the
  // first face activated -- unless `add` (⌥ held) and a face is already loaded, when they
  // are appended silently. A group that fails to load is logged and skipped.
  const loadFonts = useCallback(async (groups, add = false) => {
    const built = []
    for (const g of groups) {
      try { built.push(await buildFace(g)) } catch (err) { console.error('Font load error', err) }
    }
    if (!built.length) return
    if (add && facesRef.current.length) { addFaces(built); return }
    replaceFaces(built)
    activateFace(built[0])
    // A new set starts with no assignments but the guess, if there is one (never for an add).
    setLevelFaces(built.length >= 2 ? defaultLevels(built) ?? undefined : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateFace])

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
      const { axes, instances, chars, glyphMatchUnavailable } = await parseAxes(new File([extracted], 'extracted.ttf'))
      setVariationAxes(axes)
      setNamedInstances(instances)
      setSupportedRanges(chars)
      setGlyphMatchUnavailable(glyphMatchUnavailable)
      setAxisValues(axisDefaults(axes))
    } catch (err) {
      console.error('TTC font switch error', err)
    }
  }, [])

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    groupFiles(e.dataTransfer.files).then(g => loadFonts(g, e.altKey))
  }, [loadFonts])

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
  // 'auto' is a sentinel, not a value: an axis parked on it is left OUT of
  // font-variation-settings so the browser can supply it. Only opsz uses this
  // (see allowAuto on the slider) — moving the slider writes a number, which
  // lands in the string below and flips font-optical-sizing to 'none'.
  //
  // Worth knowing before "fixing" the auto default: Cal Sans carries an avar
  // version 2 table that cross-maps YTAS off opsz, but only across opsz 8-14.
  // So while opsz is auto, the browser derives it from font-size and small text
  // picks up a YTAS shift that a tool pinning opsz explicitly never sees. It is
  // a default-state, sub-14px edge case, not a general mismatch — measure it
  // before changing anything here.
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
  // The weight picker follows the scope's face too: in ¶ a level assigned to another face
  // lists that face's weights. Anywhere else the scope is the active face, as before.
  const scopedFace = mode === 'paragraph'
    ? (faces.find(f => f.id === paraStyles[styleScope].face) ?? activeFace)
    : activeFace
  const scopedStyles = scopedFace?.styles ?? NO_STYLES
  const scopedIsFamily = scopedStyles.length >= 2
  const scopedWeight = !styleScope ? currentStyleKey
    : scopedFace === activeFace ? (paraStyles[styleScope].weight ?? currentStyleKey)
    : (scopedStyles.find(st => st.key === paraStyles[styleScope].weight)?.key ?? defaultStyleKey(scopedStyles))
  const scopedItalic = styleScope ? (paraStyles[styleScope].italic ?? isItalic) : isItalic
  const setScopedField = (field, value) =>
    setParaStyles(prev => ({ ...prev, [styleScope]: { ...prev[styleScope], [field]: value } }))
  const setScopedWeight = (v) => styleScope ? setScopedField('weight', v) : setActiveStyleKey(v)
  // A tile is "pick a face", and what that means is the scope's call. In ¶ the scope is
  // always a level (P by default), so the face is assigned to it and nothing else moves:
  // not the header, not the sliders, not the active tile. Anywhere else nothing is scoped,
  // so the face becomes THE font and every earlier assignment is cleared with it.
  const pickFace = (face) => {
    if (mode === 'paragraph') { setScopedField('face', face.id); return }
    activateFace(face)
    setLevelFaces()
  }
  const setScopedItalic = (v) => styleScope ? setScopedField('italic', v) : setIsItalic(v)

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
    const calcomFont = effCalcomFont, axisValues = effAxisValues
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const opszAuto = merged['opsz'] === 'auto'
    // The title used to be forced into CalSansBold even in Inter mode, after an older
    // cal.com that set the heading in fontHeading. Peer's page now sets "Meeting" in
    // Inter (font-sans), so the title follows the chosen font like every other role.
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
      // In Inter mode fvs is 'normal', so the role's weight has to ride font-weight or
      // every role renders at 400 -- the title, host, meta and slots are 500-600 on cal.com.
      ...(calcomFont === 'calsans' ? {} : { fontWeight: merged.wght }),
      // Inter runs opsz auto on cal.com (measured: no rule pins it), so it does here too.
      fontOpticalSizing: (calcomFont !== 'calsans' || opszAuto) ? 'auto' : 'none',
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

  // ── Best letters per column ──────────────────────────────────────────────
  // The Size dial's navigable maximum, derived from the column rather than fitted to it.
  // The old rule was `48 + (80 - rightMargin) * 5`, which worked out to roughly "keep 34
  // characters on a line" at the default column — a good target reached by a constant
  // that only held for one typeface. Measure the face's own 'n' instead: the same target
  // then means the same thing in a condensed face and a wide one, and it tracks the
  // axes, because a 700-weight instance sets fewer characters than a 300.
  const TARGET_CHARS = 34

  // Advance of one 'n' at 1px of font-size. Measured off a real element: canvas silently
  // ignores font-variation-settings in Chrome, so a canvas measure would report the
  // default instance no matter where the axes are.
  const [nAdvance, setNAdvance] = useState(0.5)
  useEffect(() => {
    if (!fontFace) return
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.textContent = 'n'.repeat(20)          // 20 of them, so rounding is 1/20th
    Object.assign(probe.style, {
      position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
      fontFamily: `"${fontFace.family}"`, fontSize: '100px',
      fontVariationSettings: fontVariationSettings || 'normal',
      letterSpacing: '0',
    })
    document.body.appendChild(probe)
    const w = probe.getBoundingClientRect().width
    document.body.removeChild(probe)
    if (w > 0) setNAdvance(w / 20 / 100)
  }, [fontFace, fontVariationSettings])

  // Tracking widens every advance, so it belongs in the count.
  const perChar = (size) => size * nAdvance + (paraStyles.p.tracking || 0) * size
  const paraComfortableMax = Math.max(
    18,
    Math.round(measure / (TARGET_CHARS * (nAdvance + (paraStyles.p.tracking || 0)))),
  )
  // What the current column actually holds, for the readout.
  const charsPerLine = Math.max(1, Math.round(measure / perChar(paraStyles.p.size || 16)))

  // Reactively pull p size back under the cap when the column narrows.
  useEffect(() => {
    setParaStyles(prev => (prev.p.size <= paraComfortableMax
      ? prev
      : { ...prev, p: { ...prev.p, size: paraComfortableMax } }))
  }, [paraComfortableMax])

  // The scale's body column is the same measure, so its clamp follows the same number.
  const scaleBaseClampPx = useMemo(() => Math.max(8, measure / 24), [measure])

  // ── Per-block style (paragraph mode) ─────────────────────────────────────
  // What a level reads its font from. The sliders (axisValues, weightFamilies, fontFace)
  // are the active face's, so a level assigned to another face reads that face's record
  // instead: its own axis defaults under the level's overrides, minus any tag the face
  // lacks. (Step 4 makes the sliders follow the scope; until then they only reach the
  // active face.) Inherited, or assigned to the active face itself, it is all as it was.
  const faceReads = (s) => {
    const other = s.face && s.face !== activeFaceId ? faces.find(f => f.id === s.face) : null
    if (!other) return { axes: variationAxes, weightFamilies, fontFace, hasItalic: isFamily || !!italicFontFace, weight: currentStyleKey, axisValues: { ...axisValues, ...s.axisOverrides } }
    const tags = other.axes.map(a => a.tag)
    return {
      axes: other.axes, weightFamilies: other.weightFamilies, fontFace: other.fontFace,
      hasItalic: other.styles.some(st => st.italicFontFace),
      weight: null,
      axisValues: Object.fromEntries(Object.entries({ ...axisDefaults(other.axes), ...s.axisOverrides }).filter(([t]) => tags.includes(t))),
    }
  }

  const blockStyle = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    const r = faceReads(s)
    const merged = r.axisValues
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    // Per-block weight/italic/ss resolve to the block's override, or the global control.
    const weight = s.weight ?? r.weight
    const italic = s.italic ?? isItalic
    const s04 = s.ss04 ?? ss04
    const s05 = s.ss05 ?? ss05
    const family = (weight && r.weightFamilies[weight]) ? `"${r.weightFamilies[weight]}"` : (r.fontFace ? `"${r.fontFace.family}"` : 'serif')
    return {
      fontFamily: family,
      fontStyle: (italic && r.hasItalic) ? 'italic' : 'normal',
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
    const r = faceReads(s)
    const italic = kind === 'italic' ? true : (s.italic ?? isItalic)
    let weight = s.weight ?? r.weight
    const merged = r.axisValues
    if (kind === 'italic') {
      // Variable italic: drive the font's own axis (Cal Sans 'ital', or a 'slnt'
      // slant). Fonts whose italic is a separate face fall through to fontStyle below.
      const italAx = r.axes.find(a => a.tag === 'ital')
      const slntAx = r.axes.find(a => a.tag === 'slnt')
      if (italAx) merged.ital = italAx.max
      else if (slntAx) merged.slnt = slntAx.min
    }
    if (kind === 'bold') {
      const boldKey = Object.keys(r.weightFamilies).find(k => /bold|black|heavy|semibold|700|800|900/i.test(k))
      if (boldKey) weight = boldKey
      else {
        const wghtAx = r.axes.find(a => a.tag === 'wght')
        if (wghtAx) merged.wght = Math.min(wghtAx.max, 700)
      }
    }
    const family = (weight && r.weightFamilies[weight]) ? `"${r.weightFamilies[weight]}"` : (r.fontFace ? `"${r.fontFace.family}"` : 'serif')
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: family,
      fontStyle: (italic && r.hasItalic) ? 'italic' : 'normal',
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
      <ThemeSwitch look="marks" id="theme-toggle" />
      {/* Drop overlay */}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <span className="drop-icon">↓</span>
            <span className="drop-title">Drop your font. Or two.</span>
            <span className="drop-tip">Some variable fonts ship as paired Roman and Italic<br />variable fonts. Drop them both in!</span>
          </div>
        </div>
      )}

      {/* Mobile tab bar */}
      <nav className="mobile-tabs">
        {isCalcom && <button className={`mobile-tab ${mode === 'calcom' ? 'active' : ''}`} onClick={() => setMode('calcom')}><Icon name="calendar_month" /> cal.com/peer</button>}
        {isCalcom && <button className={`mobile-tab ${mode === 'coss' ? 'active' : ''}`} onClick={() => setMode('coss')}><Icon name="calendar_month" /> booking events</button>}
        <button className={`mobile-tab ${mode === 'big' ? 'active' : ''}`} onClick={() => setMode('big')}><Icon name="insert_text" /> Big Word</button>
        <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><Icon name="format_paragraph" /> Paragraph</button>
        <button className={`mobile-tab ${mode === 'ui' ? 'active' : ''}`} onClick={() => setMode('ui')}><Icon name="calendar_month" /> UI</button>
        <button className={`mobile-tab ${mode === 'scale' ? 'active' : ''}`} onClick={() => setMode('scale')}><Icon name="text_fields" /> Type Scale</button>
        <button className={`mobile-tab ${mode === 'glyphs' ? 'active' : ''}`} onClick={() => setMode('glyphs')}><Icon name="grid_view" /> Glyphs</button>
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
              /* The same marks the styles panel and the margin rail use, so a level is
                 named one way everywhere. H1/H2/H3/P as letters was a fourth spelling of
                 the four things, and the odd one out was `P` -- a capital P for a
                 paragraph, where the rest of the app draws a pilcrow. */
              className={`mobile-sub-btn mobile-sub-btn--mark ${effectiveParaStyle === type ? 'active' : ''}`}
              aria-label={type === 'p' ? 'Paragraph' : `Heading ${type[1]}`}
              title={type === 'p' ? 'Paragraph' : `Heading ${type[1]}`}
              onClick={() => setActiveParaStyle(prev => prev === type ? null : type)}
            >
              <Icon name={type === 'p' ? 'format_paragraph' : `format_h${type[1]}`} size={20}
                state={effectiveParaStyle === type ? 'active' : 'rest'} />
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
            ><Icon name="forms_add_on" /></button>
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
        {/* The house Chevron, rotated, not arrow_back_ios_new: a chevron is a chevron
            wherever it appears, and Material's has flat ends, a steeper angle and a 20px
            opsz floor. Material keeps the SYMBOLS -- pilcrow, aligns, reset, theme -- which
            are never asked to be 6px. */}
        <Chevron dir={-1} width={12} height={7}
          className={desktopSidebarOpen ? 'chev-left' : 'chev-right'} />
      </button>
      {!mobileSidebarOpen && (
        <button className="mobile-sidebar-lift-tab" onClick={() => setMobileSidebarOpen(true)}>
          <Icon name="keyboard_arrow_up" />
        </button>
      )}
      <aside className={`sidebar${mobileSidebarOpen ? '' : ' mobile-collapsed'}${desktopSidebarOpen ? '' : ' desktop-collapsed'}`}>
        <button className="mobile-sidebar-handle" onClick={() => setMobileSidebarOpen(false)}>
          <Chevron dir={-1} width={12} height={7} />
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
              multiple
              style={{ display: 'none' }}
              onChange={e => groupFiles(e.target.files).then(loadFonts)}
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
                  <Icon name="calendar_month" /> cal.com/peer
                </ModeBtn>
                {fontName && mode === 'calcom' && (
                  <button
                    ref={calcomPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${calcomPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCalcomPanelOpen(p => !p)}
                  >
                    <Icon name="discover_tune" />
                  </button>
                )}
              </div>
            )}
            {isCalcom && (
              <div className="mode-btn-row">
                <ModeBtn active={mode === 'coss'} onClick={() => setMode('coss')}>
                  <Icon name="calendar_month" /> booking events
                </ModeBtn>
                {fontName && mode === 'coss' && (
                  <button
                    ref={cossPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${cossPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCossPanelOpen(p => !p)}
                  >
                    <Icon name="discover_tune" />
                  </button>
                )}
              </div>
            )}
            <ModeBtn active={mode === 'big'} onClick={() => setMode('big')}>
              <Icon name="insert_text" /> Big Word
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'paragraph'} onClick={() => setMode('paragraph')}>
                <Icon name="format_paragraph" /> Paragraph
              </ModeBtn>
              {fontName && mode === 'paragraph' && (
                <button
                  ref={stylesPanelBtnRef}
                  className={`align-btn styles-toggle-btn ${paraStylesPanelOpen ? 'active' : ''}`}
                  data-coin-spring
                  title="Styles panel"
                  onClick={() => setParaStylesPanelOpen(p => !p)}
                >
                  <Icon name="discover_tune" />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'ui'} onClick={() => setMode('ui')}>
              <Icon name="calendar_month" /> UI
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'scale'} onClick={() => setMode('scale')}>
                <Icon name="text_fields" /> Type Scale
              </ModeBtn>
              {fontName && mode === 'scale' && (
                <button
                  ref={scalePanelBtnRef}
                  className={`align-btn styles-toggle-btn ${scaleStepsPanelOpen ? 'active' : ''}`}
                  title="Scale steps panel"
                  onClick={() => setScaleStepsPanelOpen(p => !p)}
                >
                  <Icon name="discover_tune" />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <Icon name="grid_view" /> Glyphs
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
                  ><Icon name="settings_backup_restore" /></button>
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
          {scopedIsFamily && (
            <span className="wm-select-wrap">
            <select
              className="wm-select"
              value={scopedWeight ?? ''}
              onChange={e => setScopedWeight(e.target.value)}
              title="Style"
            >
              {scopedStyles.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
              {/* The HOUSE chevron, not keyboard_arrow_down: Material's has flat ends and a
      steeper angle than the stepper chevrons beside the numbers, and those are
      the ones that have to be right. See shared/src/Chevron.tsx. */}
  <Chevron dir={-1} width={12} height={7} />
            </span>
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
          {/* The ss04/ss05 stylistic-set toggles lived here — built for ShopBop
              (SB Romie), removed with that font. There is no app-wide UI for
              stylistic sets or character variants, so nothing is exposed here.
              The featureStr/paraStyles ss04/ss05 plumbing is still in place if
              a real one is ever built. */}
          {ttcFonts.length > 1 && (
            <span className="wm-select-wrap">
            <select
              className="wm-select"
              value={ttcIndex}
              onChange={e => selectTTCFont(Number(e.target.value))}
            >
              {ttcFonts.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
              {/* The HOUSE chevron, not keyboard_arrow_down: Material's has flat ends and a
      steeper angle than the stepper chevrons beside the numbers, and those are
      the ones that have to be right. See shared/src/Chevron.tsx. */}
  <Chevron dir={-1} width={12} height={7} />
            </span>
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
              <span className="wm-select-wrap">
              <select
                className="wm-select"
                value={activeInst?.name ?? ''}
                onChange={e => applyInstance(e.target.value)}
              >
                {!activeInst && <option value="" disabled>—</option>}
                {namedInstances.map(inst => (
                  <option key={inst.name} value={inst.name}>{inst.name}</option>
                ))}
              </select>
                {/* The HOUSE chevron, not keyboard_arrow_down: Material's has flat ends and a
      steeper angle than the stepper chevrons beside the numbers, and those are
      the ones that have to be right. See shared/src/Chevron.tsx. */}
  <Chevron dir={-1} width={12} height={7} />
              </span>
            )
          })()}
          {/* Size/Tracking/Leading are per-step in Type Scale, so hide them there */}
          {(mode === 'paragraph' || mode === 'scale') && (
            <SliderRow variant="track"
              label="measure"
              value={measure}
              min={120}
              max={measureMax}
              step={1}
              suffix="px"
              display={measure}
              onChange={setMeasure}
            />
          )}
          {mode !== 'scale' && (<>
          {effectiveParaStyle ? (
            <SliderRow variant="track"
              label="size"
              value={paraStyles[effectiveParaStyle].size}
              min={8}
              max={400}
              step={1}
              lockedAbove={effectiveParaStyle === 'p' ? paraComfortableMax : undefined}
              onChange={v => {
                const capped = effectiveParaStyle === 'p' ? Math.min(v, paraComfortableMax) : v
                setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], size: capped } }))
              }}
            />
          ) : (
            <SliderRow variant="track"
              label="size"
              value={fontSize}
              min={8}
              max={400}
              step={1}
              onChange={setFontSize}
            />
          )}
          {effectiveParaStyle ? (
            <SliderRow variant="track"
              label="tracking"
              value={paraStyles[effectiveParaStyle].tracking}
              min={-0.2}
              max={0.5}
              step={0.001}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], tracking: v } }))}
              display={paraStyles[effectiveParaStyle].tracking.toFixed(3)}
            />
          ) : (
            <SliderRow variant="track"
              label="tracking"
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
            <SliderRow variant="track"
              label="leading"
              value={paraStyles[effectiveParaStyle].leading}
              min={0.6}
              max={3}
              step={0.01}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], leading: v } }))}
              display={paraStyles[effectiveParaStyle].leading.toFixed(2)}
            />
          ) : (
            <SliderRow variant="track"
              label="leading"
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
                    : variationAxes.some(a => axisValues[a.tag] !== axisDefaults(variationAxes)[a.tag])
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
                          // The same defaults the font loaded with (axisDefaults): opsz parked on
                          // 'auto', not the font's own default. Reset used to hand back the fvar
                          // value -- 9 for Cal Sans -- so "reset" pinned an axis the load left free.
                          setAxisValues(axisDefaults(variationAxes))
                        }
                      }}
                    ><Icon name="settings_backup_restore" /></button>
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
                  <SliderRow variant="track"
                    key={axis.tag}
                    label={titleCaseAxis(axis.name)}
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
        <div className="preview-preset-bar wm-chip-row">
          {Object.keys(TEXT_PRESETS).map(k => (
            <button
              key={k}
              className={`wm-chip${activeTextPreset === k ? ' on' : ''}`}
              data-label={k}
              aria-pressed={activeTextPreset === k}
              onClick={() => selectPreset(k)}
            >
              <span>{k}</span>
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
        {/* A tile is "pick a face"; the scope decides what that does (pickFace). A coin
            dragged off a tile names its level itself: the same write as pickFace's in ¶,
            to the level it was dropped on. The ¶ styles button opens under it. */}
        <FacePalette
          faces={faces}
          activeFaceId={activeFaceId}
          onPick={pickFace}
          onAdd={files => groupFiles(files).then(g => loadFonts(g, true))}
          onRemove={removeFace}
          onDropFace={(face, level) => setParaStyles(prev => ({ ...prev, [level]: { ...prev[level], face: face.id } }))}
          onSpring={() => setParaStylesPanelOpen(true)}
        />
        {!fontName && (
          <div className="empty-state">
            <img src={logoGif} alt="Logo" className="empty-logo" />
            <p className="empty-hint">Open a font file to begin proofing</p>
          </div>
        )}

        {mode === 'calcom' && (
          <CalcomPreview key={effCalcomFont} roleStyle={roleStyle} activeRole={activeCalcomRole} onRoleClick={setActiveCalcomRole}
            abVariant={abVariant}
            abVars={abVariant && {
              '--ab-family': abVariant === 'a' ? '"Inter", system-ui, -apple-system, sans-serif' : (fontFace ? `"${fontFace.family}"` : '"CalSans"'),
              // No wght here: weight rides font-weight so the cap, the pill and the toggle
              // carry the same weight in both variants instead of B's being pinned.
              '--ab-fvs': abVariant === 'a' ? 'normal' : Object.entries(AB_CALSANS_AXES).filter(([t, v]) => v !== 'auto' && t !== 'wght').map(([t, v]) => `"${t}" ${v}`).join(', '),
            }} />
        )}

        {mode === 'coss' && (
          <CossPreview key={calcomFont} roleStyle={cossRoleStyle} activeRole={activeCossRole} onRoleClick={setActiveCossRole} />
        )}

        {fontName && mode === 'ui' && (
          /* --ui-font is the HOST's interface face ('Face', Cal Sans) and the board's tabs,
             toggle groups and inputs read it (UiKitBoard.css) -- which is right in ReCal,
             where the board IS the house UI, and wrong here, where the board exists to
             show the uploaded face doing that job. Repointed on the wrapper so every
             word in the board is the specimen; the chrome outside keeps 'Face'. */
          <div className="preview-ui" style={{ '--ui-font': previewStyle.fontFamily }}>
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
                topInset={uiTopInset}
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
          <div className="preview-paragraph" style={{ maxWidth: `${measure}px` }}>
              {blocks.map((block, i) => (
                /* The rail is a SIBLING of the editable element, not a child: anything
                   inside a contentEditable is counted by the caret helpers and is
                   typeable. The wrapper is what the rail is positioned against. */
                <div className="para-block-wrap" key={block.id}>
                {focusedBlockId === block.id && (
                  <BlockStyleRail
                    value={block.type}
                    onChange={k => {
                      setBlocks(prev => prev.map(x => x.id === block.id ? { ...x, type: k } : x))
                      requestAnimationFrame(() => blockRefs.current[block.id]?.focus())
                    }}
                  />
                )}
                <EditableTextBlock
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
                </div>
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
            <div className="preview-scale" style={{ maxWidth: `${measure}px` }}>
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
              ><Icon name="forms_add_on" /></button>
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
                const r = faceReads(s)
                const fvs = Object.entries(r.axisValues).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                // A row assigned to another face says so, first among its chips.
                const own = s.face && s.face !== activeFaceId ? faces.find(f => f.id === s.face) : null
                return {
                  id: type,
                  /* The MARK names the level now -- format_h1/h2/h3, and the same pilcrow
                     the Paragraph preview mode uses -- which frees the label to stop
                     being the words "Heading 1" and become a specimen instead. */
                  icon: type === 'p' ? 'format_paragraph' : `format_h${type[1]}`,
                  /* "Rag" rather than "Heading 1": the mark beside it already says which
                     level this is, so the label is free to be a specimen -- ascender,
                     descender, round and diagonal in four characters.
                     Still CLAMPED to 22px, not set at the style's real size. Real size was
                     tried and taken back: at 57px the h1 row is taller than the other
                     three put together, so the list stops being a list of four choices and
                     becomes one big word with three footnotes. The size is already in the
                     chip, stated exactly; the specimen is here to show the FACE. */
                  /* Wrapped so a face coin can find the row's level (FacePalette). */
                  label: <span data-level={type}>Rag</span>,
                  labelStyle: {
                    fontFamily: r.fontFace ? `"${r.fontFace.family}"` : 'serif',
                    fontStyle,
                    fontSize: `${Math.min(s.size, 22)}px`,
                    fontVariationSettings: fvs,
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    ...(own ? [{ text: own.familyLabel, kind: 'local' }] : []),
                    { text: `${s.size}px`, kind: 'size' },
                    ...Object.entries(s.axisOverrides).map(([tag, val]) => ({
                      text: `${tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                      kind: 'axis',
                    })),
                  ],
                  /* effectiveParaStyle, not activeParaStyle: entering paragraph mode
                     already targets `p` (see the `activeParaStyle ?? 'p'` above), so the
                     panel has to say so. Highlighting the raw state left every row unlit
                     while the sidebar was quietly editing the paragraph -- the controls
                     and the picker disagreed about what was selected, and the picker was
                     the one that was wrong. */
                  selected: effectiveParaStyle === type,
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
function CalcomPreview({ roleStyle, activeRole, onRoleClick, abVariant = null, abVars = null }) {
  const [selectedDate, setSelectedDate] = useState('18')
  const [clock, setClock] = useState('12h')

  // September 2026 as cal.com/peer rendered it (references/): today the 16th, the 18th
  // selected, the first week gone and Mon the 7th left blank, October spilling in to fill
  // the last two rows with an OCT cap on the 1st. Availability is the boxed set from the
  // capture. Keys are strings so October's 1..11 can't collide with September's.
  const AVAIL = new Set(['18','22','23','24','25','28','29','30','o1','o2','o5','o6','o7','o8','o9'])
  const cells = [
    null, '8','9','10','11','12','13',
    '14','15','16','17','18','19','20',
    '21','22','23','24','25','26','27',
    '28','29','30','o1','o2','o3','o4',
    'o5','o6','o7','o8','o9','o10','o11',
  ]
  const label = k => k && k.replace(/^o/, '')

  // Fictional: 9:00am up in five-minute steps, the count the reference column holds.
  const times = Array.from({ length: 32 }, (_, i) => {
    const m = 9 * 60 + i * 5
    const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0')
    return clock === '12h'
      ? `${h > 12 ? h - 12 : h}:${mm}${h >= 12 ? 'pm' : 'am'}`
      : `${String(h).padStart(2, '0')}:${mm}`
  })

  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''

  // cal.com sets available days at 500 and everything else at 300. On a variable font
  // the role's inline font-variation-settings pins wght and beats any CSS font-weight,
  // so the difference has to go into the axis: +100 / -100 off the role's weight.
  // Cal Sans VF bottoms out at 400, so its muted days land at 400 -- the closest the
  // font can get to a 300. Inter's fvs is 'normal', where the CSS weights already apply.
  // Set a role's weight explicitly: through the wght axis in Cal Sans mode (inline fvs
  // beats CSS font-weight there) and through font-weight in Inter mode (fvs is 'normal').
  const withWght = (st, w) => {
    const fvs = st.fontVariationSettings
    if (!fvs || fvs === 'normal') return { ...st, fontWeight: w }
    return { ...st, fontVariationSettings: fvs.replace(/"wght" \d+/, `"wght" ${w}`) }
  }
  const dayStyle = (avail) => {
    const st = roleStyle('calDay')
    // || 400: on first paint the axis values aren't populated yet and this would be NaN.
    const base = Number((st.fontVariationSettings.match(/"wght" (\d+)/) || [])[1] ?? st.fontWeight) || 400
    const w = base + (avail ? 100 : -100)
    // Cal Sans VF bottoms out at 400; Inter has a 300.
    return withWght(st, st.fontVariationSettings === 'normal' ? w : Math.max(400, w))
  }

  return (
    <div className="calcom-page" data-abtest={abVariant ?? undefined} style={abVars ?? undefined}>
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
          <div className="calcom-meta">
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            Requires confirmation
          </div>
          {/* A single duration is plain text on cal.com, not a chip. */}
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            15m
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <img src={calcomIcon} alt="" className="calcom-meta-icon-img" /> Cal Video
          </div>
          {/* The timezone row is the one meta line cal.com sets at 400, not 500. */}
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={withWght(roleStyle('eventMeta'), 400)}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            America/New York
          </div>
          </div>
          </div>{/* end calcom-left-body */}
        </div>

        {/* Calendar panel */}
        <div className="calcom-right">
          <div className="calcom-calendar-wrap">
            <div className="calcom-month-nav">
              <div className="calcom-month-label">
                <strong style={{...roleStyle('calHeader'), fontSize: '16px', letterSpacing: 0, textTransform: 'none'}}>September</strong>
                <span className="calcom-month-year" style={{...roleStyle('calHeader'), fontSize: '16px', letterSpacing: 0, textTransform: 'none'}}>2026</span>
              </div>
              {/* Lucide chevrons at 16px / stroke 2 in 36px buttons, as cal.com; the previous
                  month is disabled (opacity .3) because you cannot book into the past. */}
              <div className="calcom-nav-btns">
                <button className="calcom-nav-btn" disabled aria-label="Previous month">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <button className="calcom-nav-btn" aria-label="Next month">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
            </div>
            <div className="calcom-cal-grid">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className={`calcom-weekday ${roleClass('calHeader')}`} style={roleStyle('calHeader')}
                  onClick={() => onRoleClick(r => r === 'calHeader' ? null : 'calHeader')}>
                  {d}
                </div>
              ))}
              {cells.map((k, i) => (
                <div
                  key={i}
                  className={`calcom-day${k === null ? ' empty' : ''}${AVAIL.has(k) ? ' avail' : ''}${k === '16' ? ' today' : ''}${k === selectedDate ? ' selected' : ''} ${k !== null ? roleClass('calDay') : ''}`}
                  style={k !== null ? dayStyle(AVAIL.has(k)) : {}}
                  onClick={() => {
                    if (AVAIL.has(k)) setSelectedDate(k)
                    onRoleClick(r => r === 'calDay' ? null : 'calDay')
                  }}
                >
                  {k === 'o1' && <span className="calcom-month-cap">Oct</span>}
                  {/* Every October cell carries the rollover, not just the one with the cap. */}
                  {k !== null && k.startsWith('o') && <span className="calcom-tip">October</span>}
                  {label(k)}
                </div>
              ))}
            </div>
          </div>

          {/* Time slots */}
          <div className="calcom-times-wrap">
            <div className="calcom-times-head">
              <div className="calcom-time-date">
                {/* Title-case 16/600 on cal.com (text-emphasis font-semibold), not the
                    uppercase tracked weekday style the column headers use. */}
                <span className="calcom-time-dow" style={withWght({...roleStyle('calHeader'), fontSize: '16px', letterSpacing: 0, textTransform: 'none', lineHeight: 1.5}, 600)}>Fri</span>
                <span className="calcom-time-dnum" style={{...roleStyle('calHeader'), fontSize: '14px', letterSpacing: 0, textTransform: 'none'}}>{label(selectedDate)}th</span>
              </div>
              <div className="calcom-clock-toggle">
                {['12h','24h'].map(c => (
                  <button key={c} className={`calcom-clock-btn ${clock === c ? 'active' : ''}`} onClick={() => setClock(c)}>{c}</button>
                ))}
              </div>
            </div>
            <div className="calcom-time-list">
              {times.map(t => (
                <button
                  key={t}
                  className={`calcom-time-btn ${roleClass('timeSlot')}`}
                  style={roleStyle('timeSlot')}
                  onClick={() => onRoleClick(r => r === 'timeSlot' ? null : 'timeSlot')}
                ><span className="calcom-slot-dot" />{t}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <img src={calcomLogo} alt="Cal.com" className="calcom-footer-logo" />
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
// The theme switch is the primitive now (ThemeSwitch, look="marks"): the three marks
// this file drew, over the shared engine -- one storage key, one attribute, one event.
// Placement (#theme-toggle, top-right) stays in App.css.

// ── Icons ─────────────────────────────────────────────────────────────────────





