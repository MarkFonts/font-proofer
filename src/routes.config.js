// Known font routes — add an entry whenever a new client/font URL is deployed.
// Used at build time to generate per-route index.html files with og:image meta tags.
// og:image will be served from /font-proofer/og/[fontSlug].png
// An entry may also declare the set its link opens with (FACES.md, "a client route declares
// its set"); the OG build reads only the two slugs.
//   faces:   extra faces, { key, file, italic?, previews? } -- files in src/fonts; `previews`
//            lists the modes the face is in the set for, unlisted = everywhere
//   palette: { [mode]: 'panel' | 'strip' }, the palette's look per preview; unlisted = strip
//   levels:  { h1?, h2?, h3?, p? } face keys (the route's own font is its fontSlug), set on load
export default [
  { clientSlug: 'claudetype', fontSlug: 'ernest' },
  { clientSlug: 'weltkern', fontSlug: 'kloten'       },
  { clientSlug: 'weltkern', fontSlug: 'lausannemono' },
  { clientSlug: 'weltkern', fontSlug: 'paquis'       },
  { clientSlug: 'calcom',   fontSlug: 'calsans',
    faces:   [{ key: 'inter', file: 'InterVariable.woff2', italic: 'InterVariable-Italic.woff2',
                previews: ['calcom', 'coss'] }],
    palette: { calcom: 'panel', coss: 'panel' } },
  { clientSlug: 'calcom',   fontSlug: 'calsansflex'    },
  { clientSlug: 'weltkern', fontSlug: 'switzerland2038' },
  { clientSlug: 'vercel',   fontSlug: 'geist'     },
  { clientSlug: 'vercel',   fontSlug: 'geistserif' },
]
