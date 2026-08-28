# Font Proofer

A clean font proofing tool for sharing with clients. Upload a font (including variable fonts), set your controls, and send the link.

## Features

- **3 preview modes**: Big Word, Paragraph, Glyph Set
- **Typography controls**: Font size, letter-spacing (tracking), line-height (leading)
- **Text alignment**: Left, center, right
- **Variable font axes**: Auto-detected and rendered as sliders
- **Drag & drop** font loading
- **Editable text** in Big Word and Paragraph modes
- **Full glyph browsing** with Unicode values

---

## Setup (Local Dev)

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- A [GitHub](https://github.com) account (deploy is automatic via GitHub Actions → GitHub Pages)

---

## Step 1 — Create a GitHub Repo

1. Go to https://github.com/new
2. Name it `font-proofer` (or anything you like)
3. Set to **Public** or **Private**
4. Click **Create repository**

---

## Step 2 — Push this project

```bash
# In the font-proofer folder:
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/font-proofer.git
git push -u origin main
```

---

## Step 3 — Deploy (GitHub Pages, automatic)

Deploy is fully automated via GitHub Actions. On every push to `main`:
- `.github/workflows/deploy.yml` runs `npm run build` and copies `dist/` into the **`wordmark`** repo's `font-proofer/` folder, which GitHub Pages serves (SPA fallback via `404.html`). The site lives under the wordmark Pages site at `/font-proofer/`.
- `.github/workflows/bump-font.yml` watches `src/fonts/*.ttf`: when a versioned font is pushed it renames it to the canonical name and records the version in `font-versions.json`.

So you just push to `main` (Step 2) and the site updates itself in ~a minute.

---

## Step 4 — Load your font before sending the link

Because fonts stay **local in the browser**, you need to embed the font in the build if you want clients to see a specific font without uploading it themselves.

### Option A: Embed font in public folder (simplest)
1. Drop your font file into the `public/` folder, e.g. `public/MyFont.woff2`
2. Edit `src/App.jsx` — find the empty state section and add auto-load logic:

```jsx
// At the top of App(), add this useEffect:
useEffect(() => {
  async function preloadFont() {
    const res = await fetch('/MyFont.woff2')
    const blob = await res.blob()
    const file = new File([blob], 'MyFont.woff2', { type: blob.type })
    loadFont(file)
  }
  preloadFont()
}, [loadFont])
```

3. Rebuild and push — clients open the link and the font is already loaded.

### Option B: Let clients upload
Leave as-is — clients drag & drop their own copy of the font. Good for sending the tool, not a specific specimen.

---

## Updating the site

Any `git push` to `main` automatically rebuilds and re-deploys via the `deploy.yml` GitHub Action (build → push `dist/` to the `wordmark` repo → GitHub Pages).

```bash
git add .
git commit -m "updated font"
git push
```

---

## Local development

```bash
npm install
npm run dev
# Open http://localhost:5173
```

---

## Other fun 🤫
![Cal Graphics](src/testvgs/CalGraphics-top.svg)


![Cal Three Ways](src/testvgs/CalThreeWays.svg)


![Optical Size](src/testvgs/OpticalSize.svg)


![Variable Morph 1](src/testvgs/VariableMorph.svg)


![Variable Morph 2](src/testvgs/VariableMorph2.svg)
