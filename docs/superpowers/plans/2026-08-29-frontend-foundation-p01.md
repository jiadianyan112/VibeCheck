# Frontend Foundation and P01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scoped VibeCheck high-fidelity visual foundation and ship a complete responsive P01 Works Plaza without changing project data, service behavior, authentication, comparison, or submission behavior.

**Architecture:** Keep `global.css` as the legacy functional baseline, then load scoped high-fidelity style layers after it. Add presentational brand/editorial components under focused directories and migrate the frontstage shell, project cards, and P01 to those components. All visual derivation is deterministic and consumes existing `Project`/`MediaItem` data.

**Tech Stack:** React 19, React Router 7, TypeScript 5.8, Vite 7, CSS, inline SVG, IntersectionObserver, Vitest, Testing Library, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-08-29-starboy-inspired-frontend-design.md`

## Global Constraints

- Preserve all current route URLs, accessible names used by functional tests, project service calls, favorite behavior, comparison behavior, and authentication return paths.
- Scope high-fidelity color overrides to `.app-shell`; do not restyle `.admin-shell` through brand surface tokens.
- Do not add an animation or font dependency.
- Do not add raster assets in this slice. Use existing project media plus original SVG/CSS fallbacks.
- Keep P01 section heading order: 个人主页与作品集、编辑精选、最新发布、最近更新、开源可复用、按问题与品类探索、已结束，但仍可复用.
- Keep new total JS at or below 251,435 bytes gzip and total CSS at or below 17,749 bytes gzip for this slice.
- Preserve the existing 360-pixel submission route regression while adding 390, 768, and 1440 P01 coverage.
- Stage only files named in this plan; user-owned untracked files are out of scope.

---

### Task 1: Establish Current Design and Executable Bundle Budgets

**Files:**
- Modify: `DESIGN.md`
- Create: `scripts/check-frontend-budgets.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**
- Consumes: Vite output in `dist/assets`.
- Produces: `npm run frontend:budget`, which exits non-zero with `FRONTEND_BUDGET_EXCEEDED` when the gzip total exceeds a fixed budget.

- [ ] **Step 1: Record the failing command**

Run:

```powershell
npm run frontend:budget
```

Expected: FAIL with `Missing script: "frontend:budget"`.

- [ ] **Step 2: Replace the obsolete low-fidelity design contract**

Replace `DESIGN.md` with a concise current contract:

```markdown
# VibeCheck Design Contract

The active high-fidelity design specification is:
`docs/superpowers/specs/2026-08-29-starboy-inspired-frontend-design.md`.

Public and task pages use the VibeCheck editorial visual system. Admin pages remain compact and tool-oriented. Existing business state, evidence, unknown facts, errors, permissions, and reduced-motion behavior remain mandatory.
```

- [ ] **Step 3: Implement the deterministic budget checker**

Create `scripts/check-frontend-budgets.mjs`:

```js
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const limits = Object.freeze({ js: 251_435, css: 17_749 })
const assetDir = new URL('../dist/assets/', import.meta.url)
const files = await readdir(assetDir)

for (const extension of ['js', 'css']) {
  const matching = files.filter((file) => file.endsWith(`.${extension}`))
  if (matching.length === 0) throw new Error(`FRONTEND_ASSET_MISSING type=${extension}`)
  let gzipBytes = 0
  for (const file of matching) {
    const source = await readFile(new URL(file, assetDir))
    gzipBytes += gzipSync(source, { level: 9 }).byteLength
  }
  console.log(`frontend_budget type=${extension} gzip_bytes=${gzipBytes} limit=${limits[extension]}`)
  if (gzipBytes > limits[extension]) {
    throw new Error(`FRONTEND_BUDGET_EXCEEDED type=${extension} actual=${gzipBytes} limit=${limits[extension]}`)
  }
}
```

Add to `package.json`:

```json
"frontend:budget": "node scripts/check-frontend-budgets.mjs"
```

Add immediately after `npm run build` in `.github/workflows/quality.yml`:

```yaml
      - run: npm run frontend:budget
```

- [ ] **Step 4: Verify the baseline passes**

Run:

```powershell
npm run build
npm run frontend:budget
```

Expected: PASS with a `frontend_budget` line for both `js` and `css`; both values are at or below their limits.

- [ ] **Step 5: Commit the budget gate**

