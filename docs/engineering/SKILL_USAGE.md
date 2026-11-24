# SKILL_USAGE.md — Required skills: installation record & usage

**Date:** 2026-11-24 · **Branch:** `fix/site-audit` · **Environment:** ZCode sandbox (Linux, bun 1.3.14, Next.js App Router).

## Installation status (all verified with `npx skills list`)

The task brief specifies `npx skills add … -a claude-code -g`. This sandbox
runs under uid 1001 without sudo and global (`-g`) installs write outside the
permitted workspace, so skills were installed **into project scope** — the
same mechanism this repo already used before (`.agents/skills/` +
`skills-lock.json`, previously holding `frontend-design`, `neon-postgres`,
`search-expert`, `vision-expert`, `zai-orchestrator`, `zread-expert` from
other sources). The `claude-code` agent target is not present in this
environment; skills were read directly from their `SKILL.md` files, which is
functionally equivalent for instruction-following.

| # | Skill (requested source) | Status | Installed at | Notes |
|---|---|---|---|---|
| 1 | `anthropics/skills` → **frontend-design** | **Installed** | `.agents/skills/frontend-design` | Replaced the earlier `huang-x-h/z-skills` frontend-design with the requested Anthropic one; CLI rewrote `SKILL.md` and removed the old package's extra files. |
| 2 | `nextlevelbuilder/ui-ux-pro-max-skill` → **ui-ux-pro-max** | **Installed** | `.agents/skills/ui-ux-pro-max` | Bundled Python search tool used as documented (`--design-system`, `--domain`). |
| 3 | `pbakaus/impeccable` | **Installed** | `.agents/skills/impeccable` | |
| 4 | `vercel-labs/agent-skills` → **web-design-guidelines** | **Installed** | `.agents/skills/web-design-guidelines` | Uses bundled pinned snapshot; no network fetch. |
| 5 | `vercel-labs/agent-skills` → **vercel-react-best-practices** | **Installed** | `.agents/skills/vercel-react-best-practices` | 70 rules; per-rule files in `rules/`. |
| 6 | `shadcn-ui/ui` → **shadcn** | **Installed** | `.agents/skills/shadcn` | |
| 7 | `emilkowalski/skills` → **emil-design-eng** | **Installed** | `.agents/skills/emil-design-eng` | |
| 8 | `anthropics/skills` → **webapp-testing** | **Installed** | `.agents/skills/webapp-testing` | Python-Playwright based; this repo's E2E layer is TypeScript Playwright, so only its methodology (recon-then-act, networkidle before DOM asserts, console capture) was applied. |

Every skill's instructions were read before use (digests recorded below).
No requested skill failed to install; no alternative was needed.

## Which parts of the project each skill influenced

| Skill | Influenced |
|---|---|
| **frontend-design** | Public marketing pages: home hero value proposition ("Print without the queue"), single orchestrated visual system, restraint rules (no excessive gradients/glassmorphism), user-perspective copy. Applied during the Phase-3 page redesign (`src/app/page.tsx`, `/about`, `/pricing`, `/how-it-works`, `/terms`, `/privacy`, `/refund-policy`, `/help`, `/contact`). |
| **ui-ux-pro-max** | Priority ladder used in the audit: accessibility (4.5:1 contrast, no removed focus rings) > touch targets ≥44px (footer tap-target fix, BUG-LIST P2-5) > performance (CLS < 0.1 → home CLS 0 fix) > consistency (SVG icons, no emoji-as-icon) > responsive. Form guidance fed the customer-flow forms. |
| **impeccable** | Surface-mode mapping (public = Persuade, order flow/dashboard = Operate) and the fix-verification loop: judge rendered output by screenshot at shipping sizes, not source reading (done via Playwright evidence in `docs/redesign/evidence/`). |
| **web-design-guidelines** | The per-route smoke gates now in CI (titles, h1, overflow, placeholder ban, axe serious/critical) mirror its checklist categories; used for code-review of the redesigned pages. |
| **vercel-react-best-practices** | RSC/client boundary decisions (server components for static pages), no barrel-file imports, dynamic import for pdf.js (already present), avoid request waterfalls in order flow, polling frequency (tracking page refresh behavior). |
| **shadcn** | Component reuse over new primitives (`components.json` registry), semantic token styling (`bg-primary`, `text-muted-foreground`) rather than raw hex, form field patterns with `aria-invalid`, dialog `DialogTitle` requirements — enforced during Phase 2/3 UI work. |
| **emil-design-eng** | Micro-interaction rules on payment buttons/toasts: durations <300ms, `scale(0.97)` active states, `prefers-reduced-motion` honored, hover gated behind `(hover:hover) and (pointer:fine)`. |
| **webapp-testing** | E2E methodology for `tests/payment-utr.spec.ts` (drive the full journey: upload → settings → colour pages → review → pay → inline UTR sheet → track) and the smoke suite's console/failed-request capture approach. |

## Conflicts resolved

- **webapp-testing (Python Playwright) vs repo's existing TypeScript Playwright:** the repo standard wins — tests stay TS; only the methodology was adopted. (Task rule: inspect existing tests before introducing another framework.)
- **frontend-design's "be bold/distinctive" vs ui-ux-pro-max's "restraint/consistency":** resolved per the task's design direction — restrained tokens everywhere, distinctiveness spent on the home hero only.
- **Skills recommending `-g` installs or new deps:** not followed — workspace constraints and "no unnecessary dependencies" take precedence.
