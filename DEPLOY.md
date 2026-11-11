# Deploying Wordproof

Wordproof (this repo, still named `font-proofer`) is live at **https://wordproof.app**, an installable PWA on Cloudflare Pages. This page is the whole deploy story. Read it before touching `vite.config.js`, `.github/workflows/deploy.yml`, `index.html`, or `routes.config.js`.

## How a deploy happens

**Merging to `main` is the deploy.** There is no other step. `deploy.yml` runs on:

- a push to `main` (every merged PR),
- `repository_dispatch: primitive-updated`, which wm-primitives' `consumers.yml` sends after its tests pass. That's how `calbuild --bump` (a Cal Sans release) reaches wordproof.app with no action here.
- `workflow_dispatch`, a manual re-run from the Actions tab.

What the workflow does, in order:

1. Checks out with the `shared/` submodule (wm-primitives), updates it to wm-primitives `main`, and commits the pointer it built (`Bump wm-primitives to … [skip ci]`).
2. `npm ci`, `node shared/scripts/lint-tokens.mjs`, then **`WORDPROOF_BASE=/ npm run build`**.
3. Creates the Pages project `wordproof` if it's missing, then `wrangler pages deploy dist --project-name=wordproof --branch=main`.
4. **Waits until https://wordproof.app serves the bundle this run built** (up to 10 minutes). If it never does, the run fails and nothing else changes.
5. Only then does it rewrite `wordmark.nyc/font-proofer/` in the `MarkFonts/wordmark` repo as forwarders (`scripts/write-forwarders.mjs`), and copy `scripts/wordmark-404.html` to wordmark's `404.html`.

**Check that a deploy is live:** the run's step "wordproof.app serves what this run built" prints `live after ~Ns: assets/index-….js` and the wm-primitives commit. Or compare yourself:

