# PrintShop — Feature Parity Matrix

> Which modules are supported by the web SaaS, the PrintEXE Windows
> desktop, or both. The web is fully functional independently of the
> desktop. The desktop is a client that extends the web for Windows
> shopkeepers.

**Status:** v1.0 — 2025-11-07. Based on actual code audit of both repos.

**Legend:**
- ✅ Implemented and working
- ⚠️ Partially implemented / vestigial
- ❌ Not implemented
- 🔄 Planned (in this architecture doc)

---

## 1. Module matrix

| Module | Web (SaaS) | Desktop (PrintEXE) | Shared backend | Notes |
|---|---|---|---|---|
| **Shop management** | ✅ | ❌ | ✅ | Desktop syncs shop settings (🔄 Phase 5) |
| **Business profile** | ✅ | ❌ | ✅ | `Shop` model — name, address, phone, UPI, pricing |
| **Customers** | ❌ | ❌ | ❌ | Phase 2 — `Customer` model not yet in schema |
| **Customer history** | ❌ | ❌ | ❌ | Phase 2 — depends on Customer model |
| **Products & services** | ⚠️ | ❌ | ⚠️ | `Shop.servicesJson` is a free-text JSON list, not a proper catalog |
| **Pricing & rate cards** | ✅ | ❌ | ✅ | `Shop.pricingConfig` JSON + `packages/core/src/pricing/` engine |
| **Print jobs** | ✅ | ⚠️ | ✅ | Web creates + dispatches; desktop prints (protocol incompatible — see `DESKTOP_INTEGRATION.md`) |
| **Quotations** | ❌ | ❌ | ❌ | Phase 2 — `Quotation` model not yet in schema |
| **Invoices** | ❌ | ❌ | ❌ | Phase 2 — `Invoice` model not yet in schema |
| **Payments** | ✅ | ❌ | ✅ | PhonePe v1/v2 + Paytm + UPI deep-link; desktop has no payment UI |
| **Expenses** | ❌ | ❌ | ❌ | Phase 2 — `Expense` model not yet in schema |
| **Inventory** | ❌ | ❌ | ❌ | Phase 2 — `InventoryItem` model not yet in schema |
| **Suppliers** | ❌ | ❌ | ❌ | Phase 2 — `Supplier` model not yet in schema |
| **Staff & roles** | ✅ | ❌ | ✅ | `User` model with `role: 'owner'|'staff'|'admin'`; desktop has no staff UI |
| **Reports** | ✅ | ❌ | ✅ | Daily reconciliation report + analytics + admin platform metrics |
| **Analytics** | ✅ | ❌ | ✅ | Shop analytics + admin analytics (recharts on web) |
| **Notifications** | ⚠️ | ❌ | ⚠️ | Socket.io realtime push (no email/SMS — stub adapters) |
| **Settings** | ✅ | ❌ | ✅ | 5-tab settings (profile, hours, payment, UPI QR, shop QR) |
| **Subscription mgmt** | ⚠️ | ❌ | ⚠️ | `Subscription` model is vestigial; tier read from `Shop.subscriptionTier`; no entitlements enforcement |
| **Audit history** | ✅ | ❌ | ✅ | `AuditLog` table; admin audit endpoint |
| **QR codes** | ✅ | ❌ | ✅ | Shop ordering QR + sticker PDF + UPI QR upload |
| **Printer agents** | ✅ | ⚠️ | ✅ | Web manages agents; desktop IS an agent (incompatible protocol) |
| **Realtime updates** | ✅ | ⚠️ | ✅ | Socket.io (web listens for order/job events; desktop listens for job.dispatch — different protocol) |
| **File storage** | ✅ | ❌ | ✅ | R2/S3/Supabase/in-memory; desktop fetches via presigned URLs |
| **Multi-tenant isolation** | ✅ | ⚠️ | ✅ | Every query scoped by shopId; desktop device token resolves to shopId |

---

## 2. Customer journey (web-only)

