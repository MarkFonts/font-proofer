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
- A [GitHub](https://github.com) account
- A [Vercel](https://vercel.com) account (free)

---

## Step 1 — Create a GitHub Repo

1. Go to https://github.com/new
2. Name it `font-proofer` (or anything you like)
3. Set to **Public** or **Private** — both work with Vercel free tier
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

## Step 3 — Deploy to Vercel

### Option A — Vercel CLI (fastest)
```bash
npm i -g vercel
vercel
# Follow prompts — accept defaults
# Your site will be live at: https://font-proofer-xxxx.vercel.app
```

### Option B — Vercel Dashboard
1. Go to https://vercel.com/new
2. Click **Import Git Repository**
3. Select your `font-proofer` repo
4. Leave all settings as default (Vite is auto-detected)
5. Click **Deploy**

Your site will be live in ~30 seconds.

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

Any `git push` to `main` automatically re-deploys via Vercel.

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
