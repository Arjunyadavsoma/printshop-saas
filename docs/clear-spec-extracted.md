# PrintShop / Printelyx — "Clear" Design Spec (extracted)

**Source:** `~/workspace/user/files/PrintShop_Clear_design_screens__1__0_2nl6.pdf`
(55 pages, image-only — no extractable text; every page was rendered to PNG at
150 dpi and read visually.)
**Live product:** https://printelyx.cc.cd
**Extracted:** 2026-11-24. Example shop throughout: **Sri Sai Xerox**.

**Page map (PDF page → screen):** mobile consumer pp. 1–8, 14–23; mobile
shopkeeper pp. 9–11, 24–31, 50–55; desktop consumer pp. 12, 32–40; desktop
shopkeeper pp. 13, 41–49. Page 13 is the desktop Orders kanban; page 43 is the
desktop Orders table — two different layouts of the same Orders screen.

**Screen count:** 36 distinct screen designs — 18 consumer + 18 shopkeeper
(see §B). Counted as separate screens: the "Your files" error state (screen
36 — same route as screen 3, but a fully different designed state) and the
desktop Orders **kanban board** (screen 23 — a genuinely different layout
from the Orders list/table, screen 22).

---

## A. Global design system

### A.1 Colours (measured from the renders with a pixel sampler)

| Token | Value (measured) | Used for |
|---|---|---|
| Page background | `#F2F3F7` (brief says `#EDF0F5` — renders measure `#F2F3F7`; treat as the same token, verify against the live site) | All page backgrounds, mobile + desktop |
| Card / surface | `#FFFFFF` | All cards, bottom bars, desktop sidebar |
| Primary blue | `#0A58D6` | Primary buttons, selected radio, filled progress segments, links-as-buttons |
| Primary blue (light fill) | `#E6EEFB` | Secondary buttons, active desktop nav item, blue status pills, "Confirm" pills |
| Text — near-black | ~`#1C1C1E` (sampled from tile numerals) | Headings, primary text, prices |
| Text — secondary grey | ~`#6B7280` range (rendered mid-grey) | Subtitles, helper text, table values, "per page" |
| Divider grey | ~`#E5E7EB` range | Hairline dividers between rows inside cards |
| Input fill | `#F2F3F7` (same as page bg) | Text inputs |
| Segmented-control track | `#E3E4E9` | Segmented control background; selected segment is white |
| Progress track | `#DADBE0` | Unfilled progress segments |
| Green (success / on) | `#1E8A56` (toggle), pill bg `#DDF3E7` | Open/Ready/Collected/Active pills, toggles ON, completed timeline dots, status dot |
| Amber (attention) | Pill bg `#FFF1CC`, text dark amber/brown | "To confirm", "Closed", "Held", "Review", waiting-timer pill |
| Red (danger / mismatch) | Pill bg `#FAE3E1`, text dark red | "Amount differs", "Needs you", "Out of paper", "Remove", "Reprint", "Fix", "Cancel order" text |
| Blue (info / in-progress) | Pill bg ~`#E5EEFB`, text `#0A58D6`-ish | "Printing", "Queued", "Waiting", "Waiting for printer", "Confirm" |
| Colour-page tile gradient | Pastel lavender → pink → pale yellow (e.g. `#E6D9F3`, `#DFDCF7`) | Colour page thumbnails |
| B&W-page tile fill | `#F2F3F7` | B&W page thumbnails |

No other accent colours appear. There is no dark mode in the PDF.

### A.2 Typography

- **Font:** the brief names Instrument Sans / Inter-like sans. The PDF itself
  names no font. Visually it is a grotesque sans with tight, very bold
  headings — consistent with Inter / Instrument Sans, but the exact family,
  weights and px sizes are **not** stated anywhere in the PDF (see §D).
- **Headings:** very large, extra-bold, near-black, tight line-height; one or
  two lines ("Print without the queue", "Choose colour pages",
  "How should we print it?"). Eyebrow line above the heading in small grey
  or bold dark text (shop name, "Printelyx", or section label e.g. "Orders").
- **Subtitle:** one line of mid-grey text directly under the heading
  ("Step 2 of 3", "2 printers online, about 6 min wait",
  "Manage orders, payments and printers.").
- **Body / list text:** regular weight, near-black; secondary lines in grey.
- **Prices and totals:** bold, right-aligned in rows; the grand total in the
  sticky bar is extra-large bold.
- **Pickup code:** huge extra-bold digits with wide letter-spacing
  ("4 8 2 1").
- **Numbers:** Indian formatting with commas (₹2,180; ₹14,260; ₹1,840).

### A.3 Layout, spacing, radii

- **Mobile:** single column, page padding ≈ 24 px, generous vertical gaps
  between cards. Content is top-aligned; the sticky bottom bar is the only
  fixed element.
- **Cards:** white, corner radius ≈ 20–24 px (per brief; visually large and
  soft), no visible border or shadow in the renders. Inside a card, rows are
  separated by 1 px light-grey hairlines; row padding is generous.
- **Desktop consumer:** white top header bar; content in a centred column,
  two-column layout where a summary/action card sits in a right sidebar
  (≈ 1/3 width). Desktop pages have large empty space below the content —
  **no footer appears on any page**.
- **Desktop shopkeeper:** left sidebar (white) + grey content area; no top
  header bar.
- **Bottom bar (mobile consumer):** white bar with a top hairline, pinned to
  the bottom. Left: small grey label over a large bold value
  (e.g. "9 B&W, 3 colour" / "₹48"). Right: one primary pill button
  (or two buttons: secondary + primary). On payment/tracking pages the bar
  holds two buttons instead.
- **Bottom nav (mobile shopkeeper):** white bar, 5 tabs — Home, Orders,
  Payments, Printers, More. Active tab: blue label + blue rounded-square
  outline icon; inactive: grey. (The tab icons render as empty rounded
  squares — see §D.)

### A.4 Buttons

- **Primary:** solid `#0A58D6`, white text, fully rounded (pill), tall
  (≈ 56–64 px), full-width inside cards or right-aligned in the bottom bar.
  Labels are verbs + value where relevant: "Review order", "Continue",
  "Pay ₹58", "I've paid", "Confirm payment", "Save prices", "Log in",
  "Print", "Print A4", "Directions".
- **Secondary:** light-blue fill `#E6EEFB`, blue text, pill. ("Add more
  files", "Call shop", "Pay at counter", "Confirm all", "Export CSV",
  "Add walk-in", "Export", "Download PNG" — the last two are light-blue.)
- **Outline / destructive:** white fill, light-grey border, red text.
  ("Cancel order", "Enter UTR again" on mobile.) On desktop the same
  actions appear as light-blue pills with blue text instead — see §D.
- **Small pills (in-card actions):** "Copy" (light blue), "Confirm"
  (light blue), "Remove" (light red bg, dark-red text), "Review" (amber),
  "Fix" / "Reprint" (light red), "Do this" (light blue).
- **Link rows:** full-width rows ending in a grey chevron "›"
  ("Register your shop", "Shopkeeper login", "Find my order", etc.).