```powershell
git add DESIGN.md scripts/check-frontend-budgets.mjs package.json .github/workflows/quality.yml
git commit -m "build: enforce frontend visual budgets"
```

---

### Task 2: Add Scoped Tokens, Style Layers, and Primitive Variants

**Files:**
- Modify: `src/styles/tokens.css`
- Create: `src/styles/highfi-foundation.css`
- Create: `src/styles/highfi-components.css`
- Create: `src/styles/highfi-home.css`
- Modify: `src/main.tsx`
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Tag.tsx`
- Modify: `src/pages/StyleSandboxPage.tsx`
- Modify: `src/pages/StyleSandboxPage.test.tsx`

**Interfaces:**
- Consumes: existing `ButtonProps`, `TagProps`, and legacy CSS classes.
- Produces: `ButtonProps.variant = 'accent'` and `TagProps.tone = 'accent' | 'inverse'` without changing existing defaults.

- [ ] **Step 1: Write the failing primitive tests**

Add to `StyleSandboxPage.test.tsx`:

```tsx
it('renders high-fidelity accent and inverse primitives', () => {
  render(<StyleSandboxPage />)
  expect(screen.getByRole('button', { name: '品牌操作' })).toHaveClass('button--accent')
  expect(screen.getByText('荧光状态')).toHaveClass('tag--accent')
  expect(screen.getByText('反相状态')).toHaveClass('tag--inverse')
})
```

Run:

```powershell
npx vitest run src/pages/StyleSandboxPage.test.tsx
```

Expected: FAIL because the new examples and prop values do not exist.

- [ ] **Step 2: Extend the primitive types without changing defaults**

Change `ButtonProps` to:

```tsx
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'accent'
  loading?: boolean
  children: ReactNode
}
```

Change `TagProps` to:

```tsx
export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'strong' | 'dashed' | 'accent' | 'inverse'
  children: ReactNode
}
```

Add these examples to the existing sandbox sections:

```tsx
<Button variant="accent">品牌操作</Button>
<Tag tone="accent">荧光状态</Tag>
<Tag tone="inverse">反相状态</Tag>
```

- [ ] **Step 3: Add brand tokens and scoped style entry points**

Append tokens with exact names to `tokens.css`:

```css
:root {
  --brand-canvas: #f7f7f2;
  --brand-ink: #111111;
  --brand-lime: #b8ff3d;
  --brand-yellow: #ffd93d;
  --brand-violet: #b78cff;
  --brand-cyan: #61e7f2;
  --brand-danger: #b42318;
  --font-display: "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-body: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --motion-fast: 180ms;
  --motion-standard: 320ms;
  --motion-slow: 500ms;
}
```

Import the layers after `global.css` in `main.tsx`:

```tsx
import './styles/global.css'
import './styles/highfi-foundation.css'
import './styles/highfi-components.css'
import './styles/highfi-home.css'
```

In `highfi-foundation.css`, scope surface overrides to `.app-shell`, define display typography, focus rings, reduced motion, and responsive gutters. In `highfi-components.css`, define the new primitive variants. In `highfi-home.css`, reserve P01-only selectors. Do not duplicate legacy submission or admin rules.

- [ ] **Step 4: Make the test pass and verify existing primitives**

Run:

```powershell
npx vitest run src/pages/StyleSandboxPage.test.tsx
npm run typecheck
```

Expected: PASS. Existing primary, secondary, quiet, danger, modal, drawer, input, tab, and focus behavior remain green.

- [ ] **Step 5: Commit the scoped foundation**

```powershell
git add src/styles/tokens.css src/styles/highfi-foundation.css src/styles/highfi-components.css src/styles/highfi-home.css src/main.tsx src/components/ui/Button.tsx src/components/ui/Tag.tsx src/pages/StyleSandboxPage.tsx src/pages/StyleSandboxPage.test.tsx
git commit -m "feat: add scoped high-fidelity foundation"
```

---

### Task 3: Build the Original Brand Mark and Deterministic Vibe Lens

**Files:**
- Create: `src/components/brand/BrandMark.tsx`
- Create: `src/components/brand/VibeLens.tsx`
- Create: `src/components/brand/VibeLens.test.tsx`
- Create: `src/components/brand/index.ts`
- Modify: `src/components/index.ts`
- Modify: `src/styles/highfi-components.css`

**Interfaces:**
- Produces: `BrandMark({ compact?: boolean })`.
- Produces: `VibeLens({ seed, tone, state, label, className })` where `tone` is `lime | yellow | violet | cyan` and `state` is `idle | active | pending`.
- Produces: `lensCoordinates(seed): { x: number; y: number; tilt: number }`, with stable output and no randomness.

- [ ] **Step 1: Write deterministic and accessible failing tests**

Create `VibeLens.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { lensCoordinates, VibeLens } from './VibeLens'

