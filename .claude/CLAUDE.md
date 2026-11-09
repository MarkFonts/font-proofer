# Wordproof (repo: font-proofer)

Live at https://wordproof.app (Cloudflare Pages project `wordproof`). **Merging to `main` deploys.** The full deploy story, the PWA rules, and the client-font rules are in DEPLOY.md, imported below. Read it before changing `vite.config.js`, `.github/workflows/deploy.yml`, `index.html`, or `src/routes.config.js`.

The rules most often broken:
- Plain `npm run build` stays at `/font-proofer/`. wm-primitives' tests serve it there and gate every primitive dispatch (`calbuild --bump`). Production is `WORDPROOF_BASE=/ npm run build`.
- Client fonts are never cached offline (`OFFLINE_FONTS`) and client routes are `noindex` (`INDEXED_FONTS`). Both are deny-by-default allowlists.
- Each font route has its own manifest. Client folders like `/calcom/` have none.
- Never handle the `CLOUDFLARE_API_TOKEN` value. Never rename the repo.

@../DEPLOY.md
