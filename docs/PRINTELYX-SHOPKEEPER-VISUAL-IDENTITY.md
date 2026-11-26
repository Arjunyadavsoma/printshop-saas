# PRINTELYX — SHOPKEEPER DESKTOP-FIRST VISUAL IDENTITY

> **Canonical source of truth for every shopkeeper-portal screen.**
> Retrieve this document before designing or restyling any `/shop/*` page
> (dashboard, orders, print jobs, payments, customers, services, devices,
> printers, reports, staff, billing, settings) to guarantee a unified
> desktop-first business application. Pair with the Consumer Visual
> Identity for the `/shop/login` and `/shop/register` entry screens.

## 1. Design Priority

Primary platform: Desktop web application
Secondary platform: Tablet
Responsive platform: Mobile

Design priority:

- Desktop: 1280–1920px
- Laptop: 1024–1279px
- Tablet: 768–1023px
- Mobile: 320–767px

The shopkeeper interface must be designed around real daily business workflows performed using a desktop or laptop.

Do not design a mobile dashboard and simply stretch it for desktop.

## 2. Desktop Visual Direction

Create a premium, professional SaaS dashboard inspired by modern business applications.

Reference: https://notarity.com/en/

Use:

- Steel-blue branding.
- Blue-violet interactive accents.
- White content surfaces.
- Light neutral backgrounds.
- Professional typography.
- Structured information layouts.
- Clear data visualization.
- Refined spacing.
- Subtle borders and shadows.

The result should feel like a mature business management platform.

### Shopkeeper Color Tokens

| Token | CSS variable | Value | Usage |
|---|---|---|---|
| Steel Blue (brand) | `--shop-steel` | `#1E3A5F` | Sidebar foundation, branding |
| Steel Blue Deep | `--shop-steel-deep` | `#16294A` | Sidebar hover, pressed |
| Blue-Violet (accent) | `--shop-accent` | `#6366F1` | Active nav, primary actions, links |
| Blue-Violet Press | `--shop-accent-press` | `#4F46E5` | Hover/pressed on accent |
| Blue-Violet Soft | `--shop-accent-soft` | `#EEF0FF` | Active row tint, highlighted bg |
| Content Surface | `--shop-surface` | `#FFFFFF` | Cards, tables, panels |
| App Background | `--shop-bg` | `#F1F5F9` | Main content area background |
| Primary Text | `--shop-ink` | `#0F172A` | Headings, important content |
| Secondary Text | `--shop-ink-2` | `#475569` | Supporting content |
| Muted Text | `--shop-ink-3` | `#94A3B8` | Metadata, hints |
| Border | `--shop-border` | `#E2E8F0` | Card/table/divider borders |
| Sidebar Border | `--shop-side-border` | `rgba(255,255,255,0.10)` | Sidebar internal dividers |
| Sidebar Text | `--shop-side-text` | `rgba(255,255,255,0.72)` | Sidebar inactive labels |
| Sidebar Text Active | `--shop-side-text-on` | `#FFFFFF` | Sidebar active labels |
| Success | `--shop-success` | `#16A34A` | Open/complete status |
| Warning | `--shop-warning` | `#D97706` | Pending/alert status |
| Danger | `--shop-danger` | `#DC2626` | Failed/cancelled status |

## 3. Desktop Application Layout

Use a consistent three-part application structure.

### A. Left Sidebar

Persistent vertical sidebar.

Recommended width:

- Expanded: 248px.
- Collapsed: 76px.

Include:

- Printelyx logo.
- Shop identity or shop switcher, if supported.
- Dashboard.
- Orders.
- Print Jobs.
- Payments.
- Customers.
- Services.
- Devices.
- Printers.
- Reports.
- Staff.
- Billing.
- Settings.

Design:

- Deep steel-blue navigation foundation or clean light sidebar with steel-blue branding.
- Clearly visible active navigation.
- Blue-violet active indicator.
- Consistent Lucide icons.
- Grouped navigation sections.
- Tooltips when collapsed.
- Smooth collapse and expand interaction.
- Preserve existing role-based permissions and navigation availability.

### B. Top Navigation Bar

Recommended height: 64–72px.

Include:

- Breadcrumbs or current page title.
- Global search, if supported.
- Notifications, if supported.
- Shop identity.
- User profile menu.
- Contextual primary action.

Keep the topbar consistent across all shopkeeper pages.

### C. Main Content Area

- Flexible content width.
- Consistent horizontal padding.
- Clear page titles and descriptions.
- Breadcrumbs where useful.
- Responsive grid system.
- Consistent section spacing.
- Structured cards and tables.

Use a light neutral background with white content surfaces.

## 4. Desktop Dashboard

The dashboard should function as a business control center.

Recommended layout:

**Top section**
- Welcome or shop identity.
- Current date or relevant period.
- Primary operational actions.

**KPI section**
- Today's orders.
- Pending orders.
- Processing jobs.
- Completed orders.
- Revenue summary.

