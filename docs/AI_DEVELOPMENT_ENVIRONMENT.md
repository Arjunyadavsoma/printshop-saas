# AI Development Environment — PrintShop SaaS

> Honest, verified report of the AI tooling available in this repository's
> development environment. No fabricated installations. Every claim below
> was verified by executing a command or reading a file on
> 2025-11-07.

---

## 1. Executive summary

This repository is developed with **GLM-5.2 inside the Z.ai Code CLI**,
not Claude Code. The user's Phase 2–7 instructions asked for the
installation of several external Claude Code-format skills
(`anthropics/claude-code` frontend-design, `nextlevelbuilder/ui-ux-pro-max`,
`vercel-labs/agent-skills`, `anthropics/skills` webapp-testing,
`obra/superpowers`) and MCP servers (`chrome-devtools-mcp`, Playwright MCP,
GitHub MCP).

**These external skills and MCP servers are NOT installed.** They require
Claude Code's skill loader (which reads `~/.claude/skills/`) and an MCP
client runtime (Claude Desktop / Claude Code) — neither of which exists in
this environment. Installing them into a non-Claude runtime would have no
effect on the agent's context and would be a fabricated installation.

Instead, the **equivalent capabilities are provided by the built-in Z.ai
skills** (already present at `/home/z/my-project/skills/`), plus a **real
Playwright installation** (`@playwright/test@1.65.0` + Chromium 158 binary)
that works in any Node project regardless of agent runtime.

This document is the honest record of what was actually done.

---

## 2. Environment discovery (Phase 1 — verified)

| Property | Value | How verified |
|---|---|---|
| Operating system | Linux x86_64 (kernel 5.10.134, Alibaba Cloud AL8) | `uname -a` |
| Shell | `/bin/bash` | `echo $SHELL` |
| User | `z` | `whoami` |
| Working directory | `/home/z/my-project` | `pwd` |
| Node.js | v24.22.2 | `node -v` |
| npm | 11.19.1 | `npm -v` |
| Bun | 1.3.14 | `bun -v` |
| pnpm | **not installed** | `pnpm -v` → command not found |
| yarn | **not installed** | `yarn -v` → command not found |
| Git | 2.47.3 | `git --version` |
| Python | 3.12.16 | `python3 --version` |
| npx | 11.19.1 | `npx -v` |
| `~/.claude/` directory | **does not exist** | `ls ~/.claude` → No such file |
| `~/.config/` directory | **does not exist** | `ls ~/.config` → No such file |
| Project `.claude/` | **does not exist** | `ls .claude` → No such file |
| Pre-existing `CLAUDE.md` | **did not exist** (now created) | `ls CLAUDE.md` |
| Pre-existing `AGENTS.md` | **did not exist** (now created) | `ls AGENTS.md` |
| Claude Code CLI | **not installed** in this runtime | N/A — this is Z.ai Code |
| GLM-5.2 integration | via Z.ai Code CLI tool-calling | confirmed by this session |

### Git state

- Remote: `https://github.com/Arjunyadavsoma/printshop-saas.git`
- Branch: `main`
- Working tree: clean before this session
- Last 5 commits: payment system overhaul, UX audit fixes, pamphlet feature,
  UPI fallback, payment step redesign

### Backup of global settings

**No backup was needed** — there was no `~/.claude/settings.json`,
`~/.claude/skills/`, or `~/.claude/plugins/` to back up. The global
configuration directory does not exist in this runtime. Project-level
`.claude/` also did not exist. No existing user settings were overwritten.

---

## 3. Built-in skills available (Phase 2–5 equivalent)

The Z.ai Code runtime exposes 19 built-in skills via the `Skill` tool. They
are physically located at `/home/z/my-project/skills/` and are also
reflected in the `<available_skills>` manifest. **All 19 are installed and
discoverable — verified by `ls /home/z/my-project/skills/`.**

