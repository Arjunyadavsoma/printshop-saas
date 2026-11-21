# PrintShop — Design plan (Phase 0, Pass 1 + Pass 2)

The design brief asks for an identity that could not be mistaken for any
other product. This document is the pre-code design contract for the
product build; it extends (customer + new surfaces) rather than rewrites
the shopkeeper "Square UI" token system already in `globals.css`.

---

## Pass 1 — the plan

### Concept: "counter slip / process ink"

The product's heart is one distinction: **which pages get ink and which
don't.** So the identity is built from two print-shop artifacts:

1. **The rate board** — the wall chart behind every Indian print-shop
   counter. Dense, ruled, honest numbers. This is the shopkeeper surface.
2. **The counter slip** — the carbon-copy job ticket with a perforated
   stub. The customer surface is a form being filled in at the counter,
   and the pickup code is the torn stub.

The COLOR vs B&W distinction is rendered as **process ink vs halftone**:
color pages carry a wash of process cyan/magenta/yellow and a solid ink
dot; B&W pages carry a halftone-dot texture and a black dot. The contrast
reads instantly even in grayscale — which is the point.

### Color (6 named values)

| Name | Hex | Use |
|---|---|---|
| `paper` | `#F1F3F2` | cool uncoated-stock background (deliberately NOT warm cream) |
| `ink` | `#1D2530` | blue-black iron-gall ink — text, rules, halftone base (not #0B0B0B) |
| `process-cyan` | `#0B7FA6` | COLOR state, active accents; AA on paper |
| `process-magenta` | `#C02E6E` | color-mode secondary (chips, swatch pairs) |
| `process-yellow` | `#8F6E00` | darkened yellow used for text/rules (pure #FFD700 fails AA; the tint #FFF3C4 is used behind swatches) |
| `alert-red` | `#B3261E` | danger, failed tasks, payment rejection |
| `ok-green` | `#1E7A44` | success, PRINTED, paid |

`process-yellow` is a **deepened** yellow so it passes AA on paper; the
saturated yellow appears only as a background tint. Success/warning reuse
`ok-green` / a darkened amber `#8F5B00` so the palette stays 6-color.

The existing shopkeeper surface keeps its `brand` (deep red) tokens — the
NEW identity tokens ship as `--p-cyan` etc. and the two systems coexist
until the redesign sweep, without breaking the "never hardcode hex" rule
(the new tokens are registered in `@theme` like the old ones).

### Type

- **Headings/display:** Archivo (700/800, tracking −2%) — an industrial
  grotesque with print-flavored tightness. Not a soft geometric SaaS font.
- **Body/UI:** IBM Plex Sans (400/500/600) — engineered, slightly
  mechanical; pairs natively with the print/industrial tone.
- **Machine fields only:** IBM Plex Mono for order short-id, pickup code,
  UTR, timestamps — the fields a *machine* prints. Not for labels.
- **Devanagari:** Noto Sans Devanagari; **Telugu:** Noto Sans Telugu —
  both loaded via next/font with `swap`, fallback chain declared per
  locale.
- Modular scale: 12 / 14 / 16 / 19 / 24 / 32 / 44 px, line-height 1.55
  body, 1.15 display. Body measure ≤ 72ch (brief: < 80).

### Layout — one-sentence concepts

1. **Customer landing + upload** — a shop counter form: the shop's "rate
   board" strip sits above, and the upload dropzone is a drawn paper tray
   you drop sheets into.
2. **Page selection / color** — a light-table: the page strip IS the
   product; options dock below as a compact counter form.
3. **Shopkeeper order board** — the wall of job tickets: columns are
   physical rails, cards are tickets with a punched corner, waiting time
   is a stamp.
4. **Order detail** — the job ticket opened flat: page-mode map, task
   manifest, payment stub, timeline as carbon-copy layers.

### Wireframes

(1) Customer landing + upload — mobile 360px
```
┌──────────────────────────────┐
│ ⌖ Shri Sai Xerox   ● OPEN    │  registration-mark logo + open stamp
│ 2 printers · 3 jobs ahead    │  live status line (plain text)
│ ~6 min wait                  │
├──────────────────────────────┤
│ A4 B&W ₹2/page · Color ₹10   │  rate-board strip (ruled rows)
│ Two-sided 10% off            │
├──────────────────────────────┤
│                              │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐      │
│     │  ⌁ Drop files     │      │  paper-tray dropzone (dashed
│   │  or tap to pick   │      │   feed-edge on the left)
│     │  PDF JPG DOCX     │      │
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘      │
│                              │
│ ┌──────────────────────────┐ │
│ │ doc1.pdf  ▓▓▓▓░░ 72%     │ │  per-file progress rows
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ ₹0.00 · Choose pages →       │  sticky bar (appears when files ready)
└──────────────────────────────┘
```

(2) Page selection / color — the light table (mobile)
```
┌──────────────────────────────┐
│ doc1.pdf · 12 pages          │
│ ┌──┐┌──┐┌──┐┌──┐             │
│ │01││02││██││04│  ██ = page 3  ← page strip: each page a sheet,
│ └──┘└──┘└──┘└──┘    in COLOR   tap toggles; SKIP = torn ghost
│ ┌──┐┌──┐┌──┐┌──┐             │
│ │05││06││07││08│             │
│ └──┘└──┘└──┘└──┘             │
│ duplex bracket links 1-2,3-4 │  bracket drawn under pairs
├──────────────────────────────┤
│ [All B&W] [All color]        │  action row (counter-form style)
│ [Use suggestion] [1-5,8 ──]  │
│ 12 B&W · 3 color · ₹54.00    │  live count = structure, not chrome
├──────────────────────────────┤
│ ₹54.00 · Review order →      │  sticky price bar
└──────────────────────────────┘
```

(3) Shopkeeper order board — desktop-dense
```
┌────────┬───────────┬───────────┬───────────┬─────────┐
│AWAITING│ PAID      │ PRINTING  │ READY     │COLLECTED│  rails (vertical rules)
│ PAYMENT│ /QUEUED   │           │           │  today  │
├────────┼───────────┼───────────┼───────────┼─────────┤
│#0417 ▤ │#0416 ▤    │#0411 ▤    │#0402 ▤    │#0398 ▤  │  ticket cards, punched
│Priya S │Ravi K     │Amit M     │Sneha D    │…        │
│12B&W+3C│8 B&W      │2 files    │done 14:02 │         │
│₹54 UTR │₹16 UPI ✓  │2/3 tasks  │code 4821  │         │
│ 4 min  │ 1 min     │ ⚠ 12 min  │           │         │  age timer stamp
└────────┴───────────┴───────────┴───────────┴─────────┘
  shortcuts: [c] confirm payment · [n] next order · [p] print slip
```

(4) Order detail — the ticket opened flat
```
┌──────────────────────────────────────────────────────┐
│ #0417 · Priya S · 98765 43210        PICKUP ╱4821╱   │ perforated stub
├──────────────────────┬───────────────────────────────┤
│ FILES + PAGE MODES   │ TASKS                         │
│ doc1 ▦ 1-12: 3,7 color│ COLOR_SET → HP-4535 (cyan)   │
│ doc2 ▦ 1-4 all B&W   │  pages 3,7 · 1 sheet · PRINTED│
│                      │ BW_SET → Ricoh-BW (halftone)  │
│ payment: UTR 4412…   │  pages 1-2,4-12 · SPOOLED     │
│ [Confirm] [Reject]   │ [reprint] [reroute] [cancel]  │
├──────────────────────┴───────────────────────────────┤
│ TIMELINE  1 placed 14:01 · 2 UTR 14:03 · 3 paid 14:05│ (numbered: it IS
│ 4 queued · 5 printing 14:06 · 6 ready 14:11          │  a sequence)
└──────────────────────────────────────────────────────┘
```

### Alignment & structure rules
- Left-aligned by default; the pickup stub is the only centered element
  (it is a physical artifact).
- Borders encode structure: board rails, duplex brackets, perforation,
  rate-board rows. No decorative borders.
- Icons/text accompany every color signal (COLOR chip has a filled ink
  dot + the word "Color").

### Principles — what makes this unmistakable
1. Halftone-vs-ink as the universal state language (also works in
   grayscale, on thermal receipts, on the assembly slip).
2. Artifacts, not cards: tickets, stubs, trays, rails — surfaces named
   after what they physically are.
3. Machine-mono only for machine fields.
4. One bold moment: **the page strip** — tapping a page flips its sheet
   between halftone-black and full process color with a small settle
   animation (200 ms, respects prefers-reduced-motion). Everything else
   stays quiet.

---

## Pass 2 — review against the brief

- **Cream+serif+terracotta tell:** rejected — background is cool
  `paper #F1F3F2`, headings are a grotesque, accents are process CMYK.
  *Changed from an earlier draft that used #F6F1E7; the warm cast is gone.*
- **Single acid accent on near-black:** rejected — six-color palette on
  paper; `ink` is blue-black `#1D2530`, not #0B0B0B/#111.
- **SaaS-card kit tell:** rejected — no uniform radius/shadow kit. Surfaces
  are ruled (1px `ink` at 12% for hairlines where they encode rails), and
  radius is intentional per artifact (tickets 6px, tray 14px, chips 999px).
  *Changed: dropped the planned soft shadow on cards; tickets get a punched
  corner instead — structure over decoration.*
- **Template chrome tell:** no ALL-CAPS eyebrows (column headers on the
  board are sentence case with a colored rail dot), no middle-dot meta
  strings (status line is a sentence), no mono for labels (mono only on
  machine fields), no arrow suffix on buttons.
- **Fade-and-slide-up on everything:** rejected — one orchestrated load
  moment (page strip sheets settle in, staggered 30 ms, once), plus
  action-answering motion (flip, toast, drawer, status stamp). All gated
  by prefers-reduced-motion.
- **Accent-one-word headlines:** rejected — headlines are plain, weight
  and size carry hierarchy.
- Contrast: every text token verified AA on `paper` (process-yellow is
  deepened for text; saturated yellow only as tint). Color never the only
  signal (dot + word + texture).