| Step | Web | Desktop |
|---|---|---|
| Discover shop | ✅ Public directory at `/` | ❌ |
| Scan QR → open shop | ✅ `/shops/{slug}` | ❌ |
| Upload PDF | ✅ Presigned PUT to R2/S3 | ❌ |
| Configure print | ✅ Paper, color, copies, duplex, page range | ❌ |
| See live pricing | ✅ `priceFile()` engine (real) | ❌ |
| Pay via UPI | ✅ PhonePe/Paytm/UPI deep-link + QR | ❌ |
| Track order | ✅ `/orders/{id}` poll + realtime | ❌ |
| Collect prints | ✅ Shopkeeper marks collected; files auto-delete | ❌ |

**The customer journey is web-only.** The desktop is for shopkeepers, not customers.

---

## 3. Shopkeeper journey (web + desktop)

| Task | Web | Desktop | Sync |
|---|---|---|---|
| Register shop | ✅ `/shop/register` (4-step wizard) | ❌ | — |
| Login | ✅ `/shop/login` | ❌ | — |
| View dashboard | ✅ `/shop/dashboard` | 🔄 Planned | 🔄 |
| Receive order | ✅ Dashboard + realtime | 🔄 Planned | 🔄 |
| Review document | ✅ `/shop/orders/{id}` | 🔄 Planned | 🔄 |
| Verify payment | ✅ Manual verify/reject | ❌ | — |
| Start printing | ✅ `/shop/orders/{id}/start` | ✅ Auto on job.dispatch | ✅ |
| Track print progress | ✅ Dashboard queue | ✅ Local queue | ✅ |
| Mark ready | ✅ `/shop/orders/{id}/ready` | 🔄 Planned | 🔄 |
| Mark collected | ✅ `/shop/orders/{id}/complete` | 🔄 Planned | 🔄 |
| Cancel order | ✅ `/shop/orders/{id}/cancel` | 🔄 Planned | 🔄 |
| Configure pricing | ✅ Settings → Pricing | ❌ | 🔄 |
| Configure UPI | ✅ Settings → UPI QR | ❌ | 🔄 |
| Configure payment provider | ✅ Settings → Payment (PhonePe/Paytm) | ❌ | 🔄 |
| Generate QR code | ✅ `/shop/me/qr` + sticker PDF | ❌ | — |
| Register printer agent | ✅ `/shop/printer` setup guide | ✅ Self-registration | — |
| View analytics | ✅ `/shop/me/analytics` | ❌ | 🔄 |
| View daily report | ✅ `/shop/reports` + CSV | ❌ | 🔄 |
| Manage subscription | ⚠️ Tier display only | ❌ | — |

---

## 4. Admin journey (web-only)

| Task | Web | Desktop |
|---|---|---|
| Login (hidden) | ✅ `/admin/login?key=...` | ❌ |
| Platform overview | ✅ `/admin` | ❌ |
| Manage all shops | ✅ `/admin/shops` | ❌ |
| Manage all orders | ✅ `/admin/orders` | ❌ |
| View analytics | ✅ `/admin/analytics` (recharts) | ❌ |
| Monitor health | ✅ `/admin/monitoring` | ❌ |
| Audit log | ✅ `/admin` audit endpoint | ❌ |

**Admin is web-only.** The desktop has no admin capabilities.

---

## 5. Printing capabilities

| Capability | Web (browser → local agent) | Desktop (PrintEXE) |
|---|---|---|
| Printer discovery | ✅ Via PrintLatch (`:32191`) or Native Printer (`:32192`) | ✅ `System.Printing.LocalPrintServer` |
| Print PDF | ✅ Browser fetches presigned URL → POST to local agent | ✅ SumatraPDF + raw GDI fallback |
| Print queue | ⚠️ In-browser (PrintLatch manages) | ✅ SQLite durable queue |
| Offline printing | ❌ Browser must be open | ✅ Desktop app runs independently |
| Crash recovery | ❌ Browser refresh loses queue | ✅ Crash-replay (`Downloading` → `Pending`) |
| Multi-printer routing | ❌ Single printer | ❌ Single printer (multi-printer is Phase 3+) |
| Print confirmation | ⚠️ Best-effort | ✅ Spooler status polling (5-min timeout) |
| ESC/POS label printing | ❌ | ✅ Raw GDI (`RawGdiPrinter.cs`) |

**The desktop's printing is more robust than the web's** (durable queue, crash recovery, offline operation). This is the primary value of the desktop client.

