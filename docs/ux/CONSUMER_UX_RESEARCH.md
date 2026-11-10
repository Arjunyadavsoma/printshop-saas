# Consumer UX Research — Document-Upload & Print-Order Workflows

> A research brief of practical, proven UI patterns for a consumer-facing
> document-upload → preview → configure → checkout → track journey, written
> for the PrintShop SaaS customer portal. Every recommendation cites an
> authoritative source and ends with the user problem, the proposed
> interaction, why it is reliable, accessibility considerations, and
> implementation implications for this codebase.
>
> **Scope:** customer-facing surfaces only (home, shop discovery, shop
> detail, order flow, order tracking). Shopkeeper and admin portals are
> out of scope.
>
> **Standards referenced:** WCAG 2.2 (W3C Recommendation 05 Oct 2023),
> GOV.UK Design System, Material Design 3 accessibility guidance,
> Nielsen Norman Group research on file-upload UX, Lucide icon
> accessibility notes. No third-party branding is copied; patterns are
> described generically.

---

## 1. Effective consumer document-upload workflows

**User problem.** Customers arrive via a QR code on a shop counter, on a
mobile device, often with marginal bandwidth. They expect to upload one
or more documents, see them accepted, and move on without surprise.

**Proposed interaction.** A single dropzone that supports both
`<input type="file" multiple>` browse **and** drag-and-drop, with the
browse button visually dominant on mobile (where drag-drop is rarely
available) and the dropzone affordance dominant on desktop. The dropzone
must declare accepted types both as the `accept` attribute (so the OS
file picker filters) and as visible helper text.

**Why reliable.** GOV.UK Design System "File upload" guidance and NN/g
research converge on: (a) a single field with a clear button, (b) visible
accepted-formats list, (c) per-file progress, (d) a per-file remove
control before submission. Material 3 "File upload" adds the drag
affordance for pointer devices.

**Accessibility.** Per WCAG 2.2 SC 2.5.7 (Dragging Movements, Level AA),
all dragging movements must have a keyboard-equivalent. The dropzone
itself is **not** focusable; the "Browse files" `<button>` is the
keyboard path and must be the first focusable element in the upload card.
The hidden `<input type="file">` is reached only via the button's click
handler. Drag events (`onDragOver`, `onDrop`) are progressive-enhancement
only.

**Implementation implications.** Keep the current
`src/app/orders/[id]/page.tsx` `UploadStep` (lines 794–901) structure:
visible `<Button>` that triggers `fileInputRef.current?.click()`, a
hidden `<input type="file" multiple accept="...">`, and a sibling
dropzone. Add an `aria-label` on the button, a `role="region"` with
`aria-label="Upload drop zone"` on the dropzone, and ensure the
`accept` string is mirrored as visible text below the button.

---

## 2. Multi-file selection and file replacement

**User problem.** Customers upload several files at once, then realise
one is the wrong version. They need to remove the bad file and add the
correct one without losing the rest of the order state.

**Proposed interaction.** Each file is rendered as a card with: filename,
size, page count, status, a remove control (trash icon button), and
— once uploaded — inline print-settings. A "Replace" affordance is
provided as a secondary action that re-opens the file picker scoped to
a single replacement, preserving the existing card position.

**Why reliable.** The "file card" pattern is used across GOV.UK, NHS,
and Dropbox uploaders. The remove-and-re-add flow is the simplest
mentally-modelable replacement and avoids the state complexity of an
in-place byte swap on a presigned URL.

**Accessibility.** The remove button must have `aria-label="Remove
{filename}"` (filename personalises the label so screen-reader users can
distinguish between cards). Each card should be a `<li>` inside a `<ul
role="list">` so screen readers announce "list, 3 items". Replace
buttons get `aria-label="Replace {filename}"`.

**Implementation implications.** `FileCard` in
`src/app/orders/[id]/page.tsx` (lines 1417–1549) already has the remove
control. Add a "Replace" button that (a) calls a new `onReplace(fileId)`
handler, (b) opens the picker, (c) on selection, optimistically marks
the old card `status: 'replacing'`, (d) runs the same presign → PUT →
confirm pipeline, (e) on success, removes the old card and inserts the
new one in the same slot. The current `removeFile` (line 464) only
removes the local row — the server still holds the file; an explicit
DELETE endpoint is needed (see audit doc, finding P1-04).