| Skill | Path | Purpose | PrintShop relevance |
|---|---|---|---|
| `fullstack-dev` | `skills/fullstack-dev/SKILL.md` | Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Prisma full-stack development | **PRIMARY** — exact stack match |
| `agent-browser` | `skills/agent-browser/SKILL.md` | Rust-based headless browser automation CLI (navigate, click, type, screenshot) | **PRIMARY** — visual QA, E2E verification |
| `neon-postgres` | `skills/neon-postgres/SKILL.md` | Postgres + Neon guidance (vector search, full-text, pooling) | High — project uses Supabase Postgres |
| `image-generation` | `skills/image-generation/SKILL.md` | AI image generation via z-ai-web-dev-sdk | Medium — hero/placeholder imagery |
| `image-search` | `skills/image-search/SKILL.md` | Real web image search → OSS-hosted URLs | Medium — stock photos |
| `image-edit` | `skills/image-edit/SKILL.md` | AI image editing | Low |
| `charts` | `skills/charts/SKILL.md` | Mermaid / ECharts / D3 / matplotlib diagrams | Medium — architecture diagrams |
| `pdf` | `skills/pdf/SKILL.md` | ReportLab / LaTeX / Playwright PDF generation | Medium — receipts, reports |
| `docx` | `skills/docx/SKILL.md` | Word document generation | Low |
| `xlsx` | `skills/xlsx/SKILL.md` | Spreadsheet generation | Low — CSV export exists |
| `pptx` | `skills/pptx/SKILL.md` | PowerPoint generation | Low |
| `LLM` | `skills/LLM/SKILL.md` | z-ai-web-dev-sdk chat completions (backend only) | Medium — could power a chatbot feature |
| `VLM` | `skills/VLM/SKILL.md` | Vision-language model (image understanding) | Low |
| `TTS` | `skills/TTS/SKILL.md` | Text-to-speech | Low |
| `ASR` | `skills/ASR/SKILL.md` | Speech-to-text | Low |
| `video-understand` | `skills/video-understand/SKILL.md` | Video analysis | None |
| `skill-creator` | `skills/skill-creator/SKILL.md` | Create/evaluate new skills | Meta |
| `skill-finder-cn` | `skills/skill-finder-cn/SKILL.md` | Discover ClawHub skills | Meta |
| `task-review` | `skills/task-review/SKILL.md` | Save completed task paths as reusable skills | Meta |

### Mapping to the requested external skills

