// Known font routes — add an entry whenever a new client/font URL is deployed.
// Used at build time to generate per-route index.html files with og:image meta tags.
// og:image will be served from /font-proofer/og/[fontSlug].png
export default [
  { clientSlug: 'claude',   fontSlug: 'ernest'    },
  { clientSlug: 'weltkern', fontSlug: 'kloten'       },
  { clientSlug: 'weltkern', fontSlug: 'lausannemono' },
  { clientSlug: 'weltkern', fontSlug: 'paquis'       },
  { clientSlug: 'calcom',   fontSlug: 'calsans'   },
  { clientSlug: 'calcom',   fontSlug: 'calsansflex'    },
  { clientSlug: 'weltkern', fontSlug: 'switzerland2038' },
  { clientSlug: 'vercel',   fontSlug: 'geist'     },
]
