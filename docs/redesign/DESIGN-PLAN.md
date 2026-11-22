# PrintShop Customer Mobile Experience — Phase 1 Design Plan

**Date:** 2026-11-22
**Designer:** Principal product designer
**Subject:** Indian neighbourhood print shops — ink, paper, CMYK process colours, halftone dots, registration marks, counter token slips, rate boards.
**Core visual idea:** the colour vs B&W distinction IS the product, so it IS the design. B&W = black ink (K channel). Colour = full CMYK process. Every page is a small paper sheet that flips between halftone-black and process-colour when tapped.

---

## 1. Colour System

### Named colours (6 core + 4 semantic)

The palette is grounded in **CMYK process inks** — the four plates a printing press uses. This is not a random brand palette; it's the literal vocabulary of the product's domain.

| Name | Hex | Role | WCAG AA check |
|------|-----|------|---------------|
| **Paper** | `#F7F8FA` | App background — the cool off-white of recycled printer paper | — |
| **Surface** | `#FFFFFF` | Cards, sheets, inputs — fresh A4 paper | Ink on Surface = 16.0:1 ✓ AAA |
| **Ink** | `#0F1B2D` | Primary text, borders, halftone dots — deep navy-black like printer toner | Ink on Paper = 14.5:1 ✓ AAA |
| **Muted** | `#5B6675` | Secondary text, captions, timestamps — pencil-mark grey | Muted on Paper = 5.2:1 ✓ AA |
| **Cyan-ink** | `#006FA6` | Primary action (buttons, links, active states) — the C in CMYK | White on Cyan = 5.3:1 ✓ AA; Cyan on Paper = 4.8:1 ✓ AA |
| **Magenta-ink** | `#C2185B` | Colour-page indicator, "Colour" chips — the M in CMYK | White on Magenta = 5.9:1 ✓ AA; Magenta on Paper = 5.9:1 ✓ AA |

### Semantic colours

| Name | Hex | Role | WCAG AA check |
|------|-----|------|---------------|
| **Success** | `#0B7A4B` | Paid, Ready, Collected | White on Success = 4.5:1 ✓ AA (borderline — use 600-weight text) |
| **Warning** | `#F59E0B` | Slow, needs attention — amber like a rate-board highlight | Ink on Warning = 7.5:1 ✓ AAA (always dark text on amber) |
| **Error** | `#B3261E` | Failed, Rejected, Cancelled — like a rubber stamp "REJECTED" | White on Error = 5.9:1 ✓ AA |
| **Yellow-ink** | `#FFD60A` | Decorative only (registration marks, halftone accents) — the Y in CMYK. Never used for text. | — |

### The colour/B&W visual distinction (the heart of the system)

