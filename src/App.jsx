import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import logoGif from '/public/logo.gif'

// ── URL route parsing ────────────────────────────────────────────────────────
const BASE = '/font-proofer'
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
  const [clientSlug, fontSlug] = segments
  return { clientSlug: clientSlug || null, fontSlug: fontSlug || null }
}

function toDisplayName(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ── Font fuzzy matching ──────────────────────────────────────────────────────
const fontModules = import.meta.glob('/src/fonts/*.{ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' })

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

// ── Special built-in fonts (UI fonts, not from src/fonts/) ───────────────────
const CALSANSUI_AXES = [
  { tag: 'opsz', name: 'Optical Size',min: 10,  max: 10.1, defaultVal: 10  },
  { tag: 'wght', name: 'Weight',      min: 400, max: 700,  defaultVal: 400 },
  { tag: 'GEOM', name: 'Geometric Formality', min: 0, max: 100, defaultVal: 0 },
  { tag: 'YTAS', name: 'Y Ascender',  min: 720, max: 800,  defaultVal: 720 },
  { tag: 'SHRP', name: 'Sharpness',   min: 0,   max: 100,  defaultVal: 0   },
]

const SPECIAL_FONTS = {
  calsansui: { family: 'CalSansUI', name: 'CalSansUI', axes: CALSANSUI_AXES },
  calsans:   { family: 'CalSansUI', name: 'Cal Sans (UI)', axes: CALSANSUI_AXES },
}

function matchSpecial(slug) {
  return SPECIAL_FONTS[slug.toLowerCase().replace(/[-_\s]/g, '')] || null
}

function matchFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  if (!entries.length) return null
  const match = entries.find(([path]) => {
    const name = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return name.includes(needle) || needle.includes(name)
  })
  return match ? { url: match[1], filename: match[0].split('/').pop() } : null
}

// ── Sample content ──────────────────────────────────────────────────────────
const SAMPLE_BIG = 'Hand gloves'
const SAMPLE_BLOCKS = [
  { id: '1', type: 'h1', text: 'Hand gloves' },
  { id: '2', type: 'p',  text: 'Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing, and letter-spacing, as well as adjusting the space between pairs of letters.' },
  { id: '3', type: 'p',  text: 'The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process. Type design is a closely related craft, sometimes considered part of typography.' },
]

// ── Paragraph style model ────────────────────────────────────────────────────
const DEFAULT_PARA_STYLES = {
  h1: { size: 57, leading: 1.1, tracking: 0,     axisOverrides: { wght: 700 } },
  h2: { size: 32, leading: 1.2, tracking: 0,     axisOverrides: { wght: 400 } },
  h3: { size: 22, leading: 1.3, tracking: 0,     axisOverrides: {} },
  p:  { size: 18, leading: 1.6, tracking: 0,     axisOverrides: {} },
}

