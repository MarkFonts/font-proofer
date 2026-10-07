# Faces: proofing more than one font at once

Decisions from planning on 2026-10-07. The proofer takes one font today, or a roman plus its
italic. This adds a *set* of faces (a display cut and a text cut, a static beside a
variable, Inter beside Cal Sans) and a way to say which face each style draws with.

## What stays the same

- One font dropped: nothing new appears. Sidebar, drop overlay and dropdowns are unchanged.
- A roman/italic pair still pairs, inside the set.
- Nothing on the rail advertises the feature. It is discovered, told, or preloaded by Mark.

## Building a set (three ways, all of them drops)

1. Drop several files at once. Each becomes a face. (Today only the last file loads.)
2. Hold ⌥ while dropping onto a loaded font: the file is added instead of replacing.
3. In ¶ view with H1, H2 or H3 selected: the drop is added *and* assigned to that level.

Overlays, two plus three: "Drop your font. Or two." (replace) · "Add to the set" (⌥) ·
"Drop → H1 / H2 / H3".

### Adds are silent

Adding a face and using it are two different acts. A multi-file drop or an ⌥-drop puts a
tile in the palette and nothing on screen moves — P being the default scope in ¶ view does
not count as asking for the new face there. Using a face is always a tile click. The one
exception is the drop that names its effect before you let go: H1–H3 selected, overlay
says "Drop → H2", and the face is assigned there. A new set (a multi-file drop replacing
what was loaded) still gets default levels; that is a new set, not an add.

⌥ is unused everywhere in the app and in wm-primitives (only Shift, ×10 nudges), so it is
free. Drag events carry `altKey`, so ⌥ works mid-drag from Finder.

## The palette (bottom right)

A tile per face, set in that face as "Aa", plus a dim "+" tile. Bottom right of the stage.

- Two or more faces: persistent.
- One face: hidden. Holding ⌥ shows it (lone tile plus "+") — the discovery path.
- Removing a face: ⌥ is down when the palette shows, so click a tile's corner. A plain
  drop still resets everything.

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
4. Axis panel follows the scoped face.
5. The three drop overlays and ⌥-drop.
6. Scale tiers, Cal.com and booking roles; retire the CalSans/Inter radio.
7. Route-declared sets.

Steps 1–3 are enough to try it.
