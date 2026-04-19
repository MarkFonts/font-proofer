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
const SAMPLE_PARAGRAPH = `Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing, and letter-spacing, as well as adjusting the space between pairs of letters.

The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process. Type design is a closely related craft, sometimes considered part of typography.`

const GLYPH_SETS = {
  'Uppercase': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'Lowercase': 'abcdefghijklmnopqrstuvwxyz',
  'Numerals': '0123456789',
  'Punctuation': '.,;:!?\'"-()[]{}/@#$%^&*+=<>\\|`~',
  'Accents': 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
}

// ── Slider row component ─────────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step, onChange, display }) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span className="slider-label-text">{label}</span>
        <input
          type="number"
          value={display ?? value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(parseFloat(e.target.value))}
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
  const [isDragging, setIsDragging] = useState(false)
  const fontObjectUrl = useRef(null)

  // View mode
  const [mode, setMode] = useState('big') // 'big' | 'paragraph' | 'glyphs'

  // Text content
  const [bigText, setBigText] = useState(SAMPLE_BIG)
  const [paragraphText, setParagraphText] = useState(SAMPLE_PARAGRAPH)

  // Typography controls
  const [fontSize, setFontSize] = useState(120)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.1)

  // Alignment
  const [textAlign, setTextAlign] = useState('left')

  // Glyph set selection
  const [activeGlyphSet, setActiveGlyphSet] = useState('Uppercase')

  const fileInputRef = useRef(null)
  const previewAreaRef = useRef(null)

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
      const res = await fetch(matched.url)
      const buffer = await res.arrayBuffer()
      const axes = parseVariationAxes(buffer)
      setVariationAxes(axes)
      const defaults = {}
      axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
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

  const detectAxes = async (file, fontFamilyName) => {
    try {
      const buffer = await file.arrayBuffer()
      const axes = parseVariationAxes(buffer)
      setVariationAxes(axes)
      const defaults = {}
      axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
    } catch (e) {
      setVariationAxes([])
      setAxisValues({})
    }
  }

  // Minimal fvar table parser
  const parseVariationAxes = (buffer) => {
    try {
      const data = new DataView(buffer)

      // Read SFNT header
      const numTables = data.getUint16(4)
      let fvarOffset = 0

      for (let i = 0; i < numTables; i++) {
        const tag = String.fromCharCode(
          data.getUint8(12 + i * 16),
          data.getUint8(13 + i * 16),
          data.getUint8(14 + i * 16),
          data.getUint8(15 + i * 16),
        )
        if (tag === 'fvar') {
          fvarOffset = data.getUint32(12 + i * 16 + 8)
          break
        }
      }

      if (!fvarOffset) return []

      const axisArrayOffset = data.getUint16(fvarOffset + 4)
      const axisCount = data.getUint16(fvarOffset + 8)
      const axisSize = data.getUint16(fvarOffset + 10)

      const axes = []
      for (let i = 0; i < axisCount; i++) {
        const off = fvarOffset + axisArrayOffset + i * axisSize
        const tag = String.fromCharCode(
          data.getUint8(off),
          data.getUint8(off + 1),
          data.getUint8(off + 2),
          data.getUint8(off + 3),
        )
        const minVal = data.getInt32(off + 4) / 65536
        const defaultVal = data.getInt32(off + 8) / 65536
        const maxVal = data.getInt32(off + 12) / 65536

        const tagLabels = {
          wght: 'Weight',
          wdth: 'Width',
          ital: 'Italic',
          slnt: 'Slant',
          opsz: 'Optical Size',
          GRAD: 'Grade',
          XHGT: 'X-Height',
          YOPQ: 'Y Opacity',
          YTUC: 'Uppercase Height',
          YTLC: 'Lowercase Height',
        }

        axes.push({
          tag,
          name: tagLabels[tag] || tag,
          min: minVal,
          max: maxVal,
          defaultVal,
        })
      }
      return axes
    } catch {
      return []
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

  // ── Paragraph font size is smaller ────────────────────────────────────────
  const paragraphStyle = {
    ...previewStyle,
    fontSize: `${Math.min(fontSize, 48)}px`,
  }

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
        <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><ParaIcon /> Paragraph</button>
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
            <ModeBtn active={mode === 'paragraph'} onClick={() => setMode('paragraph')}>
              <ParaIcon /> Paragraph
            </ModeBtn>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Typography controls */}
        <div className="sidebar-section">
          <div className="typography-header">
            <div className="section-label">Typography</div>
            <div className="align-group">
              {(() => {
                const axisDefaults = {}
                variationAxes.forEach(a => { axisDefaults[a.tag] = a.defaultVal })
                const isDirty =
                  fontSize !== 200 ||
                  letterSpacing !== 0 ||
                  lineHeight !== 1.1 ||
                  textAlign !== 'left' ||
                  variationAxes.some(a => axisValues[a.tag] !== a.defaultVal)
                return (
                  <button
                    className={`align-btn ${isDirty ? '' : 'reset-clean'}`}
                    title="Reset settings"
                    style={isDirty ? {} : { pointerEvents: 'none' }}
                    onClick={() => {
                      setFontSize(200)
                      setLetterSpacing(0)
                      setLineHeight(1.1)
                      setTextAlign('left')
                      setAxisValues(axisDefaults)
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
          <SliderRow
            label="Size"
            value={fontSize}
            min={8}
            max={400}
            step={1}
            onChange={setFontSize}
          />
          <SliderRow
            label="Tracking"
            value={letterSpacing}
            min={-0.2}
            max={0.5}
            step={0.001}
            onChange={setLetterSpacing}
            display={letterSpacing.toFixed(3)}
          />
          <SliderRow
            label="Leading"
            value={lineHeight}
            min={0.6}
            max={3}
            step={0.01}
            onChange={setLineHeight}
            display={lineHeight.toFixed(2)}
          />
        </div>

        {/* Variable font axes */}
        {variationAxes.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Variable Axes</div>
              {variationAxes.map(axis => (
                <SliderRow
                  key={axis.tag}
                  label={axis.name}
                  value={axisValues[axis.tag] ?? axis.defaultVal}
                  min={axis.min}
                  max={axis.max}
                  step={(axis.max - axis.min) > 10 ? 1 : 0.01}
                  onChange={v => setAxisValues(prev => ({ ...prev, [axis.tag]: v }))}
                  display={Math.round((axisValues[axis.tag] ?? axis.defaultVal))}
                />
              ))}
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
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="editable-big"
              style={previewStyle}
              onInput={e => setBigText(e.currentTarget.textContent)}
            >
              {bigText}
            </div>
          </div>
        )}

        {fontName && mode === 'paragraph' && (
          <div className="preview-paragraph">
            <div
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="editable-paragraph"
              style={paragraphStyle}
              onInput={e => setParagraphText(e.currentTarget.textContent)}
            >
              {paragraphText}
            </div>
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
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" aria-hidden="true" style={{flexShrink:0}} viewBox="0 0 20 20">
      <path d="M10.386 2.51A7.5 7.5 0 1 1 5.499 4H3a.5.5 0 0 1 0-1h3.5a.5.5 0 0 1 .49.402L7 3.5V7a.5.5 0 0 1-1 0V4.879a6.5 6.5 0 1 0 4.335-1.37L10 3.5l-.1-.01a.5.5 0 0 1 .1-.99z"/>
    </svg>
  )
}
