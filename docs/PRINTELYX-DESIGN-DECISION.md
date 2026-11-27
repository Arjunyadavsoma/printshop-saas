# PRINTELYX — Design Decision

**Date:** 2026-11-27
**Source of truth:** This document is the canonical design direction for the Printelyx consumer pipeline.

---

## Selected Methodology: "Impeccable" (polish + craft)

**Score:** 8.35/10 (highest of three evaluated methodologies)

**Justification:** The Impeccable methodology produces the "premium, clean, confident, and approachable" feel the Printelyx design brief specifies. It balances visual quality (9/10) with consistency (9/10) and mobile responsiveness (9/10) — the three criteria most important for a consumer-facing printing marketplace. It avoids the over-design risk of conversion-optimized approaches and the plainness of minimal approaches.

---

## Canonical Design Tokens

These tokens are the source of truth for all consumer UI work. They are already defined in `globals.css` as CSS variables.

### Colors

| Token | Value | CSS Variable | Usage |
|---|---|---|---|
| Primary Blue | `#2563EB` | `--accent` | Primary actions, links, focus rings |
| Deep Blue | `#1D4ED8` | `--accent-press` | Pressed/hover state of primary |
| Light Blue | `#EFF6FF` | `--accent-tint` | Tinted backgrounds for primary accents |
| Pale Blue | `#DBEAFE` | `--accent-tint-2` | Hover states, subtle highlights |
| White | `#FFFFFF` | `--surface` | Cards, modals, inputs |
| Background | `#F8FAFC` | `--ground` | Page background |
| Primary Text | `#0F172A` | `--label` | Headings, primary text |
| Secondary Text | `#64748B` | `--label-2` | Body text, descriptions |
| Muted Text | `#94A3B8` | `--label-3` | Labels, placeholders, captions |
| Border | `#E2E8F0` | `--hairline` | Card borders, dividers, input borders |
| Success | `#16A34A` | `--success` | Success states, confirmed payments |
| Warning | `#D97706` | `--warning` | Warnings, pending states |
| Error | `#DC2626` | `--error` | Errors, rejected payments |

### Typography

- **Font:** Inter (loaded as `--font-inter` in `layout.tsx`)
- **Weights:** 400 (body), 500 (medium), 600 (semibold), 700 (bold)
- **Scale:**
  - Hero: 22px / 700 / leading-tight
  - H1: 22px / 700
  - H2: 16px / 600
  - H3: 15px / 600
  - Body: 14px / 400
  - Small: 13px / 400
  - Caption: 11-12px / 500 / uppercase tracking-wide

### Spacing

- **System:** 4px base unit
- **Card padding:** p-4 (16px) mobile, p-5/p-6 (20-24px) desktop
- **Gap between cards:** gap-4 (16px)
- **Section spacing:** py-6 (24px) mobile, py-8 (32px) desktop

### Radii

| Element | Radius | Tailwind |
|---|---|---|
| Controls (buttons, inputs) | 8-10px | `rounded-[10px]` |
| Cards | 14-18px | `rounded-[16px]` |
| Modals | 20px | `rounded-[20px]` |
| Pills/badges | 999px | `rounded-full` |

### Shadows

- **Cards:** `shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]`
- **Sticky bars:** `shadow-[0_-4px_16px_rgba(15,23,42,0.08)]`
- **No heavy shadows** — the design is clean and flat with subtle depth.

---

## Component Standards

### Buttons

| Type | Style | Usage |
|---|---|---|
| Primary | `bg-[var(--accent)] text-white` | Main CTA (Pay, Proceed, Place order) |
| Tinted | `bg-[var(--accent-tint)] text-[var(--accent)]` | Secondary action |
| Outline | `border border-[var(--hairline)] bg-[var(--surface)]` | Tertiary action (Back, Edit) |
| Destructive | `bg-[var(--error)] text-white` | Cancel, Delete |

- **Min height:** 44px (touch target)
- **Loading state:** Spinner + disabled + `aria-busy`
- **Focus:** `focus:ring-2 focus:ring-[var(--accent)]/30`