describe('VibeLens', () => {
  it('derives stable coordinates from a project seed', () => {
    expect(lensCoordinates('project-pdfquizlab')).toEqual(lensCoordinates('project-pdfquizlab'))
    expect(lensCoordinates('project-pdfquizlab')).not.toEqual(lensCoordinates('project-speakingecho'))
  })

  it('has an explicit accessible label and state', () => {
    render(<VibeLens seed="project-pdfquizlab" tone="lime" state="active" label="题练工坊视觉占位" />)
    expect(screen.getByRole('img', { name: '题练工坊视觉占位' })).toHaveAttribute('data-state', 'active')
  })
})
```

Run:

```powershell
npx vitest run src/components/brand/VibeLens.test.tsx
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement stable coordinates**

Use this exact algorithm in `VibeLens.tsx`:

```tsx
export type VibeLensTone = 'lime' | 'yellow' | 'violet' | 'cyan'
export type VibeLensState = 'idle' | 'active' | 'pending'

export function lensCoordinates(seed: string) {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  const unsigned = hash >>> 0
  return {
    x: 34 + (unsigned % 33),
    y: 36 + ((unsigned >>> 8) % 29),
    tilt: -8 + ((unsigned >>> 16) % 17),
  }
}
```

Render an original circular lens with two internal ellipses and a check notch using inline SVG/CSS. Set `role="img"`, `aria-label={label}`, `data-state={state}`, and CSS custom properties derived from `lensCoordinates(seed)`.

- [ ] **Step 3: Implement and export BrandMark**

`BrandMark` renders the word `VibeCheck` plus a compact lens/check glyph. It accepts only `compact?: boolean`, is decorative inside an already-labelled link, and marks its SVG `aria-hidden="true"`.

Export both components and types from `src/components/brand/index.ts`, then add:

```tsx
export * from './brand'
```

to `src/components/index.ts`.

- [ ] **Step 4: Verify component behavior and types**

Run:

```powershell
npx vitest run src/components/brand/VibeLens.test.tsx
npm run typecheck
```

Expected: PASS with stable output and an accessible labelled image.

- [ ] **Step 5: Commit the brand primitives**

```powershell
git add src/components/brand src/components/index.ts src/styles/highfi-components.css
git commit -m "feat: add original VibeCheck brand primitives"
```

---

### Task 4: Centralize Project Media and Failure Fallbacks

**Files:**
- Create: `src/components/editorial/ProjectMediaStage.tsx`
- Create: `src/components/editorial/ProjectMediaStage.test.tsx`
- Create: `src/components/editorial/index.ts`
- Modify: `src/components/index.ts`
- Modify: `src/styles/highfi-components.css`

**Interfaces:**
- Consumes: `MediaItem | undefined` from `src/types/domain.ts`.
- Produces: `ProjectMediaStage({ media, projectId, title, tone, priority, aspect, className })`.
- `priority` maps to `loading="eager"` and `fetchPriority="high"`; otherwise images use lazy loading.
- `aspect` is `landscape | portrait | square` and defaults to `landscape`.

- [ ] **Step 1: Write failing media tests**

Create tests that assert the real image path, loading policy, and error fallback:

```tsx
it('renders real project media with declared loading priority', () => {
  render(<ProjectMediaStage media={{ id: 'cover', kind: 'image', url: '/cover.webp', alt: '作品首页' }} projectId="project-1" title="作品一" tone="lime" priority />)
  expect(screen.getByRole('img', { name: '作品首页' })).toHaveAttribute('loading', 'eager')
  expect(screen.getByRole('img', { name: '作品首页' })).toHaveAttribute('fetchpriority', 'high')
})

it('falls back to the same labelled Vibe Lens when media fails', () => {
  render(<ProjectMediaStage media={{ id: 'cover', kind: 'image', url: '/broken.webp', alt: '损坏图片' }} projectId="project-1" title="作品一" tone="violet" />)
  fireEvent.error(screen.getByRole('img', { name: '损坏图片' }))
  expect(screen.getByRole('img', { name: '作品一视觉占位' })).toBeInTheDocument()
})
```

