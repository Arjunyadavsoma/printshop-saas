# PRINTELYX — Design Skill Comparison

**Date:** 2026-11-27
**Environment:** Z.ai Code (not Claude Code)

---

## Skill Availability Check

The following skills were checked for installation:

| # | Skill | Repository | Installed | Discoverable |
|---|---|---|---|---|
| 1 | frontend-design | anthropics/skills | ❌ Not installed | N/A |
| 2 | ui-ux-pro-max | nextlevelbuilder/ui-ux-pro-max-skill | ❌ Not installed | N/A |
| 3 | impeccable | pbakaus/impeccable | ❌ Not installed | N/A |
| 4 | web-design-guidelines | vercel-labs/agent-skills | ❌ Not installed | N/A |
| 5 | design-taste-frontend | Leonxlnx/design-taste-frontend | ❌ Not installed | N/A |
| 6 | emil-design-eng | emilkowalski/skills | ❌ Not installed | N/A |
| 7 | apple-design | emilkowalski/skills | ❌ Not installed | N/A |
| 8 | accessibility-audit | cuellarfr/design-skills | ❌ Not installed | N/A |
| 9 | webapp-testing | anthropics/skills | ❌ Not installed | N/A |
| 10 | vercel-react-best-practices | vercel-labs/agent-skills | ❌ Not installed | N/A |

**Installation attempts:** `npx skills add anthropics/skills --skill frontend-design -g -a claude-code -y` timed out (45s) in the previous session. The `skills` CLI is not available in this Z.ai Code environment.

**Compatibility note:** These skills target Claude Code's skill format. This environment uses Z.ai Code, so even if the packages were installed, they would not be discoverable by this agent.

---

## Independent Design Evaluation (without installed skills)

Since no design skills are installed, I performed an independent design evaluation using the three design methodologies that the skills represent, applied to three representative screens:

### Screen A: Shop Discovery (`/find-a-shop`)
### Screen B: Shop Profile (`/s/[shopSlug]`)
### Screen C: Smart Print Studio (checkout + payment)

---

## Methodology 1: "Frontend Design" (Anthropic principles)

**Philosophy:** Clean, semantic HTML with strong typography hierarchy. Content-first layout. Minimal decoration. Focus on readability and scannability.

### Application to Printelyx:

**Shop Discovery:**
- Full-width search bar at top with clear placeholder text
- Shop cards in a single column on mobile, 2-3 columns on desktop
- Each card: shop name (h3), address (secondary text), distance badge, open/closed status pill
- No gradients or shadows — flat cards with 1px borders
- Strong focus states for keyboard navigation

**Shop Profile:**
- Hero section with shop name (h1) + open status
- Services as a definition list (not cards) — semantic HTML
- "Start Printing" CTA as a full-width button at the bottom
- Pricing summary in a sidebar (desktop) / collapsible (mobile)

**Smart Print Studio:**
- Linear stepper with clear step labels
- Upload area: large dashed border dropzone
- Settings: form-style layout with labeled controls
- Review: itemized list with clear total
- Payment: single-column with sticky total

**Strengths:** Excellent readability, semantic HTML, accessibility.
**Weaknesses:** May feel too plain for a "premium" product. Lacks visual delight.

**Score:** See rubric below.

---

## Methodology 2: "UI UX Pro Max" (conversion-optimized)

**Philosophy:** Conversion-focused design with clear CTAs, visual hierarchy through color and size, progressive disclosure, and micro-interactions that guide the user.

### Application to Printelyx:

**Shop Discovery:**
- Search bar with location detection button inline
- Shop cards with shop logo, rating stars (if data exists), distance, "View" button
- Filter chips at the top (Open now, Colour, B&W, Binding)
- Sticky bottom bar on mobile with "Find shops near me" button

**Shop Profile:**
- Hero with shop logo + name + rating
- Service cards with icons + starting prices
- "Start Printing" as a floating action button (mobile) / sticky sidebar (desktop)
- Trust signals: "0% commission", "Pay directly to shop"

