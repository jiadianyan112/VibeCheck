# VibeCheck Design Contract

The active visual reference is the deployed project discovery feed (`ProjectsHomePage`,
`explore-feed.css`, and `feed-card.css`). The September 13, 2026 design direction extends
that vocabulary to all other routes. The earlier Starboy specification is historical.

Use a warm canvas (#f7f7f2), near-black ink (#111111), subdued borders, and lime
(#b8ff3d) for primary actions. Desktop navigation stays at the left; mobile navigation
collapses behind the menu. Headings are compact (24px desktop, 20px mobile), controls
are rounded, and content appears near the top of the page. Prefer flat sections and
clear spacing over nested panels, heavy dividers, decorative heroes, or repeated copy.

Shared controls and admin styling live in `unified-ui.css`, scoped to `.ui-root` so
the approved discovery feed retains its layout. Page families retain their own
layout styles. Task forms and admin tables may be denser than browsing surfaces.
Existing business state, evidence, unknown facts, errors, permissions, and
reduced-motion behavior remain mandatory. Data tables scroll within their container.

The full-site stylesheet budget is 21 KiB gzip (level 9), raised from 17,749 bytes
for the former partial rollout. The unified 26-route surface measures about 20 KB
after removing unused rules and consolidating 106 legacy selector definitions.
The JavaScript budget is unchanged. This budget remains enforced in CI.

Untracked previews under `outputs/` are non-authoritative and must not override this contract or its linked specification.