Run the file and expect module-not-found failure.

- [ ] **Step 2: Implement the media decision table**

Implement these branches:

```tsx
const canRenderImage = media?.kind === 'image' && Boolean(media.url) && !failed
const canRenderVideo = media?.kind === 'video' && Boolean(media.url) && !failed
```

- Image: render `<img width="1600" height="900">` with `decoding="async"`, the requested loading policy, and `onError={() => setFailed(true)}`. CSS may change the displayed aspect, but the intrinsic dimensions remain declared.
- Video: render muted, playsInline video without autoplay; add an accessible title.
- Placeholder/wireframe/missing/failed: render `VibeLens` using `projectId` and `${title}视觉占位`.
- Never render the raw URL as visible fallback text.

- [ ] **Step 3: Export and style the component**

Export from `src/components/editorial/index.ts` and the component barrel. Add aspect, crop, border, fallback, and image transition rules. All media containers declare `overflow: clip` and a stable aspect ratio.

- [ ] **Step 4: Verify all branches**

Run:

```powershell
npx vitest run src/components/editorial/ProjectMediaStage.test.tsx
npm run typecheck
```

Expected: PASS for image, video, placeholder, wireframe, missing, and failure cases.

- [ ] **Step 5: Commit the media boundary**

```powershell
git add src/components/editorial src/components/index.ts src/styles/highfi-components.css
git commit -m "feat: centralize high-fidelity project media"
```

---

### Task 5: Add Reduced-Motion Reveal and Editorial Structures

**Files:**
- Create: `src/components/motion/useReducedMotion.ts`
- Create: `src/components/motion/Reveal.tsx`
- Create: `src/components/motion/Reveal.test.tsx`
- Create: `src/components/motion/index.ts`
- Create: `src/components/editorial/EditorialHero.tsx`
- Create: `src/components/editorial/SectionLead.tsx`
- Create: `src/components/editorial/MarqueeStrip.tsx`
- Create: `src/components/editorial/EditorialHero.test.tsx`
- Modify: `src/components/editorial/index.ts`
- Modify: `src/components/index.ts`
- Modify: `src/styles/highfi-components.css`

**Interfaces:**
- Produces: `Reveal({ children, className, delayMs })` with `delayMs` clamped to 0–320.
- Produces: `EditorialHero({ eyebrow, title, description, actions, artwork, label, children })`; `title`, `description`, `actions`, `artwork`, and optional `children` are `ReactNode`.
- Produces: `SectionLead({ eyebrow, title, description, action, id })`.
- Produces: `MarqueeStrip({ label, children })`, which is user-scrollable and has no timer.

- [ ] **Step 1: Write failing reduced-motion and semantic tests**

Cover these assertions:

```tsx
it('shows content immediately when reduced motion is requested', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  render(<Reveal><p>立即可见</p></Reveal>)
  expect(screen.getByText('立即可见').parentElement).toHaveAttribute('data-reveal-state', 'visible')
})

it('labels the hero artwork and preserves heading semantics', () => {
  render(<EditorialHero eyebrow="社区精选" title="看懂作品，再开始创造。" description="描述" actions={<a href="/projects">探索</a>} artwork={<span>视觉</span>} label="作品广场首屏" />)
  expect(screen.getByRole('heading', { level: 1, name: '看懂作品，再开始创造。' })).toBeInTheDocument()
  expect(screen.getByLabelText('作品广场首屏')).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement progressive reveal**

`useReducedMotion` reads `(prefers-reduced-motion: reduce)` and subscribes with `addEventListener('change', ...)`. `Reveal` starts visible when reduced motion is true or IntersectionObserver is unavailable. Otherwise it observes once, sets `data-reveal-state="visible"`, then disconnects.

Do not set content to `display: none`, `visibility: hidden`, or `aria-hidden`.

- [ ] **Step 3: Implement the editorial structures**

Use semantic `<section>`, `<header>`, `<h1>`/`<h2>`, and labelled scroll regions. `MarqueeStrip` must render:

```tsx
<div className="marquee-strip" role="region" aria-label={label} tabIndex={0}>
  <div className="marquee-strip__track">{children}</div>
