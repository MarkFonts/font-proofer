# Vision

A minimal, opinionated font proofing tool for sending to clients.

The premise is simple: a typeface designer finishes a build, drops a font file into the project, pushes to GitHub, and sends a link. The client opens it in a browser and sees the font — no install, no account, no friction.

---

## What it is

A single-page app for proofing a specific font with a specific client in mind. Not a general-purpose type tester. Not a specimen generator. A quiet, focused tool that gets out of the way and lets the typeface speak.

Three modes cover the range of how type actually gets evaluated:

- **Big Word** — for evaluating spacing, rhythm, and character at display sizes
- **Paragraph** — for reading color, density, and texture at text sizes  
- **Glyphs** — for checking coverage and individual character design

Controls are kept to what matters: size, tracking, leading, alignment, and variable axes. Nothing else.

---

## What it is not

- Not a font management tool
- Not a web font generator
- Not a specimen builder with export
- Not a replacement for desktop proofing

---

## Design principles

**Dark by default.** The interface recedes. `#242424` background, white text. The font is the only thing with visual weight.

**One font at a time.** Each deployment is for one client, one font. The designer controls what the client sees by embedding the font before pushing.

**No data leaves the browser.** Fonts loaded by the client stay local. Nothing is uploaded or tracked.

**Typography controls only.** Size, tracking, leading, alignment. Variable axes when present, auto-detected from the font binary. No color pickers, no OpenType feature panels, no animation tools.

**Editable preview text.** Clients can type their own words directly into the preview — this is often the most useful thing.

---

## Stack

React + Vite. Deployed on Vercel free tier. Source on GitHub. No backend, no database, no auth.
