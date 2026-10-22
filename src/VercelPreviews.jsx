// Vercel previews: New Project (the dashboard), Docs and Marketplace (the public site).
// One role set drives all three (VERCEL_ROLE_LABELS in App.jsx), so a role tuned in one
// screen carries into the others, the way Geist is one system across Vercel. Every role's
// element carries data-role and the highlight ring, as in CalcomPreview and CossPreview.
// Names, repos and the account are placeholders: wordmark.nyc is public.
import { useState } from 'react'
import './VercelPreviews.css'

const useRoles = (roleStyle, activeRole, onRoleClick) => (role, cls = '') => ({
  className: `${cls} ${activeRole === role ? 'calcom-role-highlight' : ''}`.trim(),
  style: roleStyle(role),
  'data-role': role,
  onClick: (e) => { e.stopPropagation(); onRoleClick(r => r === role ? null : role) },
})

const Svg = ({ children, size = 16, className = 'v-icon' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
)
const Triangle = ({ size = 22 }) => (
  <svg viewBox="0 0 76 65" width={size} height={size * 65 / 76} aria-hidden="true" className="v-logo"><path d="M37.6 0 75.2 65H0z" fill="currentColor" /></svg>
)
const Chevron = () => <Svg size={14}><path d="m6 9 6 6 6-6" /></Svg>
const SearchIcon = () => <Svg size={15}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
const Lock = () => <Svg size={13}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>

// ── New Project ─────────────────────────────────────────────────────────────
const REPOS = [
  { name: 'geist-proofs', when: '5h ago' },
  { name: 'brand-site', when: '8h ago' },
  { name: 'type-tester', when: '8h ago' },
  { name: 'release-notes', when: '1d ago', locked: true },
  { name: 'docs-starter', when: '3d ago' },
]
const TEMPLATES = [
  { title: 'Build an agent', desc: 'Deploy an agent in a minute on Vercel.' },
  { title: 'Ticket router', desc: 'Route support tickets by context with the AI SDK.' },
  { title: 'Next.js Boilerplate', desc: 'Get started with Next.js and React in seconds.' },
  { title: 'Flask Boilerplate', desc: 'Deploy Python Flask applications with zero configuration.' },
]

export function VercelNewProjectPreview({ roleStyle, activeRole, onRoleClick }) {
  const R = useRoles(roleStyle, activeRole, onRoleClick)
  return (
    <div className="v-shell v-new">
      <header className="v-new-bar">
        <div className="v-new-team">
          <span className="v-team-dot" />
          <span {...R('button')}>ACME</span>
          <Svg size={14}><path d="m8 9 4-4 4 4" /><path d="m16 15-4 4-4-4" /></Svg>
        </div>
        <span {...R('button', 'v-new-bar-title')}>New Project</span>
        <span className="v-avatar" />
      </header>

      <div className="v-new-body">
        <h1 {...R('title', 'v-ink')}>Let’s build something new</h1>
        <div className="v-new-prompt">
          <Svg size={15}><path d="M12 5v14M5 12h14" /></Svg>
          <span {...R('label', 'v-muted')}>Ask v0 to build or enter a Git repository URL…</span>
        </div>
        <div className="v-new-chips">
          {['Contact Form', 'Image Editor', 'Mini Game', 'Finance Calculator'].map(c => (
            <span key={c} className="v-chip"><span {...R('label', 'v-ink')}>{c}</span></span>
          ))}
        </div>
        <p className="v-new-drop"><span {...R('meta', 'v-muted')}>You can also drag and drop your project, or choose a <a>file</a> or a <a>folder</a>.</span></p>

        <div className="v-new-cols">
          <section className="v-new-col">
            <h2 {...R('heading', 'v-ink')}>Import Git Repository</h2>
            <div className="v-new-pickers">
              <span className="v-select">
                <Svg size={15}><circle cx="12" cy="12" r="9" /><path d="M9 19c-3 1-3-1.5-4-2m8 4v-3a3 3 0 0 0-1-2.3c3 0 5-1.7 5-5a4 4 0 0 0-1-2.7 3.6 3.6 0 0 0 0-2.7s-1 0-2.7 1.2a9 9 0 0 0-4.6 0C6 3.3 5 3.3 5 3.3a3.6 3.6 0 0 0 0 2.7A4 4 0 0 0 4 8.7c0 3.3 2 5 5 5a3 3 0 0 0-1 2.3v3" /></Svg>
                <span {...R('label', 'v-ink')}>acme-studio</span><Chevron />
              </span>
              <span className="v-input"><SearchIcon /><span {...R('label', 'v-muted')}>Search</span></span>
            </div>
            <div className="v-list">
              {REPOS.map(r => (
                <div key={r.name} className="v-list-row">
                  <span className="v-repo-mark" />
                  <span {...R('button', 'v-ink')}>{r.name}</span>
                  {r.locked && <Lock />}
                  <span {...R('label', 'v-muted')}>· {r.when}</span>
                  <span className="v-btn v-btn--primary v-push"><span {...R('button')}>Import</span></span>
                </div>
              ))}
            </div>
          </section>

          <section className="v-new-col">
            <div className="v-new-col-head">
              <h2 {...R('heading', 'v-ink')}>Build your solution</h2>
              <span {...R('label', 'v-ink')}>Filter</span><Chevron />
              <span {...R('label', 'v-ink v-gap')}>Browse All</span>
            </div>
            <div className="v-new-templates">
              {TEMPLATES.map((t, i) => (
                <div key={t.title} className="v-card v-template">
                  <span {...R('cardTitle', 'v-ink')}>{t.title}</span>
                  <span {...R('label', 'v-muted v-template-desc')}>{t.desc}</span>
                  <span className={`v-template-art v-template-art--${i}`} />
                </div>
              ))}
            </div>
          </section>
        </div>
        <p className="v-new-foot"><span {...R('label', 'v-muted')}>Only need Web Analytics or Speed Insights? Create an empty project.</span></p>
      </div>
    </div>
  )
}

// ── Docs ────────────────────────────────────────────────────────────────────
const DOC_NAV = ['Overview', 'Environments', 'Generated URLs', 'Managing Deployments', 'Promoting Deployments', 'Deployment Policies', 'Troubleshoot Build Errors', 'Accessing Build Logs', 'Claim Deployments', 'Inspect OG Metadata', 'Rollback Production', 'Sharing a Preview']
const DOC_TOC = [
  ['Deployment Methods', 0], ['Git', 1], ['Vercel Drop', 1], ['Vercel CLI', 1], ['Deploy Hooks', 1], ['REST API', 1],
  ['Accessing Deployments', 0], ['Using the Dashboard', 0], ['Project Overview', 1], ['CLI workflows', 0],
]
const DOC_TABS = ['Create a deployment', 'Verify a preview', 'Deploy to production']

export function VercelDocsPreview({ roleStyle, activeRole, onRoleClick }) {
  const R = useRoles(roleStyle, activeRole, onRoleClick)
  const [tab, setTab] = useState(0)
  const code = [
    ['vercel', 'deploy'],
    ['vercel', 'inspect https://geist-proofs-4f2k9x1qa.vercel.app'],
    ['vercel', 'deploy --prod'],
  ][tab]
  return (
    <div className="v-shell v-docs">
      <header className="v-site-bar">
        <Triangle /><span className="v-slash">/</span><span {...R('heading', 'v-ink v-docs-wordmark')}>Docs</span>
        <nav className="v-site-nav">
          <span {...R('label', 'v-ink')}>Build</span><Chevron />
          <span {...R('label', 'v-muted v-gap')}>Learn</span><Chevron />
          <span {...R('label', 'v-muted v-gap')}>Getting Started</span>
        </nav>
        <div className="v-site-actions">
          <span className="v-btn"><span {...R('button')}>Ask AI</span></span>
          <span className="v-btn"><span {...R('button')}>Log In</span></span>
          <span className="v-btn v-btn--primary"><span {...R('button')}>Sign Up</span></span>
        </div>
      </header>

      <div className="v-docs-grid">
        <aside className="v-docs-side">
          <span className="v-input v-input--wide"><SearchIcon /><span {...R('label', 'v-muted')}>Search Docs</span><kbd className="v-kbd v-push"><span {...R('code')}>⌘K</span></kbd></span>
          <div className="v-docs-side-head"><Svg size={14}><path d="m15 18-6-6 6-6" /></Svg><span {...R('label', 'v-ink')}>Deployments</span></div>
          {DOC_NAV.map((n, i) => (
            <div key={n} className={`v-docs-link${i === 0 ? ' is-active' : ''}`}>
              <span {...R('button')}>{n}</span>
              {n === 'Deployment Policies' && <span className="v-pill v-pill--blue"><span {...R('badge')}>Beta</span></span>}
            </div>
          ))}
        </aside>

        <article className="v-docs-main">
          <div className="v-docs-copy"><span className="v-btn"><Svg size={14}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg><span {...R('button')}>Copy page</span></span></div>
          <h1 {...R('display', 'v-ink')}>Deploy and verify applications on Vercel</h1>
          <p {...R('lede', 'v-muted')}>Ship preview and production deployments from Git, the Vercel CLI, or the REST API, and check every deployment URL before your changes reach production.</p>
          <div className="v-docs-ctas">
            <span className="v-btn v-btn--primary"><span {...R('button')}>Deploy from the CLI</span></span>
            <span className="v-btn"><span {...R('button')}>Connect Git</span></span>
          </div>

          <div className="v-tabs">
            {DOC_TABS.map((t, i) => (
              <button key={t} type="button" className={`v-tab${i === tab ? ' is-active' : ''}`} onClick={() => setTab(i)}><span {...R('label')}>{t}</span></button>
            ))}
          </div>
          <div className="v-code">
            <div className="v-code-head"><span {...R('code', 'v-muted')}>&gt;_ terminal</span></div>
            <pre className="v-code-body"><span {...R('code')}><span className="v-ink">{code[0]} </span><span className="v-code-arg">{code[1]}</span></span></pre>
          </div>

          <p {...R('body', 'v-ink')}>A <b>deployment</b> is the result of a successful build of your project. Every deploy gets its own URL, such as <code className="v-inline-code" style={roleStyle('code')}>geist-proofs-4f2k9x1qa.vercel.app</code>, so you and your team can review a change in a live <u>environment</u> before it ships.</p>
          <h2 {...R('heading', 'v-ink')}>Deployment Methods</h2>
          <p {...R('body', 'v-ink')}>You can create a deployment in five ways. On Pro and Enterprise teams, a <u>deployment policy</u> controls which Git sources and methods may deploy to each environment.</p>
          <h3 {...R('subhead', 'v-ink')}>Git</h3>
          <p {...R('body', 'v-ink')}>Push to a connected repository and Vercel builds it. Commits to <code className="v-inline-code" style={roleStyle('code')}>main</code> go to production; every other branch gets a preview, with its status reported back to the pull request.</p>
          <ul className="v-docs-list">
            {['GitHub', 'GitLab', 'Bitbucket', 'Azure DevOps'].map(x => <li key={x}><span {...R('body', 'v-ink')}><u>{x}</u></span></li>)}
          </ul>
          <div className="v-note">
            <span {...R('button', 'v-ink')}>Note</span>
            <span {...R('label', 'v-ink')}>Preview URLs stay live until you delete the deployment. Use <code className="v-inline-code" style={roleStyle('code')}>vercel rm</code> to remove one.</span>
          </div>
        </article>

        <aside className="v-docs-toc">
          <span {...R('label', 'v-muted')}>On this page</span>
          {DOC_TOC.map(([t, d], i) => (
            <span key={t} className={`v-toc-item${d ? ' is-sub' : ''}${i === 0 ? ' is-active' : ''}`}><span {...R('label')}>{t}</span></span>
          ))}
        </aside>
      </div>
    </div>
  )
}

// ── Marketplace ─────────────────────────────────────────────────────────────
const FEATURED = [
  { name: 'Postgres Cloud', tag: 'Storage', art: 'Serverless Postgres', blurb: 'Serverless, reliable, secure Postgres that scales to zero.' },
  { name: 'Data Studio', tag: 'Storage', art: 'Browse and edit data', blurb: 'A visual editor for every table in your database.' },
  { name: 'Checkout', tag: 'Commerce', art: 'The fastest checkout', blurb: 'The all-in-one commerce platform for headless stores.' },
]
const RECENT = [
  { name: 'Object Store', tag: 'Storage', desc: 'S3-compatible storage with zero egress fees.' },
  { name: 'Memory Layer', tag: 'Agents', desc: 'Persistent, searchable memory for your agents.' },
  { name: 'Flagship', tag: 'Experimentation', desc: 'Feature flags, experiments and gradual rollouts.' },
  { name: 'Query API', tag: 'Searching', desc: 'AI-powered search for developers. Build in minutes.' },
]
const NATIVE = [
  { name: 'Branch DB', tag: 'Storage', desc: 'Postgres with instant branches for every preview.' },
  { name: 'Edge KV', tag: 'Storage', desc: 'Durable Redis, vector, queue and search.' },
  { name: 'Auth Kit', tag: 'Authentication', desc: 'Sign-in, sessions and users in one SDK.' },
  { name: 'Queue', tag: 'Workflow', desc: 'Background jobs with retries, 0.2 ms to enqueue.' },
]

export function VercelMarketplacePreview({ roleStyle, activeRole, onRoleClick }) {
  const R = useRoles(roleStyle, activeRole, onRoleClick)
  const Card = ({ it }) => (
    <div className="v-card v-int">
      <div className="v-int-top">
        <span className="v-mono-mark"><span {...R('cardTitle', 'v-ink')}>{it.name[0]}</span></span>
        <span className="v-pill v-push"><span {...R('badge', 'v-ink')}>{it.tag}</span></span>
      </div>
      <span {...R('cardTitle', 'v-ink')}>{it.name}</span>
      <span {...R('body', 'v-muted v-clamp')}>{it.desc}</span>
    </div>
  )
  return (
    <div className="v-shell v-market">
      <header className="v-site-bar">
        <Triangle />
        <nav className="v-site-nav">
          <span {...R('label', 'v-muted')}>Products</span><Chevron />
          <span {...R('label', 'v-ink v-gap')}>Resources</span><Chevron />
          <span {...R('label', 'v-muted v-gap')}>Enterprise</span>
          <span {...R('label', 'v-muted v-gap')}>Pricing</span>
        </nav>
        <div className="v-site-actions">
          <span className="v-btn"><span {...R('button')}>Contact</span></span>
          <span className="v-btn"><span {...R('button')}>Log In</span></span>
          <span className="v-btn v-btn--primary"><span {...R('button')}>Sign Up</span></span>
        </div>
      </header>

      <div className="v-market-body">
        <div className="v-market-head">
          <h1 {...R('display', 'v-ink')}>Marketplace</h1>
          <div className="v-market-filters">
            <span className="v-select"><span {...R('label', 'v-ink')}>All types</span><Chevron /></span>
            <span className="v-select"><span {...R('label', 'v-ink')}>All categories</span><Chevron /></span>
            <span className="v-input"><SearchIcon /><span {...R('label', 'v-muted')}>Search</span><kbd className="v-kbd v-push"><span {...R('code')}>/</span></kbd></span>
          </div>
        </div>

        <div className="v-featured">
          {FEATURED.map((f, i) => (
            <div key={f.name} className="v-card v-feat">
              <div className={`v-feat-art v-feat-art--${i}`}>
                <span className="v-pill v-pill--solid"><span {...R('badge')}>{f.tag}</span></span>
                <span {...R('heading', 'v-feat-art-title')}>{f.art}</span>
              </div>
              <div className="v-feat-foot">
                <span className="v-mono-mark"><span {...R('cardTitle', 'v-ink')}>{f.name[0]}</span></span>
                <span {...R('body', 'v-muted v-clamp')}><b className="v-ink">{f.name}</b> {f.blurb}</span>
              </div>
            </div>
          ))}
        </div>

        <h2 {...R('heading', 'v-ink v-market-h2')}>Recently added</h2>
        <div className="v-int-grid">{RECENT.map(it => <Card key={it.name} it={it} />)}</div>
        <h2 {...R('heading', 'v-ink v-market-h2')}>Native integrations</h2>
        <div className="v-int-grid">{NATIVE.map(it => <Card key={it.name} it={it} />)}</div>
      </div>
    </div>
  )
}