### Cards

- White background (`bg-[var(--surface)]`)
- 1px border (`border border-[var(--hairline)]`)
- 16px radius (`rounded-[16px]`)
- Subtle shadow
- Consistent padding (p-4 mobile, p-5 desktop)

### Input fields

- 44px height
- 8px radius
- 1px border, focus → accent border + ring
- Clear labels above the input
- Error messages below in red

### Status pills

- `rounded-full px-2.5 py-1 text-[11px] font-medium`
- Success: green tint
- Warning: amber tint
- Error: red tint
- Info: blue tint

---

## Responsive Rules

| Breakpoint | Width | Layout approach |
|---|---|---|
| Small mobile | 320-374px | Single column, full-width elements, sticky bottom bars |
| Mobile | 375-767px | Single column, comfortable spacing, sticky bottom bars |
| Tablet | 768-1023px | Single column with wider max-width, optional sidebar |
| Laptop | 1024-1279px | Two-column where appropriate, right sidebar for summaries |
| Desktop | 1280-1920px | Two-column with generous spacing, max-w-[1200px] container |

**Mobile-first:** All layouts are designed mobile-first, then enhanced with `sm:`, `md:`, `lg:`, `xl:` prefixes.

**Sticky bottom bars on mobile:** Payment/checkout actions use `fixed bottom-0` with `pb-[max(0.75rem,env(safe-area-inset-bottom))]` for iOS safe area.

**Sticky right sidebar on desktop:** Order summaries use `lg:sticky lg:top-24` so they flow naturally.

---

## Navigation

### Desktop
- Top header with logo, search, profile/orders links
- No bottom navigation

### Mobile
- Top header with logo + hamburger/back
- Bottom tab bar: Home, Find Shops, Scan, Orders, Profile (when authenticated)

---

## Accessibility Rules

1. **Semantic HTML:** Use `<main>`, `<header>`, `<nav>`, `<section>`, `<article>`, `<aside>`.
2. **Focus visible:** All interactive elements have `focus-visible:outline-2 focus-visible:outline-offset-2`.
3. **Touch targets:** Minimum 44px height for all buttons and interactive elements.
4. **Labels:** All inputs have associated `<label>` elements. All buttons have descriptive text.
5. **ARIA:** `aria-busy` on loading buttons, `role="alert"` on error messages, `aria-pressed` on toggle buttons.
6. **Color contrast:** Primary text (#0F172A) on white = 15.8:1 (AAA). Secondary text (#64748B) on white = 4.6:1 (AA).
7. **Reduced motion:** Respect `prefers-reduced-motion` — no animations when the user has it enabled.
8. **Keyboard navigation:** All actions reachable via Tab, Enter, Space. No keyboard traps.

---

## Interaction Patterns

1. **Loading states:** Skeletons matching the content layout, not generic spinners.
2. **Empty states:** Illustration + helpful copy + primary action.
3. **Error states:** Red banner with clear message + retry action.
4. **Success states:** Green checkmark + confirmation text + next action.
5. **Transitions:** `transition-colors duration-200 ease-out` — no bounce, no slide, just color transitions.
6. **Sticky elements:** Bottom bar on mobile (payment), right sidebar on desktop (order summary).

---

## Approved Design Decisions

1. **Blue #2563EB is the only primary color.** No indigo, no blue-violet. Consumer identity is pure blue.
2. **Inter is the only font.** No decorative fonts.
3. **White cards on #F8FAFC background.** No dark mode for consumer (the shopkeeper portal has its own identity).
4. **4px spacing system.** All spacing is a multiple of 4px.
5. **44px minimum touch targets.** Non-negotiable for mobile usability.
6. **Sticky bottom bar for payment on mobile.** The Pay button is always reachable.
7. **Sticky right sidebar for order summary on desktop.** The total is always visible.
8. **No fabricated data.** No fake ratings, reviews, distances, or availability.
9. **Subtle shadows, not heavy ones.** The design is clean and flat with minimal depth.
10. **Motion explains state, not decorates.** Transitions show loading → loaded, not eye candy.