</div>
```

It has no `setInterval`, autoplay, duplicate content, or focus manipulation.

- [ ] **Step 4: Run component and reduced-motion tests**

```powershell
npx vitest run src/components/motion/Reveal.test.tsx src/components/editorial/EditorialHero.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the editorial structures**

```powershell
git add src/components/motion src/components/editorial src/components/index.ts src/styles/highfi-components.css
git commit -m "feat: add accessible editorial motion and structure"
```

---

### Task 6: Upgrade the Frontstage Shell and Add the Site Footer

**Files:**
- Create: `src/components/SiteFooter.tsx`
- Create: `src/components/FrontstageLayout.test.tsx`
- Modify: `src/components/FrontstageLayout.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/styles/highfi-components.css`

**Interfaces:**
- Consumes: existing session, notification, comparison, and route state.
- Produces: the same navigation links and restricted paths, plus `SiteFooter({ submitPath, compact })` on frontstage routes.
- `BrandMark` remains inside the existing `/projects` link whose accessible name is `VibeCheck 作品广场`.

- [ ] **Step 1: Write the failing shell test**

Create a memory router around `FrontstageLayout` and assert:

```tsx
expect(screen.getByRole('link', { name: 'VibeCheck 作品广场' })).toHaveAttribute('href', '/projects')
expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
expect(screen.getByRole('contentinfo')).toContainElement(screen.getByRole('link', { name: '了解收录规则' }))
expect(screen.getByRole('link', { name: '发布' })).toHaveAttribute('href', '/auth?return_to=%2Fsubmit')
```

Expected: FAIL because there is no footer and the brand component is not used.

- [ ] **Step 2: Implement the footer**

`SiteFooter` accepts `submitPath: string` and optional `compact?: boolean`, and contains only existing destinations:

- `/projects` as 作品广场.
- `/categories` as 浏览分类.
- `/submit` or the existing restricted auth path as 发布作品.
- `/about` as 了解收录规则.

Do not add a fake newsletter form, social account, or legal destination.

- [ ] **Step 3: Upgrade the shell without changing route behavior**

Replace the wordmark text node with `<BrandMark />`, preserve all current navigation arrays and restricted paths, and render `<SiteFooter submitPath={restrictedPath('/submit', isLoggedIn, '/submit')} compact={isFocusedFlow} />` after the outlet content. Focused task routes use the compact footer class but retain contentinfo and the about link.

- [ ] **Step 4: Verify navigation and regressions**

```powershell
npx vitest run src/components/FrontstageLayout.test.tsx src/app/router.test.tsx
npm run typecheck
```

Expected: PASS; all existing header, mobile menu, restricted route, and comparison behaviors remain unchanged.

- [ ] **Step 5: Commit the shell**

```powershell
git add src/components/SiteFooter.tsx src/components/FrontstageLayout.tsx src/components/FrontstageLayout.test.tsx src/components/index.ts src/styles/highfi-components.css
git commit -m "feat: upgrade the frontstage shell"
```

---

### Task 7: Migrate ProjectCard to the Media Stage and Featured Variant

**Files:**
- Modify: `src/components/domain/ProjectCard.tsx`
- Modify: `src/components/domain/ProjectCard.test.tsx`
- Modify: `src/styles/highfi-components.css`

**Interfaces:**
- Extends: `ProjectCardVariant` with `featured`.
- Preserves: all current links, labels, creator metadata, favorite callbacks, comparison callbacks, event behavior, and compact behavior.
- Uses: `ProjectMediaStage` for `standard` and `featured`; compact and event variants remain media-free.

- [ ] **Step 1: Write failing featured and fallback tests**

Add:

```tsx
it('renders a featured card through the centralized media stage', () => {
  renderCard(<ProjectCard project={project} variant="featured" />)
  expect(screen.getByRole('article')).toHaveClass('project-card--featured')
  expect(screen.getByRole('img', { name: `${project.currentName.state === 'known' ? project.currentName.value : '名称未知的作品'}视觉占位` })).toBeInTheDocument()
})
```

Keep the existing compact test asserting that compact cards have no media.

