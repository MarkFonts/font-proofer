// Known font routes — add an entry whenever a new client/font URL is deployed.
// Used at build time to generate per-route index.html files with og:image meta tags.
// og:image will be served from /og/[fontSlug].png
// An entry may also declare the set its link opens with (FACES.md, "a client route declares
// its set"); the OG build reads only the two slugs.
//   files:   the route's own font by file name, when its slug would also match siblings
//            (Harvey Serif Text Beta 14 beside Text Beta): a static family, its weights and
//            their italics, grouped by the trailing style word (-Regular, -MediumItalic)
//   faces:   extra faces, { key, file, italic?, files?, label?, previews? } -- files in
//            src/fonts; `files` in place of file/italic is a static family as above, one
//            face; `label` names a face whose name table is empty or unreadable (a woff2);
//            `previews` lists the modes the face is in the set for, unlisted = everywhere
//   palette: { [mode]: 'panel' | 'strip' }, the palette's look per preview; unlisted = strip
//   levels:  { h1?, h2?, h3?, p? } face keys (the route's own font is its fontSlug), set on load
//   roles:   { [role]: faceKey }, the same for the client's preview roles (Vercel's, Harvey's)
export default [
  { clientSlug: 'claudetype', fontSlug: 'ernest' },
  // Aileron (Sora Sagano, CC0, 2014) joined into a variable font from its three masters;
  // opsz only adds spacing (+40 units at 8, none at 32). The URL is /wordmark/aileronVF.
  { clientSlug: 'wordmark', fontSlug: 'aileronvf' },
  // Spectral (Production Type, OFL) joined into a roman and an italic variable font from its
  // three masters per style, wght 200-800. A work in progress, named "Spectral VF" for now;
  // the files are in shared/fonts (wm-primitives). Not indexed until it is released.
  { clientSlug: 'wordmark', fontSlug: 'spectralvf' },
  { clientSlug: 'weltkern', fontSlug: 'kloten'       },
  { clientSlug: 'weltkern', fontSlug: 'lausannemono' },
  { clientSlug: 'weltkern', fontSlug: 'paquis'       },
  { clientSlug: 'calcom',   fontSlug: 'calsans',
    faces:   [{ key: 'inter', file: 'InterVariable.woff2', italic: 'InterVariable-Italic.woff2',
                previews: ['calcom', 'coss'] }],
    palette: { calcom: 'panel', coss: 'panel' } },
  { clientSlug: 'calcom',   fontSlug: 'calsansflex'    },
  { clientSlug: 'weltkern', fontSlug: 'switzerland2038' },
  { clientSlug: 'vercel',   fontSlug: 'geist',
    faces:   [{ key: 'geist-mono', file: 'GeistMono[wght].woff2', italic: 'GeistMono-Italic[wght].woff2' }],
    palette: { vercelNew: 'panel', vercelDocs: 'panel', vercelMarket: 'panel' },
    roles:   { code: 'geist-mono' } },
  { clientSlug: 'vercel',   fontSlug: 'geistserif' },
  { clientSlug: 'harvey',   fontSlug: 'harveyserif',
    files:   ['Regular', 'Italic', 'Medium', 'MediumItalic', 'Bold', 'BoldItalic'].map(w => `HarveySerifTextBeta14-${w}.ttf`),
    // The Thread UI preview and the two client faces only it uses (the UI sans, the serif
    // shipped today) are not here: they ship encrypted (src/locked/harvey.bin,
    // scripts/lock-preview.mjs) and join the set when it is opened.
    // strip, not panel: big tiles covered a quarter of the thread (?palette=panel to see it)
    palette: { harvey: 'strip' } },
]