---

## 3. Document preview and page navigation

**User problem.** Customers cannot tell from a filename alone whether
they uploaded the right PDF, whether it is 2 pages or 200, or whether
page 7 (which they don't want printed) is the colour plate.

**Proposed interaction.** Render PDF page thumbnails client-side using
PDF.js in a Web Worker, 5 per "view" with prev/next pagination and a
"page X of Y" indicator. Provide "Select all / Deselect all" controls
and per-page selection (click a thumbnail to toggle). For images, show
a single thumbnail. For Office files where server-side page count is
unknown, show a "preview not available, {N} pages reported by shopkeeper"
placeholder.

**Why reliable.** The thumbnails-with-checkbox pattern is well
established (Adobe Acrobat online, Smallpdf, ILovePDF). Client-side PDF.js
rendering avoids a server round-trip and keeps the document on the
customer device until upload.

**Accessibility.** Per-page selection must be operable by keyboard: each
thumbnail must be a `<button role="checkbox" aria-checked={selected}
aria-label="Page {n}">`. WCAG 2.2 SC 4.1.2 (Name, Role, Value) requires
the role and state be programmatically exposed. The current
implementation uses a `<div onClick>` (pdf-preview.tsx line 300) which
fails this — see audit finding P0-03.

**Implementation implications.** `src/components/portal/pdf-preview.tsx`
already uses PDF.js via a dynamic import + Worker (lines 82–91). The
rendered thumbnails are JPEG data URLs at scale 0.5 (line 113). Add:
(a) convert the thumbnail `<div>` to a `<button role="checkbox">`, (b)
add a zoom control (1×, 1.5×, 2×) by re-rendering at a higher scale on
demand, (c) memoise rendered thumbnails so toggling selection does not
re-render. The `fileUrl` prop exists but is unused when `rawFile` is
present; wire it so refresh-on-track-step can still preview.

---

## 4. Print configuration interfaces (progressive disclosure)

**User problem.** A file has four orthogonal settings (copies, colour,
paper, duplex) plus an optional page range. Showing all five at once
overwhelms; hiding any of them risks the customer printing the wrong
thing.

**Proposed interaction.** Show the four primary settings as a compact
2×2 grid (or 4-col grid on desktop) with sensible defaults pre-applied
(copies=1, B&W, A4, simplex). Reveal page-range only after the file is
confirmed (page count known). Use the same control type for the same
setting everywhere — `ToggleGroup` for binary/short-enum choices,
`Select` for paper size, `Input[type=number]` for copies, `Switch` for
duplex is inconsistent; pick one and apply it.

**Why reliable.** Material 3 "Progressive disclosure" and GOV.UK "Hide
optional content" both warn: reveal complexity only when the preceding
step is settled. The 2×2 grid is dense without being cramped on a 360px
viewport.

**Accessibility.** Every control must have a `<Label>` with `htmlFor`
pointing at the input id. `ToggleGroup` from Radix already provides
`role="radiogroup"` and arrow-key navigation; preserve that. Avoid
native `<select>` mixed with shadcn `Select` — they look different and
behave differently under screen readers.

**Implementation implications.** `ConfigureStep` (orders/[id]/page.tsx
lines 903–1024) uses `ToggleGroup` for colour/sides but a native
`<select>` for paper (lines 966–975). `FileCard` (lines 1498–1511) uses
`ToggleGroup` for paper. **Pick `ToggleGroup` everywhere** for
consistency, or migrate both to shadcn `Select`. The current duplication
means the same setting is rendered two different ways depending on which
step the customer is in.

---

## 5. Price transparency and checkout patterns

**User problem.** Customers do not trust a price that changes between
the file-config step and the checkout step. They want to see what
they're paying for (per-file line items) and the total before paying.

**Proposed interaction.** Show a per-file price on the file card (live,
client-side estimate while editing; server-confirmed once saved). On the
checkout step, show a line-items table: one row per file with filename,
settings summary (copies × colour × paper × duplex × page-range), and
price. The total is the server-computed sum, never the client sum.
Explicitly label "Server-confirmed total" so the customer knows the
number is authoritative.

**Why reliable.** GOV.UK "Check answers" pattern + Material 3 "Review"
both put the authoritative total at the end, before the primary action.
The label "server-confirmed" sets the right expectation that the visible
number can change if settings change.

**Accessibility.** The line-items table must be a real `<table>` with
`<thead>`, `<tbody>`, `<tfoot>`, `scope="col"` on headers, and
`scope="row"` on the first cell of each row. Wrap in
`<div className="overflow-x-auto">` for mobile horizontal scroll
(already done in `CheckoutStep` lines 1047–1082).

**Implementation implications.** Already largely implemented correctly.
Server recalculates the order total on every PATCH (file/[fileId]/route.ts
lines 67–69) and on checkout (checkout/route.ts line 70 reads
`order.totalAmountPaise`). The client never sends a price to the server
— only settings. Keep this invariant. The current "Skip to checkout"
button (line 891) bypasses configuration and may surface an unpriced
file; the checkout endpoint will reject with "X file(s) have no price"
(checkout/route.ts line 49) — surface that error inline at the file
that needs configuration, not as a generic banner.

---

## 6. Mobile-first upload and ordering behaviour

**User problem.** The customer is on a 360–414px viewport, paying for
data, often one-handed. Tap targets that work on desktop (32×32px) are
unusable.

**Proposed interaction.** Minimum 44×44px tap target for every
interactive element (WCAG 2.2 SC 2.5.8, Level AA). Primary actions
stretch full-width on mobile (`w-full`) and shrink to `sm:w-auto` on
≥640px. Settings grids collapse from 4-col to 1-col. The order stepper
shows step numbers in 32px circles (acceptable because they are not
interactive). The sticky summary bar pins the total + primary CTA at
the bottom of the viewport while scrolling the file list.

**Why reliable.** WCAG 2.2 SC 2.5.8 codifies the 44px minimum; the
NN/g mobile-form guidelines document the full-width primary pattern.

**Accessibility.** Use `min-h-[44px]` on every `<Button>` and icon-only
`<button>`. The remove-file trash button (FileCard line 1451) already
has `min-h-[44px] min-w-[44px]`. The pagination dots in `PdfPreview`
(line 350) are `h-8 min-w-8` (32px) — below the 44px minimum; bump to
`h-11 min-w-11` or wrap in a larger hit area.

**Implementation implications.** The codebase already applies
`min-h-[44px]` to most buttons (a lint check worth adding). Stepper
labels at `text-[10px]` (line 786) are too small for low-vision users;
consider `text-xs` (12px) as the floor. Camera capture on mobile: add
`capture="environment"` to the file input so the camera is offered as a
source on supported devices (useful for scanning a printed page the
customer physically holds).

---

## 7. Accessible drag-and-drop alternatives

**User problem.** Drag-drop is unusable for keyboard users, screen-reader
users, and touch users (no native drag on iOS Safari for files). A
"drag-only" uploader locks out a meaningful fraction of customers.

**Proposed interaction.** The dropzone is purely decorative — it
provides visual affordance for pointer users but is not focusable and
carries no role. The **only** programmatic path to the file picker is
the visible "Browse files" button. Drag-over and drop events are
attached to the dropzone region for progressive enhancement only.

**Why reliable.** WCAG 2.2 SC 2.5.7 (Dragging Movements) requires that
all functionality operated by dragging also be operable by a
single-pointer without dragging. The browse button satisfies this.

**Accessibility.** The dropzone must not be in the tab order (`tabIndex`
not set, no `role="button"`). The "Browse files" button is the labelled,
focusable control. After a file is picked, focus should move to the new
file card's first control so the screen-reader user knows something
happened (focus management).

**Implementation implications.** `UploadStep` (line 824) attaches
`onDragOver`/`onDragLeave`/`onDrop` to a plain `<div>`. The div is
correctly not focusable today. Add: after `handleFiles` completes for a
file, call `fileCardRef.current?.focus()` on the new card's first
interactive element. The "Browse files" button (line 832) already has a
visible label; add `aria-label="Browse files from your device"` to
override the truncated text on narrow screens.

---

## 8. Upload progress, retry, cancellation, error recovery

**User problem.** Uploads fail on flaky mobile networks. Without
per-file progress, retry, and cancel, the customer cannot tell whether
an upload is stuck or recover without refreshing the page (which loses
in-progress configuration).

**Proposed interaction.** Each uploading file card shows: a determinate
progress bar (0–100%), the percentage as text, and a Cancel button that
aborts the XHR. On failure, the card shows the error inline and a Retry
button that re-runs the presign → PUT → confirm pipeline for the same
`File` object. Optimistic UI: the placeholder card appears immediately
on selection; failure does not remove the card, it transitions to a
`failed` state with the retry affordance.

**Why reliable.** Material 3 "Progress" + NN/g "Feedback" research:
determinate progress with a number reduces perceived wait time and
abandonment. The retry-on-same-payload pattern is standard for
idempotent uploads.

**Accessibility.** The progress bar must have `role="progressbar"` with
`aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, and an
`aria-label` such as "Uploading {filename}, {percent}% complete". Cancel
and Retry buttons get personalised `aria-label`s.

**Implementation implications.** The XHR is already created in
`handleFiles` (orders/[id]/page.tsx lines 394–408) with
`xhr.upload.onprogress` wired (line 398). To add cancel: store the XHR
reference on the `LocalFile` (e.g. `xhrRef`) and call `xhr.abort()` from
a Cancel button. To add retry: keep the `rawFile` on the failed card
(already kept, line 376) and re-call `handleFiles([rawFile])` after
removing the failed placeholder. The current `Progress` component
(FileCard line 1465) renders without ARIA — pass through the props.

---

## 9. Order status and tracking experiences

**User problem.** After paying, the customer waits. They want to know:
did the shopkeeper get my money? Is it printing? When can I collect?
Without clear separation of "payment status" and "order status",
customers confuse "Payment Pending" with "Order Cancelled".

**Proposed interaction.** Two distinct indicators on the tracking page:
(1) Payment status — green checkmark + "Payment Confirmed {time}" or
amber clock + "Payment Pending — the shopkeeper will verify". (2) Order
status — a labelled timeline (Paid → Printing → Ready → Collected) with
the current step highlighted and the next action stated explicitly
("Collect your prints at the counter"). Auto-poll on a sensible cadence;
show the cadence to the customer ("Refreshed every 30 seconds").

**Why reliable.** GOV.UK "Status" pattern + the Material 3 "Stepper"
both recommend: one status at a time, clear current state, clear next
action. Separating payment from fulfilment status is the standard fix
for the "permanent spinner when payment is confirmed but order is still
printing" bug (documented in TrackStep comments, orders/[id]/page.tsx
lines 1283–1332).

**Accessibility.** Status icons must have a text label (already done —
the `<p>` next to the icon carries the label). Use `aria-live="polite"`
on the order-status block so screen readers announce transitions ("Order
is now printing"). The 30-second poll must not steal focus or scroll.

**Implementation implications.** TrackStep (lines 1254–1402) already
splits payment and order status into two cards and already polls at 30s
(line 601). Add `aria-live="polite"` to the order-status card. The
"Refreshed every 30 seconds" copy is already present (line 1271).
Terminal states (`collected`, `cancelled`, `refunded`) stop polling
(line 599) — correct.

---

## 10. Icon, typography, spacing, component, interaction conventions

**Icons.** Lucide icons throughout, sized with the `size-N` shorthand
(`size-4` = 16px, `size-5` = 20px) or `h-N w-N`. Every icon that is
decorative (next to a text label) must have `aria-hidden="true"`; every
icon-only button must have an `aria-label`. Lucide's own accessibility
note: "icons must always be accompanied by a visible text label or an
`aria-label` — never rely on the icon alone." The codebase already
applies `aria-hidden="true"` to most decorative icons (see page.tsx
lines 169, 182, 187) — keep this discipline.

**Typography.** Body 14px (`text-sm`), captions 12px (`text-xs`), tiny
labels 11px (`text-[11px]`) — but 11px is below the WCAG 2.2 SC 1.4.4
resize-text guidance floor; reserve `text-[11px]` for non-essential
metadata only. Headings: `text-xl sm:text-2xl` for card titles,
`text-3xl sm:text-4xl lg:text-5xl` for the page H1. Currency amounts use
`tabular-nums` so columns of numbers align (already applied in
ShopCard line 424).

**Spacing.** Tailwind scale only — no `p-3.5` or `gap-7`. Standard card
padding `p-4` (compact) / `p-6` (default). Section gaps `gap-4` (within
a card) / `gap-6` (between cards). The audit doc records where off-scale
values leak in.

**Components.** Use shadcn primitives (`Button`, `Card`, `Input`,
`Label`, `Badge`, `Switch`, `ToggleGroup`, `Progress`, `Skeleton`,
`Dialog`, `AlertDialog`) — do not rebuild equivalents. The existing
`src/components/ui/` folder has the full set. The `pdf-preview.tsx`
component hand-rolls a "checkbox" with `<div onClick>` — migrate to a
real `<button role="checkbox">` or to the shadcn `Checkbox` primitive.

**Interaction conventions.** Focus-visible rings on every interactive
element: `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-ring focus-visible:ring-offset-2`. Hover:
`hover:bg-muted`, `hover:border-brand/40`. Disabled:
`disabled:opacity-50 disabled:pointer-events-none`. Loading:
`Loader2` spinner + `disabled`. Reduced motion is already handled in
`globals.css` lines 175–182 (zeroes animation/transition durations for
`prefers-reduced-motion: reduce`).

**Professional/restrained aesthetic.** No decorative gradients. No emoji
as icons. No "rocket" or "sparkles" feature-card icons. Brand amber is
the only accent colour; success/warning/info/danger tokens carry
semantic load. Cards have `shadow-sm`; hover lifts to `shadow-md` with a
`-translate-y-0.5` nudge. Dialogs use `shadow-lg`. No `shadow-2xl`.

---

## Cross-cutting principles

1. **Server-authoritative pricing.** The client may estimate, the server
   must compute. Never send a price from the client to the server.
2. **Per-order access tokens.** The `customerToken` (X-Order-Token)
   pattern in `with-order-access.ts` is the right IDOR mitigation;
   preserve it and never log the token.
3. **Optimistic UI, pessimistic truth.** Show optimistic state
   immediately (placeholder card, progress bar), but never lie about
   server state (failed = failed, pending = pending).
4. **Mobile-first, keyboard-always.** Every customer-facing interaction
   must be operable at 360px width and from a keyboard with no pointer.
5. **Progressive disclosure.** Reveal complexity only when the
   prerequisite step is settled (page count known → show page range;
   file priced → show checkout).
6. **Respect reduced motion.** All animations are decorative; the
   `prefers-reduced-motion` media query in `globals.css` already
   disables them — keep new animations subtle and override-able.

---

## References

- W3C. *Web Content Accessibility Guidelines (WCAG) 2.2.* 05 Oct 2023.
  https://www.w3.org/TR/WCAG22/
- GOV.UK Design System. *File upload.* https://design-system.service.gov.uk/components/file-upload/
- GOV.UK Design System. *Status.*
  https://design-system.service.gov.uk/patterns/status-pages/
- Material Design 3. *Accessibility guidance.*
  https://m3.material.io/foundations/accessible-design/overview
- Nielsen Norman Group. *File-Upload UX.*
  https://www.nngroup.com/articles/file-upload/
- Lucide. *Accessibility notes.* https://lucide.dev/guide/
- WAI-ARIA Authoring Practices 1.2. *Checkbox pattern.*
  https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
- WAI-ARIA Authoring Practices 1.2. *Progressbar pattern.*
  https://www.w3.org/WAI/ARIA/apg/patterns/progressbar/