- **Disabled state:** none shown in the PDF.

### A.5 Inputs, controls, feedback

- **Text inputs:** light-grey fill (`#F2F3F7`), radius ≈ 16 px, dark text,
  bold label above ("Mobile number", "Name (optional)", "Email",
  "Password", "Shop name"). Example values are pre-filled in the renders.
- **Segmented control:** grey track (`#E3E4E9`), white selected segment with
  soft shadow, 2–4 options. Used for: All B&W / Mixed / All colour;
  A4 / A3 / A5; Today / 7 days / 30 days; To confirm 3 / Confirmed;
  Waiting / Held / Printing / Done.
- **Radio list:** circular radios; selected = blue fill with white centre
  dot; unselected = grey outline. Used on "How should we print it?".
- **Toggles:** iOS-style switch; ON = green `#1E8A56` with white knob.
  No OFF toggle is shown anywhere (all toggles in the PDF are ON).
- **Progress:** 3-segment bar above step headings; filled segments blue,
  unfilled `#DADBE0`. Register flow uses the same 3-segment bar.
- **Status pills:** small rounded pills, coloured bg + darker coloured text
  (see colour table). Pill texts: Open, Closed, Ready, Collected, Active,
  Printing, Queued, Waiting, Waiting for printer, To confirm, Held,
  Needs you, Amount differs, Out of paper, Review, Fix, Reprint, Do this,
  Confirm, Remove, Copy, "1 min 20 s", "68%".
- **Timeline (order tracking):** vertical list; completed = solid green
  circle; current = blue ring with white centre; upcoming = grey outline
  circle. Current step carries a grey sub-line.
- **FAQ accordions:** question rows with a grey "+" at the right; the first
  and last questions show their answer as grey sub-text under the question.
- **QR codes:** all QR graphics are checkerboard placeholders, not real
  scannable codes (see §D).
- **Badges:** amber circle with a count ("3") on the Payments nav item
  (desktop sidebar + mobile "To confirm 3" tab).

### A.6 Headers

- **Mobile consumer, shop pages:** green dot + "Sri Sai Xerox" (bold dark)
  at top-left; on the shop home it reads "● Sri Sai Xerox, open". No back
  button, no brand mark, no Help link.
- **Mobile consumer, platform pages:** "Printelyx" (bold) at top-left
  (Find a shop, About, Help, Privacy, My orders, 404). Login page uses
  "Printelyx for shops" as the eyebrow.
- **Mobile shopkeeper:** green dot + "Sri Sai Xerox" at top-left on most
  pages; the Order-detail page instead shows the eyebrow "Orders".
- **Desktop consumer:** white header bar — left: green dot + "Sri Sai Xerox"
  (or "● Sri Sai Xerox, open" on the home/colour pages, "Printelyx" on
  platform pages); right: "Help" link in grey.
- **Desktop shopkeeper:** no top bar; left sidebar headed by the bold shop
  name "Sri Sai Xerox", then nav: Home, Orders, Payments (badge 3),
  Printers, Pricing, Reports, Customers, Settings. Active item: light-blue
  pill background (`#E6EEFB`) + blue text.
- **No footer** on any screen, mobile or desktop.

### A.7 Common copy patterns

- Plain, short, sentence-case copy; no jargon. Prices always with ₹ and no
  decimals except ₹1.50 / ₹1 in pricing tables.
- Phone numbers shown spaced: "98765 43210".
- UTR shown in full on consumer pages ("401288361190") and as last-4 on
  shopkeeper pages ("UTR ending 1190", desktop table "-1190" — see §D).
- Times as "2 min ago", "5 min", "about 6 min wait", "9 am to 9 pm".
- File-retention line recurs: "Your files are deleted 24 hours after
  pickup." / Privacy: "24 hours after pickup, 7 days at most."
- "No extra fees" / "0% commission" / "You pay the shop directly by UPI"
  recurs across About, Review, Pay.

---

## B. Screens (36)

Route mappings are inferred from the live app's URL structure and the
screens' roles — the PDF shows no URLs. Where a route is a guess it is
marked "(inferred)".

### Consumer screens

#### 1. Find a shop (landing) — PDF pp. 14 (mobile), 32 (desktop)
- **Route:** `/` (inferred).
- **Mobile:** Eyebrow "Printelyx". Heading "Print without the queue".
  Subtitle "Find a shop near you, or scan its QR code." Card "Search shops"
  with grey input containing "Sri Sai". Results card: "Sri Sai Xerox /
  Open, about 6 min wait" + green "Open" pill; "Quick Print Hub / Open, no
  wait" + "Open"; "City Copy Point / Opens tomorrow at 9 am" + amber
  "Closed". Helper text: "Scan a shop's QR code to go straight to its
  page." Card "Run a print shop? / Get a QR code and start taking orders."
  with link rows "Register your shop ›" and "Shopkeeper login ›".
- **Desktop:** Same content, two columns. Left: heading + search card +
  results card. Right: QR card "Scan a shop QR code" with checkerboard
  placeholder QR, and a card with "Register your shop ›" /
  "Shopkeeper login ›" (the "Run a print shop?" heading is dropped on
  desktop).
- **Components:** search input, shop-result rows, status pills, link rows,
  QR placeholder (desktop only).
- **States:** search text "Sri Sai" filters the list (shown); closed shop
  shows amber pill + next-opening text.

#### 2. Shop home — PDF pp. 2 (mobile), 33 (desktop)
- **Route:** `/shop/[slug]` (inferred; e.g. Sri Sai Xerox).
- **Mobile:** Header "● Sri Sai Xerox, open". Heading "Print without the
  queue". Subtitle "2 printers online, about 6 min wait". Card "Add files
  to print / PDF, photos or Word files" + full-width primary "Add files".
  Price card: "Black & white / per page — ₹2"; "Colour / per page — ₹10";
  "Double-sided — Costs less per page". Info card: "Open today — 9 am to
  9 pm"; row "Call shop | Directions" (two columns). Footnote: "Your files
  are deleted 24 hours after pickup."