Expected: FAIL because `featured` is not a valid variant and standard media bypasses the new boundary.

- [ ] **Step 2: Add featured as a presentation-only variant**

Change the union to:

```tsx
export type ProjectCardVariant = 'compact' | 'standard' | 'featured' | 'event'
```

Use category-based tones:

```tsx
const mediaTone = project.categoryId === 'personal_site_portfolio' ? 'violet' : 'lime'
```

Render `ProjectMediaStage` with the first cover item, project ID, known name, and media tone. `featured` uses the same facts and actions as standard, differing only by CSS class and media composition.

- [ ] **Step 3: Add hover and focus behavior without hiding actions**

Use `transform` and border-color transitions only for devices that support hover. `:focus-within` must provide the same visual elevation. Do not move the card more than 8px and do not reveal required actions only on hover.

- [ ] **Step 4: Verify card regression coverage**

```powershell
npx vitest run src/components/domain/ProjectCard.test.tsx
npm run typecheck
```

Expected: all existing and new ProjectCard tests pass.

- [ ] **Step 5: Commit the card migration**

```powershell
git add src/components/domain/ProjectCard.tsx src/components/domain/ProjectCard.test.tsx src/styles/highfi-components.css
git commit -m "feat: upgrade project cards and media"
```

---

### Task 8: Recompose P01 as the High-Fidelity Reference Page

**Files:**
- Modify: `src/pages/ProjectsHomePage.tsx`
- Modify: `src/pages/ProjectsHomePage.test.tsx`
- Modify: `src/styles/highfi-home.css`

**Interfaces:**
- Consumes: the existing `projectService.list` result and current section derivations.
- Produces: one `EditorialHero`, a labelled three-item artwork stage, one featured editor pick, a user-scrollable latest strip, and the same required content sections.
- Preserves: `home_viewed`, favorite and comparison callbacks, search query links, category links, publishing auth path, loading state, and error retry.

- [ ] **Step 1: Add failing P01 structure tests**

Extend the current test file:

```tsx
it('renders the high-fidelity editorial landmarks', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects'] })
  render(<AppProviders><RouterProvider router={router} /></AppProviders>)
  await screen.findByRole('heading', { name: '编辑精选' })
  expect(screen.getByRole('heading', { level: 1, name: /先看看别人怎么做/ })).toBeInTheDocument()
  expect(screen.getByLabelText('本周作品舞台')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '最新发布作品' })).toHaveAttribute('tabindex', '0')
  expect(document.querySelector('.project-card--featured')).not.toBeNull()
})
```

Expected: FAIL because the editorial components are not used.

- [ ] **Step 2: Replace the current split hero**

Use:

```tsx
<EditorialHero
  eyebrow="Vibe Coding 作品社区"
  title={<>先看看别人怎么做，<br />再决定自己怎么做。</>}
  description="发现 Vibe Coding 作品、创作者和构建工具，找到可以借鉴的实现。"
  label="作品广场首屏"
  actions={<><Link className="button button--accent" to="#editor-picks">探索作品</Link><Link className="button button--secondary" to={state.session.user ? '/submit' : '/auth?return_to=%2Fsubmit'}>发布作品</Link></>}
  artwork={<div className="home-artwork" aria-label="本周作品舞台">{sections.latest.slice(0, 3).map((project, index) => <ProjectMediaStage key={project.id} media={project.coverMedia[0]} projectId={project.id} title={knownName(project)} tone={index === 0 ? 'lime' : index === 1 ? 'cyan' : 'violet'} priority={index === 0} />)}</div>}
>
  <UnifiedSearchForm id="home-search" className="hero-search" inputClassName="input" submitClassName="button button--accent" placeholder="搜索作品、功能，或描述完整想法" />
  <div className="cluster" aria-label="快捷问题">{['PDF 出题', '口语模拟评分', '开发者作品集', '极简个人主页'].map((query) => <Link key={query} className="tag" to={`/search?q=${encodeURIComponent(query)}`}>{query}</Link>)}</div>
</EditorialHero>
```

Keep exactly one search form and one quick-question group inside the hero child slot.

- [ ] **Step 3: Recompose the existing sections**

