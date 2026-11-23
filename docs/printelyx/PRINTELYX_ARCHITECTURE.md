# Printelyx Architecture

**Date:** 2026-11-23

---

## Tech Stack

- **Framework:** Next.js 16 App Router (Turbopack)
- **Language:** TypeScript 5 strict
- **Styling:** Tailwind CSS 4 + shadcn/ui + Clear design system
- **Database:** PostgreSQL (Supabase) via Prisma ORM
- **Font:** Instrument Sans (next/font, Latin subset, display swap)
- **Realtime:** Socket.io relay (mini-service on port 3004)
- **PWA:** Manifest + service worker + install prompt
- **CI:** GitHub Actions (lint, typecheck, tests, Android APK build)
- **Deploy:** Vercel (bom1 region)

## Design System

**"Clear"** — calm, premium, quiet, precise.

| Token | Light | Dark |
|-------|-------|------|
| ground | #F2F3F7 | #0B0B0D |
| surface | #FFFFFF | #1C1C1E |
| label | #1C1C1E | #F2F3F7 |
| label-2 | #5B5F66 | #9B9BA4 |
| accent | #0A58D6 | #2E7FFF |
| hairline | #DADBE1 | rgba(255,255,255,.12) |

Print semantics:
- B&W dot: half #1C1C1E / half #FFFFFF with 1px #6B6F76 ring
- Colour dot: conic-gradient(#E5484D, #F5C400, #30A46C, #0091FF, #D6409F, #E5484D)
- Colour sheet: linear-gradient(160deg, #CFE3FF, #F6D3EC 55%, #FFF0B8)

## Authentication Layers

1. **Shopkeeper/Admin:** JWT (access + refresh tokens, PBKDF2-SHA256 600k iterations)
2. **Device agents (PrintEXE/phone):** Device token (SHA-256 hashed, pairing ticket flow)
3. **Customers:** Order token (128-bit hex, token IS the credential)

## API Structure (122 endpoints)

- `/api/v1/s/[slug]/*` — customer order flow (public, rate-limited)
- `/api/v1/o/[token]/*` — customer tracking + payment
- `/api/v1/shops/me/*` — shopkeeper dashboard (withAuth owner/staff)
- `/api/v1/shop/*` — queue management (withAuth owner/staff)
- `/api/v1/admin/*` — admin panel (withAuth admin role)
- `/api/v1/agents/*` — device contract (withDeviceAuth)
- `/api/v1/auth/*` — authentication (login, refresh, logout, password reset)
- `/api/v1/analytics/track` — privacy-friendly analytics ingestion

## Data Models (26 Prisma models)

Core: Shop, User, Order, PrintFile, PrintJob, Printer, PrinterPath, PrintAgent
Payments: PaymentAttempt, PaymentEvent, WebhookInbox
Delivery: PrintDeliveryAttempt, FileCleanupTask, DeviceCommand
Auth: PairingTicket, PasswordResetToken
Sync: DeviceSyncState, Customer
Subscription: Subscription
Support: AuditLog

## State Machines

**Order:** draft → awaiting_payment → payment_submitted → paid → queued → printing → ready → collected
**PrintTask:** queued → dispatched → printing → completed / failed / uncertain
**Payment:** created → pending → paid / failed / expired

## Security

- Rate limiting on all public endpoints (per-IP)
- Zod validation on all API inputs
- Constant-time token comparisons
- Server-authoritative pricing (never trust client)
- Webhook signature verification (PhonePe, Razorpay)
- CSP + security headers via middleware
- Audit logging for all queue/payment actions
- Secret scan (gitleaks) — clean except 1 item in worklog.md:1437

## Known Issues (from audit)

1. /dev routes exposed in production
2. Old/duplicate routes (need redirects)
3. Brand rename PrintShop → Printelyx
4. 7 missing public routes
5. 29 unused CMYK component files