- **Desktop:** Header bar "● Sri Sai Xerox, open" + "Help". Left column:
  heading + wide Add-files card (centred text, smaller pill "Add files"
  button). Right column: pricing card (same three rows; "Double-sided —
  Costs less" — truncated vs mobile's "Costs less per page") and info card
  ("Open today — 9 am to 9 pm", "Call shop ›", "Directions ›" as separate
  rows). Footnote under the right column.
- **States:** open shop (shown). Closed variant is screen 13.

#### 3. Your files — Step 1 of 3 — PDF pp. 3 (mobile), 34 (desktop); error state p. 20 (mobile)
- **Route:** `/shop/[slug]/order` step 1 (inferred).
- **Mobile:** Header "● Sri Sai Xerox". 3-segment progress bar, first
  segment blue. Heading "Your files". Subtitle "Step 1 of 3". Card rows:
  "Unit-3 notes.pdf / 12 pages, 2.4 MB" + green "Ready" pill;
  "Lab record.docx / Preparing your file" + blue "68%" pill;
  "ID copy.jpg / 1 page, 1.1 MB" + "Ready". Secondary button
  "Add more files". Sticky bar: "3 files / 15 pages" + primary "Continue".
- **Desktop:** Header bar "● Sri Sai Xerox" + "Help". Left: heading +
  same file card. Below the card, "Add more files" as a small secondary
  pill (not full-width). Right sidebar card: "3 files" (top-right, grey),
  "15 pages" (large bold), full-width primary "Continue". No sticky bar.
- **Error state (p. 20, mobile only):** designed in full as screen 36.
- **Rules shown:** 50 MB per-file limit; PDF, photos, Word files only;
  password-locked PDFs must be unlocked first; files prepare
  asynchronously with a % pill while processing.

#### 4. How should we print it? — Step 2 of 3 — PDF pp. 4 (mobile), 35 (desktop)
- **Route:** `/shop/[slug]/order` step 2 (inferred), per file
  ("Step 2 of 3, Unit-3 notes.pdf").
- **Mobile:** Progress bar, first two segments blue. Heading "How should
  we print it?" (wraps to two lines). Subtitle "Step 2 of 3,
  Unit-3 notes.pdf". Radio card: "Notes / Black & white, double-sided —
  ₹30"; "Colour everything / All 12 pages in colour — ₹120";
  "Photo or ID copy / Single-sided, best quality — ₹10";
  "Mix / 3 pages look colourful — ₹48" (selected). Second card: "Pages —
  All 12"; "More options / Copies, paper, binding — 1 copy". Sticky bar:
  "9 B&W, 3 colour / ₹48" + primary "Choose colour pages".
- **Desktop:** Same radio card left; "More options" row gains a chevron.
  Right sidebar card: "9 B&W pages — ₹18", "3 colour pages — ₹30",
  "Total — ₹48", primary "Choose colour pages". No sticky bar.
- **Note:** the "Notes" preset price (₹30) does not reconcile with the
  per-page rates — see §D.

#### 5. Choose colour pages — PDF pp. 1 (mobile), 12 (desktop)
- **Route:** `/shop/[slug]/order` step 2, colour-picker view (inferred).
- **Mobile:** Header "● Sri Sai Xerox, open". Heading "Choose colour
  pages". Subtitle "Step 2 of 3" (no progress bar on this page).
  Segmented control: "All B&W | Mixed | All colour" (Mixed selected).
  Card: header "Unit-3 notes.pdf" + "12 pages"; grid of page tiles
  (4 columns; 8 tiles visible for the 12-page file). Each tile: page
  number top-left, B&W half-circle icon or colour-wheel icon top-right,
  white pill bottom-left "B&W" / "Colour". B&W tiles light grey; colour
  tiles pastel gradient (pages 3, 6, 7). Caption: "3 pages look colourful,
  so they are set to colour. Tap any page to switch it." Sticky bar:
  "9 B&W, 3 colour / ₹48" + primary "Review order".
- **Desktop:** Header bar + "Help". Segmented control same. Card shows
  all 12 tiles in 6 columns. Caption: "...Click any page to switch it."
  Right sidebar, two cards: (1) "Print style — Mix", "Copies — 1",
  "Paper — A4", "Double-sided" + green toggle ON; (2) "9 B&W pages — ₹18",
  "3 colour pages — ₹30", "Total — ₹48", primary "Review order".
- **Behaviour shown:** colour detection pre-selects colourful pages;
  tapping/clicking a tile toggles B&W ↔ Colour; the three presets set all
  pages at once.

#### 6. Review order — Step 3 of 3 — PDF p. 5 (mobile only)
- **Route:** `/shop/[slug]/order` step 3 (inferred).
- **Mobile:** Progress bar, all three segments blue. Heading
  "Review order". Subtitle "Step 3 of 3". Summary card:
  "Unit-3 notes.pdf / 9 B&W, 3 colour, double-sided — ₹48";
  "ID copy.jpg / Photo, single-sided — ₹10"; "Total — ₹58".
  Form card: label "Mobile number", input "98765 43210"; label
  "Name (optional)", input "Asha". Helper text: "You pay the shop
  directly by UPI. No extra fees." Sticky bar: "2 files, 13 pages / ₹58"
  + primary "Pay ₹58".
- **Desktop:** no desktop version in the PDF (see §D).
- **Note:** only 2 of the 3 files from Step 1 appear here — see §D.

#### 7. Pay — PDF pp. 6 (mobile), 36 (desktop)
- **Route:** `/shop/[slug]/order/[id]/pay` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Pay ₹58". Subtitle
  "Choose your UPI app". Card rows: "Google Pay — Open", "PhonePe —
  Open", "Paytm — Open", "BHIM — Open", "Other UPI apps — Choose".
  Card: "Shop UPI ID / srisai@upi" + light-blue "Copy" pill. Helper text:
  "After you pay, come back here and tap I've paid." Bottom bar:
  secondary "Pay at counter" + primary "I've paid".
- **Desktop:** Heading "Pay ₹58", subtitle "Open your UPI app, or scan
  the code." Progress bar all three segments blue. Left: same UPI-app
  card; below it a card "Mobile number — 98765 43210" / "Name / Optional —
  Asha". Right: QR card "Scan with any UPI app" + checkerboard QR,
  "Shop UPI ID / srisai@upi" + "Copy", primary "I've paid". Helper text
  under the card: "You pay the shop directly. No extra fees." **No
  "Pay at counter" button on desktop** (see §D).
- **States:** none else shown; the UTR-entry step itself is not designed
  (see §D).

#### 8. Waiting for the shop — PDF pp. 7 (mobile), 37 (desktop)
- **Route:** `/shop/[slug]/order/[id]` while payment is unconfirmed
  (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Waiting for the shop".
  Subtitle "Sri Sai Xerox will confirm your payment." Card: "Amount —
  ₹58"; "UTR — 401288361190"; "Waiting — [1 min 20 s]" (amber pill).
  Helper text: "This page updates by itself. You can close it and come
  back from your order link." Bottom bar: secondary "Call shop" + outline
  red "Enter UTR again".
- **Desktop:** Same card left; right sidebar link card: "Call shop ›",
  "Enter UTR again ›", "Pay at counter ›". No bottom bar.
- **Behaviour:** auto-refreshing page; the "1 min 20 s" pill is a live
  waiting timer.

#### 9. Order tracking — PDF pp. 8 (mobile), 38 (desktop)
- **Route:** `/orders/[id]` / order link (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Order 1042". Subtitle
  "Printing now, about 4 min left". Pickup-code card: "Pickup code" (grey,
  centred), "4 8 2 1" (huge bold), dashed divider, "Show this at the
  counter" (grey, centred). Timeline card: "Order placed" (green dot),
  "Payment confirmed" (green dot), "Printing / Colour pages done, B&W
  printing" (blue ring dot), "Ready for pickup" (grey outline dot).
  Bottom bar: secondary "Call shop" + outline red "Cancel order".
- **Desktop:** Heading + subtitle left; pickup-code card in the right
  sidebar; timeline card left, full width. Below the timeline, two
  light-blue pill buttons: "Call shop" and "Cancel order" (blue text —
  not red, see §D). Right sidebar second card: "Sri Sai Xerox / Open
  until 9 pm" + "Directions ›".

#### 10. Your prints are ready — PDF p. 22 (mobile only)
- **Route:** `/orders/[id]` when ready (same route as screen 9, ready
  state) (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Your prints are ready".
  Subtitle "Show this code at the counter." Pickup-code card: "Pickup
  code", "4 8 2 1", dashed divider, "Order 1042". Info card:
  "Open until — 9 pm"; "Directions ›". Bottom bar: secondary "Call shop"
  + primary "Directions".
- **Desktop:** no desktop version in the PDF (see §D).

#### 11. Payment not confirmed — PDF p. 21 (mobile only)
- **Route:** `/orders/[id]` payment-failed state (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Payment not confirmed".
  Subtitle "The shop couldn't match UTR 401288361190." Card:
  "Note from the shop / Amount was ₹20, your order is ₹58.";
  "Amount to pay — ₹58". Helper text: "Pay the rest, or pay at the
  counter." Bottom bar: secondary "Pay at counter" + primary
  "Enter UTR again".
- **Desktop:** no desktop version in the PDF.

#### 12. Shop closed — PDF p. 19 (mobile only)
- **Route:** `/shop/[slug]` when closed (same route as screen 2)
  (inferred).
- **Mobile:** Header "● Sri Sai Xerox" (green dot still shown — see §D).
  Heading "Closed right now". Subtitle "Opens tomorrow at 9 am." Card:
  "Hours — 9 am to 9 pm"; "Call shop ›"; "Directions ›". Helper text:
  "Come back when the shop opens. Nothing is uploaded until then."
  No upload / order entry is offered.
- **Desktop:** no desktop version in the PDF.

#### 13. About — PDF p. 15 (mobile only)
- **Route:** `/about` (inferred).
- **Mobile:** Eyebrow "Printelyx". Heading "About". Subtitle "Print
  without the queue." Card: "0% commission / You pay the shop directly
  by UPI. Shops keep every rupee."; "Private files / Deleted 24 hours
  after pickup."; "Works with your shop / Scan the shop's QR code to
  start." Second card: "Questions? / Visit Help, or call your shop from
  your order page. ›".
- **Desktop:** no desktop version in the PDF.

#### 14. Help — PDF pp. 16 (mobile), 39 (desktop)
- **Route:** `/help` (inferred).
- **Mobile:** Eyebrow "Printelyx". Heading "Help". Subtitle
  "Quick answers". FAQ card (accordion rows, "+" at right): "How do I
  pay? / Tap your UPI app, then enter the 12-digit UTR."; "When will my
  prints be ready?"; "Is my payment safe?"; "Are my files private?";
  "Can I cancel? / Yes, before printing starts." Second card:
  "Need a person? / For order questions, call the shop from your order
  page."; "Email support ›"; "Find my order ›".
- **Desktop:** Same FAQ card left; "Need a person?" card in the right
  sidebar. Only the first and last FAQ answers are visible as sub-text;
  the other three answers are **not** shown (see §D).

#### 15. Privacy — PDF p. 17 (mobile only)
- **Route:** `/privacy` (inferred).
- **Mobile:** Eyebrow "Printelyx". Heading "Privacy". Subtitle
  "Last updated 24 Nov 2026". Card: "What we collect / Phone number
  (optional), your files for a short time, order details.";
  "What we never collect / Card or UPI details.";
  "How long we keep files / 24 hours after pickup, 7 days at most.";
  "Who sees your data / Only the shop you order from.";
  "Delete my data / Ask the shop or email privacy. ›".
- **Desktop:** no desktop version in the PDF.

#### 16. My orders — PDF p. 18 (mobile only)
- **Route:** `/orders` (inferred; device-local list).
- **Mobile:** Eyebrow "Printelyx". Heading "My orders". Subtitle
  "On this device". Card: "Order 1042 / Sri Sai Xerox, ₹58" + blue
  "Printing" pill; "Order 1038 / Sri Sai Xerox, ₹30" + green "Collected"
  pill. Helper text: "Orders stay on this device for 30 days. Open your
  order link to see an older one."
- **Desktop:** no desktop version in the PDF.

#### 17. Page not found — PDF p. 23 (mobile only)
- **Route:** 404 catch-all (inferred).
- **Mobile:** Eyebrow "Printelyx". Heading "Page not found". Subtitle
  "The link may be old or mistyped." Card with link rows: "Find a shop ›",
  "My orders ›", "Help ›". Helper text: "Reference 7F3A21. Share it if
  you ask for help."
- **Desktop:** no desktop version in the PDF.

### Shopkeeper screens

#### 18. Shopkeeper log in — PDF pp. 24 (mobile), 40 (desktop)
- **Route:** `/shop/login` (inferred).
- **Mobile:** Eyebrow "Printelyx for shops". Heading "Log in". Subtitle
  "Manage orders, payments and printers." Form card: label "Email",
  input "asha@srisai.in"; label "Password", input "••••••••";
  primary "Log in". Second card: "Forgot your password? ›";
  "New shop? Register your shop ›".
- **Desktop:** Same content centred in a narrow column; heading and
  subtitle centred; no eyebrow shown on desktop.

#### 19. Register your shop — Step 1 of 3 — PDF p. 25 (mobile only)
- **Route:** `/shop/register` (inferred).
- **Mobile:** Eyebrow "Printelyx for shops". 3-segment progress bar,
  first segment blue. Heading "Register your shop". Subtitle
  "Step 1 of 3". Form card: "Shop name" / "Sri Sai Xerox";
  "Mobile number" / "98765 43210"; "Email" / "asha@srisai.in". Helper
  text: "Next: your UPI ID, then your printer." Sticky bar: primary
  "Continue" (right-aligned, no left summary).
- **Desktop:** no desktop version in the PDF.
- **Note:** steps 2 (UPI ID) and 3 (printer) are named only in the helper
  text — no screens for them in the PDF (see §D).

#### 20. Set up your shop (onboarding checklist) — PDF p. 26 (mobile only)
- **Route:** `/shop/setup` or shopkeeper home for a new shop (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Set up your shop".
  Subtitle "3 of 5 done". Checklist card: "Shop profile" (green dot),
  "UPI ID" (green dot), "Add a printer" (green dot), "Set prices"
  (grey outline dot + light-blue "Do this" pill), "Print your QR poster"
  (grey outline dot). Helper text: "You can skip any step and come back
  later." Bottom nav: Home active.
- **Desktop:** no desktop version in the PDF.

#### 21. Today (shopkeeper home) — PDF pp. 9 (mobile), 41 (desktop)
- **Route:** `/shop` / `/shop/dashboard` (inferred).
- **Mobile:** Header "Sri Sai Xerox" (no green dot — see §D). Heading
  "Today". Card: "Open for orders" + green toggle ON; "Accepting new
  orders" + green toggle ON. Alerts card: "3 payments to confirm" +
  amber "Review" pill; "Colour printer is offline" + red "Fix" pill;
  "Order 1039 did not print" + red "Reprint" pill. Stats card:
  "Orders today — 24"; "Collected so far — ₹2,180"; "Colour pages — 96".
  Bottom nav: Home active.
- **Desktop:** Sidebar (Home active). Heading "Today" + top-right
  light-blue pill button "Add walk-in". Two top cards: toggles card
  (same two toggles) and alerts card (same three alerts). Four stat
  cards in a row: "Orders — 24", "Collected — ₹2,180", "B&W pages —
  412", "Colour pages — 96". Below: "Next in queue" table card with
  columns Next in queue / Split / Printer / Status; rows "Asha, ₹58 /
  9 B&W, 3 colour / Shop PC / To confirm", "Ravi, ₹120 / 12 colour /
  Colour printer / Waiting".
- **Note:** mobile stats omit the B&W-pages figure that desktop shows.

#### 22. Orders list — PDF p. 27 (mobile); desktop table p. 43
- **Route:** `/shop/orders` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Orders". Segmented
  control: "Waiting | Held | Printing | Done" (Waiting selected).
  Card rows: "Asha, ₹58 / 9 B&W, 3 colour, Shop PC" + amber
  "To confirm" pill; "Ravi, ₹120, urgent / 12 colour, waiting" + blue
  "Waiting" pill; "Meena, ₹30 / 10 B&W, held" + amber "Held" pill.
  Bottom nav: Orders active.
- **Desktop (table, p. 43):** Sidebar (Orders active). Heading "Orders"
  + top-right pills "All printers", "Unpaid" (light blue) and primary
  "Add walk-in". Table card, columns Customer / Split / Total /
  Printing on / Status: "Asha / 9 B&W, 3 colour / ₹58 / Shop PC /
  To confirm"; "Ravi, urgent / 12 colour / ₹120 / Waiting / Waiting";
  "Meena / 10 B&W / ₹30 / Held / Held"; "Kiran / 7 B&W / ₹14 /
  Asha's phone / Printing"; "Sana / 4 B&W / ₹8 / Shop PC / Ready".
- **Note:** the mobile list is filtered by the segmented tabs; the
  desktop table shows all statuses at once with filter pills instead.

#### 23. Orders — Kanban board (desktop only) — PDF p. 13
- **Route:** `/shop/orders` (desktop kanban view) (inferred).
- **Desktop:** Sidebar (Orders active). Heading "Orders" + top-right
  light-blue pills "All printers", "Unpaid", "Search by name or code".
  Four kanban columns (light-grey `#F3F4F6` panels): "Awaiting payment
  3" (amber count), "Queued 4" (blue), "Printing 2" (blue),
  "Ready 5" (green). Cards (white): "Asha, ₹58 / 9 B&W, 3 colour, 2 min"
  + "To confirm"; "Ravi, ₹120 / 12 colour, 5 min" + "To confirm";
  "Meena, ₹30 / 10 B&W, 8 min" + "Waiting for printer";
  "Kiran, ₹14 / 7 B&W, 11 min" + "Waiting for printer";
  "Order 1038, ₹76 / B&W set printing" + "Printing";
  "Order 1039, ₹44 / Colour printer offline" + "Needs you";
  "Sana, ₹18 / Code 2290, 14 min" + "Ready";
  "Vijay, ₹52 / Code 7415, 21 min" + "Ready".
- **Note:** no mobile kanban; the PDF does not say how the shopkeeper
  switches between kanban and table on desktop (see §D).

#### 24. Order detail (shopkeeper) — PDF pp. 10 (mobile), 42 (desktop)
- **Route:** `/shop/orders/[id]` (inferred).
- **Mobile:** Eyebrow "Orders". Heading "Order 1042". Subtitle
  "Asha, 98765 43210". Payment card: "Payment / UTR 401288361190" +
  amber "To confirm" pill; "Amount — ₹58"; "Screenshot — View".
  File card: "Unit-3 notes.pdf / 12 pages, double-sided" + a strip of
  12 mini page tiles (3 colour-gradient, 9 grey). Print-split card:
  "Colour set, 3 pages / Colour printer" + blue "Queued" pill;
  "B&W set, 9 pages / B&W printer" + "Queued". Bottom bar: outline red
  "Reject" + primary "Confirm payment".
- **Desktop:** Sidebar (Orders active). Heading "Order 1042" + top-right
  light-blue "Reject" pill and primary "Confirm payment". Left column:
  payment card (same) and a "Customer — Asha, 98765 43210" /
  "Note — Staple pages 1 to 6" card. Right column: file card with tile
  strip, and the print-split card. The customer note appears only on
  desktop (see §D).

#### 25. Payments — PDF pp. 11 (mobile), 44 (desktop)
- **Route:** `/shop/payments` (inferred).
- **Mobile:** Header "Sri Sai Xerox" (no green dot — see §D). Heading
  "Payments". Segmented control: "To confirm 3" (selected) | "Confirmed".
  Card rows: "Asha, ₹58 / UTR ending 1190, 2 min ago" + light-blue
  "Confirm" pill; "Ravi, ₹120 / UTR ending 7712, 5 min ago" + "Confirm";
  "Meena, ₹30 / Paid ₹20, order is ₹30" + red "Amount differs" pill
  (no Confirm button). Summary card: "UPI today — ₹1,840";
  "Counter today — ₹340". Bottom nav: Payments active.
- **Desktop:** Sidebar (Payments active, badge 3). Heading "Payments" +
  top-right amber pill "To confirm 3" and light-blue "Confirm all".
  Three stat cards: "UPI today — ₹1,840", "Counter today — ₹340",
  "Unpaid ready — 2". Table card, columns Customer / Amount / UTR /
  Age / Action: "Asha / ₹58 / -1190 / 2 min / Confirm";
  "Ravi / ₹120 / -7712 / 5 min / Confirm";
  "Meena / ₹30 (paid ₹20) / -4408 / 9 min / Amount differs".
- **Note:** desktop UTR column shows "-1190" — see §D.

#### 26. Printers — PDF pp. 28 (mobile), 45 (desktop)
- **Route:** `/shop/printers` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Printers". Subtitle
  "3 printers, 2 ready". Card rows: "HP LaserJet M130 / B&W, Shop PC
  and phone" + green "Ready" pill; "Canon G3010 / Colour, Shop PC" +
  "Ready"; "Epson L3250 / Colour, this phone" + red "Out of paper" pill.
  Secondary full-width button "Add printer". Bottom nav: Printers active.
- **Desktop:** Sidebar (Printers active). Heading "Printers" + top-right
  primary "Add printer". Table card, columns Printer / Type /
  Connected through / Pages today / Status: "HP LaserJet M130 / B&W /
  Shop PC, phone / 188 / Ready"; "Canon G3010 / Colour / Shop PC / 52 /
  Ready"; "Epson L3250 / Colour / Asha's phone / 0 / Out of paper".
  Below: "Devices / Shop PC online, 1 phone paired" card with "Manage"
  at the right.

#### 27. Add printer — PDF p. 50 (mobile only)
- **Route:** `/shop/printers/add` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Add printer". Subtitle
  "Choose how to connect." Card rows (all "›"): "Find on Wi-Fi /
  Printers on this network"; "Add by address / Enter its IP address";
  "This PC / Use printers installed on the shop PC"; "This phone /
  Pair with the QR code". Helper text: "Phones can print to printers
  that support network printing. Others go through the shop PC."
  Bottom nav: Printers active.
- **Desktop:** no desktop version in the PDF.

#### 28. Pricing — PDF pp. 29 (mobile), 46 (desktop)
- **Route:** `/shop/pricing` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Pricing". Segmented
  control: "A4 | A3 | A5" (A4 selected). Price card (per page):
  "B&W, one side — ₹2"; "B&W, both sides — ₹1.50"; "Colour, one side —
  ₹10"; "Colour, both sides — ₹8". Price-check card: "Price check /
  9 B&W and 3 colour pages — ₹48". Sticky bar: primary "Save prices"
  (right-aligned, no left summary).
- **Desktop:** Sidebar (Pricing active). Heading "Pricing" + top-right
  light-blue pills "A4", "A3" and primary "Save prices" (no A5 pill —
  see §D). Table card, columns Type / One side / Both sides: "B&W /
  ₹2 / ₹1.50"; "Colour / ₹10 / ₹8"; "Bulk, 50+ pages B&W / ₹1.50 / ₹1".
  Right card: "Price check / 9 B&W and 3 colour pages — ₹48";
  "Effective from — Today".
- **Note:** the Bulk 50+ row appears only on desktop.

#### 29. Reports — PDF pp. 30 (mobile), 47 (desktop)
- **Route:** `/shop/reports` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Reports". Segmented
  control: "Today | 7 days | 30 days" (Today selected). Stats card:
  "Orders — 24"; "Collected — ₹2,180"; "B&W pages — 412";
  "Colour pages — 96"; "Average wait — 7 min". Second card:
  "UPI — ₹1,840"; "Counter — ₹340"; "Show as table ›". Bottom bar:
  light-blue "Export CSV" (right-aligned).
- **Desktop:** Sidebar (Reports active). Heading "Reports" + top-right
  pills "Today", "7 days" (amber/selected), "30 days" (light blue) and
  "Export CSV". Five stat cards in a row: "Orders — 168",
  "Collected — ₹14,260", "B&W pages — 2,980", "Colour pages — 640",
  "Average wait — 7 min". Table card, columns Day / Orders / Collected /
  Colour pages: "Mon / 26 / ₹2,040 / 88"; "Tue / 22 / ₹1,760 / 71";
  "Wed / 31 / ₹2,610 / 102". Below: "Show as chart ›" card.
- **Note:** desktop is on the "7 days" range but the table shows only
  Mon–Wed; mobile offers "Show as table", desktop "Show as chart"
  (same toggle, opposite direction).

#### 30. Settings — PDF pp. 31 (mobile), 49 (desktop)
- **Route:** `/shop/settings` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Settings". Card:
  "Shop profile ›"; "Payments / UPI srisai@upi ›"; "Hours / 9 am to
  9 pm ›"; "Ordering rules ›"; "Privacy and retention / Files kept
  24 hours ›"; "Notifications ›". Second card: "Staff and roles ›";
  "Advanced ›". Bottom nav: More active (Settings lives under More on
  mobile).
- **Desktop:** Sidebar (Settings active). Heading "Settings". Left
  card — sub-nav list: "Shop profile" (active, light-blue),
  "Payments", "Hours", "Ordering rules", "Privacy and retention",
  "Notifications", "Staff and roles". Right column: profile card
  "Shop name — Sri Sai Xerox", "Mobile number — 98765 43210",
  "Address — Station Road", "UPI ID — srisai@upi"; toggles card:
  "Manual printing from phones" ON, "Hold unpaid orders" ON.
- **Note:** sub-pages (Payments, Hours, Ordering rules, etc.) are only
  listed, never designed; "Advanced" appears only on mobile.

#### 31. Customers — PDF pp. 51 (mobile), 48 (desktop)
- **Route:** `/shop/customers` (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Customers". Card rows
  ("›"): "Asha / 12 orders, last today"; "Ravi / 7 orders, last
  yesterday"; "Meena / 3 orders, last Mon". Bottom nav: More active
  (Customers lives under More on mobile).
- **Desktop:** Sidebar (Customers active). Heading "Customers" +
  top-right light-blue "Export". Table card, columns Customer / Phone /
  Orders / Last order: "Asha / 98765 43210 / 12 / Today";
  "Ravi / 98123 45678 / 7 / Yesterday"; "Meena / 97654 32109 / 3 / Mon".

#### 32. Print a file (walk-in) — PDF p. 52 (mobile only)
- **Route:** `/shop/walk-in` (inferred; reached from "Add walk-in" on
  desktop Today/Orders and from More → "Print a file" on mobile).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Print a file". Subtitle
  "For walk-in customers". Card rows: "File / Choose or scan — Choose";
  "Pages — All"; "Copies — 1"; "Colour — B&W"; "Printer — HP LaserJet".
  Sticky bar: "8 pages / ₹16" + primary "Print".
  (8 pages × ₹2 B&W = ₹16, consistent with the price list.)
- **Desktop:** no desktop version in the PDF.

#### 33. QR poster — PDF p. 53 (mobile only)
- **Route:** `/shop/qr-poster` (inferred; reached from setup checklist
  and More).
- **Mobile:** Header "● Sri Sai Xerox". Heading "QR poster". Subtitle
  "Customers scan this to order." Poster card (white, centred):
  "Sri Sai Xerox" (bold), "Scan to print. Pay by UPI." (grey),
  checkerboard QR placeholder in a rounded frame. Bottom bar: secondary
  "Download PNG" + primary "Print A4".
- **Desktop:** no desktop version in the PDF.

#### 34. More (shopkeeper menu) — PDF p. 54 (mobile only)
- **Route:** mobile shopkeeper overflow menu (inferred).
- **Mobile:** Header "● Sri Sai Xerox". Heading "More". Card:
  "Pricing ›", "Reports ›", "Customers ›", "Print a file ›",
  "QR poster ›", "Settings ›". Second card: "Billing ›", "Audit log ›",
  "Help ›". Bottom nav: More active.
- **Desktop:** no equivalent — all items are in the sidebar.

#### 35. Billing — PDF p. 55 (mobile only)
- **Route:** `/shop/billing` (inferred; reached from More).
- **Mobile:** Header "● Sri Sai Xerox". Heading "Billing". Subtitle
  "Your plan". Card: "Plan / Flat monthly fee, no commission — Standard";
  "Status — [Active]" (green pill); "Next payment — 1 Dec". Second
  card: "Invoice, Nov — Download"; "Invoice, Oct — Download". Bottom
  nav: More active.
- **Desktop:** no desktop version in the PDF.
- **Note:** the monthly fee amount is never stated anywhere (see §D).

#### 36. Your files — file-error state (mobile only) — PDF p. 20
- **Route:** same route as screen 3, error state (inferred).
- **Mobile:** Header "● Sri Sai Xerox". 3-segment progress bar, first
  segment blue. Heading "Your files". Subtitle "Step 1 of 3". Card rows:
  "Thesis.pdf / Too big. The limit is 50 MB." + red "Remove" pill;
  "Notes.zip / Not supported. Use a PDF, photo or Word file." + "Remove";
  "Form.pdf / Locked with a password. Unlock it, then add it again." +
  "Remove"; "Lab record.docx / 8 pages, 0.9 MB" + green "Ready" pill.
  Sticky bar: "1 file ready / 8 pages" + primary "Continue".
- **Behaviour:** each failed file gets a plain-language reason and a
  "Remove" pill; valid files stay and the flow can continue with only
  the ready files (bottom bar counts "1 file ready").
- **Note:** the same "Lab record.docx" appears here as 8 pages, 0.9 MB,
  Ready — while on screen 3 it is still "Preparing your file" at 68%
  with no page count. See §D.

---

## C. End-to-end flows

### C.1 Consumer flow (order a print)

1. **Find a shop** (1) — land on Printelyx, search or scan a QR code →
   pick a shop (open / wait time shown; closed shops show next opening).
2. **Shop home** (2) — see printers online, wait time, prices, hours →
   "Add files".
3. **Your files** (3) — add PDF / photo / Word files (≤ 50 MB each);
   files prepare with a % pill; bad files are rejected with a reason
   (36) → "Continue".
4. **How should we print it?** (4) — pick a preset per file: Notes,
   Colour everything, Photo or ID copy, or Mix → set pages/copies/paper/
   binding under "More options".
5. **Choose colour pages** (5) — only for Mix: pre-detected colour pages
   are pre-selected; tap any tile to flip B&W ↔ Colour; or use the
   All B&W / Mixed / All colour presets → "Review order".
6. **Review order** (6) — check per-file summary and total; enter mobile
   number and optional name → "Pay ₹58".
7. **Pay** (7) — open a UPI app (Google Pay / PhonePe / Paytm / BHIM /
   other) or scan the QR (desktop), pay the shop's UPI ID directly, come
   back and tap "I've paid" (or "Pay at counter").
8. **Waiting for the shop** (8) — auto-refreshing page shows amount, UTR
   and a waiting timer while the shop confirms. If the shop can't match
   the payment → **Payment not confirmed** (11) with the shop's note
   ("Amount was ₹20, your order is ₹58"), offering "Pay at counter" or
   "Enter UTR again".
9. **Order tracking** (9) — timeline Order placed → Payment confirmed →
   Printing → Ready for pickup; pickup code (4 digits) is shown from the
   printing stage; "Call shop" / "Cancel order" available.
10. **Your prints are ready** (10) — same order page in the ready state;
    show the pickup code at the counter; "Directions" offered.
11. **Afterwards:** **My orders** (16) lists orders placed on this device
    for 30 days. **Help** (14), **About** (13), **Privacy** (15) and the
    **404 page** (17) are reachable from headers/links at any point.
    **Shop closed** (12) replaces the shop home outside hours and blocks
    uploads.

### C.2 Shopkeeper flow

1. **Register your shop** (19) — Step 1 of 3: shop name, mobile, email.
   Helper text promises Step 2 = UPI ID, Step 3 = printer.
   (Steps 2–3 have no screens in the PDF.)
2. **Set up your shop** (20) — checklist, 3 of 5 done in the example:
   Shop profile ✓, UPI ID ✓, Add a printer ✓, Set prices, Print your
   QR poster. Steps are skippable.
3. **Log in** (18) — email + password → shopkeeper home.
4. **Today** (21) — toggles "Open for orders" / "Accepting new orders";
   alerts (payments to confirm, printer offline, failed print); today's
   stats; "Next in queue" (desktop) / "Add walk-in" (desktop).
5. **Orders** (22 mobile list / 23 desktop kanban / desktop table) —
   triage by status (Waiting / Held / Printing / Done; kanban: Awaiting
   payment / Queued / Printing / Ready). Open an order →
6. **Order detail** (24) — check payment (UTR, amount, screenshot),
   check the file and its page tiles, see the colour/B&W print split
   and which printer each set is queued on → "Confirm payment" (starts
   printing) or "Reject".
7. **Payments** (25) — confirm UTRs one by one ("Confirm") or all at
   once ("Confirm all", desktop); mismatched amounts show "Amount
   differs" with no confirm action; UPI vs counter totals shown.
8. **Printers** (26) — see printer status (Ready / Out of paper, etc.);
   **Add printer** (27): Find on Wi-Fi, Add by address, This PC,
   This phone.
9. **Pricing** (28) — per-paper-size (A4/A3/A5) rates for B&W/colour,
   one/both sides, plus a bulk row (desktop); price-check preview;
   "Save prices".
10. **Reports** (29) — Today / 7 days / 30 days; orders, collected,
    B&W/colour pages, average wait; UPI vs counter; table or chart view;
    "Export CSV".
11. **Customers** (31) — repeat customers by phone, order counts, last
    order; "Export" (desktop).
12. **Walk-in orders** — **Print a file** (32) from the counter: choose/
    scan a file, pages, copies, colour, printer → "Print" (charged at
    the price list, e.g. 8 pages B&W = ₹16). Reached via "Add walk-in"
    (desktop) or More → "Print a file" (mobile).
13. **QR poster** (33) — the shop's order QR ("Sri Sai Xerox — Scan to
    print. Pay by UPI.") → "Download PNG" / "Print A4". This is the QR
    customers scan to reach the shop page.
14. **Settings** (30) — shop profile, payments (UPI ID), hours,
    ordering rules, privacy/retention, notifications, staff/roles,
    advanced; desktop adds the "Manual printing from phones" and
    "Hold unpaid orders" toggles.
15. **More** (34, mobile) — overflow menu for Pricing, Reports,
    Customers, Print a file, QR poster, Settings, Billing, Audit log,
    Help.
16. **Billing** (35) — plan ("Standard", flat monthly fee, no
    commission), status Active, next payment date, monthly invoices.

---

## D. Ambiguous or unreadable — do not invent

1. **Font identity and sizes.** The PDF names no font and no sizes. The
   brief says "Instrument Sans / Inter-like sans" — the renders are
   consistent with that, but it is not verifiable from the PDF. No px/rem
   values, weights, or line-heights are given anywhere.
2. **Exact radii/spacing.** The brief says cards 20–24 px radius; the
   renders look consistent with that, but no measurement is stated in the
   PDF. Page padding, card gaps and button heights are eyeballed, not
   specified.
3. **Desktop breakpoint / container width.** Desktop pages are wide
   renders with a centred content column, but no breakpoint, max-width or
   grid spec is given.
4. **No URLs.** The PDF shows no routes. All routes in §B are inferred
   from the live app's structure and the screens' roles.
5. **QR codes are placeholders.** Every QR graphic (landing, Pay desktop,
   QR poster) is a checkerboard pattern, not a real QR code. The QR
   payload/URL format is unspecified.
6. **No UTR-entry screen.** "I've paid" and "Enter UTR again" imply a
   12-digit UTR input, but no screen in the PDF shows a UTR field. How
   the UTR is collected (dialog? separate page?) is unspecified.
7. **"Pay at counter" flow.** No screen shows what happens after tapping
   it (consumer or shopkeeper side).
8. **"Notes" preset price doesn't reconcile.** "Notes — Black & white,
   double-sided" for a 12-page file is ₹30, but the price list gives
   ₹2/page one side (₹24) and ₹1.50/page both sides (₹18). No
   combination of the listed rates gives ₹30. The Mix total (9×₹2 +
   3×₹10 = ₹48) uses single-sided rates even though the review calls
   the file "double-sided".
9. **Review drops a file without explanation.** Step 1 shows 3 files /
   15 pages; Review shows 2 files / 13 pages. The "Lab record.docx"
   (still "Preparing your file" at 68% in Step 1) simply never appears
   in Review. Whether unprepared files are excluded, or this is just
   example-data sloppiness, is unspecified.
10. **Lab record.docx is inconsistent between pages.** On p. 3 it is
    "Preparing your file, 68%" with no page count; on p. 20 it is
    "8 pages, 0.9 MB, Ready". Example data, not a spec — do not treat
    either as canonical.
11. **Desktop Pay has no "Pay at counter".** Mobile Pay (p. 6) has
    "Pay at counter" + "I've paid"; desktop Pay (p. 36) has only
    "I've paid" (inside the QR card). Unclear whether this is an
    omission in the desktop design or intentional.
12. **Cancel order changes colour on desktop.** Mobile tracking (p. 8)
    shows "Cancel order" as a red-text outline button; desktop (p. 38)
    shows it as a light-blue pill with blue text, same as "Call shop".
    Unclear which is intended.
13. **Desktop Payments UTR column reads "-1190".** Mobile says "UTR
    ending 1190". The desktop dash is probably a truncated "…1190",
    but it renders as a hyphen; the intended masking format is
    ambiguous.
14. **Green status dot on the Closed screen.** The "Closed right now"
    page (p. 19) still shows a green dot next to "Sri Sai Xerox", and
    the Today (p. 9) and Payments (p. 11) headers show no dot at all,
    while every other shopkeeper page shows one. Possibly inconsistent
    example art; the dot's meaning (open vs merely "shop context") is
    unspecified.
15. **Desktop Pricing omits A5 and adds Bulk.** Mobile Pricing has an
    A4/A3/A5 segmented control and no bulk row; desktop Pricing has
    only "A4" and "A3" pills and adds a "Bulk, 50+ pages B&W — ₹1.50 /
    ₹1" row. Unclear whether A5/bulk are desktop-only, mobile-only, or
    just missing from one render.
16. **Billing fee amount is never stated.** "Standard — Flat monthly
    fee, no commission", "Next payment 1 Dec", but no ₹ amount appears
    anywhere in the PDF.
17. **Kanban ↔ table switching is unexplained.** Desktop Orders exists
    as both a kanban (p. 13) and a table (p. 43); no control for
    switching views is shown on either page.
18. **Register steps 2–3 are not designed.** Only Step 1 (shop name,
    mobile, email) is shown; the UPI-ID and printer steps are named
    only in the "Next:" helper text.
19. **Settings sub-pages are not designed.** Shop profile is shown
    (desktop); Payments, Hours, Ordering rules, Privacy and retention,
    Notifications, Staff and roles, Advanced are list items only.
    "Advanced" appears on mobile Settings but not on desktop.
20. **"Audit log" has no screen.** It appears only as a row in More
    (p. 54).
21. **"Find my order" has no screen.** It appears as a link on Help
    (pp. 16, 39) and on the 404 page; no lookup form (order code /
    phone) is designed.
22. **"Email support" address is not shown.** No support email appears
    anywhere; Privacy says "email privacy" with no address.
23. **FAQ answers mostly hidden.** On Help, only "How do I pay?" and
    "Can I cancel?" show answers; the answers to "When will my prints
    be ready?", "Is my payment safe?" and "Are my files private?" are
    not in the PDF.
24. **"Show as table" vs "Show as chart".** Mobile Reports offers
    "Show as table ›"; desktop offers "Show as chart ›". The toggle
    exists in both directions, but neither the table (mobile) nor the
    chart (desktop) view itself is designed.
25. **Reports 7-day table shows only 3 days.** Desktop Reports on the
    "7 days" range lists Mon–Wed only (26/22/31 orders). Whether the
    table scrolls or is truncated is unspecified.
26. **"Held" / "Hold unpaid orders" semantics.** Orders can be "Held"
    and there is a "Hold unpaid orders" toggle, but no screen explains
    what holding does, who releases a held order, or how a held order
    resumes.
27. **Bottom-nav icons are placeholders.** The five mobile shopkeeper
    tab icons render as empty rounded-square outlines; the actual glyphs
    are not specified in the PDF.
28. **No loading, empty, or offline states** beyond "Preparing your
    file 68%" and the waiting timer. No empty-orders, empty-payments,
    no-results, network-error, or session-expired screens are in the
    PDF. No toast/snackbar/confirmation-dialog designs (e.g. for
    "Cancel order", "Reject", "Confirm payment", "Reprint").
29. **No desktop versions** for: Review order, Your prints are ready,
    Payment not confirmed, Shop closed, About, Privacy, My orders,
    404, Register, Setup checklist, Add printer, Print a file,
    QR poster, More, Billing, Customers (mobile exists; desktop
    exists — see §B), and the file-error state. Desktop coverage is
    20 of the 55 pages.
30. **"1 min 20 s" waiting timer.** Shown as an amber pill; its
    countdown behaviour, timeout, and what happens when it expires are
    unspecified.
31. **Customer note ("Staple pages 1 to 6") appears only on desktop**
    order detail (p. 42), not on mobile (p. 10). Whether the note
    exists on mobile or is desktop-only is unspecified. (There is also
    no consumer-side UI in the PDF for adding such a note.)
32. **"Urgent" flag.** "Ravi, ₹120, urgent" appears in Orders; no UI
    for marking an order urgent, or what urgency changes, is shown.
33. **"Add walk-in" vs "Print a file".** Desktop Today/Orders have an
    "Add walk-in" button; the corresponding screen is titled
    "Print a file" (mobile only). The desktop walk-in screen is not
    designed.
34. **Background colour discrepancy.** The brief states `#EDF0F5`; the
    renders measure `#F2F3F7` at every sampled background pixel. Either
    value may be the intended token — verify against the live site
    before hard-coding.
35. **"2 printers online" vs 3 printers.** The shop home says
    "2 printers online", while the Printers screen lists 3 printers
    (2 Ready, 1 Out of paper) — consistent (2 of 3 online), but the
    home subtitle does not say how the count is derived when printers
    are in other states.
