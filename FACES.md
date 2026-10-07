# Faces: proofing more than one font at once

Decisions from planning on 2026-10-07. The proofer takes one font today, or a roman plus its
italic. This adds a *set* of faces (a display cut and a text cut, a static beside a
variable, Inter beside Cal Sans) and a way to say which face each style draws with.

## What stays the same

- One font dropped: nothing new appears. Sidebar, drop overlay and dropdowns are unchanged.
- A roman/italic pair still pairs, inside the set.
- Nothing on the rail advertises the feature. It is discovered, told, or preloaded by Mark.
  The one place that tells is the drop overlay, which only exists while someone is already
  dragging: "Drop your font. Or two. Or the whole family." with the tip "Roman and italic
  pair up. A folder of weights becomes one family. Different families get their own tile."
  Nine fonts at once is fine.

## Building a set (three ways, all of them drops)

1. Drop several files at once. Each family becomes a face. (Today only the last file loads.)
2. Hold ⌥ while dropping onto a loaded font: the file is added instead of replacing.
   The same by click: the palette's "+" tile, or ⌥-click on the rail's ↺ button.
3. In ¶ view with H1, H2 or H3 selected: the drop is added *and* assigned to that level.

A plain drop always replaces. ⌥ means "add" everywhere: ⌥-drop, ⌥-click. Overlays, two
plus three: "Drop your font. Or two. Or the whole family." (replace) · "Add to the set"
(⌥) · "Drop → H1 / H2 / H3".

### Adds are silent

Adding a face and using it are two different acts. A multi-file drop, an ⌥-drop, "+" or ⌥-click puts a
tile in the palette and nothing on screen moves — P being the default scope in ¶ view does
not count as asking for the new face there. Using a face is always a tile click. The one
exception is the drop that names its effect before you let go: H1–H3 selected, overlay
says "Drop → H2", and the face is assigned there. A new set (a multi-file drop replacing
what was loaded) still gets default levels; that is a new set, not an add.

⌥ is unused everywhere in the app and in wm-primitives (only Shift, ×10 nudges), so it is
free. Drag events carry `altKey`, so ⌥ works mid-drag from Finder (confirm in Chrome and
Safari on the first build that has it).

## A face is a family

Dump in 64 static files and the palette shows four tiles, one per family, with the weights
inside each on the weight dropdown that bundled static families already use. Grouping is
by the font's own name table (family ID 16, else 1), then by weight (OS/2 usWeightClass,
labelled from the style name), with the italic paired to its roman per weight. A
roman/italic pair is a family with one weight. A variable font is a family whose single
entry carries axes. The bundled-route family code and the dropped-family code are one path.

An italic is an attribute of its face, never a tile: the Roman/Italic toggle keeps scoping
per level, and inline *italic* emphasis resolves through the face's own italic. A lone
italic file with no roman is its own face. A tile whose face has an italic sets its g in
italic, "Ra*g*", the letter where an italic differs most -- that is all the UI it needs.

## The palette (bottom right)

A tile per face, set in that face as "Rag" -- the same specimen the ¶ styles panel rows use (ascender, descender, round, diagonal), decided 2026-10-07 -- plus a dim "+" tile. Bottom right of the stage.

- One face loaded: hidden. Hold ⌥ and it appears, one tile and the "+". You still have
  to hold ⌥ to find it; the drop overlay tells you it exists, ⌥ is how you reach it.
- Two or more faces: persistent.
- The "+" opens the file picker; what is picked is ADDED, never a replacement. So does
  ⌥-click on the rail's ↺ upload button. A plain click on ↺ still replaces, and its
  picker takes many files, so picking a folder's worth there builds a set the same as a
  drop does.
- Removing a face: hold ⌥ and the tiles show a corner mark; click it. A plain drop still
  resets everything.

### Clicking a tile is "pick a face"; what that means depends on what is scoped

- Nothing scoped (Big Word, Glyphs, UI with no role): the tile becomes *the* font, and
  that is a reset. Header name, axis sliders, glyph set and EVERY style follow it; any
  per-scope assignment made earlier is cleared. Pick Inter in Big Word, switch to ¶: the
  whole page, every style, is Inter.
- Something scoped (a ¶ level, a scale tier, a Cal.com or booking role): the tile is
  assigned to that scope only. Its dropdown row renders in that face, with a family chip.
  Assignments exist only from scoped picks made after the last global pick.
- Storage is `null = inherit`, the same rule the per-level weight and italic already use;
  a global pick writes the face and nulls every scope.
- In ¶ view P is always the scope, so a tile click there changes the paragraph face.
  That is the expected behaviour.

## The grid, as far as it goes here

The proofer does not adopt the wm-primitives grid: no `.wm-lines` root, no gridSnap, no
`lines` lint on App.css. The stage is the client's font and stays that way. What sits on the
3px line is the chrome: the palette (this work) and the side rail's controls (chips, buttons,
selects at 27px, vertical space in units). Nothing else. Decided 2026-10-07.

