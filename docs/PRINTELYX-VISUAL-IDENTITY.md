# PRINTELYX — CONSUMER VISUAL IDENTITY

> **Canonical source of truth for every consumer-facing screen.**
> Retrieve this document before designing or restyling any consumer page,
> auth screen, shopkeeper portal, or admin portal to guarantee visual
> consistency across the product.

## 1. Brand Direction

**Brand:** Printelyx
**Experience:** Consumer-facing printing marketplace
**Visual identity:** Modern, minimal, premium, friendly and trustworthy.

The consumer experience should feel like a polished technology product, not a generic e-commerce template or admin dashboard.

**Brand personality:**
- Simple and approachable
- Modern and professional
- Trustworthy and reliable
- Fast and convenient
- Clean and premium

**Brand positioning:**
"Your documents. Your nearby print shop. One simple experience."

## 2. Primary Color Palette

The consumer brand uses a **Blue + White** identity.

| Color | Hex | Usage |
|---|---|---|
| Primary Blue | `#2563EB` | Primary actions, links, active states |
| Deep Blue | `#1D4ED8` | Hover and pressed states |
| Light Blue | `#EFF6FF` | Highlighted backgrounds |
| Pale Blue | `#DBEAFE` | Subtle accents |
| White | `#FFFFFF` | Cards and surfaces |
| Background | `#F8FAFC` | Main page background |
| Primary Text | `#0F172A` | Headings and important content |
| Secondary Text | `#64748B` | Supporting content |
| Muted Text | `#94A3B8` | Hints and metadata |
| Border | `#E2E8F0` | Card and input borders |

### Semantic Colors

| Purpose | Hex |
|---|---|
| Success | `#16A34A` |
| Success Background | `#F0FDF4` |
| Warning | `#D97706` |
| Warning Background | `#FFFBEB` |
| Error | `#DC2626` |
| Error Background | `#FEF2F2` |
| Information | `#2563EB` |
| Information Background | `#EFF6FF` |

Use blue selectively for important interactions. Keep most surfaces white or neutral.

## 3. Typography

**Primary font: Inter**

| Style | Size | Weight |
|---|---:|---:|
| Display | 36–48px | 700 |
| H1 | 30–36px | 700 |
| H2 | 24–30px | 600 |
| H3 | 20–24px | 600 |
| H4 | 16–18px | 600 |
| Body | 14–16px | 400 |
| Caption | 12–13px | 400 |
| Metadata | 11–12px | 500 |

Typography must be clean, readable and consistent across every consumer screen.

> **Implementation note:** the project loads Inter via `next/font/google`
> and exposes it as the `--font-inter` CSS variable (aliased to
> `--font-sans`). All consumer surfaces, auth screens, and the restyled
> shopkeeper/admin portals use Inter.

## 4. Design Language

- Minimal and spacious layouts.
- White and light-neutral surfaces.
- Strong typography hierarchy.
- Subtle borders instead of heavy shadows.
- Rounded cards and controls.
- Consistent Lucide icons.
- Restrained use of gradients.
- Clear visual separation between sections.
- Consistent alignment and spacing.
- No unnecessary decorative elements.
- No excessive glassmorphism or neon effects.

### Border Radius

| Element | Radius |
|---|---:|
| Small controls | 8px |
| Inputs and buttons | 10px |
| Standard cards | 14px |
| Large cards | 18px |
| Modals | 20px |
| Bottom sheets | 20px top corners |
| Pills | 999px |

### Spacing System

