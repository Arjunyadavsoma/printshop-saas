# PrintShop / Printelyx — Revamp Diagnosis (Nov 23–24, 2026)

**Scope:** what the Nov 23–24 revamp broke, vs. the last known-working build.
**Working build:** merge commit `f464815` (Nov 22, 2026, PR #3).
**Latest origin/main examined:** `fb7dbbc` (Nov 24, 2026).
**Live site:** https://printelyx.cc.cd (Vercel project `printshop-saas`).
**Method:** read-only. Only `git diff`, `git show`, `git log`, `git grep`, `git ls-tree`
against commits — no checkout/reset/clean, no edits to code, no commit/push.
The working tree's uncommitted Gmail UTR work was not touched.
All file:line references below are to the **`fb7dbbc`** version unless stated otherwise.
Line numbers for `f464815` are marked as such.

**Scale of the change:** 48 commits, **627 files changed, +164,158 / −18,096** lines
(`git diff --shortstat f464815..fb7dbbc`). This was not one revamp but four stacked
rewrites landing in ~48 hours (Nov 22–24):

| Wave | Commits | What it did |
|---|---|---|
| Clear design system | `ea04eee`, `36a434d`, `f5d982a`, `90cba19`, `af64d3d` (Nov 23) | New `src/components/clear/` (27 components, Instrument Sans, dark mode), migrated customer routes, shells |
| Printelyx rebrand + route cleanup | `ed75b29`, `4224635`, `17f04e4`, `6f0a8fb` (Nov 23) | Brand rename, real info pages, old routes turned into redirects |
| Reference 1:1 replication | `cb28a04`, `4adf2c4`, `60196a5`, `aa64065`, `3679dc5` (Nov 23) | `.ref-*` CSS classes + `ReferenceCustomerFlow` (1,469 lines) + ref-shop pages |
| Audit P0–P2 + CI/perf | `65fe94c`, `2d54ff7`, `7ae3c3b`, `8d02f0e`, `744d513`, `fb7dbbc` (Nov 24) | Inline UTR entry, honest upload validation, CI repair, perf budgets |

---

## TL;DR — the one-sentence root cause

The revamp replaced the old full-width responsive pages with **phone-screen mockups
rendered as literal page layout**: every flagship page now renders inside
`.ref-screen.m` — a **390 px-wide, left-aligned, light-only** box
(`src/app/globals.css:487`) — with **no shared header/footer in the root layout**,
while the properly responsive Clear shells/components that were built in the same
revamp (`CustomerShell`, `ShopShell`, `CustomerOrderFlowV2`) are **dead code that
no route imports**. On a desktop browser (especially in dark mode, which the
site auto-enables) that is exactly the reported symptom: a ~370–390 px column
pinned to the left, the rest of the viewport empty dark ground.

---

## 1. The 370 px left column + ~80% empty black space

### 1.1 The exact mechanism (three compounding defects)

**Defect A — the width cap.** `src/app/globals.css:487`:

```css
.ref-screen.m { width: 100%; max-width: 390px; min-height: 100vh; }
.ref-screen.d { width: 100%; max-width: 1280px; min-height: 100vh; }
```

`.ref-screen` itself (`globals.css:476-486`) sets `display:flex; flex-direction:column;
color:#1C1C1E; background:#F2F3F7` and **no `margin: 0 auto`, no centering**.
It was copied 1:1 from a phone mockup (`upload/PrintShop Clear design screens.html`,
added in the same diff) where 390 px *is* the viewport. On desktop it is a
390 px column inside a ~1440–1920 px viewport.

**Defect B — no centering wrapper anywhere.** Every `.ref-screen.m` usage sits in
a full-width, left-aligned parent:

- `/` — `src/app/page.tsx:69`: `<div className="ref-screen m">` is the direct
  child of `<body>` (root layout renders `{children}` bare, see §2). Nothing centers it.
- `/s/[shopSlug]` — `src/app/s/[shopSlug]/page.tsx:65-66`:
  `<div className="customer-flow min-h-dvh flex flex-col items-center"><main className="flex-1 w-full">`
  — the `items-center` is defeated by the `w-full` `<main>`; the `ReferenceCustomerFlow`
  inside it renders its own `<div className="ref-screen m">` at lines 969, 1024, 1146,
  1222, 1284, 1350, 1422, left-aligned.
- `/shop/dashboard` — `src/app/shop/dashboard/page.tsx:189`; `/shop/payments` —
  `src/app/shop/payments/page.tsx:282`; `/shop/orders/[id]` — lines 290/300/321/341;
  mobile list in `/shop/orders` — line 496. All bare `<div className="ref-screen m">`
  inside `src/app/shop/layout.tsx:216-218`'s bare `<div className="min-h-dvh bg-page">`
  passthrough for ref-shop routes (see §4.3).

**Defect C — the "black" void is dark mode.** The ground outside the column is
`--ground`, which is `#F2F3F7` (light grey) in light mode but **`#0B0B0D` (near-black)
in dark mode** (`globals.css:227-228`, `.dark { --ground: #0B0B0D; ... }`).
Dark mode is **auto-enabled**: `src/app/layout.tsx` (fb7dbbc) injects a
`beforeInteractive` `theme-init` script that adds the `dark` class whenever
`localStorage.theme === 'dark'` **or no stored theme and
`prefers-color-scheme: dark`**. So any user whose OS is in dark mode — the common
case — sees a light-grey 390 px column on a black page. In light mode the same
bug presents as a light-grey void instead of black; the column width is wrong
in both modes. The `.ref-*` classes hardcode light colours with **no `.dark`
variants at all** (`globals.css:476-581`: `#1C1C1E` text, `#FFFFFF` cards,
`#F2F3F7` ground), so the column itself never adapts either.

**Contrast with the working build:** `f464815` `src/app/page.tsx:145,153` used
`<div className="flex min-h-screen flex-col bg-page">` with
`mx-auto max-w-6xl` sections; `f464815` `src/app/orders/[id]/page.tsx:756-774`
used `mx-auto max-w-4xl`. Everything was centred and full-width-responsive.

### 1.2 Which pages are hit by the 390 px column

| Page | Container in fb7dbbc | Effect on desktop |
|---|---|---|
| `/` (homepage) | `page.tsx:69` `ref-screen m` | 390 px left column; footer is 3 links *inside* the column |
| `/s/[shopSlug]` (QR landing / order flow) | `ReferenceCustomerFlow.tsx` ×7 `ref-screen m` | 390 px left column for all 7 steps (landing → track) |
| `/shop/dashboard` | `dashboard/page.tsx:189` `ref-screen m` | 390 px left column, no sidebar on desktop |
| `/shop/payments` | `payments/page.tsx:282` `ref-screen m` | 390 px left column |
| `/shop/orders/[id]` | `orders/[id]/page.tsx:290-341` `ref-screen m` (×4 states) | 390 px left column |
| `/shop/orders` (mobile list) | `orders/page.tsx:496` `ref-screen m` | 390 px left column below 1280 px breakpoint handling; desktop kanban uses `ref-screen d` (1280 px, line 410) — also left-aligned, no `margin:auto` |
| `/o/[token]`, `/orders`, `/help`, `/privacy`, `/track` | `mx-auto max-w-xl` (576 px) / `max-w-md` (448 px) | Narrow **but centred** — deliberate mobile-first width, not the left-column bug |
| `/about`, `/pricing`, `/terms`, `/refund-policy`, `/how-it-works`, `/contact` | `max-w-2xl mx-auto` (672 px) | Narrow but centred; no header/footer (see §2) |
| `/shop/services`, `/settings`, `/devices`, `/staff`, `/customers`, `/reports` | Clear shells (see §4.3) | Full-width inside shell (desktop `max-w-[1280px]`, tablet 960 px, mobile 640 px) — **not** affected by the 390 px bug, but affected by the triple-mount bug (§4.4) |

---

## 2. No shared header / footer

**Root cause:** the root layout never rendered one, in either build — but the old
pages each rendered their own full-width header + footer, and the revamp deleted
those without replacing them.

- `src/app/layout.tsx` (fb7dbbc): renders `<AuthProvider><ThemeProvider>{children}
  </ThemeProvider></AuthProvider><Toaster /><PWARegister />` only. No `<header>`,
  no nav, no `<footer>`, no `SiteFooter`. (The f464815 layout was the same shape —
  the header/footer lived in the pages.)
- `src/components/phase1/site-footer.tsx` (fb7dbbc, 31 lines) exists and is a real,
  centred `max-w-6xl` footer — but **`git grep SiteFooter` in fb7dbbc finds zero
  imports**: it is dead code. It was equally unimported in f464815, so this is a
  long-standing dead component, not a revamp regression — but the revamp removed
  the *inline* footers that had been doing the job instead.
- What f464815 had and fb7dbbc lost:
  - Homepage: `f464815 page.tsx:153,349-381` — hero `<header>` (`max-w-6xl`) and a
    full footer with Shopkeeper portal / Register / Source-code links. fb7dbbc
    `page.tsx:209-218` replaces it with a `<footer className="ref-cap">` containing
    only Help / About / Contact, trapped inside the 390 px column.
  - `/s/[shopSlug]`: `f464815 page.tsx` had a per-shop `<header>` (shop name +
    Open/Closed badge, `max-w-xl` centred). fb7dbbc's `ReferenceCustomerFlow`
    has only a `.ref-top` strip (shop name + dot) inside the 390 px column, and
    no footer at all.
  - `/orders/[id]` (customer): `f464815` lines 756/921 — centred `max-w-4xl`
    header + footer. fb7dbbc deleted the whole page (see §5.1).
- What fb7dbbc *does* have, inconsistently: Clear `AppBar` (shop/order name +
  back button, sticky frosted) on `/o/[token]` (`page.tsx:351` etc.), `/orders`
  (`orders/page.tsx:58`), `/help` (`help/page.tsx:69`), `/privacy`
  (`privacy/page.tsx:74`) — but **not** on `/`, `/s/[shopSlug]`, `/about`,
  `/pricing`, `/terms`, `/refund-policy`, `/how-it-works`, `/contact`,
  `/track` (which has no AppBar, just an `<h1>`), or any `/shop/*` auth page.
  There is no shared marketing/site chrome anywhere; each page is on its own.

---

## 3. Orphan pages (Terms / Pricing / Track unlinked)

The revamp **created** the missing pages (good — see §6) but **never linked them
into any navigation**. Verified by `git grep` for `href="/pricing"`,
`href="/terms"`, `href="/track"`, `href="/refund-policy"`,
`href="/how-it-works"`, `href="/download-app"` across `src/app` +
`src/components` in fb7dbbc: **zero hits for all six**.

| Page | Exists? | Linked from any UI? |
|---|---|---|
| `/pricing` (`pricing/page.tsx`, 44 lines, new) | Yes | **No** — only in `sitemap.ts` |
| `/terms` (`terms/page.tsx`, 64 lines, new) | Yes | **No** — only in `sitemap.ts` |
| `/track` (`track/page.tsx` + `track-client.tsx`, new) | Yes | **No** — only in `sitemap.ts`; homepage "How it works" section doesn't link it; `/orders` page doesn't link it |
| `/refund-policy` (`refund-policy/page.tsx`, 24 lines, new) | Yes | **No** — only in `sitemap.ts` |
| `/how-it-works` (`how-it-works/page.tsx`, 35 lines, new) | Yes | **No** — only in `sitemap.ts`; homepage has a "How it works" *section* (page.tsx:184-195) that does not link to the page |
| `/download-app` (`download-app/page.tsx` + client, new) | Yes | **No** — only in `sitemap.ts` |
| `/privacy` (`privacy/page.tsx`, 162 lines, new) | Yes | Yes — linked from `/about:34`, `/help:151`, `/o/[token]:710`, `/orders:119` (footer text only) |
| `/about`, `/contact`, `/help` | Yes | Yes — the only three links in the homepage footer (`page.tsx:212-214`) |

`src/app/sitemap.ts` (new, 30 lines) lists all 11 public routes, so the pages are
discoverable by search engines but **unreachable by any human navigating the site**
— no header nav, no footer nav, no link from the homepage, the shop flow, or
the order/tracking pages. `/terms` is additionally the page a checkout flow
normally links for legal consent; nothing does.

---

## 4. Bug-by-bug: exact causes

### 4.1 White-on-white Contact button

**File:** `src/app/contact/page.tsx:29,48,59` (new file, added by `4224635`).

```tsx
<div className="mt-6 rounded-[14px] bg-white p-4">                          {/* :29 */}
  <Link href="/orders" className="... text-[var(--label)]">…Find my order…</Link>
<a className="... rounded-[14px] bg-white px-4 ... text-[var(--label)]">     {/* :48, :59 */}
  <Mail …/> Email support   /   <MessageSquare …/> WhatsApp support
```

The cards hardcode **`bg-white`** (literal `#FFFFFF`) while the text uses the
**theme variable `text-[var(--label)]`**. In light mode `--label` is `#1C1C1E`
(dark, readable). In dark mode `--label` is **`#F2F3F7` (near-white)**
(`globals.css` `.dark` block) — near-white text on a hardcoded white card =
invisible/white-on-white. The correct token is `bg-[var(--surface)]`
(`#FFFFFF` light / `#1C1C1E` dark), which the Clear components use. Same
hardcoded-`bg-white` pattern also at `src/app/download-app/download-app-client.tsx:110`
(QR card) and `src/app/offline/page.tsx:15`.

**Second, independent Contact defect:** the Email/WhatsApp buttons are
**rendered only if env vars are set** — `contact/page.tsx:47,56` guard on
`hasSupportEmail()` / `hasSupportWhatsApp()`, which read
`NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_WHATSAPP`
(`src/lib/customer/support-config.ts`). If those are unset in the Vercel
production env (not verifiable from the repo — no `.env` is committed), **no
contact button renders at all** and the page falls through to the "In-app
support is being set up" paragraph (`:64-70`). So on live the button is either
invisible (dark mode) or absent (missing env) — both consistent with the report.
The `/orders` "Find my order and call the shop" card (`:29-37`) has the same
`bg-white` + `text-[var(--label)]` combination.

### 4.2 Register page shows validation errors on first load

**File:** `src/app/shop/register/page.tsx:211-223` (+ `Field` at `:740-779`).

```tsx
const accountErrors = useMemo(() => {          // :211 — runs on EVERY render
  const errs: Record<string, string> = {};
  if (!state.account.email) errs.email = 'Email is required';       // empty on load → error
  …
  if (!state.account.name.trim()) errs.name = 'Your name is required';
  return errs;
}, [state.account]);
```

The errors are computed **unconditionally from the current (empty) state** and
passed straight into every field — e.g. `:399,408,419,432,457`
`error={accountErrors.name/phone/email/password/passwordConfirm}` — and `Field`
(`:771-777`) renders `{error && <p className="text-xs text-danger">{error}</p>}`
whenever an error string exists. **There is no `touched`, `dirty`, or
`submitted` gate anywhere in the file** (`grep touched|submitted|validate`
returns only `slugTouched`, which gates slug autofill, not errors). First paint
therefore shows "Email is required", "Password is required", "Phone is
required", "Your name is required" under empty fields, and `canAdvance`
(`:239-243`) is false for the same reason.

**Attribution correction:** `git diff --stat f464815..fb7dbbc --
src/app/shop/register/page.tsx` is **empty — the register page was not changed
by the revamp**. This bug pre-dates Nov 23 and existed in the working build too;
it was surfaced (not introduced) by the revamp window. Same for
`src/app/shop/login/page.tsx` (unchanged in the range). Fix is the same either
way: gate error display on blur/submit, or compute errors only after first
attempt.

### 4.3 Clipped email placeholder — NOT reproducible from code (needs a live check)

No code-level clipping defect was found in either email input:

- Login: `src/app/shop/login/page.tsx:130-140` — `<Input id="email" type="email"
  placeholder="you@example.com" className="h-11 text-base" />`, full-width
  inside `w-full max-w-md` (`:109`). Old `src/components/ui/input.tsx` is
  `h-9 w-full … px-3 py-1 text-base`, overridden to `h-11` — 44 px tall, 16 px
  text, no truncation mechanism.
- Register: `register/page.tsx:417-426` — email `Field` with
  `placeholder="owner@myprintshop.com"`, `Field`'s `Input` is
  `className="h-11 text-base sm:h-10"` (`:771`), full-width row (not in the
  2-column grid).

Two concrete placeholder defects **were** found and may be what was seen:

1. `/track` — `src/app/track/track-client.tsx:60`:
   `placeholder="https://printelyx.app/o/..."` — **wrong domain**
   (live domain is `printelyx.cc.cd`; `printelyx.app` is not the site). If a user
   copies that shape it also fails the token regex at `:42-48`.
2. The Clear `Input` (`src/components/clear/input.tsx`) is fine, but the old
   `ui/input` sets `md:text-sm` — at desktop widths text shrinks while the
   `h-11` override stays, which can look cramped but does not clip.

**Verdict:** do not "fix" this from code alone. It needs a live screenshot of
`/shop/login` (and `/shop/register`) at the reporter's viewport to see which
field clips; the code paths above are the ones to inspect in that screenshot.
Possibly a browser-zoom / autofill-overlay artifact rather than a CSS bug.

### 4.4 Shop page "Add files" click doing nothing visible

**File:** `src/app/s/[shopSlug]/ReferenceCustomerFlow.tsx` (live flow; see §5.3).

The button itself is wired — `:978-980`:

```tsx
<button type="button" className="ref-btn" style={{ width: '100%' }}
  onClick={triggerFileInput}>Add files</button>
```

with `triggerFileInput` (`:223-225`) doing `fileInputRef.current?.click()` on the
hidden input (`:922-940`, `type="file" multiple style={{display:'none'}}`,
`onChange` → `onPick`). The failure is **downstream of the click, in feedback** —
three stacked causes, any one of which reads as "nothing happened":

1. **No optimistic UI; the step change is gated on the whole upload chain.**
   `onPick` (`:306-417`) only calls `setStep('files')` at **line 413, after**
   `uploads/init` → all chunk `PUT`s → `uploads/complete` have *all* succeeded.
   The first file row is only seeded after `init` returns (`:352-367`). While
   `init` is in flight — or if it fails/hangs (DB, storage, network) — the
   landing screen shows **no spinner, no progress, no "uploading…" state**; the
   button just sits there. On failure the only feedback is the `catch` at
   `:414-416` → `setError(...)`.
2. **The error banner renders outside the visible column.** The banner
   (`:940-963`, `role="alert"`, `margin:'16px 20px 0'`) is a sibling rendered
   *before* the `ref-screen m` divs, at full viewport width — detached from the
   button, and on desktop it appears at the far left above a 390 px column
   (or, if the page scrolled, off-screen). A failed pick therefore looks like
   nothing happened unless the user notices a thin red strip at the top-left.
3. **Fragile trigger + picker mismatch.** A programmatic `.click()` on a
   `display:none` file input is ignored by iOS Safari / some mobile browsers
   (the documented workaround is `opacity:0; position:absolute` instead of
   `display:none`). And the input's `accept` attribute (`:926`) lists only
   `.pdf,.jpg,.jpeg,.png,.docx` while the validator `SUPPORTED_EXT` (`:315`)
   also allows `.webp,.heic,.heif,.doc,.pptx,.xlsx` — those types can't even be
   picked in the OS dialog, yet are advertised as supported ("PDF, photos or
   Word files", `:976`).

Note the same `triggerFileInput` is reused by the files-step button (`:1122`).
The *correctly built* alternative, `UploadDropzone`
(`src/components/clear/upload-dropzone.tsx`, used by the dead `CustomerOrderFlowV2`),
shows drag/drop + immediate file rows — it is not what ships.

### 4.5 Redirect routes that always land on `/`

**Files:** `src/app/shops/[slug]/page.tsx` and `src/app/orders/[id]/page.tsx`
(both 9 lines in fb7dbbc, identical body):

```tsx
export default function OldRouteRedirect({ params }: { params: Promise<{ slug?: string; id?: string }> }) {
  const { slug, id } = params instanceof Promise ? {} as { slug?: string; id?: string } : params;
  if (slug) redirect(`/s/${slug}`);
  if (id) redirect(`/shop/orders/${id}`);
  redirect('/');
}
```

In Next.js 16 (`package.json`: `"next": "^16.1.1"`) `params` is **always a
Promise**, so `params instanceof Promise` is always true, `slug`/`id` are always
`undefined`, and **both routes unconditionally `redirect('/')`** — the intended
targets (`/s/<slug>`, `/shop/orders/<id>`) are unreachable. The author knew
params is async elsewhere (`src/app/s/[shopSlug]/page.tsx` correctly does
`await params`). Old shared links (`/shops/<slug>`, `/orders/<id>`) and any
bookmark therefore dump the user on the homepage with no explanation.
`/shop/print-jobs/page.tsx` has the same shape but its fallthrough
(`redirect('/shop/orders')`) is intentional per its own comment (the queue lives
at `/shop/orders`), so that one is correct by design.

### 4.6 Shopkeeper portal: two shells fighting + triple-mounted pages

**File:** `src/app/shop/layout.tsx` (fb7dbbc, 277 lines; f464815 was 158 lines,
single `AppShell`).

1. **Ref-shop routes bypass all shells.** `isRefShopRoute` (`:115-119`:
   `/shop/dashboard`, `/shop/orders`, `/shop/payments`, `/shop/orders/*`) returns
   bare children (`:216-218` `<div className="min-h-dvh bg-page">{children}</div>`).
   Those four pages render their own `.ref-screen` chrome (top strip + tab bar /
   sidebar inside the page). Consequence: **no desktop sidebar, no shared top
   bar, and the 390 px column** (§1) on the four most-used shopkeeper pages.
   Their in-page nav (`RefShopTabBar` / `RefShopSidebar` from
   `src/components/ref-shop/`) duplicates what the Clear shells already provide.
2. **Non-ref routes render their children three times.** `:244-275` mounts
   `<ShopShellMobile>{children}</ShopShellMobile>` **and**
   `<ShopShellTablet>{children}</ShopShellTablet>` **and**
   `<ShopShellDesktop>{children}</ShopShellDesktop>`, relying on CSS to hide
   two of them. Client components mount 3×, effects and API calls fire 3×
   (the layout's own badge-count fetch is in the layout, but every page-level
   `useEffect` fetch — services, settings, devices, customers, reports, staff —
   runs in triplicate). The comment at `:240-242` even concedes this
   ("children render once per shell (acceptable …)").
3. **Tablet/desktop overlap at 768–1023 px.** `ShopShellDesktop` root
   (`src/components/clear/shop-shell-desktop.tsx:76`) is
   `hidden md:flex` — it is **missing the `lg:` prefix** — while
   `ShopShellTablet` (`shop-shell-tablet.tsx:83`) is correctly
   `hidden md:flex lg:hidden`. At 768–1023 px **both the 72 px icon rail and
   the 256 px sidebar render side by side, each with its own copy of the page**.
   (Mobile `<768px` is fine — `shop-shell-mobile.tsx:74` `md:hidden`.)
   The old `ShopShell` in `src/components/clear/shop-shell.tsx` (140 lines,
   correct single-shell design) is **imported by nothing**.
4. **Dead legacy fallback:** `?legacy=1` (`layout.tsx:121-123,223-235`) renders
   the old `AppShell` with `NAV_GROUPS` — but the old shell's `app-shell.tsx`
   itself only changed 4 lines in the range, and no page opts into it.

### 4.7 Other concrete defects found in the same pass

- **`/o/[token]` error/not-found states have no horizontal padding:**
  `src/app/o/[token]/page.tsx:391,407,424` — `<main className="mx-auto max-w-xl">`
  with no `px-4` (the loading state at `:352` and the success state at `:464`
  correctly have `px-4 py-6`). Content touches the viewport edge on mobile for
  not-found / error / empty states.
- **`.ref-*` hardcodes light mode everywhere** (`globals.css:476-581`): text
  `#1C1C1E`, cards `#FFFFFF`, `.ref-btn` `#0A58D6` on `#fff`, `.ref-utrsheet-card`
  `background:#fff`. With the auto-dark theme-init script, the whole customer
  flow and shop portal are light-only islands inside a dark app.
- **Instrument Sans replaces the old font stack** (`layout.tsx`: Geist →
  Instrument Sans, Latin-only) and Hindi/Telugu content was removed
  (`ea04eee`, `36a434d`) — a product decision, but it means any Hindi/Telugu
  shop content now renders in fallback fonts or not at all; flag, don't assume.
- **`CustomerShell` is dead code:** `src/components/clear/customer-shell.tsx`
  (64 lines — the *correct* responsive wrapper: `max-w-[1120px]` two-pane on
  desktop at `:45`, `max-w-[640px]` single column at `:53`, with `AppBar` +
  sticky `PriceBar`) is exported from `src/components/clear/index.ts:130` but
  **imported by zero routes** (`git grep CustomerShell` in fb7dbbc finds only
  its definition + the index export). The same holds for `ShopShell`
  (`clear/shop-shell.tsx`). The revamp built the right abstraction, then
  shipped the mockup classes instead of using it.
- **`/shop/settings` is 1,199 lines of old UI** (`settings/page.tsx`) and still
  imports the uncommitted Gmail UTR work's neighbours; it renders inside the
  triple shell (§4.6.2) — not itself broken by the revamp, but it never got the
  Clear treatment the commit messages claim ("all customer routes migrated …
  no old imports remain", `af64d3d` — false for `/shop/*`: login, register,
  forgot/reset, services, settings, devices, staff, customers, reports all
  still import `@/components/ui/*`).

---

## 5. What the revamp deleted / rewrote (file inventory)

### 5.1 Deleted or gutted (largest regressions)

| File | f464815 → fb7dbbc | Note |
|---|---|---|
| `src/app/orders/[id]/page.tsx` | 2,044 lines → **9-line redirect** (broken, §4.5) | The entire customer order-detail page (status, files, payment) is gone; `/o/[token]` is now the only tracking surface |
| `src/app/shops/[slug]/page.tsx` | 400 lines → **9-line redirect** (broken, §4.5) | The public shop page is gone; `/s/[slug]` is the only shop surface |
| `src/app/s/[shopSlug]/CustomerOrderFlow.tsx` | 593 lines → **deleted** | Replaced by `ReferenceCustomerFlow.tsx` (1,469 lines, live) — and by `CustomerOrderFlowV2.tsx` (2,123 lines, **dead**, see §5.3) |
| `src/app/shop/dashboard/page.tsx` | 1,188 lines → 287 lines | Full dashboard (tables, PrintEXE overview, alerts) → 390 px ref-screen summary |
| `src/app/shop/orders/page.tsx` | 1,464 lines → 538 lines | Full orders table/review UI → ref-screen kanban + mobile list |
| `src/app/shop/orders/[id]/page.tsx` | 1,616 lines → 458 lines | Full order detail → ref-screen screens |
| `src/app/shop/payments/page.tsx` | 652 lines → 348 lines | → ref-screen |
| `src/app/shop/print-jobs/page.tsx` | real resolution UI → 11-line redirect to `/shop/orders` | Intentional per comment, but the needs-review job-resolution surface is gone |
| `src/app/page.tsx` | 576 lines → 258 lines | Full-width hero/features/shops → 390 px ref-screen list |
| `src/app/o/[token]/page.tsx` | 797 lines → 721 lines (rewritten onto Clear) | Kept, and the best-migrated customer page (centred `max-w-xl`, AppBar, UTR input) |
| `src/components/phase4/customer-app.tsx` | 388 lines → **deleted** | Old customer app shell removed |
| `src/lib/upload/file-validation.ts` + tests, `upload/*` pasted content | deleted | Replaced by new validation in `src/lib/upload/*` / pipeline (see §6) |
| `src/app/globals.css` | 581 lines, +530/−223 | Square UI tokens → Clear tokens + ~110 lines of `.ref-*` mockup CSS appended |

### 5.2 New files (selection)

- **Clear system (all new):** `src/components/clear/` — 27 components
  (`tokens.ts` is only 7 lines — just the `PageMode` type; the real tokens live
  in `globals.css`), `customer-shell.tsx`, `shop-shell*.tsx`, `app-bar.tsx`,
  `page-strip.tsx`, `upload-dropzone.tsx`, `utr-input.tsx`, `payment-sheet.tsx`,
  `compat.ts` (old-name re-exports), `gallery.tsx`, `index.ts`.
- **Ref-shop (all new):** `src/components/ref-shop/` — `RefShopLayout.tsx`,
  `RefShopSidebar.tsx`, `RefShopTabBar.tsx`, `index.ts`.
- **New public pages:** `about`, `contact`, `help` (+layout), `how-it-works`,
  `pricing`, `privacy`, `refund-policy`, `terms`, `orders/page.tsx` (392 lines),
  `track/` + `track-client.tsx`, `download-app/` + client, `offline/page.tsx`,
  `sitemap.ts`, `o/[token]/` + `s/[shopSlug]/` loading/error/not-found files.
- **New customer flow (dead):** `CustomerOrderFlowV2.tsx` (2,123 lines),
  `CustomerOrderFlowV2Lazy.tsx`, `CustomerFlowSkeleton.tsx`,
  `ReferenceColorPages.tsx` (313 lines).
- **Backend/supporting (new):** OTP service (`src/lib/auth/otp-*`), offline
  queue (`src/lib/customer/offline-queue.ts` + tests), realtime client, UPI link
  lib + 684-line tests, queue/claim services, dispatcher gate, security tests
  (IDOR, order-token, payment-validation, PII-scan, retention), axe tests,
  `src/lib/customer/*` (analytics, draft-storage, last-choices, recent-orders).

### 5.3 Two competing customer flows shipped; the wrong one is live

- **Live:** `ReferenceCustomerFlow.tsx` (1,469 lines), imported by
  `src/app/s/[shopSlug]/page.tsx:4,74`. Inline styles + `.ref-*` classes, 7
  hardcoded steps, own upload logic. This is the flow with the 390 px column
  and the Add-files feedback gap (§4.4).
- **Dead:** `CustomerOrderFlowV2.tsx` (2,123 lines) + `CustomerOrderFlowV2Lazy.tsx`.
  Built on the Clear system (`Stepper`, `UploadDropzone`, `FileCard`,
  `PageStrip`, `PaymentSheet`, `UTRInput`), with draft recovery, colour
  suggestions, and analytics. **Imported by nothing** — `git grep
  CustomerOrderFlowV2` in fb7dbbc finds only its own file, the lazy wrapper,
  and a comment in `CustomerFlowSkeleton.tsx`. Its root is a plain
  `<section className="flex flex-col gap-4">` (`:1358`) with no shell of its
  own — it was designed to sit inside `CustomerShell`, which is also dead.
- The old `CustomerOrderFlow.tsx` was deleted, so there is no fallback: the
  live flow is the mockup replica, and the engineered flow is orphaned.

---

## 6. What the revamp ADDED that is genuinely good — keep

1. **Real info pages** (new in `4224635` / `2d54ff7`): About, Pricing, Contact,
   Help, Privacy, Terms, Refund Policy, How it Works, Track, Download-app,
   `/orders` (device-local order list), sitemap + per-route metadata/canonicals.
   Content is honest (e.g. Contact hides controls when support env is unset
   instead of showing fake addresses). **Keep the pages; fix the navigation
   (§3) and the `bg-white` bug (§4.1).**
2. **Inline UTR entry** (`65fe94c`, audit P0-1): `src/components/clear/utr-input.tsx`
   + `.ref-utrsheet` bottom sheet (`globals.css`) + `UTRInput` on `/o/[token]`
   replaces `window.prompt()` for UPI payment proof. **Keep.**
3. **Honest upload validation** (`65fe94c`, `8d02f0e`, audit P0-2/P0-3):
   client-side extension gate in `ReferenceCustomerFlow.tsx:315`, server-side
   validation + local storage provider, file-status polling instead of silent
   hangs. **Keep the validation; fix the feedback gap (§4.4).**
4. **CI repairs** (`8d02f0e`, `744d513`, `fb7dbbc`): gitignored adapter + public
   PNGs committed, `127.0.0.1` service DB, `ci.yml` db push + tiered vitest,
   Postgres port mapping. **Keep.**
5. **Perf/a11y work** (`7ae3c3b`): home Lighthouse 69→85, CLS 0.306→0,
   a11y 98, `lighthouserc` budgets, axe tests, reduced-motion + focus-visible
   rules in `globals.css`. **Keep** (note: the CLS win is partly because the
   homepage is now a fixed 390 px column — re-measure after the layout fix).
6. **Clear design system itself** (`36a434d`–`af64d3d`): coherent tokens
   (`--ground/--surface/--label/--accent…`), dark mode with AA-verified pairs,
   48 px touch targets, 16 px inputs, `AppBar`/`PriceBar`/`PageStrip`/
   `UTRInput`/`PaymentSheet` components, and the (unused) `CustomerShell` /
   `ShopShell` wrappers. **Keep the system; start actually using it** —
   it is the fix for most of §1–§4.
7. **Backend hardening** (`ff813b2`, `b204ae5`, `ee2c9b0`): queue claim/lease,
   dispatcher gate, OTP service, offline queue + draft recovery, realtime
   order tracking, security test suites, honest wait-time + rate-board math on
   `/s/[shopSlug]` (fallback pricing so demo shops work). **Keep.**
8. **Rebrand to Printelyx** (`17f04e4`): consistent naming, metadata/OpenGraph,
   `printelyx.cc.cd` canonical. **Keep.**
9. **`/o/[token]` Clear migration**: the one customer page that came out
   well — centred, AppBar, `StatusTimeline`, `TokenSlip`, `PriceBreakdown`,
   inline UTR. **Keep as the template** for migrating the other customer pages.
10. **Dead-UI cleanup in the same wave** (`2d54ff7`): removed fake support
    contacts, fixed the `/shop/print-jobs` dead-end redirect, `robots.txt` /
    sitemap consistency. **Keep.**

---

## 7. Recommended fix direction (diagnosis only — no code changed)

In priority order; each is a small, reversible change against fb7dbbc:

1. **Kill the 390 px column (P0).** Delete `.ref-screen.m/.d` usage as page
   layout. Put `/` and `/s/[shopSlug]` inside `CustomerShell`
   (already built: `max-w-[1120px]` desktop two-pane / `max-w-[640px]` mobile,
   `customer-shell.tsx:45,53`) and the ref-shop pages inside the Clear
   `ShopShell*` shells — or, minimally, add `margin: 0 auto` and a desktop
   `max-width` to `.ref-screen` and give `.ref-*` dark variants. Do not ship
   both systems: pick Clear, delete `.ref-*` CSS + `ReferenceCustomerFlow`'s
   inline styles, and **wire up the already-built `CustomerOrderFlowV2`** (or
   delete it — 2,123 dead lines is a liability either way).
2. **Restore one shared header/footer (P0).** Render a real site header + footer
   in `src/app/layout.tsx` (or a `SiteHeader`/`SiteFooter` pair used by all
   public pages), linking **every** public route (§3). The existing
   `SiteFooter` component is a usable starting point but has no links to
   Pricing/Terms/Track — add them.
3. **Fix the shop layout (P0).** Render children **once** (pick shell by
   breakpoint in one component, or use CSS-only visibility on the *chrome*,
   not by mounting `{children}` 3×); fix `shop-shell-desktop.tsx:76`
   `hidden md:flex` → `hidden lg:flex`; decide ref-shop vs Clear shells and
   delete the loser (including `ref-shop/` if Clear wins).
4. **Fix the redirects (P0).** `await params` in `shops/[slug]/page.tsx` and
   `orders/[id]/page.tsx` (Next 16) instead of the `instanceof Promise` check.
5. **Fix Contact (P1).** `bg-white` → `bg-[var(--surface)]` in
   `contact/page.tsx:29,48,59` (and the same pattern in download-app/offline);
   confirm `NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_WHATSAPP` are set
   in Vercel production, or the buttons intentionally stay hidden.
6. **Fix Register (P1).** Gate `accountErrors`/`businessErrors` display on
   field blur or first submit attempt in `register/page.tsx:211-239,740-779`.
   (Pre-existing bug, §4.2.)
7. **Fix Add-files feedback (P1).** In `ReferenceCustomerFlow.tsx`: seed the
   file row + switch to the files step **optimistically on pick** (before
   `init` resolves); show an uploading state on the landing step; move the
   error banner inside the visible column; replace `display:none` with an
   accessible visually-hidden input; align `accept` with `SUPPORTED_EXT`.
8. **Fix `/o/[token]` padding (P2).** Add `px-4 py-6` to the mains at
   `:391,407,424`.
9. **Verify live after fixing (P1).** The "clipped email placeholder" (§4.3)
   and the exact Add-files failure mode need a live browser check with a
   screenshot + network log; neither is conclusively reproducible from the
   code alone. Also re-run Lighthouse after the layout fix — the claimed
   CLS 0 / home 85 numbers were measured against the 390 px column.

## Appendix — verification notes & limits

- Read-only diagnosis; no browser, no build, no dev server was run, so all
  findings are from source at `fb7dbbc` vs `f464815`. Live behaviour (Vercel
  env vars for support contact, actual dark-mode preference of the reporter,
  network behaviour of `uploads/init` in production) could not be confirmed
  from the repo and is flagged where it matters (§4.1, §4.3, §4.4).
- `SiteFooter` and `CustomerShell`/`ShopShell` were unimported in **both**
  commits — dead code predating the revamp, exposed by it rather than caused
  by it. The register-errors bug (§4.2) likewise predates the revamp
  (file unchanged in the range).
- Working-tree state at diagnosis time: `HEAD` is `f464815` with uncommitted
  Gmail UTR work (modified `prisma/schema.prisma`,
  `src/app/shop/orders/[id]/page.tsx`, `src/app/shop/settings/page.tsx`,
  `src/lib/repositories/index.ts`, plus untracked Gmail files). None of it was
  read, modified, stashed, or committed; all comparisons used committed trees
  only. Note the Gmail work touches `src/app/shop/orders/[id]/page.tsx`, which
  the revamp rewrote (1,616 → 458 lines) — merging that branch will need care
  regardless of this diagnosis.