### Two looks, undecided until ship

The tiny strip (27px "Rag" tiles in a row) and the panel (220×129 tiles stacked, display
"Rag" over the family name) are both built; `?palette=panel` on the URL shows the panel,
the strip is the default. Neither is deleted until ship. In dark mode the active face's
"Rag" is HDR white in both (icon.css's swatch and gate).

## Dragging a face onto a block (step 3b)

Clicking a tile picks a face and the scope decides where it goes; dragging a tile says where.
Press and hold an "Rag" and it lifts off as a COIN, a circle with the letters in it, and
follows the pointer. Every drop target can take it: each paragraph block (its level takes the
face), later the scale tiers and the role panels. Released on a block, that level is
assigned; released anywhere else, the coin snaps back and nothing changes. The click model
stays; drag is the precise version, and it answers ¶ view's "P is always the scope".

Three beats (Mark, 2026-10-07). CLICK: the tile morphs into the active state, a button-shaped
ground with inverted letters (black/white in light, surface/HDR in dark), in both looks, so
the strip's active tile is a filled pill, not just full ink. HOLD: the circle REPLACES the
cursor; the tile is the coin, one blob under your hand. DRAG AWAY: mitosis -- the blob
divides, the "Rag" button is back in its place and the circle travels as the cursor. Release
on a block assigns and the coin shrinks into it; release elsewhere and the coin travels
back and merges into its tile, reverse mitosis, then the cursor returns.

The chrome is a target too, and it says so with DOTTED LINES, not goo (Mark, 2026-10-07).
While a coin is in flight the ¶ styles button gets a dotted outline; hover the coin on it
and the panel springs open. Each row's "Rag" in the open panel gets a dotted outline; drop
on a row and that level takes the face, and the row's "Rag" re-renders in it -- the replace
made visible. Goo is for the stage blocks only; dotted is for chrome. So the targets in ¶
view are the blocks (goo halo), the styles button (dotted, spring-opens) and the panel rows
(dotted, assign).

The look is GOOEY. The coin stretches off its tile with a neck that breaks, and within reach
of a target the two edges bridge and round into each other -- the metaball bridge IS the
"you are about to land here", not a highlight. SVG goo filter (blur, then an alpha contrast
step) over one layer holding only GROUNDS: the tile's, the coin's, the target's halo. The
"Rag" and the block's words sit above it unfiltered, since anything inside the goo blurs.
Reach is about a tile's width: inside it the bridge forms and release assigns. Pointer
events (`@use-gesture/react` is already a dependency), never an HTML5 drag, so the
file-drop overlay does not wake. `prefers-reduced-motion`: the coin still moves, the goo
and the spring go. Decided 2026-10-07; built after step 3.

## Phones: a drawer, not a floating palette

At the mobile breakpoint (≤768px) the stage is short and a floating palette sits on the
last line of text, so the palette becomes a side drawer on the right edge. Collapsed, a
5px slice of the TILES peeks from the edge -- the first sliver of each "Rag", not a blank
handle -- so the sliver already says what is in there: that is the whole hint, no label, no
coachmark. Pulled open, it is a column of tiles 51px high (17 units; 50 was the first
number, 51 is the one on the line, and both clear the 44px touch floor) with the "Rag" at
display size, the same ink ladder as the desktop palette. Tap outside or push it back to
close. It is the first page-level gesture in the app (GESTURES.md promises only the
rail's), so it is built with the drawer's own rules written there. A phone sees two faces
only through a route-declared set, so this is built with step 7, against a real route.
Until then, on a coarse pointer the floating palette hides while a paragraph block is
being edited. Decided 2026-10-07.

## Consequences

- The CalSans / Inter radio in the calcom route goes. Inter is a bundled second face in
  that route's set; the A/B hash locks the global face as it does now.
- Axis sliders show the axes of whichever face the selected scope uses (a static face
  shows its weight picker instead). Two faces that both have `wght` are never merged into
  one slider — their ranges differ.
- Default levels for a multi-file drop, in order of evidence: style-name words
  (Display/Headline/Poster/Title → H1/H2; Text/Book/Caption → P/H3), then the declared
  optical-size range, then weight. No match: first face everywhere.
- `routes.config.js` can declare a set and its level mapping, so a client link opens
  already arranged.

## Build order

1. Faces model: generalise `pairFiles` so a drop sorts into faces (each with its italic).
   A single file or a pair behaves exactly as now.
2. Palette: tiles + "+", persistent at two faces, ⌥ reveals at one.
3. Scoped assignment: face per ¶ level in the StyleScopeDropdown rows; default levels.
   3b. The coin: drag a tile onto a block, gooey.
4. Axis panel follows the scoped face.
5. The overlay copy, the "Add to the set" and "Drop → H1/H2/H3" overlays, ⌥-drop, ⌥-click on ↺.
6. Scale tiers, Cal.com and booking roles; retire the CalSans/Inter radio.
7. Route-declared sets.

Steps 1–3 are enough to try it.