// ── Cursor utilities ─────────────────────────────────────────────────────────
function placeCursorAtEnd(el) {
  const range = document.createRange()
  const sel = window.getSelection()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCursorAtStart(el) {
  const range = document.createRange()
  const sel = window.getSelection()
  range.setStart(el, 0)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function caretAtStart(el) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length === 0
}

const GLYPH_SETS = {
  'Uppercase': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'Lowercase': 'abcdefghijklmnopqrstuvwxyz',
  'Numerals': '0123456789',
  'Punctuation': '.,;:!?\'"-()[]{}/@#$%^&*+=<>\\|`~',
  'Accents': 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
}

// ── Slider row component ─────────────────────────────────────────────────────
function SliderRow({ label, tag, value, min, max, step, onChange, display }) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span className="slider-label-left">
          <span className={`slider-label-text${tag ? ' slider-label-text--tagged' : ''}`}>{label}</span>
          {tag && <span className="slider-tag">{tag}</span>}
        </span>
        <input
          className="slider-number"
          type="text"
          inputMode="numeric"
          value={display != null ? String(display).replace('-', '−') : value}
          onChange={e => onChange(parseFloat(String(e.target.value).replace('−', '-')))}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

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

  // Font loading
  const [fontName, setFontName] = useState(null)
  const [fontFace, setFontFace] = useState(null)
  const [variationAxes, setVariationAxes] = useState([]) // [{tag, name, min, max, defaultVal}]
  const [axisValues, setAxisValues] = useState({})
  const [namedInstances, setNamedInstances] = useState([]) // [{name, coordinates: {tag: value}}]
  const [isDragging, setIsDragging] = useState(false)
  const fontObjectUrl = useRef(null)

  // View mode
  const [mode, setMode] = useState('big') // 'big' | 'paragraph' | 'glyphs'

  // Text content
  const [bigText, setBigText] = useState(SAMPLE_BIG)
  const [blocks, setBlocks] = useState(SAMPLE_BLOCKS)
  const [paraStyles, setParaStyles] = useState(DEFAULT_PARA_STYLES)

  // Paragraph styles panel
  const [paraStylesPanelOpen, setParaStylesPanelOpen] = useState(false)
  const [activeParaStyle, setActiveParaStyle] = useState(null)

  // Paragraph escape bar (right margin, px)
  const [rightMargin, setRightMargin] = useState(80)
  const rightMarginRef = useRef(80)
  useEffect(() => { rightMarginRef.current = rightMargin }, [rightMargin])

  // Typography controls
  const [fontSize, setFontSize] = useState(200)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.1)

  // Alignment
  const [textAlign, setTextAlign] = useState('left')

  // Glyph set selection
  const [activeGlyphSet, setActiveGlyphSet] = useState('Uppercase')

  const fileInputRef = useRef(null)
  const previewAreaRef = useRef(null)
  const bigEditorRef = useRef(null)
  const blockRefs = useRef({})
  const stylesPanelBtnRef = useRef(null)
  const mobileStylesBtnRef = useRef(null)
  const stylesPanelPopoverRef = useRef(null)

  const bigEditorCallback = useCallback(el => {
    bigEditorRef.current = el
    if (el && !el.textContent) el.textContent = SAMPLE_BIG
  }, [])

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

  // ── Auto-load font from URL route ──────────────────────────────────────────
  useEffect(() => {
    if (!fontSlug) return

    // Special built-in fonts — resolve to a real file via matchFont
    const special = matchSpecial(fontSlug)
    const resolvedSlug = special ? 'calsansui' : fontSlug

    const matched = matchFont(resolvedSlug)
    if (!matched) return
    const loadRouteFont = async () => {
      const name = `ProoferFont_${Date.now()}`
      const face = new FontFace(name, `url(${matched.url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(matched.filename.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)
      if (special) {
        setVariationAxes(special.axes)
        setNamedInstances([])
        const defaults = {}
        special.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      } else {
        const res = await fetch(matched.url)
        const buffer = await res.arrayBuffer()
        const { axes, instances } = parseVariationAxes(buffer)
        setVariationAxes(axes)
        setNamedInstances(instances)
        const defaults = {}
        axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      }
    }
    loadRouteFont().catch(console.error)
  }, [fontSlug])

  // ── Font loading ───────────────────────────────────────────────────────────
  const loadFont = useCallback(async (file) => {
    try {
      if (fontObjectUrl.current) {
        URL.revokeObjectURL(fontObjectUrl.current)
      }

      const url = URL.createObjectURL(file)
      fontObjectUrl.current = url

      const name = `ProoferFont_${Date.now()}`
      const face = new FontFace(name, `url(${url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(file.name.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)

      // Try to read variable font axes via opentype.js style
      // We'll use a simple approach: check if font has variation settings
      // by using the font's internal data
      await detectAxes(file, name)
    } catch (err) {
      console.error('Font load error', err)
    }
  }, [])

  const detectAxes = async (file) => {
    try {
      const buffer = await file.arrayBuffer()
      const { axes, instances } = parseVariationAxes(buffer)
      if (axes.length > 0) {
        setVariationAxes(axes)
        setNamedInstances(instances)
        const defaults = {}
        axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
        return
      }
      // woff/woff2 compressed — try to match filename against special fonts
      const normalized = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[-_\s]/g, '')
      const specialEntry = Object.entries(SPECIAL_FONTS).find(([key]) => normalized.includes(key))
      if (specialEntry) {
        const special = specialEntry[1]
        setVariationAxes(special.axes)
        setNamedInstances([])
        const defaults = {}
        special.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      } else {
        setVariationAxes([])
        setNamedInstances([])
        setAxisValues({})
      }
    } catch (e) {
      setVariationAxes([])
      setNamedInstances([])
      setAxisValues({})
    }
  }

  // Minimal fvar + name table parser (TTF/OTF only — WOFF/WOFF2 are compressed)
  const parseVariationAxes = (buffer) => {
    const empty = { axes: [], instances: [] }
    try {
      const data = new DataView(buffer)
      const sig = data.getUint32(0)
      // wOFF = 0x774F4646, wOF2 = 0x774F4632
      if (sig === 0x774F4646 || sig === 0x774F4632) return empty
      const numTables = data.getUint16(4)
      let fvarOffset = 0
      let nameOffset = 0

      for (let i = 0; i < numTables; i++) {
        const t = String.fromCharCode(
          data.getUint8(12 + i * 16),
          data.getUint8(13 + i * 16),
          data.getUint8(14 + i * 16),
          data.getUint8(15 + i * 16),
        )
        if (t === 'fvar') fvarOffset = data.getUint32(12 + i * 16 + 8)
        if (t === 'name') nameOffset = data.getUint32(12 + i * 16 + 8)
      }

      if (!fvarOffset) return empty

      // Read a nameID string from the name table (prefers Windows Unicode)
      const getNameString = (nameID) => {
        if (!nameOffset) return null
        const count = data.getUint16(nameOffset + 2)
        const stringBase = nameOffset + data.getUint16(nameOffset + 4)
        let win = null, mac = null
        for (let i = 0; i < count; i++) {
          const r = nameOffset + 6 + i * 12
          const platformID = data.getUint16(r)
          const encodingID = data.getUint16(r + 2)
          const nID = data.getUint16(r + 6)
          const len = data.getUint16(r + 8)
          const strOff = data.getUint16(r + 10)
          if (nID !== nameID) continue
          if (platformID === 3 && encodingID === 1) {
            const chars = []
            for (let j = 0; j < len; j += 2) chars.push(String.fromCharCode(data.getUint16(stringBase + strOff + j)))
            win = chars.join('')
          } else if (platformID === 1 && !mac) {
            const chars = []
            for (let j = 0; j < len; j++) chars.push(String.fromCharCode(data.getUint8(stringBase + strOff + j)))
            mac = chars.join('')
          }
        }
        return win || mac
      }

      const axisArrayOffset = data.getUint16(fvarOffset + 4)
      const axisCount = data.getUint16(fvarOffset + 8)
      const axisSize = data.getUint16(fvarOffset + 10)
      const instanceCount = data.getUint16(fvarOffset + 12)
      const instanceSize = data.getUint16(fvarOffset + 14)

      const tagLabels = {
        wght: 'Weight', wdth: 'Width', ital: 'Italic', slnt: 'Slant',
        opsz: 'Optical Size', GRAD: 'Grade', XHGT: 'X-Height',
        YOPQ: 'Y Opacity', YTUC: 'Uppercase Height', YTLC: 'Lowercase Height',
      }

      const axes = []
      const tags = []
      for (let i = 0; i < axisCount; i++) {
        const off = fvarOffset + axisArrayOffset + i * axisSize
        const tag = String.fromCharCode(
          data.getUint8(off), data.getUint8(off + 1),
          data.getUint8(off + 2), data.getUint8(off + 3),
        )
        const minVal = data.getInt32(off + 4) / 65536
        const defaultVal = data.getInt32(off + 8) / 65536
        const maxVal = data.getInt32(off + 12) / 65536
        const axisNameID = data.getUint16(off + 18)
        const fontName = getNameString(axisNameID)
        const name = fontName || tagLabels[tag] || tag

        tags.push(tag)
        axes.push({ tag, name, min: minVal, max: maxVal, defaultVal })
      }

      const instancesStart = fvarOffset + axisArrayOffset + axisCount * axisSize
      const instances = []
      for (let i = 0; i < instanceCount; i++) {
        const off = instancesStart + i * instanceSize
        const nameID = data.getUint16(off)
        const name = getNameString(nameID)
        if (!name) continue
        const coordinates = {}
        for (let j = 0; j < axisCount; j++) {
          coordinates[tags[j]] = data.getInt32(off + 4 + j * 4) / 65536
        }
        instances.push({ name, coordinates })
      }

      return { axes, instances }
    } catch {
      return empty
    }
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFont(file)
  }, [loadFont])

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)

  useEffect(() => {
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDrop])

  // ── Font variation string ─────────────────────────────────────────────────
  const fontVariationSettings = Object.entries(axisValues)
    .map(([tag, val]) => `"${tag}" ${val}`)
    .join(', ') || 'normal'

  const previewStyle = {
    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
    fontSize: `${fontSize}px`,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: lineHeight,
    fontVariationSettings,
    textAlign,
    color: '#ffffff',
    wordBreak: 'break-word',
    transition: 'font-variation-settings 0.15s ease',
  }

  // ── Active style for sidebar controls in paragraph mode ──────────────────
  // null when not in paragraph mode; falls back to 'p' when panel open but nothing selected
  const effectiveParaStyle = mode === 'paragraph' ? (activeParaStyle ?? 'p') : null

  // ── Paragraph comfortable max (scales 48→400 as escape bar opens 80→10px) ──
  const paraComfortableMax = Math.max(18, Math.round(48 + Math.max(0, 80 - rightMargin) * 5))

  const handleEscapeBarMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startMargin = rightMarginRef.current
    const onMove = (e) => {
      // drag right → smaller margin → wider column → higher max
      const newMargin = Math.max(10, Math.min(80, startMargin - (e.clientX - startX)))
      setRightMargin(newMargin)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Per-block style (paragraph mode) ─────────────────────────────────────
  const blockStyle = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    const merged = { ...axisValues, ...s.axisOverrides }
    const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
      fontSize: `${s.size}px`,
      fontWeight: merged.wght ?? 400,
      letterSpacing: `${s.tracking}em`,
      lineHeight: s.leading,
      fontVariationSettings: fvs,
      textAlign,
      color: '#ffffff',
      wordBreak: 'break-word',
      display: 'block',
      width: '100%',
      minHeight: '1em',
      outline: 'none',
      cursor: 'text',
      transition: 'font-variation-settings 0.15s ease',
    }
  }

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`layout ${isDragging ? 'dragging' : ''}`}
    >
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
        <button className={`mobile-tab ${mode === 'big' ? 'active' : ''}`} onClick={() => setMode('big')}><BigIcon /> Big Word</button>
        <div className="mobile-tab-para">
          <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><ParaIcon /> Paragraph</button>
          {fontName && mode === 'paragraph' && (
            <button
              ref={mobileStylesBtnRef}
              className={`mobile-styles-toggle ${paraStylesPanelOpen ? 'active' : ''}`}
              onClick={() => setParaStylesPanelOpen(p => !p)}
            >
              {paraStylesPanelOpen ? '▼' : '▽'}
            </button>
          )}
        </div>
        <button className={`mobile-tab ${mode === 'glyphs' ? 'active' : ''}`} onClick={() => setMode('glyphs')}><GlyphIcon /> Glyphs</button>
      </nav>

      {/* Sidebar */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <img src={logoGif} alt="Logo" className="logo-gif" />
          {clientLabel && clientSlug !== 'wordmark' && <span className="client-label">{clientLabel}</span>}
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
            <ModeBtn active={mode === 'big'} onClick={() => setMode('big')}>
              <BigIcon /> Big Word
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'paragraph'} onClick={() => setMode('paragraph')}>
                <ParaIcon /> Paragraph
              </ModeBtn>
              {fontName && (
                <button
                  ref={stylesPanelBtnRef}
                  className={`align-btn styles-toggle-btn ${paraStylesPanelOpen ? 'active' : ''}`}
                  title="Styles panel"
                  onClick={() => setParaStylesPanelOpen(p => !p)}
                >
                  {paraStylesPanelOpen ? '▶' : '▷'}
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Typography controls */}
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
            <div className="align-group">
              {(() => {
                const isDirty = effectiveParaStyle
                  ? paraStyles[effectiveParaStyle].size !== DEFAULT_PARA_STYLES[effectiveParaStyle].size ||
                    paraStyles[effectiveParaStyle].tracking !== DEFAULT_PARA_STYLES[effectiveParaStyle].tracking ||
                    paraStyles[effectiveParaStyle].leading !== DEFAULT_PARA_STYLES[effectiveParaStyle].leading
                  : fontSize !== 200 || letterSpacing !== 0 || lineHeight !== 1.1 || textAlign !== 'left'
                return (
                  <button
                    className={`align-btn ${isDirty ? 'active' : 'reset-clean'}`}
                    title="Reset typography"
                    style={isDirty ? {} : { pointerEvents: 'none' }}
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
                    }}
                  ><ResetIcon /></button>
                )
              })()}
              {['left', 'center', 'right'].map(a => (
                <button
                  key={a}
                  className={`align-btn ${textAlign === a ? 'active' : ''}`}
                  onClick={() => setTextAlign(a)}
                  title={`Align ${a}`}
                >
                  {a === 'left' ? <AlignLeftIcon /> : a === 'center' ? <AlignCenterIcon /> : <AlignRightIcon />}
                </button>
              ))}
            </div>
          </div>
          {namedInstances.length > 0 && (
            <div className="instance-chips">
              {namedInstances.map(inst => {
                const active = variationAxes.every(a => {
                  const cur = effectiveParaStyle
                    ? (paraStyles[effectiveParaStyle].axisOverrides[a.tag] ?? axisValues[a.tag] ?? a.defaultVal)
                    : (axisValues[a.tag] ?? a.defaultVal)
                  return cur === inst.coordinates[a.tag]
                })
                return (
                  <button
                    key={inst.name}
                    className={`instance-chip ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...inst.coordinates } }
                        }))
                      } else {
                        setAxisValues({ ...inst.coordinates })
                      }
                    }}
                  >
                    {inst.name}
                  </button>
                )
              })}
            </div>
          )}
          {effectiveParaStyle ? (
            <SliderRow
              label="Size"
              value={Math.min(paraStyles[effectiveParaStyle].size, effectiveParaStyle === 'p' ? paraComfortableMax : 400)}
              min={8}
              max={effectiveParaStyle === 'p' ? paraComfortableMax : 400}
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
        </div>

        {/* Variable font axes */}
        {variationAxes.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="typography-header">
                <div className="section-label">Variable Axes</div>
                {(() => {
                  const axesDirty = effectiveParaStyle
                    ? JSON.stringify(paraStyles[effectiveParaStyle].axisOverrides) !== JSON.stringify(DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides)
                    : variationAxes.some(a => axisValues[a.tag] !== a.defaultVal)
                  return (
                    <button
                      className={`align-btn ${axesDirty ? 'active' : 'reset-clean'}`}
                      title="Reset axes"
                      style={axesDirty ? {} : { pointerEvents: 'none' }}
                      onClick={() => {
                        if (effectiveParaStyle) {
                          setParaStyles(prev => ({
                            ...prev,
                            [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides } }
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
                const val = effectiveParaStyle
                  ? (paraStyles[effectiveParaStyle].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : (axisValues[axis.tag] ?? axis.defaultVal)
                return (
                  <SliderRow
                    key={axis.tag}
                    label={axis.name}
                    tag={axis.tag}
                    value={val}
                    min={axis.min}
                    max={axis.max}
                    step={(axis.max - axis.min) > 10 ? 1 : 0.01}
                    onChange={v => {
                      if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...prev[effectiveParaStyle].axisOverrides, [axis.tag]: v } }
                        }))
                      } else {
                        setAxisValues(prev => ({ ...prev, [axis.tag]: v }))
                      }
                    }}
                    display={Math.round(val)}
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
                {Object.keys(GLYPH_SETS).map(k => (
                  <button
                    key={k}
                    className={`glyph-set-btn ${activeGlyphSet === k ? 'active' : ''}`}
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
          {clientSlug && clientSlug !== 'wordmark'
            ? `\u00A9${new Date().getFullYear()} ${clientLabel}, courtesy of WORDMARK. Please do not distribute without approval and understanding of IP holder.`
            : `\u00A9${new Date().getFullYear()} WORDMARK.`
          }
        </div>
      </aside>

      {/* Main preview area */}
      <main className="preview-area" ref={previewAreaRef}>
        {!fontName && (
          <div className="empty-state">
            <img src={logoGif} alt="Logo" className="empty-logo" />
            <p className="empty-hint">Open a font file to begin proofing</p>
          </div>
        )}

        {fontName && mode === 'big' && (
          <div className="preview-big">
            <div
              ref={bigEditorCallback}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="editable-big"
              style={previewStyle}
              onInput={e => setBigText(e.currentTarget.textContent)}
            />
          </div>
        )}

        {fontName && mode === 'paragraph' && (
          <div className="preview-paragraph" style={{ paddingRight: `${rightMargin}px` }}>
              <div
                className="escape-bar"
                style={{ right: `${rightMargin - 14}px` }}
                onMouseDown={handleEscapeBarMouseDown}
                title="Drag to expand column"
              />
              {blocks.map(block => (
                <div
                  key={block.id}
                  ref={el => {
                    if (el) {
                      blockRefs.current[block.id] = el
                      if (!el.textContent) el.textContent = block.text
                    } else {
                      delete blockRefs.current[block.id]
                    }
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  className={`para-block para-block--${block.type}${activeParaStyle === block.type ? ' para-block--selected' : ''}`}
                  style={blockStyle(block.type)}
                  onInput={e => handleBlockInput(block.id, e)}
                  onKeyDown={e => handleBlockKeyDown(block.id, e)}
                />
              ))}
          </div>
        )}

        {fontName && mode === 'glyphs' && (
          <div className="preview-glyphs">
            <div className="glyphs-grid" style={{
              fontFamily: previewStyle.fontFamily,
              fontVariationSettings,
              fontSize: `${Math.min(fontSize, 120)}px`,
              lineHeight: 1,
              transition: 'font-variation-settings 0.15s ease',
            }}>
              {[...GLYPH_SETS[activeGlyphSet]].map((char, i) => (
                <div key={i} className="glyph-cell">
                  <div className="glyph-char">{char}</div>
                  <div className="glyph-code">U+{char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

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
            {(['h1', 'h2', 'h3', 'p']).map(type => {
              const s = paraStyles[type]
              const isActive = activeParaStyle === type
              const merged = { ...axisValues, ...s.axisOverrides }
              const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
              const label = type === 'p' ? 'Paragraph' : `Heading ${type[1]}`
              return (
                <button
                  key={type}
                  className={`para-styles-row ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveParaStyle(prev => prev === type ? null : type)}
                >
                  <span
                    className="para-styles-preview"
                    style={{
                      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
                      fontSize: `${Math.min(s.size, 22)}px`,
                      fontWeight: merged.wght ?? 400,
                      fontVariationSettings: fvs,
                      lineHeight: 1.3,
                    }}
                  >
                    {label}
                  </span>
                  <span className="para-styles-specs">
                    <span className="para-styles-spec">{s.size}px</span>
                    {variationAxes.map(axis => {
                      const val = s.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      return (
                        <span key={axis.tag} className="para-styles-spec">
                          {axis.tag} {Number.isInteger(val) ? val : val.toFixed(1)}
                        </span>
                      )
                    })}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function BigIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><text x="1" y="12" fontSize="13" fill="currentColor" fontFamily="'CalSansUI', system-ui, sans-serif">A</text></svg>
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
function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="1" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="1" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
    </svg>
  )
}
function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="3" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="2" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
    </svg>
  )
}
function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="5" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="3" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
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