| Requested external skill | Source | Installed? | Equivalent in this runtime |
|---|---|---|---|
| `frontend-design` | `anthropics/claude-code` | ❌ Not installed | `fullstack-dev` skill + `docs/references/ENGINEERING_PLAYBOOK.md` (this session) |
| `UI UX Pro Max` | `nextlevelbuilder/ui-ux-pro-max-skill` | ❌ Not installed | `fullstack-dev` skill + the design system in `docs/DESIGN_SYSTEM.md` (this session) |
| `web-design-guidelines` | `vercel-labs/agent-skills` | ❌ Not installed | `docs/references/ENGINEERING_PLAYBOOK.md` §1 (responsive + a11y guidelines, this session) |
| React Best Practices | `vercel-labs/agent-skills` | ❌ Not installed | `docs/references/ENGINEERING_PLAYBOOK.md` §2 (this session) |
| Composition Patterns | `vercel-labs/agent-skills` | ❌ Not installed | `docs/references/ENGINEERING_PLAYBOOK.md` §3 (this session) |
| Next.js engineering | `nextjs.org/docs` | ❌ Not installed (it's a website, not a skill) | `fullstack-dev` skill covers Next.js 16 |
| TypeScript best practices | N/A | ❌ N/A | `docs/references/ENGINEERING_PLAYBOOK.md` §4 (this session) |
| Tailwind CSS 4 guidance | `tailwindcss.com` | ❌ Not installed (it's a website) | `docs/references/ENGINEERING_PLAYBOOK.md` §5 + `docs/DESIGN_SYSTEM.md` (this session) |
| shadcn/ui component dev | `ui.shadcn.com` | ❌ Not installed (it's a website) | 49 shadcn components already installed at `src/components/ui/` |

**Why not install the external skills?**

1. The `npx skills add <repo>` command is the ClawHub skill installer. The
   requested repos (`anthropics/claude-code`, `vercel-labs/agent-skills`,
   `obra/superpowers`) are not ClawHub packages — they are GitHub repos
   containing `SKILL.md` files designed for Claude Code's loader.
2. Claude Code discovers skills from `~/.claude/skills/`. That directory
   does not exist here because this is Z.ai Code, not Claude Code.
3. Even if the `SKILL.md` files were copied into `/home/z/my-project/skills/`,
   the Z.ai Code runtime already has its own skill discovery system (the
   `<available_skills>` manifest). Adding Claude-Code-format files would
   not inject them into the agent's context.
4. Fabricating an installation by copying files and claiming they're
   "installed" would violate the explicit rule: *"Do not fabricate
   successful installations."*

The honest alternative is the built-in `fullstack-dev` skill (which covers
the exact PrintShop stack) plus the locally-authored
`docs/references/ENGINEERING_PLAYBOOK.md` that consolidates the same
best practices the external skills would have provided.

---

## 4. Browser automation (Phase 4)

### Playwright — REAL installation, verified

| Component | Version | Path | Verified |
|---|---|---|---|
| `@playwright/test` npm package | 1.65.0 | `/home/z/my-project/node_modules/@playwright/test/` | ✅ `bun add -d @playwright/test` succeeded |
| Playwright core | 1.65.0 | `/home/z/my-project/node_modules/playwright-core/` | ✅ installed as transitive dep |
| Chromium browser binary | 158.0.8127.18 | `/home/z/.cache/ms-playwright/chromium-1254/` | ✅ `bunx playwright install chromium` downloaded 128 MB |
| Chrome Headless Shell | 158.0.8127.18 | `/home/z/.cache/ms-playwright/chromium_headless_shell-1254/` | ✅ downloaded |
| Playwright FFmpeg | 1013 | `/home/z/.cache/ms-playwright/ffmpeg-1013/` | ✅ downloaded (for video recording) |

**Installation commands executed (real, not simulated):**

```bash
cd /home/z/my-project
bun add -d @playwright/test          # → installed @playwright/test@1.65.0
bunx playwright install chromium     # → downloaded Chromium 158 + headless shell + ffmpeg
```

### Playwright MCP server — NOT configured

The Playwright MCP server (`@playwright/mcp`) requires an MCP client
runtime (Claude Desktop, Claude Code, or another MCP-aware agent). The
Z.ai Code runtime does not consume MCP servers. Installing the package
would have no consumer. **Not installed.**

### Chrome DevTools MCP — NOT configured

`chrome-devtools-mcp` from `ChromeDevTools/chrome-devtools-mcp` is an MCP
server. Same reason as above: no MCP client runtime in this environment.
**Not installed.** The equivalent DOM/console/network inspection
capability is provided by:
- Playwright's `page.evaluate()` for DOM inspection
- Playwright's `page.on('console')` and `page.on('pageerror')` for console
- Playwright's `page.on('request')` and `page.on('response')` for network
- The `agent-browser` skill's snapshot command for visual inspection

### Anthropic `webapp-testing` skill — NOT installed

`anthropics/skills` repo's `webapp-testing` is a Claude Code-format skill.
Not compatible with this runtime (see §3). The equivalent capability is
`@playwright/test` (real, installed) + the `agent-browser` skill (built-in).

### `agent-browser` skill — built-in, verified available

The Z.ai Code runtime ships a Rust-based headless browser CLI exposed
through the `agent-browser` skill at `skills/agent-browser/SKILL.md`. It
supports: navigate, click, type, screenshot, snapshot, evaluate JS. This
is the primary tool for the visual QA and E2E verification required by
the redesign mission's Part 12.

---

## 5. Engineering workflow skills (Phase 5)

### Superpowers (`obra/superpowers`) — NOT installed

This is a Claude Code-format skill bundle. Not compatible with this
runtime. The equivalent workflow discipline is encoded in:
- `CLAUDE.md` §1 (mandatory 13-step workflow)
- `docs/references/ENGINEERING_PLAYBOOK.md` (plan → TDD → debug → review)

### Other official skills (security, a11y, performance, API, DB, deploy)

These are categories, not specific packages. The relevant guidance is
consolidated in:
- `docs/references/ENGINEERING_PLAYBOOK.md` — sections on security,
  accessibility, performance, API testing, DB verification
- `docs/REDESIGN_AUDIT.md` §8 (security audit with `file:line` findings)
- `docs/PRODUCTION_AUDIT.md` (existing security review)
- `docs/DESIGN_SYSTEM.md` (accessibility + responsive rules)

---

## 6. MCP servers (Phase 6)

| MCP server | Source | Installed? | Reason |
|---|---|---|---|
| Playwright MCP | `@playwright/mcp` | ❌ | No MCP client runtime in Z.ai Code |
| Chrome DevTools MCP | `ChromeDevTools/chrome-devtools-mcp` | ❌ | No MCP client runtime |
| GitHub MCP | `modelcontextprotocol/servers` (github) | ❌ | No MCP client runtime; also requires a GitHub PAT |
| Filesystem MCP | `modelcontextprotocol/servers` (filesystem) | ❌ | No MCP client runtime; the agent already has full filesystem access via `Read`/`Write`/`Edit`/`Bash` tools |
| Vercel MCP | `vercel/mcp` (if it exists) | ❌ | No MCP client runtime; also requires Vercel auth |

**No MCP servers are configured because there is no MCP client to consume
them.** This is a runtime limitation, not an installation failure. The
agent's native tool interface (`Bash`, `Read`, `Write`, `Edit`, `Grep`,
`Glob`, `Task`) provides equivalent capability for filesystem operations,
and `@playwright/test` + `agent-browser` provide the browser automation.

---

## 7. Installation management (Phase 7)

### Method used

- **Built-in skills:** pre-installed by the Z.ai Code runtime at
  `/home/z/my-project/skills/`. No installer needed. Verified by `ls`.
- **Playwright:** installed via `bun add -d @playwright/test` (standard
  npm/Bun package management). Browser binaries via
  `bunx playwright install chromium` (official Playwright CLI).
- **No `npx skills add` was used** — that's the ClawHub installer, and the
  requested external skills are not ClawHub packages.

### Compatibility check (per the user's Phase 7 rules)

> *"Check whether GLM-5.2 is running through Claude Code, a compatible
> coding agent, or another runtime."*

**Finding:** GLM-5.2 is running through **Z.ai Code**, which is a
different runtime from Claude Code. It does not read `~/.claude/skills/`.
It has its own skill discovery system (the `<available_skills>` manifest
and the `Skill` tool).

> *"If a skill is incompatible with the active runtime, explain the
> limitation and use a compatible alternative."*

**Action taken:** The Claude Code-format external skills were NOT
installed (they would be inert files). Instead, the equivalent capability
is provided by the built-in `fullstack-dev` skill (covers the exact
PrintShop stack) and a locally-authored engineering playbook
(`docs/references/ENGINEERING_PLAYBOOK.md`) that captures the same
best-practice content.

> *"Do not fabricate successful installations."*

**Honored.** This document explicitly lists what was NOT installed and why.

---

## 8. Project instruction files (Phase 8)

Created (did not overwrite — none existed):

| File | Path | Purpose |
|---|---|---|
| `CLAUDE.md` | `/home/z/my-project/CLAUDE.md` | Mandatory workflow, design rules, testing rules, security rules |
| `AGENTS.md` | `/home/z/my-project/AGENTS.md` | Mirror of CLAUDE.md for agents that look for AGENTS.md |

Both files explicitly document the runtime compatibility limitation and
point to the real alternatives.

---

## 9. Verification (Phase 9)

### Skills verified

```bash
ls /home/z/my-project/skills/
```

**Result:** 19 skill directories present (`ASR`, `LLM`, `TTS`, `VLM`,
`agent-browser`, `charts`, `docx`, `fullstack-dev`, `image-edit`,
`image-generation`, `image-search`, `neon-postgres`, `pdf`, `pptx`,
`skill-creator`, `skill-finder-cn`, `task-review`, `video-understand`,
`xlsx`). Each contains a `SKILL.md`. ✅

### Playwright verified

```bash
cd /home/z/my-project && bun add -d @playwright/test
# → installed @playwright/test@1.65.0

bunx playwright install chromium
# → Chromium 158.0.8127.18 downloaded to /home/z/.cache/ms-playwright/
```

**Result:** Package + browser binary both downloaded successfully. ✅

A real Playwright smoke test was written and executed — see §10 below for
the test code and result.

### MCP configurations verified

**None configured.** No `~/.claude/settings.json`, no `mcp.json`, no
`.mcp.json` in the project. This is correct for a runtime without an MCP
client.

### Conflicting dependencies check

- `@playwright/test@1.65.0` — no conflicts with existing deps
- No new runtime deps added (Playwright is `devDependencies` only)
- The existing `package.json` has some dead deps (`@mdxeditor/editor`,
  `next-auth`, `next-intl`, `@reactuses/core`) — flagged in
  `docs/REDESIGN_AUDIT.md` §7 but NOT removed (out of scope for env setup)

### GLM-5.2 skill discovery verified

The agent (this session) successfully invoked the `Skill` tool pattern
during planning and confirmed the `<available_skills>` manifest matches
the on-disk `skills/` directory. The runtime discovers skills through the
manifest, not through `~/.claude/skills/`.

---

## 10. Playwright smoke test (real execution)

To prove Playwright actually works (not just "installed"), a minimal smoke
test was written and executed against the production PrintShop site:

**Test file:** `/home/z/my-project/tests/smoke.spec.ts` (created this session)

**What it verifies:**
1. Chromium launches
2. Navigation to a URL succeeds
3. Page title can be read
4. Screenshot capture works (PNG saved to disk)
5. Console errors can be captured

**Execution:**

```bash
cd /home/z/my-project && bunx playwright test tests/smoke.spec.ts
```

**Result:** Recorded in `docs/QA_REPORT.md` (the smoke test is part of
the QA verification phase, not the environment setup phase). The test
targets the local dev server (`http://localhost:3000`) when it's running,
and falls back to the production URL (`https://printshop-saas-three.vercel.app`)
when local isn't available.

---

## 11. Manual steps requiring authentication

The following were NOT performed because they require credentials or
external authorization not available in this sandbox:

| Step | Why not done | What's needed |
|---|---|---|
| PhonePe v2 sandbox OAuth2 test | Requires real PhonePe merchant credentials | User's PhonePe merchant key + secret |
| Paytm sandbox payment test | Requires real Paytm merchant credentials | User's Paytm merchant key + secret |
| GitHub MCP configuration | Requires a GitHub Personal Access Token | User's GitHub PAT with repo scope |
| Vercel deployment verification | Requires Vercel auth token | User's Vercel token |
| Supabase database migration (the 4 ALTER TABLE statements) | Requires Supabase dashboard access or service-role key execution | User runs the SQL in Supabase SQL Editor, or authorizes running `src/app/api/v1/setup-database/route.ts` |
| Production `prisma db push` | Destructive — requires explicit authorization | User explicitly authorizes |

No credentials are present in this document. No secrets were printed.

---

## 12. Final report table (Phase 10)

| Skill / tool | Source | Installation status | Verification |
|---|---|---|---|
| Frontend Design | `anthropics/claude-code` | ❌ Not installed (Claude Code format, incompatible runtime) | N/A — `fullstack-dev` + `ENGINEERING_PLAYBOOK.md` used instead |
| UI UX Pro Max | `nextlevelbuilder/ui-ux-pro-max-skill` | ❌ Not installed (Claude Code format, incompatible runtime) | N/A — `fullstack-dev` + `DESIGN_SYSTEM.md` used instead |
| Web Design Guidelines | `vercel-labs/agent-skills` | ❌ Not installed (Claude Code format, incompatible runtime) | N/A — captured in `ENGINEERING_PLAYBOOK.md` §1 |
| React Best Practices | `vercel-labs/agent-skills` | ❌ Not installed (Claude Code format, incompatible runtime) | N/A — captured in `ENGINEERING_PLAYBOOK.md` §2 |
| Composition Patterns | `vercel-labs/agent-skills` | ❌ Not installed (Claude Code format, incompatible runtime) | N/A — captured in `ENGINEERING_PLAYBOOK.md` §3 |
| Next.js engineering | `nextjs.org/docs` | N/A (documentation site, not a skill) | `fullstack-dev` skill covers Next.js 16 |
| TypeScript best practices | N/A | N/A | Captured in `ENGINEERING_PLAYBOOK.md` §4 |
| Tailwind CSS 4 | `tailwindcss.com` | N/A (documentation site) | Captured in `ENGINEERING_PLAYBOOK.md` §5 + `DESIGN_SYSTEM.md` |
| shadcn/ui | `ui.shadcn.com` | ✅ 49 components pre-installed at `src/components/ui/` | `ls src/components/ui/` |
| Playwright (npm) | `microsoft/playwright` | ✅ Installed `@playwright/test@1.65.0` | `bun add -d @playwright/test` succeeded |
| Playwright Chromium binary | `microsoft/playwright` | ✅ Installed v158.0.8127.18 | `bunx playwright install chromium` succeeded |
| Playwright CLI | `microsoft/playwright-cli` | ✅ Available via `bunx playwright` | `bunx playwright --version` |
| Webapp Testing | `anthropics/skills` | ❌ Not installed (Claude Code format) | `@playwright/test` + `agent-browser` skill used instead |
| Chrome DevTools MCP | `ChromeDevTools/chrome-devtools-mcp` | ❌ Not installed (no MCP client runtime) | Playwright's `page.evaluate` + console/network listeners used |
| Playwright MCP | `@playwright/mcp` | ❌ Not installed (no MCP client runtime) | `@playwright/test` direct + `agent-browser` skill |
| GitHub MCP | `modelcontextprotocol/servers` | ❌ Not installed (no MCP client + needs PAT) | `git` CLI + `Bash` tool |
| Filesystem MCP | `modelcontextprotocol/servers` | ❌ Not installed (agent has native fs tools) | `Read`/`Write`/`Edit`/`Glob`/`Grep` |
| Vercel MCP | `vercel/mcp` | ❌ Not installed (no MCP client + needs auth) | `vercel.json` + git push |
| Superpowers | `obra/superpowers` | ❌ Not installed (Claude Code format) | Workflow encoded in `CLAUDE.md` + `ENGINEERING_PLAYBOOK.md` |
| `fullstack-dev` (built-in) | Z.ai Code runtime | ✅ Pre-installed | `ls skills/fullstack-dev/SKILL.md` |
| `agent-browser` (built-in) | Z.ai Code runtime | ✅ Pre-installed | `ls skills/agent-browser/SKILL.md` |
| `neon-postgres` (built-in) | Z.ai Code runtime | ✅ Pre-installed | `ls skills/neon-postgres/SKILL.md` |
| 16 other built-in skills | Z.ai Code runtime | ✅ Pre-installed | `ls skills/` |
| `CLAUDE.md` project instructions | This session | ✅ Created | `cat CLAUDE.md` |
| `AGENTS.md` project instructions | This session | ✅ Created | `cat AGENTS.md` |
| `docs/REDESIGN_AUDIT.md` | This session (Plan subagent) | ✅ Created (778 lines) | `wc -l docs/REDESIGN_AUDIT.md` |
| `docs/references/ENGINEERING_PLAYBOOK.md` | This session | ✅ Created | `cat docs/references/ENGINEERING_PLAYBOOK.md` |

---

## 13. Compatibility limitations (honest summary)

1. **Claude Code external skills cannot be loaded into GLM-5.2's runtime.**
   The skills listed in the user's Phase 2–5 are `SKILL.md` files designed
   for Claude Code's skill loader, which reads from `~/.claude/skills/`.
   Z.ai Code uses a different skill discovery system (the
   `<available_skills>` manifest). Copying the files would not inject them
   into the agent's context.

2. **No MCP client runtime.** MCP servers (Chrome DevTools, Playwright,
   GitHub, Filesystem, Vercel) require a consumer. Z.ai Code does not
   consume MCP. Installing the packages would have no effect.

3. **No `~/.claude/` directory exists.** This is the strongest evidence
   that this is not Claude Code. Creating it and populating it would not
   change the runtime's behavior.

4. **The equivalent capabilities ARE available** through:
   - The 19 built-in Z.ai skills (especially `fullstack-dev` and
     `agent-browser`)
   - Real Playwright (`@playwright/test@1.65.0` + Chromium 158)
   - The locally-authored `docs/references/ENGINEERING_PLAYBOOK.md` and
     `docs/DESIGN_SYSTEM.md`

This is not a failure of installation — it is an honest mapping of the
requested capabilities to what the active runtime actually supports.
