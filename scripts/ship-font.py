#!/usr/bin/env python3
"""Ship a new build of a font that's already on Wordproof, so its pinned link is always current.

    python3 scripts/ship-font.py <new.ttf> <client/font>            # dry run: prints what changed
    python3 scripts/ship-font.py <new.ttf> <client/font> --push     # one commit to main = deploy

Example (Geist Serif, after Scripts/build.py has exported serif21):

    python3 scripts/ship-font.py \
      "~/Dropbox (Personal)/_ClientWork/Vercel/Geist Serif/exports/serif21/GeistSerifVF.ttf" \
      vercel/geistserif --push

What it does:
  1. Fetches the copy wordproof.app is serving now (src/fonts/<same filename> on main).
  2. Diffs the two by glyph name: outlines (glyf + gvar), advance widths, GSUB, GPOS.
     Hinting is ignored, since ttfautohint rewrites it on every build.
  3. Writes src/fonts/changes/<stem>.json, which drives the "new since your last visit"
     badge in the app and the Slack ping in deploy.yml.
  4. With --push: puts the font, that JSON, and font-versions.json in ONE commit on main
     through the GitHub API (no local checkout is touched). deploy.yml then builds, waits
     until wordproof.app serves the new bundle, and posts to Slack.

It only replaces a font the app already has. A new face goes through `npm run font:add`.
Needs: fontTools, and `gh` signed in with push access to MarkFonts/font-proofer.
"""
import argparse, base64, io, json, os, re, subprocess, sys, unicodedata
from datetime import datetime, timezone
from fontTools.ttLib import TTFont

REPO = 'MarkFonts/font-proofer'
BRANCH = 'main'


def gh(*args, data=None, raw=False):
    cmd = ['gh', 'api', *args]
    if data is not None:
        cmd += ['--input', '-']
    r = subprocess.run(cmd, input=json.dumps(data).encode() if data is not None else None,
                       capture_output=True)
    if r.returncode:
        raise SystemExit(f"gh api {' '.join(args)} failed:\n{r.stderr.decode() or r.stdout.decode()}")
    return r.stdout if raw else json.loads(r.stdout or b'null')