---

## 6. Payment capabilities

| Capability | Web | Desktop |
|---|---|---|
| PhonePe v1 (Standard API) | ✅ X-VERIFY + base64 | ❌ |
| PhonePe v2 (Business API) | ✅ SHA auth + JSON | ❌ |
| Paytm | ✅ CHECKSUMHASH | ❌ |
| UPI deep-link | ✅ `upi://pay?...` fallback | ❌ |
| Cash on pickup | ✅ `Shop.cashOnPickup` flag | ❌ |
| Split payment (UPI + cash) | ✅ `Shop.paymentMethods: 'split'` | ❌ |
| Manual payment verify | ✅ Shopkeeper verify/reject | ❌ |
| Webhook processing | ✅ Server-side signature verification | ❌ |
| Payment idempotency | ✅ `paymentTxnId` UNIQUE + cache dedup | ❌ |
| Payment reconciliation | ✅ Daily report | ❌ |

**Payments are web-only.** The desktop has no payment UI — it displays payment status (synced from the web).

---

## 7. Gap analysis

### 7.1 Modules missing from BOTH clients (Phase 2)

- **Customers** — no `Customer` model, no customer directory, no history
- **Quotations** — no `Quotation` model
- **Invoices** — no `Invoice` model (the "receipt" is a PDF, not a proper invoice)
- **Expenses** — no `Expense` model
- **Inventory** — no `InventoryItem` model
- **Suppliers** — no `Supplier` model
- **Employees** — `User` model exists but no staff management UI (scheduling, payroll, etc.)

These are Phase 2 business modules that need schema additions + UI on both clients.

### 7.2 Modules on web but missing from desktop (Phase 4-5)

- Dashboard (orders, queues, stats)
- Order management (verify payment, start, ready, complete, cancel)
- Settings (pricing, UPI, payment providers)
- Analytics + reports
- QR code generation

These need the sync protocol (Phase 5) to be available on the desktop.

### 7.3 Infrastructure gaps

- **Subscription enforcement** — `Subscription` model is vestigial; no entitlements checking
- **PaymentAttempt/PaymentEvent** — models exist but not wired into webhook pipeline
- **Bidirectional sync** — no sync endpoints, no revision fields, no device sync state
- **PrintEXE protocol compatibility** — desktop can't talk to the real backend

---

## 8. Priority for implementation

| Priority | Module | Why |
|---|---|---|
| P0 | Fix PrintEXE protocol compatibility | Desktop can't connect to backend without this |
| P0 | Add `DELETE /api/v1/agents/{id}` | Desktop needs revocation |
| P1 | Sync protocol (Phase 5) | Enables desktop dashboard + order management |
| P1 | Wire `PaymentAttempt`/`PaymentEvent` | Durability fix for webhook pipeline |
| P2 | Customer model + directory | Foundation for invoices, history |
| P2 | Invoice model + generation | Business requirement |
| P2 | Subscription enforcement | SaaS business model |
| P3 | Expenses, inventory, suppliers | Operational modules |
| P3 | Quotations | Pre-sales flow |

---

## 9. Design system parity

The web design system is documented in `docs/DESIGN_SYSTEM.md`. For the desktop to match:

| Token | Web (CSS) | Desktop (WPF) |
|---|---|---|
| Brand | `oklch(0.646 0.222 41.116)` ≈ `#d97706` | `Color.FromArgb(255, 217, 119, 6)` |
| Success | `oklch(0.62 0.17 152)` ≈ `#10b981` | `Color.FromArgb(255, 16, 185, 129)` |
| Warning | `oklch(0.72 0.18 70)` ≈ `#f59e0b` | `Color.FromArgb(255, 245, 158, 11)` |
| Info | `oklch(0.62 0.14 230)` ≈ `#0ea5e9` | `Color.FromArgb(255, 14, 165, 233)` |
| Danger | `oklch(0.58 0.22 25)` ≈ `#e11d48` | `Color.FromArgb(255, 225, 29, 72)` |

PrintEXE uses WPF-UI Fluent theme which auto-follows the system light/dark mode. The brand color should be applied consistently.

**The desktop should feel like the same product.** Same brand color, same typography hierarchy, same status badge semantics.