- Use `SectionLead` for every section heading without changing heading text/order.
- Render the first curated project with `variant="featured"`; render the remainder as standard cards.
- Render latest projects inside `<MarqueeStrip label="最新发布作品">`.
- Keep portfolios, recently updated, reusable, problem links, ended reusable, and explainer content.
- Wrap decorative entrance sequences with `Reveal`; do not wrap loading/error states.

- [ ] **Step 4: Verify P01 behavior and ordering**

```powershell
npx vitest run src/pages/ProjectsHomePage.test.tsx src/components/domain/ProjectCard.test.tsx
npm run typecheck
```

Expected: PASS. The existing required heading array, search/category links, creators, tools, auth path, and callbacks remain intact.

- [ ] **Step 5: Commit P01**

```powershell
git add src/pages/ProjectsHomePage.tsx src/pages/ProjectsHomePage.test.tsx src/styles/highfi-home.css
git commit -m "feat: deliver high-fidelity works plaza"
```

---

### Task 9: Add Responsive Visual Gates and Complete Slice Verification

**Files:**
- Create: `e2e/highfi-visual.spec.ts`
- Create: `e2e/highfi-visual.spec.ts-snapshots/*`
- Modify: `e2e/responsive.spec.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `PROGRESS.md`

**Interfaces:**
- Produces: deterministic P01 full-page snapshots at 390, 768, and 1440.
- Preserves: existing 360/390/768 submission and comparison checks.
- Produces: a reduced-motion browser assertion for P01.

- [ ] **Step 1: Write the visual and reduced-motion tests**

Create `e2e/highfi-visual.spec.ts`:

```tsx
import { expect, test } from '@playwright/test'

const p01Viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const

for (const viewport of p01Viewports) {
  test(`P01 ${viewport.name} visual baseline`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/projects')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`p01-${viewport.name}.png`, { fullPage: true, animations: 'disabled' })
  })
}

test('P01 remains complete with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: '编辑精选' })).toBeVisible()
  await expect(page.locator('[data-reveal-state="hidden"]')).toHaveCount(0)
})
```

Change the desktop responsive viewport from 1280 to 1440 while retaining 360, 390, and 768. Keep `/projects` in both responsive and axe route lists.

- [ ] **Step 2: Generate and inspect snapshot baselines**

Run:

```powershell
npx playwright test e2e/highfi-visual.spec.ts --project=desktop-chromium --update-snapshots
```

Inspect all three PNGs. Reject the baseline if text clips, project actions disappear, media crops hide the entire subject, focusable strips lack a visible boundary, or page-level overflow appears.

- [ ] **Step 3: Re-run browser gates without updating snapshots**

```powershell
npx playwright test e2e/highfi-visual.spec.ts e2e/responsive.spec.ts e2e/accessibility.spec.ts --project=desktop-chromium
npx playwright test e2e/responsive.spec.ts --project=mobile-chromium
```

Expected: PASS with no snapshot diffs, axe violations, overflow, hidden task actions, or reduced-motion hidden content.

- [ ] **Step 4: Run the complete local gate**

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run frontend:budget
git diff --check
```

Expected:

- lint has zero errors; known Fast Refresh warnings may remain but must not increase.
- typecheck passes.
- all existing and new Vitest tests pass.
- build passes.
- JS gzip is at most 251,435 bytes and CSS gzip is at most 17,749 bytes.
- diff check is clean.

- [ ] **Step 5: Record evidence, run Sol review, and commit**

Update `PROGRESS.md` with the exact test counts, asset sizes, visual snapshot list, remaining scope, and the statement that P01 visual completion is not real-deployment E2E.

Sol review must check:

- spec coverage and no Starboy asset/shape copying.
- no business request or state changes.
- desktop/tablet/mobile screenshots.
- reduced motion and keyboard behavior.
- bundle budgets and all test evidence.

Then commit:

```powershell
git add e2e/highfi-visual.spec.ts e2e/highfi-visual.spec.ts-snapshots e2e/responsive.spec.ts e2e/accessibility.spec.ts PROGRESS.md
git commit -m "test: gate the high-fidelity works plaza"
```

- [ ] **Step 6: Push the completed slice and confirm CI**

```powershell
git push origin HEAD
```

Wait for the pushed HEAD's `quality` workflow. The slice is complete only when the workflow conclusion is `success`. If it fails, inspect the exact job evidence, fix within this slice, rerun the complete local gate, commit, push, and wait again.