Use a consistent 4px-based spacing scale:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px`

### Shadows

Use subtle elevation only where necessary:
- Cards: light shadow or border.
- Dropdowns: moderate shadow.
- Modals: clear elevation.
- Floating controls: restrained shadow.

## 5. Component Appearance

Maintain consistent styling for:

- Primary and secondary buttons.
- Text fields and search inputs.
- Dropdowns and selectors.
- Cards and information panels.
- Shop cards.
- Document cards.
- Order cards.
- Status badges.
- Modals and drawers.
- Bottom sheets.
- Toast notifications.
- Loading skeletons.
- Empty and error states.
- Navigation elements.

Buttons should have clear primary, secondary, outline and destructive variants.

Inputs should have consistent heights, borders, focus rings, validation states and labels.

Cards should use consistent padding, radius and border treatment.

## 6. Consumer Navigation Identity

### Desktop
- Clean white navigation header.
- Printelyx logo.
- Simple navigation links.
- Clear active states.
- Account/sign-in access.
- Prominent primary action.
- Consistent content alignment.

### Mobile
- Compact navigation.
- Bottom navigation where appropriate.
- Icon plus label.
- Clearly visible active state.
- Safe-area support.
- Touch-friendly controls.
- No content hidden behind navigation.

## 7. Responsive Identity

Design mobile-first while maintaining a complete desktop experience.

**Mobile:** 320–430px
**Tablet:** 768–1024px
**Desktop:** 1280–1920px

Mobile:
- Compact layouts.
- Comfortable touch targets.
- Full-width controls where appropriate.
- Readable typography.
- No horizontal overflow.
- Proper safe-area spacing.

Desktop:
- Wider content containers.
- Multi-column layouts where useful.
- Balanced whitespace.
- Responsive grids.
- Proper hover and focus states.
- No stretched mobile components.

## 8. Interaction and Accessibility

- Smooth, subtle transitions.
- Consistent hover, focus, active and disabled states.
- Visible keyboard focus.
- Accessible contrast.
- Proper labels and validation.
- Minimum 44px touch targets wherever practical.
- Respect reduced-motion preferences.
- Never communicate status using color alone.

## 9. Visual Consistency Rules

1. Use the same consumer color tokens across all consumer pages.
2. Use Inter consistently.
3. Use one icon family.
4. Maintain consistent spacing, radii and shadows.
5. Keep navigation patterns consistent.
6. Use the same component appearance for the same interaction.
7. Maintain consistent loading, empty, error and success states.
8. Do not introduce unrelated accent colors.
9. Do not allow consumer styles to leak into shopkeeper or admin interfaces.
10. Keep the identity consistent across the website and consumer mobile app.

## 10. Design Inspiration

Reference: https://youengage.me/

Take inspiration from its:
- Clean visual hierarchy.
- Spacious layouts.
- Modern typography.
- Blue-and-white visual direction.
- Clear navigation.
- Structured content sections.
- Product-focused presentation.
- Professional use of whitespace.

Do not clone its interface. Create an original Printelyx identity.

## 11. Implementation Token Map

The canonical CSS custom properties that implement this identity live in
`src/app/globals.css` under `:root`. Every consumer page, auth screen,
and restyled portal reads these tokens — never hardcode hex values.

| Identity token | CSS variable | Value |
|---|---|---|
| Primary Blue | `--accent` | `#2563EB` |
| Deep Blue (hover) | `--accent-press` | `#1D4ED8` |
| Light Blue bg | `--accent-tint` | `#EFF6FF` |
| Pale Blue | `--accent-tint-text` | `#1D4ED8` |
| Page background | `--ground` | `#F8FAFC` |
| Card surface | `--surface` | `#FFFFFF` |
| Primary text | `--label` | `#0F172A` |
| Secondary text | `--label-2` | `#64748B` |
| Muted text | `--label-3` | `#94A3B8` |
| Border | `--hairline` | `#E2E8F0` |
| Success | `--success` | `#16A34A` |
| Error | `--error` | `#DC2626` |
| Warning | `--warning` | `#D97706` |
| Font | `--font-inter` / `--font-sans` | Inter |

The auth design system (`src/app/auth.css`) reads the same `--accent`
family so the 8-screen authentication experience matches the consumer
identity exactly.

## Final Design Principle

Printelyx Consumer should feel like one cohesive, premium product across every screen.

The visual experience must be recognizable through its blue-and-white palette, clean typography, rounded components, consistent spacing, restrained shadows and simple interactions.

**The goal is visual consistency, not visual complexity.**