Only display metrics supported by actual backend data.

**Main content**
- Order activity.
- Print-job queue.
- Revenue charts.
- Recent transactions.
- Printer/device health.
- Operational alerts.

Use a responsive 4-column KPI grid on larger screens, reducing columns as the viewport shrinks.

Charts should use steel-blue and blue-violet accents with readable labels and legends.

## 5. Desktop Tables and Data Density

Tables are a core part of shopkeeper workflows.

Design professional tables for:

- Orders.
- Print jobs.
- Payments.
- Customers.
- Staff.
- Devices.
- Reports.

Requirements:

- Clear column headers.
- Consistent row heights.
- Subtle row separators.
- Proper alignment of numeric values.
- Readable status badges.
- Search and filtering where supported.
- Sorting where supported.
- Pagination where supported.
- Row actions.
- Bulk actions only where existing functionality supports them.
- Sticky table headers for long lists where useful.

Avoid oversized cards when a table is more efficient.

Use compact but comfortable information density.

## 6. Desktop Forms and Operational Workflows

Design forms for desktop productivity.

Requirements:

- Two-column form layouts where appropriate.
- Logical grouping of fields.
- Clear section headings.
- Consistent label placement.
- Inline validation.
- Proper spacing.
- Sticky action bars for long forms where useful.
- Confirmation dialogs for destructive actions.

Do not unnecessarily stretch input fields across the entire screen.

## 7. Desktop Order and Print Queue Experience

Prioritize operational efficiency.

Order details should use structured panels and columns.

Where supported, display:

- Order information.
- Customer information.
- Uploaded documents.
- Print specifications.
- Payment details.
- Order timeline.
- Available actions.

Print queues should prioritize:

- Job identification.
- Document details.
- Print settings.
- Printer/device status.
- Job progress.
- Failure and retry states.

Use clear visual status indicators without inventing backend states.

## 8. Desktop Interaction Design

- Sidebar collapse and expand.
- Keyboard-friendly navigation.
- Clear hover states.
- Visible keyboard focus.
- Tooltips for icon-only controls.
- Efficient dropdowns.
- Contextual action menus.
- Confirmation dialogs.
- Toast notifications.
- Subtle transitions.

Prioritize speed and predictability over decorative animation.

## 9. Laptop and Smaller Desktop

At 1024–1279px:

- Support a collapsible sidebar.
- Reduce dashboard grid columns.
- Adapt table widths.
- Preserve important information.
- Avoid overlapping navigation and content.

At 1280–1920px:

- Use the full desktop layout.
- Maintain a readable maximum content width.
- Use available space efficiently.
- Avoid excessively stretched components.

## 10. Tablet and Mobile Adaptation

Tablet:

- Collapsible sidebar or drawer.
- Two-column dashboard layouts where practical.
- Responsive tables.
- Adapted forms.

Mobile:

- Sidebar becomes a drawer.
- Topbar becomes compact.
- Tables become readable cards or controlled horizontal scrolling.
- Forms become single-column.
- Primary actions remain accessible.
- Touch targets remain comfortable.
- Respect device safe areas.

Do not remove shopkeeper functionality on mobile merely to simplify the layout.

## 11. Visual Consistency

Every shopkeeper route must share:

- The same sidebar.
- The same topbar.
- The same typography.
- The same color tokens.
- The same button styles.
- The same table language.
- The same card language.
- The same status badges.
- The same interaction patterns.

The interface should feel like one unified business application, not separate pages built by different developers.

## 12. Implementation Token Map

The shopkeeper tokens live in `src/app/globals.css` under `:root`
(prefixed `--shop-*`). The shared shell component
(`src/components/shop/shop-shell.tsx`) reads these tokens and renders the
sidebar + topbar + content frame for every `/shop/*` route. Login and
register entry screens use the same tokens on a centered-card layout.

| Identity token | CSS variable | Value |
|---|---|---|
| Steel Blue | `--shop-steel` | `#1E3A5F` |
| Steel Blue Deep | `--shop-steel-deep` | `#16294A` |
| Blue-Violet accent | `--shop-accent` | `#6366F1` |
| Blue-Violet press | `--shop-accent-press` | `#4F46E5` |
| Blue-Violet soft | `--shop-accent-soft` | `#EEF0FF` |
| Content surface | `--shop-surface` | `#FFFFFF` |
| App background | `--shop-bg` | `#F1F5F9` |
| Primary text | `--shop-ink` | `#0F172A` |
| Secondary text | `--shop-ink-2` | `#475569` |
| Muted text | `--shop-ink-3` | `#94A3B8` |
| Border | `--shop-border` | `#E2E8F0` |
| Font | `--font-inter` | Inter |

## Final Principle

Desktop-first productivity with responsive mobile support.

The primary experience must optimize daily shop operations: managing orders, handling print jobs, checking payments, monitoring printers and managing customers.

Make the desktop experience feel premium, efficient, structured and reliable. Mobile must remain usable without compromising the desktop-first design.