```bash
curl -s https://wordproof.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

## Secrets (repo settings, never in code or chat)

| Secret | What it's for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Account › Cloudflare Pages › Edit. Deploys to the `wordproof` project. Mark creates and rotates it; an agent never handles the value. |
| `WORDMARK_DEPLOY_TOKEN2` | Pushes the forwarders into `MarkFonts/wordmark`. |
| `SLACK_WEBHOOK_<CLIENT>` | Optional, one per client (`SLACK_WEBHOOK_VERCEL`): a Slack incoming webhook for that client's channel. A font shipped with `ship-font.py` is announced there once it's live. No secret, no post. |

The Cloudflare account ID is written into `deploy.yml`; it's an identifier, not a credential.

## Two builds, on purpose

| Command | Base path | PWA | Who uses it |
|---|---|---|---|
| `WORDPROOF_BASE=/ npm run build` | `/` | on | production (wordproof.app) |
| `npm run build` | `/font-proofer/` | off | wm-primitives' tests, local test runs |

**Never change the default `/font-proofer/` base.** wm-primitives' `consumers.yml` builds this repo with a plain `npm run build`, serves `dist/` at `/font-proofer/` (`tests/serve.mjs`), and runs the behaviour tests that gate every `primitive-updated` dispatch. Break that build and `calbuild --bump` stops redeploying Wordproof, ReCal, and wordmarktools. The same goes for the `/font-proofer/` paths in wm-primitives' tests, `FONT_PROOFER_DIST`, and its consumer list: they're wiring, not names.

To look at the production build locally:

```bash
WORDPROOF_BASE=/ npm run build && WORDPROOF_BASE=/ npx vite preview
```

## PWA rules (all in `vite.config.js`)

- **Each font route is its own installable app.** The build writes `/<client>/<font>/manifest.webmanifest` with that route as `id` and `start_url` and the font as the home-screen label. iOS opens a manifest's `start_url`, never the page you were on, so one root manifest would make every install open the empty root.
- **Client folders (`/calcom/`, `/weltkern/`, …) must not have a manifest.** The build gives each one a page with no manifest link and `noindex`.
- **The root** (`/`) uses the root manifest, "Wordproof".
- **`OFFLINE_FONTS`** is deny by default: only open-licensed faces (OFL, plus Material Symbols under Apache) are saved for offline use. Client retail fonts are fetched from the server on every visit and never written to app storage. No font is precached. The pattern must stay a `RegExp`: workbox copies `urlPattern` into `sw.js` as source, and a function would lose the list it closes over.
- **Runtime caches use `ignoreVary`.** The same font arrives from `@font-face` and from `fetch()`, and without it the second lookup misses offline.
- **`skipWaiting` + `clientsClaim`:** a new deploy is live on the next launch of an installed app.
- **No `404.html` in `dist`.** Cloudflare Pages falls back to `index.html` (with a 200) only when there's no 404 page.
- `public/_headers` keeps `sw.js` and the manifests uncached. On wordproof.app the zone's 4-hour browser cache shows on `sw.js`; that's harmless, because browsers fetch the service-worker script fresh regardless.

## Search

- **`INDEXED_FONTS`** is deny by default: the root and the listed open-licensed routes go in `/sitemap.xml`. Every other route page gets `<meta name="robots" content="noindex">`.
- `robots.txt` allows everything. Don't block the client routes there, or Google can't read their `noindex`.

## Adding a client route

1. Put the font in `src/fonts/` and add `{ clientSlug, fontSlug }` to `src/routes.config.js`.
2. It deploys with its own installable app, OG image, and page. It's `noindex` and its font is never cached offline, unless you decide otherwise.
3. Only for an open-licensed face: add its slug to `INDEXED_FONTS`, and its hashed asset stem to `OFFLINE_FONTS` (`[wght]` is written `_wght_`).

## Shipping a new build of a font

A route's link is meant to always show the latest build, so a client never asks which file is current. When a font that's already here has a new export:

```bash
python3 scripts/ship-font.py <new.ttf> <client/font>          # dry run: what changed
python3 scripts/ship-font.py <new.ttf> <client/font> --push   # ships it
```

It diffs the new file against the one on `main` by glyph name (outlines, advance widths, GSUB, GPOS; hinting ignored), then puts the font, `src/fonts/changes/<font>.json` and `font-versions.json` in one commit on `main` through the GitHub API. That commit is the deploy. The JSON drives two things:

- **The badge:** the first visit after a ship shows "New since your last visit: v1.001 → v1.003" in the sidebar footer, with the redrawn glyphs drawn in the font. It's remembered per browser (`wp-seen:<route>` in localStorage). A first-time visitor sees it only for a week after the ship.
- **The Slack post:** `deploy.yml` posts to `SLACK_WEBHOOK_<CLIENT>` after wordproof.app serves the new bundle.

It only replaces fonts the app already has. A new face goes through `npm run font:add`.

## wordmark.nyc

- `wordmark.nyc/font-proofer/…` is forwarders only, rewritten on every deploy. Don't edit them by hand in the wordmark repo; change `scripts/write-forwarders.mjs` or `scripts/wordmark-404.html` here.
- **This repo owns wordmark.nyc's site-wide `404.html`.**
- Never redirect wordproof.app back to wordmark.nyc. It used to 302 there before the move, and doing so now would loop with the forwarders.

## Cloudflare (zone wordproof.app)

- DNS: `wordproof.app` is a CNAME to `wordproof.pages.dev`, set by the Pages custom-domain setup. `www` is a proxied placeholder record.
- Redirect rule "www to wordproof.app": `www.wordproof.app/*` 301s to `https://wordproof.app/*`, keeping the path and query.
- The Pages project is named `wordproof`. Its custom domain is `wordproof.app`.

## Analytics

`index.html` tags Google Analytics stream **Wordproof, `G-DM2JYW1G84`**. wordmark.nyc keeps its own stream, `G-MZ4M1P8P1P`.

## Don't

- Rename the repo or its local folder. About ten scripts in other repos (stemperature, hind-siliguri, vercel, calsans-proofs, framercomponents) use the folder path.
- Change the default `/font-proofer/` base, or the wm-primitives test wiring.
- Merge a PR that changes the deploy without a build of both variants. `npm run build` must show no `sw.js` and paths under `/font-proofer/`. `WORDPROOF_BASE=/ npm run build` must show the manifest, `sw.js`, `sitemap.xml`, and per-route manifests.
