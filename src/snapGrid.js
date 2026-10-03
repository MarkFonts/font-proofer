import gridSnapSrc from '../shared/src/gridSnap.js?raw'

/* THE HOUSE GRID's snapper (wm-primitives gridSnap.js) puts each chrome text block's first
   baseline on the 3px line after layout.

   It is a PLAIN SCRIPT (GRID.md: <script src defer>) and has to be loaded as one:
   `import '../shared/src/gridSnap.js'` builds and then ships nothing, because wm-primitives'
   package.json says "sideEffects": ["*.css"] and Rollup drops a side-effect-only import of a
   .js file -- window.wmGridSnap never exists. ?raw inlines its source and a script element runs it,
   synchronously, before React renders.

   And it cannot know when React changes a layout: it reruns on load, on fonts.ready and when
   #root resizes, and #root is the viewport. A mode switch, an opened font or a face that
   arrives after fonts.ready leaves it holding old positions. So the app tells it: on mount,
   after the state changes that re-lay-out the chrome, and whenever a font finishes loading --
   now, and once more after the 300ms layout transitions have settled. */
const run = () => window.wmGridSnap?.()
export function snapGrid() {
  run()
  setTimeout(run, 400)
}
export function loadGridSnap() {
  if (document.querySelector('script[data-wm-gridsnap]')) return
  const s = document.createElement('script')
  s.textContent = gridSnapSrc
  s.dataset.wmGridsnap = ''
  document.head.appendChild(s)
  snapGrid()
  document.fonts?.addEventListener?.('loadingdone', () => snapGrid())
}