def fetch(path):
    """A file's bytes on main, or None if it doesn't exist."""
    r = subprocess.run(['gh', 'api', '-H', 'Accept: application/vnd.github.raw',
                        f'repos/{REPO}/contents/{path}?ref={BRANCH}'], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def version_of(font):
    v = font['name'].getDebugName(5) or ''
    m = re.search(r'(\d+\.\d+)', v)
    return m.group(1) if m else v


def outline(font, name):
    """A glyph's OWN data: its contours, or its component references. A composite whose
    base changed is reported separately (via_components), not as a change of its own."""
    g = font['glyf'][name]
    if g.isComposite():
        own = ('composite', tuple((c.glyphName, c.x, c.y, getattr(c, 'transform', None) and
                                   tuple(map(tuple, c.transform))) for c in g.components))
    elif g.numberOfContours == 0:
        own = ('empty',)
    else:
        own = ('contours', tuple(g.coordinates), tuple(g.endPtsOfContours),
               tuple(f & 1 for f in g.flags))  # on/off-curve bit only; other flag bits are encoding
    var = ()
    if 'gvar' in font and name in font['gvar'].variations:
        var = tuple((tuple(sorted(tv.axes.items())), tuple(tv.coordinates))
                    for tv in font['gvar'].variations[name])
    return own, var


def components_of(font, name):
    g = font['glyf'][name]
    return [c.glyphName for c in g.components] if g.isComposite() else []


def table_bytes(font, tag):
    return font.getTableData(tag) if tag in font else b''


def label(name, cmap_rev):
    """What a person reads: the character itself for an encoded glyph, else the glyph name
    ('a.ss01', 'uni0434.loclBGR')."""
    cp = cmap_rev.get(name)
    if cp is not None and unicodedata.category(chr(cp))[0] in 'LNPS':
        return chr(cp)
    return name


def diff(old, new):
    on, nn = set(old.getGlyphOrder()), set(new.getGlyphOrder())
    common = sorted(on & nn, key=new.getGlyphOrder().index)
    direct = [g for g in common if outline(old, g) != outline(new, g)]
    changed = set(direct)
    # Glyphs that only changed because a component they use did (aacute after /a).
    via, grew = [], True
    while grew:
        grew = False
        for g in common:
            if g not in changed and any(c in changed for c in components_of(new, g)):
                changed.add(g); via.append(g); grew = True
    spacing = [g for g in common
               if old['hmtx'][g][0] != new['hmtx'][g][0]]
    rev = {}
    for cp, n in sorted(new.getBestCmap().items(), reverse=True):
        rev[n] = cp  # lowest code point wins

    def rank(g):
        """Plain letters and figures, then other characters, then accented forms, then
        unencoded alternates: a reader wants 'C g' before 'Ấ Ậ' before 'a.ss02'."""
        cp = rev.get(g)
        if cp is None:
            return 3
        ch = chr(cp)
        if unicodedata.decomposition(ch) and not unicodedata.decomposition(ch).startswith('<'):
            return 2
        return 0 if unicodedata.category(ch)[0] in 'LN' else 1
    direct.sort(key=rank)  # stable: glyph order within each rank
    return {
        'glyphs': [label(g, rev) for g in direct],
        'names': direct,
        'viaComponents': len(via),
        'added': [label(g, rev) for g in sorted(nn - on, key=new.getGlyphOrder().index)],
        'removed': sorted(on - nn),
        'spacing': [label(g, rev) for g in spacing],
        'kerning': table_bytes(old, 'GPOS') != table_bytes(new, 'GPOS'),
        'features': table_bytes(old, 'GSUB') != table_bytes(new, 'GSUB'),
    }


def summary(d):
    parts = []
    if d['glyphs']:
        shown = ' '.join(d['glyphs'][:24]) + (f" +{len(d['glyphs']) - 24} more" if len(d['glyphs']) > 24 else '')
        parts.append(f"{len(d['glyphs'])} glyphs redrawn: {shown}")
    if d['viaComponents']:
        parts.append(f"{d['viaComponents']} more follow through components")
    if d['added']:
        parts.append(f"{len(d['added'])} added: {' '.join(d['added'][:16])}")
    if d['removed']:
        parts.append(f"{len(d['removed'])} removed")
    if d['spacing']:
        parts.append(f"{len(d['spacing'])} advance widths changed")
    if d['kerning']:
        parts.append('kerning changed')
    if d['features']:
        parts.append('features (GSUB) changed')
    return '; '.join(parts) or 'no outline, spacing, kerning or feature changes (hinting or names only)'


def push(files, message):
    """One commit on main holding every file in `files` ({path: bytes}); fast-forward only,
    retried if main moved (deploy.yml commits submodule bumps to main too)."""
    for attempt in range(5):
        head = gh(f'repos/{REPO}/git/ref/heads/{BRANCH}')['object']['sha']
        base_tree = gh(f'repos/{REPO}/git/commits/{head}')['tree']['sha']
        tree = []
        for path, data in files.items():
            blob = gh(f'repos/{REPO}/git/blobs', data={
                'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
            tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        t = gh(f'repos/{REPO}/git/trees', data={'base_tree': base_tree, 'tree': tree})
        c = gh(f'repos/{REPO}/git/commits', data={'message': message, 'tree': t['sha'], 'parents': [head]})
        r = subprocess.run(['gh', 'api', '-X', 'PATCH', f'repos/{REPO}/git/refs/heads/{BRANCH}',
                            '-f', f"sha={c['sha']}", '-F', 'force=false'], capture_output=True)
        if r.returncode == 0:
            return c['sha']
        print(f'main moved (attempt {attempt + 1}), retrying...', file=sys.stderr)
    raise SystemExit('could not fast-forward main after 5 attempts')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('font', help='the new build, e.g. exports/serif21/GeistSerifVF.ttf')
    ap.add_argument('route', help='its Wordproof route, e.g. vercel/geistserif')
    ap.add_argument('--as', dest='target', help='path in the repo (default src/fonts/<same filename>)')
    ap.add_argument('--push', action='store_true', help='commit to main (deploys); without it, a dry run')
    a = ap.parse_args()

    src = os.path.expanduser(a.font)
    new_bytes = open(src, 'rb').read()
    target = a.target or f'src/fonts/{os.path.basename(src)}'
    stem = os.path.splitext(os.path.basename(target))[0]

    routes = (fetch('src/routes.config.js') or b'').decode()
    client, _, font_slug = a.route.strip('/').partition('/')
    if not re.search(rf"clientSlug:\s*'{re.escape(client)}',\s*fontSlug:\s*'{re.escape(font_slug)}'", routes):
        raise SystemExit(f'{a.route} is not in src/routes.config.js on main')

    old_bytes = fetch(target)
    if old_bytes is None:
        raise SystemExit(f'{target} is not on main. A new face goes through `npm run font:add`.')
    if old_bytes == new_bytes:
        print(f'{target} on main is already byte-identical to {src}. Nothing to ship.')
        return

    old, new = TTFont(io.BytesIO(old_bytes)), TTFont(io.BytesIO(new_bytes))
    d = diff(old, new)
    ov, nv = version_of(old), version_of(new)
    print(f'{a.route}: {target}\n  live: version {ov}, {len(old_bytes):,} bytes\n  new:  version {nv}, {len(new_bytes):,} bytes')
    print(f'  {summary(d)}')
    if nv == ov:
        print(f'  WARNING: the version string did not change ({nv}). The badge still works, '
              f'but the sidebar will show the same v{nv}.')

    changes = {
        'file': os.path.basename(target), 'route': f'{client}/{font_slug}',
        'version': nv, 'previous': ov,
        'shipped': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        **d,
    }
    files = {target: new_bytes,
             f'src/fonts/changes/{stem}.json': (json.dumps(changes, ensure_ascii=False, indent=2) + '\n').encode()}

    versions = json.loads((fetch('font-versions.json') or b'{}').decode())
    norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    key = next((k for k in versions if norm(k) == norm(stem)), None)
    if key:
        versions[key] = nv
        files['font-versions.json'] = (json.dumps(versions, indent=2) + '\n').encode()

    glyphs = ' '.join(d['glyphs'][:8]) + (' ...' if len(d['glyphs']) > 8 else '')
    message = f"{key or stem} {nv}" + (f": {glyphs}" if glyphs else '') + \
              f"\n\nShipped by scripts/ship-font.py from {os.path.basename(os.path.dirname(src))}/{os.path.basename(src)}.\n{summary(d)}"
    if not a.push:
        print(f'\nDry run. Would commit to {REPO}@{BRANCH}:\n  ' + '\n  '.join(files) + f'\nmessage: {message.splitlines()[0]}')
        print('Re-run with --push to ship it (merging to main is the deploy).')
        return
    sha = push(files, message)
    print(f'\nPushed {sha[:7]}. Deploy: https://github.com/{REPO}/actions/workflows/deploy.yml')
    print(f'Live in a few minutes at https://wordproof.app/{client}/{font_slug}/')


if __name__ == '__main__':
    main()