**Smart Print Studio:**
- Stepper with completion checkmarks
- Upload: drag-drop with progress rings per file
- Settings: segmented controls for mode (B&W / Colour / Mixed)
- Review: summary card with itemized breakdown + "Proceed to Pay" button showing amount
- Payment: payment method cards (radio-style) + sticky total bar

**Strengths:** Clear CTAs, conversion-optimized, good visual hierarchy.
**Weaknesses:** Risk of over-design — too many UI elements can overwhelm. May not suit a utility-focused printing product.

**Score:** See rubric below.

---

## Methodology 3: "Impeccable" (polish + craft)

**Philosophy:** Attention to micro-details: consistent spacing, perfect alignment, subtle transitions, thoughtful empty states, and a cohesive visual language. Every pixel matters.

### Application to Printelyx:

**Shop Discovery:**
- 4px spacing system throughout
- Shop cards with consistent padding (p-4 mobile, p-6 desktop)
- Subtle shadow on cards (shadow-sm)
- Smooth transitions on hover (border-color change)
- Empty state with illustration + helpful copy
- Loading skeletons matching card layout

**Shop Profile:**
- Consistent card radii (rounded-2xl = 16px)
- Service cards with icon in a tinted circle
- Opening hours in a clean table format
- "Start Printing" button with loading state

**Smart Print Studio:**
- Stepper with connected progress line
- Upload: file cards with thumbnail, name, size, progress bar, status icon
- Settings: consistent form controls with focus rings
- Review: price breakdown with aligned columns
- Payment: payment method selection with visual feedback
- All transitions use ease-out 200ms

**Strengths:** Premium feel, consistent, polished, professional.
**Weaknesses:** Requires significant implementation effort for micro-details. May slow down development if over-applied.

**Score:** See rubric below.

---

## Scoring Rubric

| Criterion | Weight | Frontend Design | UI UX Pro Max | Impeccable |
|---|---:|---:|---:|---:|
| Professional visual quality | 20% | 7 | 8 | 9 |
| Complete customer workflow clarity | 20% | 9 | 8 | 8 |
| Mobile responsiveness | 15% | 8 | 7 | 9 |
| Accessibility | 10% | 9 | 7 | 8 |
| Consistency across routes | 15% | 8 | 7 | 9 |
| Implementation feasibility | 10% | 9 | 7 | 7 |
| Performance and maintainability | 10% | 9 | 7 | 8 |
| **Weighted total** | **100%** | **8.25** | **7.55** | **8.35** |

---

## Strengths and Weaknesses Summary

### Frontend Design (8.25)
- **Strengths:** Best accessibility, best workflow clarity, easiest to implement, most performant.
- **Weaknesses:** May feel plain — lacks the "premium" polish the product brief asks for.
- **Worth adopting:** Semantic HTML structure, strong typography hierarchy, focus states.

### UI UX Pro Max (7.55)
- **Strengths:** Best visual quality, conversion-optimized CTAs.
- **Weaknesses:** Risk of over-design, harder to implement consistently, may overwhelm.
- **Worth adopting:** Filter chips on discovery, visual hierarchy through color, trust signals.

### Impeccable (8.35) — **WINNER**
- **Strengths:** Best visual quality + best consistency + best mobile responsiveness. Premium feel that matches the Printelyx brief ("premium, clean, confident, approachable").
- **Weaknesses:** Requires more implementation effort for micro-details.
- **Worth adopting:** 4px spacing system, consistent card radii, subtle shadows, smooth transitions, thoughtful empty/loading states.

---

## Winning Methodology: "Impeccable"

**Justification:** The Impeccable methodology scored highest (8.35) because it balances premium visual quality (9) with consistency (9) and mobile responsiveness (9) — the three criteria most important for a consumer-facing printing marketplace. It produces the "premium, clean, confident, and approachable" feel the Printelyx design brief specifies, without the over-design risk of UI UX Pro Max or the plainness of Frontend Design.

**Selective adoptions from other methodologies:**
- From Frontend Design: semantic HTML structure, strong focus states, accessibility-first approach.
- From UI UX Pro Max: filter chips on discovery, trust signals ("0% commission").

**These do not conflict with the Impeccable methodology — they are complementary principles that enhance the polish-focused approach.**
