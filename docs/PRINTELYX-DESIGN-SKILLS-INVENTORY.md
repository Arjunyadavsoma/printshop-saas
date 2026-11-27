# PRINTELYX — Design Skills Inventory

**Date:** 2026-11-26

## Attempted Installations

The following skills were attempted via `npx skills add` commands. All attempts timed out or failed because the `skills` CLI / npm package is not available in this sandbox environment (network restrictions + the package may not exist on the public registry).

| # | Skill | Repository | Command | Result | Local Location | Discoverable | Use Case |
|---|---|---|---|---|---|---|---|
| 1 | Frontend Design | anthropics/skills | `npx skills add anthropics/skills --skill frontend-design -g -a claude-code -y` | **Failed** (timeout) | N/A | N/A | UI/component design |
| 2 | UI UX Pro Max | nextlevelbuilder/ui-ux-pro-max-skill | `npx skills add nextlevelbuilder/ui-ux-pro-max-skill -g -a claude-code -y` | **Not attempted** (after #1 timed out) | N/A | N/A | UX patterns |
| 3 | Impeccable | pbakaus/impeccable | `npx skills add pbakaus/impeccable -g -a claude-code -y` | **Not attempted** | N/A | N/A | Frontend polish |
| 4 | Web Design Guidelines | vercel-labs/agent-skills | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines -g -a claude-code -y` | **Not attempted** | N/A | N/A | Vercel design standards |
| 5 | Design Taste Frontend | Leonxlnx/design-taste-frontend | `npx skills add Leonxlnx/design-taste-frontend -g -a claude-code -y` | **Not attempted** | N/A | N/A | Design aesthetics |
| 6 | Emil Design Engineering | emilkowalski/skills | `npx skills add emilkowalski/skills --skill emil-design-eng -g -a claude-code -y` | **Not attempted** | N/A | N/A | Design engineering |
| 7 | Apple Design | emilkowalski/skills | `npx skills add emilkowalski/skills --skill apple-design -g -a claude-code -y` | **Not attempted** | N/A | N/A | Apple HIG |
| 8 | Accessibility Audit | cuellarfr/design-skills | `npx skills add cuellarfr/design-skills --skill accessibility-audit -g -a claude-code -y` | **Not attempted** | N/A | N/A | a11y auditing |
| 9 | Web App Testing | anthropics/skills | `npx skills add anthropics/skills --skill webapp-testing -g -a claude-code -y` | **Not attempted** | N/A | N/A | Browser testing |
| 10 | React Best Practices | vercel-labs/agent-skills | `npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -g -a claude-code -y` | **Not attempted** | N/A | N/A | React patterns |

## Environment Compatibility

This environment uses **Z.ai Code** (not Claude Code). The `npx skills add ... -a claude-code` commands target the Claude Code skill format, which is not compatible with this agent. Even if the packages were available on the npm registry, the installed skills would not be discoverable by this agent.

## Mitigation

The Printelyx consumer design system (documented in `docs/PRINTELYX-VISUAL-IDENTITY.md`) serves as the source of truth for all UI work:
- Primary Blue: #2563EB
- Deep Blue: #1D4ED8
- Background: #F8FAFC
- White cards, Inter typography, subtle borders/shadows, rounded controls.
- Mobile-first responsive design with sticky footers and safe-area awareness.

All UI work in this session followed these tokens directly (see `StepPayment.tsx`, `StepPreview.tsx`, `StepConfirmation.tsx` for examples).