| State | Visual treatment | Never colour-alone signals |
|-------|-----------------|---------------------------|
| **B&W page** | Halftone dot pattern — black dots (`Ink` at 20% opacity) on white. Looks like a printed B&W page. | Chip says "B&W" + carries a filled-square icon |
| **Colour page** | Vivid process-ink fill — `Magenta-ink` (#C2185B) with a subtle cyan halftone rosette overlay | Chip says "Colour" + carries a four-dot CMYK icon |
| **Skipped page** | Greyed out — `Muted` at 30% opacity, dashed border | Chip says "Skip" + carries a minus icon |

### Halftone texture (CSS)

```css
/* B&W page thumbnail background — halftone dots */
.halftone-bw {
  background-color: #FFFFFF;
  background-image: radial-gradient(circle, #0F1B2D33 1px, transparent 1.5px);
  background-size: 4px 4px;
}

/* Colour page thumbnail — process magenta with cyan rosette */
.halftone-colour {
  background-color: #C2185B;
  background-image:
    radial-gradient(circle, #006FA655 1px, transparent 1.5px),
    radial-gradient(circle, #FFD60A33 1px, transparent 1.5px);
  background-size: 6px 6px, 8px 8px;
  background-position: 0 0, 3px 3px;
}
```

### Registration marks (decorative structural element)

Cross-hair marks (✛) used as:
- Section dividers (a subtle registration mark between major sections)
- The "printer online" indicator in the app bar (a small registration mark instead of a dot)
- Corner marks on the token slip (like real print registration marks)

---

## 2. Type System

### Family: Anek (by Ek Type)

**One family, three scripts, designed to work together.** Anek is by Ek Type — an Indian type foundry that designs multilingual typefaces. It's not a generic Google Font; it was built specifically for Indian multilingual use.

| Script | Google Font name | Weights available |
|--------|-----------------|-------------------|
| Latin | Anek Latin | 100, 200, 300, 400, 500, 600, 700, 800 |
| Devanagari (Hindi) | Anek Devanagari | 100, 200, 300, 400, 500, 600, 700, 800 |
| Telugu | Anek Telugu | 100, 200, 300, 400, 500, 600, 700, 800 |

**Fallback:** Noto Sans Devanagari / Noto Sans Telugu (if Anek fails to load).

### Loading strategy

```typescript
// next/font config — self-hosted, display: swap, subsetted by script
import { Anek_Latin, Anek_Devanagari, Anek_Telugu } from 'next/font/google';

const anekLatin = Anek_Latin({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-anek-latin',
});

const anekDevanagari = Anek_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-anek-devanagari',
  fallback: ['Noto Sans Devanagari', 'sans-serif'],
});

const anekTelugu = Anek_Telugu({
  subsets: ['telugu'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-anek-telugu',
  fallback: ['Noto Sans Telugu', 'sans-serif'],
});
```

**unicode-range:** `next/font` handles this automatically — Devanagari glyphs load the Devanagari font, Latin glyphs load the Latin font. No manual `unicode-range` needed.

**Font-display:** `swap` on all three — text is visible immediately in fallback, swaps to Anek when loaded. No FOIT.

### Type scale

| Token | Size | Weight | Line-height | Usage |
|-------|------|--------|-------------|-------|
| `text-xs` | 12px | 400 | 1.5 | Captions, timestamps, meta (Muted colour) |
| `text-sm` | 14px | 400 | 1.5 | Secondary text, labels, chip text |
| `text-base` | 16px | 400 | 1.5 | Body text, **all input text** (prevents iOS zoom) |
| `text-lg` | 20px | 600 | 1.4 | Card titles, section headings |
| `text-xl` | 24px | 600 | 1.3 | Screen titles, price display |
| `text-2xl` | 32px | 700 | 1.2 | Hero numbers — pickup code, total price, order number |

### Indic line-height

Devanagari and Telugu have matras (vowel signs above and below the consonant) that need more vertical space than Latin. Body line-height is **1.6 for Indic scripts** (vs 1.5 for Latin). This is handled by CSS:

```css
:lang(hi), :lang(te) {
  line-height: 1.6;
}
```

### Tabular numerals

Prices, page counts, and UTR numbers must use tabular (monospaced) figures so digits align in columns. Anek supports `font-variant-numeric: tabular-nums`.

```css
.tnum {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
```

Applied to: price displays, page counts, UTR input, order numbers, timestamps.

### Alignment

**Left-aligned by default.** Numbers (prices, page counts) are right-aligned in tables/columns but left-aligned in display contexts (hero price). Center alignment only for: the pickup code (a hero number that's the focal point of the tracking screen) and status pills.

### Line length

Maximum **80 characters** for body text. On a 360px screen with 16px margins, the content width is 328px — at 16px font size, that's ~40-45 characters per line. Well within limits.

---

## 3. Layout

### Spacing scale (4px base)

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps: icon-to-text, chip padding |
| `space-2` | 8px | Default small gap: between related elements |
| `space-3` | 12px | Medium gap: between fields in a form |
| `space-4` | 16px | **Page margin** (left + right). Default card padding. |
| `space-5` | 20px | Large gap: between sections |
| `space-6` | 24px | Section padding, sticky bar height |
| `space-8` | 32px | Hero spacing, between major screen sections |
| `space-12` | 48px | Touch target minimum height |

### Radius scale (three values, different roles)

| Token | Value | Role | Why |
|-------|-------|------|-----|
| `radius-sm` | 4px | Chips, small badges, page-strip tiles | Tight — like a cut paper corner |
| `radius-md` | 8px | Cards, inputs, buttons, preset cards | The default — a rounded paper corner, not too soft |
| `radius-lg` | 16px | Bottom sheets, sticky action bars, token slip | Soft — like a curled paper edge that lifts off the surface |
| `radius-full` | 9999px | Pills, status dots, the open/closed indicator | Circular — only for dots and pills |

**Never one radius everywhere.** The three values encode different roles: tight (structural elements), medium (interactive elements), soft (floating elements).

### Elevation

**Borders encode structure, shadows only for sheets and bars.**

| Level | Treatment | Usage |
|-------|-----------|-------|
| 0 | Border: 1px solid `Ink` at 10% opacity (`#0F1B2D1A`) | Default — cards, dividers, inputs |
| 1 | Border + subtle shadow: `0 1px 2px rgba(15,27,45,0.06)` | Sticky action bar (resting) |
| 2 | Shadow only: `0 -4px 16px rgba(15,27,45,0.12)` | Bottom sheets (floating above content) |
| 3 | Shadow: `0 8px 32px rgba(15,27,45,0.16)` | Modals, the token slip when elevated |

**No drop shadows on resting cards.** They use borders. Shadows mean "this floats above the surface" — reserved for sheets, bars, and modals.

### Safe areas

```css
/* Root layout */
html { viewport-fit: cover; }
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
/* Sticky action bar respects the home indicator */
.sticky-bar {
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
```

Use `100dvh` (dynamic viewport height) not `100vh` — prevents the mobile browser chrome from covering content.

---

## 4. Design Principles

### Principle 1: The Page Strip is the one bold moment

Every page of the document is a small paper sheet that flips between halftone-black and full-colour when tapped. This is the signature interaction — tactile, visual, immediately understandable. **Everything else is quiet and disciplined.**

The flip animation: the page thumbnail rotates on its Y-axis (like a paper flipping over), revealing the colour side. 200ms, ease-out. `prefers-reduced-motion` → instant cross-fade, no rotation.

### Principle 2: Paper as material

The app feels like paper:
- **Surface** (`#FFFFFF`) = fresh A4 sheets on a desk
- **Paper** (`#F7F8FA`) = the desk surface (slightly cooler, receded)
- **Halftone textures** on B&W thumbnails = printed dots, not flat fills
- **Perforated edges** on the token slip = a torn counter slip
- **Registration marks** (✛) as structural dividers = the marks printers use to align plates

Not glassmorphism. Not gradients. Not "frosted" anything. Paper.

### Principle 3: CMYK as the colour vocabulary

The four process colours (Cyan, Magenta, Yellow, Black) are the ONLY accent colours. No random brand purple, no "primary blue #2563EB" from a design system generator. The accents are literally what a printing press uses.

- **B&W page** = K channel (black ink) → halftone black dots
- **Colour page** = CMYK process → magenta fill with cyan+yellow halftone rosette
- **Primary button** = Cyan-ink (the C plate)
- **"Colour" chip** = Magenta-ink (the M plate)

### Principle 4: Quiet chrome, loud content

The app chrome (app bar, sticky bars, navigation) is restrained — Muted colours, thin borders, no decoration. The content (page strip, price, pickup code) is loud — vivid colour, large type, the focal point.

One primary action per screen. The primary action lives in the bottom third (thumb zone) in a sticky bar with the live price.

### Principle 5: Numbered sequences only where content IS a sequence

Numbered markers appear ONLY on:
- The 3-step Stepper (Files → Options → Pay) — it's a sequence
- The order timeline (Placed → Payment → Printing → Ready → Collected) — it's a sequence

Numbered markers do NOT appear on: preset cards, feature lists, FAQ items, or any non-sequential content.

### Principle 6: Motion answers user actions

| Motion | When | Duration | Reduced-motion fallback |
|--------|------|----------|-------------------------|
| **Page flip** | Customer taps a page thumbnail to toggle B&W ↔ Colour | 200ms, ease-out (Y-axis rotation) | Instant cross-fade (no rotation) |
| **Sheet slide-up** | Bottom sheet opens (More options, payment) | 250ms, ease-out | Instant appear |
| **Price pulse** | Live total updates after a toggle | 150ms, scale 1.0 → 1.03 → 1.0 | No pulse |
| **Status change** | Order status transitions (Printing → Ready) | 300ms, colour fade + icon swap | Instant swap |
| **Toast** | Notification appears | 200ms, slide-up + fade-in | Instant appear |

**One orchestrated moment on load:** the shop landing's rate board fades in (100ms) after the shop name. Nothing else animates on load.

**No:** fade-and-slide-up on every section, hover transitions on every card, staggered list entrances, parallax.

---

## 5. ASCII Wireframes

### Screen 1: Shop landing + upload (`/s/[shop]`)

```
┌─────────────────────────────┐
│  ✛  QuickPrint Demo    ● open │  ← AppBar: registration mark + shop name + open dot
│     B&W ₹2 · Colour ₹8 /page  │  ← Rate board (one line, tabular nums)
│     2 printers · ~6 min wait  │  ← Live status (Muted)
├─────────────────────────────┤
│                               │
│    ┌─────────────────────┐   │
│    │                     │   │
│    │   ✛  Drop files     │   │  ← Upload dropzone (primary action)
│    │      or tap here    │   │     Large, centered, dashed border
│    │                     │   │     Accepts: PDF, JPG, PNG, DOCX
│    │   PDF · JPG · DOCX  │   │
│    │                     │   │
│    └─────────────────────┘   │
│                               │
│    Files deleted 24h after    │  ← Trust line (Muted, small)
│    pickup. 0% commission.     │
│                               │
│    ✛  Hours: 9am–9pm          │  ← Shop info section
│       123 Main Street         │
│       [Call]  [Directions]    │
│                               │
└─────────────────────────────┘
```

**Key decisions:**
- No marketing hero. The shop name IS the hero. The customer scanned a QR — they know why they're here.
- Rate board is one line, not a table. "B&W ₹2 · Colour ₹8 /page" — all the pricing the customer needs at a glance.
- The upload dropzone is the primary action — large, centered, with accepted formats listed below.
- Trust line is small but visible — "Files deleted 24h after pickup" addresses the privacy concern immediately.

### Screen 2: Options with presets (step 2 of 3)

```
┌─────────────────────────────┐
│  ① Files  ② Options  ③ Pay   │  ← Stepper (numbered = sequence)
├─────────────────────────────┤
│                               │
│  ✛  document.pdf · 12 pages   │  ← File summary (name + page count)
│                               │
│  Choose a preset:             │
│                               │
│  ┌──────────┐  ┌──────────┐  │
│  │  Notes   │  │  Colour   │  │  ← Preset cards (2×2 grid)
│  │  B&W     │  │  All      │  │     Each card: name + description + price
│  │  Double  │  │  pages    │  │     One tap = full configuration
│  │          │  │          │  │
│  │   ₹24    │  │   ₹96    │  │
│  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  │
│  │  Photo   │  │  Mix     │  │
│  │  1 page  │  │  Choose  │  │
│  │  Colour  │  │  colour  │  │
│  │          │  │  pages   │  │
│  │   ₹8     │  │          │  │
│  └──────────┘  └──────────┘  │
│                               │
│  ▸ More options               │  ← Progressive disclosure (one row)
│                               │
├─────────────────────────────┤
│  12 B&W · 3 Colour    ₹48    │  ← StickyActionBar: totals + CTA
│                    Pay →     │
└─────────────────────────────┘
```

**Key decisions:**
- Presets as large cards, not a dropdown. Each preset is a one-tap setup with its price visible.
- "Notes: B&W, double-sided" is the default for multi-page PDFs (the most common order — students printing notes).
- "More options" is ONE row, not an expandable section with 10 fields. It opens a bottom sheet.
- The sticky bar shows running totals (B&W count, Colour count) + the live price + the primary CTA.

### Screen 3: Page and colour picker (the signature screen)

```
┌─────────────────────────────┐
│  ① Files  ② Options  ③ Pay   │
├─────────────────────────────┤
│                               │
│  12 B&W · 3 Colour · 2 skip   │  ← Running totals (tabular nums)
│                               │
│  ┌────┐ ┌────┐ ┌────┐         │  ← Page strip (3 columns on 360px)
│  │░░░░│ │████│ │░░░░│         │     B&W = halftone dots (░)
│  │░░░░│ │████│ │░░░░│         │     Colour = solid magenta fill (█)
│  │ 1  │ │ 2  │ │ 3  │         │     Page number at bottom
│  │B&W │ │Col │ │B&W │         │     Label below number
│  └────┘ └────┘ └────┘         │
│  ┌────┐ ┌────┐ ┌────┐         │
│  │░░░░│ │████│ │░░░░│         │
│  │░░░░│ │████│ │░░░░│         │
│  │ 4  │ │ 5  │ │ 6  │         │
│  │B&W │ │Col │ │B&W │         │
│  └────┘ └────┘ └────┘         │
│  ┌────┐ ┌────┐ ┌────┐         │
│  │    │ │░░░░│ │    │         │  ← Skipped pages (dashed border, grey)
│  │    │ │░░░░│ │    │         │
│  │ 7  │ │ 8  │ │ 9  │         │
│  │skip│ │B&W │ │skip│         │
│  └────┘ └────┘ └────┘         │
│                               │
│  [All B&W] [All Colour]       │  ← Bulk actions (48px touch targets)
│  [Use suggestion]             │
│                               │
│  ✛  Double-sided saves ₹12.   │  ← Money nudge (only when true)
│                               │
├─────────────────────────────┤
│  12 B&W · 3 Colour    ₹48    │
│                    Pay →     │
└─────────────────────────────┘
```

**Key decisions:**
- The page strip IS the screen. Everything else supports it.
- B&W thumbnails use halftone dots (░) — visually distinct from the solid magenta fill (█) of colour pages. Even at a glance, the customer sees the colour/B&W split.
- Skipped pages have a dashed border + grey fill — clearly "not printing this one."
- Each thumbnail has: the page number + a text label ("B&W"/"Col"/"skip"). Colour is never the only signal.
- "Use suggestion" appears when the server's auto-detection found colour pages — one tap to accept.
- The money nudge is one line, only when true, and uses the registration mark (✛) as a bullet.

### Screen 4: Review and pay (step 3 of 3)

```
┌─────────────────────────────┐
│  ① Files  ② Options  ③ Pay   │
├─────────────────────────────┤
│                               │
│  ✛  Review your order         │
│                               │
│  document.pdf                 │  ← File list (collapsed)
│  12 B&W · 3 Colour            │     Each file: name + mode summary
│  Double-sided · A4 · 1 copy   │     + options summary
│                               │
│  ┌─────────────────────────┐ │
│  │ Total              ₹48  │ │  ← Price breakdown (collapsed)
│  │ ▸ See breakdown         │ │     Tap to expand → itemised lines
│  └─────────────────────────┘ │
│                               │
│  ✛  Your details              │
│                               │
│  Mobile number                │
│  ┌─────────────────────────┐ │
│  │ 98765 43210             │ │  ← 10-digit, numeric keypad, tel input
│  └─────────────────────────┘ │
│                               │
│  Name (optional)              │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  └─────────────────────────┘ │
│                               │
│  Note to shop (optional)      │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  └─────────────────────────┘ │
│                               │
├─────────────────────────────┤
│              Pay ₹48 →       │  ← Primary CTA with total
└─────────────────────────────┘
```

**Key decisions:**
- One screen, not a multi-step checkout. The customer sees everything at once: files, price, details.
- Price is collapsed by default — "Total ₹48" with "See breakdown" below. Most customers just want the number.
- Mobile number is the only required field (for pickup notification). Name + note are optional + clearly labelled as such.
- The primary CTA shows the exact amount: "Pay ₹48" — not "Submit" or "Continue."

### Screen 5: Payment waiting

```
┌─────────────────────────────┐
│  ←  Waiting for the shop     │
│      to confirm your payment │
├─────────────────────────────┤
│                               │
│         ✛                     │
│        ╭───╮                 │
│       │ 3:42 │                │  ← Elapsed timer (tabular nums)
│        ╰───╯                 │
│         ✛                     │
│                               │
│  You paid via UPI             │
│  UTR: 7284 5610 3927          │  ← UTR display (tabular nums, grouped)
│                               │
│  ┌─────────────────────────┐ │
│  │ The shop will verify    │ │  ← Reassurance card (Surface, bordered)
│  │ your payment. This      │ │
│  │ usually takes 1–2 mins. │ │
│  └─────────────────────────┘ │
│                               │
│  [Call shop]                  │  ← Secondary actions
│  [Enter UTR again]            │
│  [Pay at counter instead]     │
│                               │
└─────────────────────────────┘
```

**Key decisions:**
- No "Payment successful!" claim. The app NEVER claims payment is verified — it says "Waiting for the shop to confirm."
- The elapsed timer gives the customer a sense of time without anxiety.
- The UTR is displayed for reference (the customer may need to share it with the shop).
- "Call shop" is always available — if the shop is slow to confirm, the customer can call.
- "Pay at counter instead" is the escape hatch — never trap the customer in a digital flow they can't exit.

### Screen 6: Order tracking with token slip (`/o/[token]`)

```
┌─────────────────────────────┐
│  ←  Order #1247              │  ← AppBar with order number
├─────────────────────────────┤
│                               │
│  ┌╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╮  │  ← Token slip (perforated edges)
│  │                         │  │     radius-lg, shadow level 3
│  │   ✛  Pickup code        │  │
│  │                         │  │
│  │      ┌──────────┐       │  │
│  │      │   A-7    │       │  │  ← Hero pickup code (text-2xl, bold)
│  │      └──────────┘       │  │     Centered — the focal point
│  │                         │  │
│  │   Order #1247           │  │  ← Order number (tabular nums)
│  │   QuickPrint Demo       │  │  ← Shop name
│  │   12 B&W · 3 Colour     │  │  ← Order summary
│  │   ₹48                   │  │
│  │                         │  │
│  │   ┌─────────┐           │  │
│  │   │ ▓▓▓▓▓▓▓ │           │  │  ← QR code of order token
│  │   │ ▓ ▓ ▓▓ │           │  │     (scan to re-open this tracking page)
│  │   │ ▓▓▓ ▓▓ │           │  │
│  │   └─────────┘           │  │
│  │                         │  │
│  └╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╯  │  ← Perforated bottom edge
│                               │
│  ✛  Status                   │
│                               │
│  ① Placed          2:15 PM   │  ← Timeline (numbered = sequence)
│  ② Payment         2:16 PM   │
│  ③ Printing        in progress│
│  ④ Ready           —         │
│  ⑤ Collected       —         │
│                               │
│  [Call shop]  [Directions]    │
│  [Share order link]           │
│  [Cancel order]               │  ← Only before printing
│                               │
└─────────────────────────────┘
```

**Key decisions:**
- The token slip is a physical metaphor — perforated edges, elevated shadow (it "lifts off" the screen like a paper slip). The customer can almost tear it off.
- The pickup code ("A-7") is the hero — text-2xl (32px), bold, centered. This is what the customer shows at the counter.
- The QR code lets the customer re-open the tracking page from another device (scan the slip).
- The timeline is numbered (①②③④⑤) because it IS a sequence — the brief allows numbering for sequences.
- "Cancel order" is present but de-emphasised — only available before printing starts.
- No "Reorder" on this screen — it would clutter. Reorder lives on the "My orders" page.

---

## 6. PASS 2: Self-Review Against the Brief

### Checking against "AVOID these generated-design tells"

| Tell | Present in this plan? | Verdict |
|------|----------------------|---------|
| Warm cream background + high-contrast serif + terracotta accent | ❌ No — background is cool off-white (#F7F8FA), sans-serif (Anek), accents are CMYK process colours | ✓ Clean |
| Near-black background with a single acid-green or vermilion accent | ❌ No — background is light, accents are cyan + magenta (two process colours, not one) | ✓ Clean |
| Broadsheet look: hairline rules, zero radius, dense columns | ❌ No — radius scale (4/8/16px), generous spacing, single column | ✓ Clean |
| The card kit: identical rounded cards, one radius, one grey shadow, gradient washes | ❌ No — three radii for different roles, borders not shadows for cards, no gradients | ✓ Clean |
| Template chrome: tracked ALL-CAPS eyebrows, labels with spaced em dashes, middle-dot meta strings | ❌ No — sentence case throughout, no ALL-CAPS eyebrows, meta uses "·" separator only in rate board (not decorative) | ✓ Clean |
| Tinted near-black as black | ❌ No — Ink (#0F1B2D) is a deep navy but it's used as "ink" not "black"; the halftone texture makes the blackness feel printed, not tinted | ✓ Clean |
| Monospace for every small label | ❌ No — Anek throughout; tabular nums for numbers only, not monospace | ✓ Clean |
| Arrows appended to buttons | ⚠️ "Pay →" and "Pay ₹48 →" use a right arrow. **REVISE:** remove the arrow from button labels. The button's shape + position in the sticky bar already signals "forward." The arrow is a template tell. | ✗ REVISED |
| Accenting one word of a headline | ❌ No — no headlines with one accented word | ✓ Clean |
| ALL-CAPS labels | ❌ No — sentence case throughout ("Choose a preset", "Your details", "Review your order") | ✓ Clean |
| Labels above content that add nothing | ⚠️ "Choose a preset:" and "Your details" — are these necessary? **REVISE:** "Choose a preset:" stays (it tells the customer what to do). "Your details" → remove the label; the field labels (Mobile, Name, Note) are self-explanatory. | ✗ REVISED |
| Numbered markers on non-sequence content | ❌ No — numbering only on the Stepper (sequence) + Timeline (sequence) | ✓ Clean |
| Fade-and-slide-up on every section | ❌ No — one load moment (rate board fade, 100ms). All other motion answers user actions. | ✓ Clean |
| Hover transitions on every card | ❌ No — this is a mobile app; hover isn't a meaningful state. No hover transitions defined. | ✓ Clean |

### What I changed in PASS 2

1. **Removed arrows from button labels.** The original wireframes had "Pay →" and "Pay ₹48 →". The right-arrow appended to a button is a template tell (listed in the brief's AVOID list). Removed — the button's position in the sticky action bar + its primary-action styling already communicate "this moves you forward."

2. **Removed the "Your details" section heading.** The original wireframe had "✛ Your details" above the Mobile/Name/Note fields. The heading adds nothing — the field labels are self-explanatory. Removed the heading; the fields stand on their own.

3. **Kept "Choose a preset:" heading.** Considered removing it (it's a label above content) but it stays because it tells the customer WHAT to do (choose) — it's instructional, not decorative. Without it, four cards with no instruction would be ambiguous.

4. **Kept the "·" separator in the rate board.** "B&W ₹2 · Colour ₹8 /page" — the middle-dot is functional here (separating two rate items on one line), not decorative meta. It stays.

### Checking against the Simplicity Law

| Screen | One primary action? | ≤ 7 visible choices? | Smart defaults? | Explained in < 10 words? |
|--------|--------------------|-----------------------|-----------------|-------------------------|
| Shop landing | ✅ Upload dropzone | ✅ 1 (upload) | ✅ None needed | ✅ "Drop files or tap here" |
| Options (presets) | ✅ Choose a preset | ✅ 4 preset cards + "More options" | ✅ "Notes B&W Double" is default | ✅ "Choose a preset" |
| Page picker | ✅ Tap to toggle pages | ✅ 3 bulk actions + page grid | ✅ Auto-suggestion from server | ✅ "Tap a page to change colour" |
| Review + pay | ✅ Pay ₹48 | ✅ 3 fields (1 required) + price | ✅ Mobile is required, rest optional | ✅ "Pay ₹48" |
| Payment waiting | ✅ Wait (no action needed) | ✅ 3 secondary actions | ✅ Auto-elapsed timer | ✅ "Waiting for the shop" |
| Tracking | ✅ Show pickup code | ✅ Timeline + 3 actions | ✅ None needed | ✅ "Show this code at the counter" |

All screens pass the Simplicity Law.

### Checking against "grounded in THIS subject"

| Element | Is it generic? | Is it specific to print shops? |
|---------|---------------|-------------------------------|
| Colour palette | ❌ Not generic — CMYK process colours are the literal vocabulary of printing | ✅ Cyan = C plate, Magenta = M plate, Yellow = Y plate, Black = K plate |
| Halftone texture on B&W pages | ❌ Not generic — halftone dots are how printing simulates greyscale | ✅ Specific to the printing process |
| Token slip with perforated edges | ❌ Not generic — it's a counter token slip, an artifact of Indian print shops | ✅ Specific to the domain |
| Registration marks (✛) as dividers | ❌ Not generic — registration marks are printer's alignment marks | ✅ Specific to printing |
| Rate board (one-line pricing) | ❌ Not generic — it's a rate board, like the hand-painted cards in Indian print shops | ✅ Specific to the domain |
| Anek typeface | ❌ Not generic — by Ek Type, an Indian foundry, designed for Indian multilingual use | ✅ Specific to the Indian market |
| Page strip (flip between B&W/colour) | ❌ Not generic — it's the product's core function visualised | ✅ The colour/B&W distinction IS the product |

**Verdict:** The design is recognisably ours. No generic print or SaaS app would use CMYK process colours as the palette, halftone dots as the texture, registration marks as dividers, and a perforated token slip as the confirmation artifact. These choices are grounded in the specific subject (Indian neighbourhood print shops) and the specific product (page-level colour/B&W split).

---

## 7. What Is NOT Yet Finalised

These items are deferred to Phase 2 (component library implementation):

- **Dark mode colour mapping** — the light-mode palette is finalised; dark mode will map Paper → dark surface, Ink → light text, etc. The CMYK accents stay the same. Dark mode follows system preference (`prefers-color-scheme: dark`).
- **Exact icon set** — Lucide icons are the baseline (already in the project), but custom CMYK/icons for the page-strip chips (the four-dot CMYK icon, the filled-square B&W icon) will be designed as inline SVGs.
- **Bottom sheet drag-handle styling** — the exact visual treatment of the drag handle on bottom sheets.
- **Skeleton screen patterns** — the exact skeleton layout for each async region (will match the final content layout).
- **Toast/snackbar positioning + styling** — bottom-anchored, above the sticky bar, with the registration mark as the bullet.

---

## Next Phase

**Phase 2: Design System + Component Library** — implement the tokens as CSS variables mapped into Tailwind, build the components in `/components/customer` with a dev-only gallery route `/dev/ui`. The component list is in the brief (AppBar, PrimaryButton, StickyActionBar, BottomSheet, Stepper, SegmentedControl, Chips, NumberStepper, UploadDropzone, FileCard, PageStrip + PageThumb, PriceBreakdown, PaymentSheet, UTRInput, StatusTimeline, TokenSlip, StatusPill, skeletons, EmptyState, ErrorState, Toast, OfflineBanner, form fields).

**Awaiting your review of this design plan before building.**
