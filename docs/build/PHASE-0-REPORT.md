# PHASE 0 REPORT — Inspect, architecture, design, data model
Date: 2026-11-21 · Branch: fix/e2e-printshop · Status: COMPLETE

## What was inspected
- prisma/schema.prisma (470 lines, 16 models) — User(email+passwordHash+role+shopId), Shop(slug,upiId,pricingConfig), Order(customerToken,tokenNumber,ut fields), PrintFile(flat spec), PrintJob(device contract), PrintAgent/PairingTicket/DeviceCommand (device contract), PaymentAttempt/PaymentEvent/WebhookInbox (PhonePe PSP), PrintDeliveryAttempt, FileCleanupTask, AuditLog, Customer, DeviceSyncState.
- 40+ API routes incl. full device contract + shops/me surface; customer pages exist at /shops/[slug] + /orders/[id]; shopkeeper app at /shop/*.
- lib: pbkdf2 password hashing (tested), JWT auth adapter, storage adapters (local/S3/R2/Supabase), delivery-coordinator (container-scoped after Phase-4 fix), price-file engine, page-count parsers (PDF/DOCX/PPTX/XLSX/images).
- Toolchain available in THIS environment (all real, not simulated): soffice (LibreOffice → DOCX/PPTX/XLSX→PDF), ghostscript gs (inkcov → per-page CMYK coverage), poppler pdftoppm+pdfinfo (thumbnails, page geometry), qpdf. Deps already present: pdf-lib, pdfjs-dist, sharp, qrcode, next-intl, socket.io, playwright.
- Missing: argon2 (existing hashing is pbkdf2-SHA512 — kept, adapter-wrapped, honest note in KNOWN LIMITS), no seed file (dev/seed route exists), no Printer/PriceRule/PrintSpec/OrderEvent/Notification models.

## Deliverables
- docs/ARCHITECTURE.md (v2) — system map, module boundaries, contracts (device contract extended additively only), state machines, storage layout, security invariants, simulators+labels, test matrix.
- docs/DESIGN.md — Pass 1 (concept "counter slip / process ink", 6 named colors, type stack with Devanagari/Telugu fallbacks, 4 ASCII wireframes, the page-strip bold moment) + Pass 2 (rejected tells listed with what changed).
- docs/DATA-MODEL.md — reconciliation decisions (PrintTask=extended PrintJob; Payment coexists with PaymentAttempt; PrintSpec 1:1 PrintFile; ShopMember=existing User+operator role), new tables, additive columns, migration plan.

## Key decisions
1. PrintTask maps onto existing PrintJob (additive columns) — device contract untouched.
2. Direct-UPI/counter Payment is a NEW table; PhonePe PSP tables stay for the gateway flow.
3. LibreOffice + Ghostscript are REAL here: conversion + ink-coverage color detection are not simulated. Only printers, OTP, and UPI verification are simulated/manual.
4. New design tokens coexist with the shopkeeper Square-UI tokens; customer flow gets the new identity.
