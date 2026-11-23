# Known Limits — Mobile Executor

## What works (backend, verified)

1. **Schema + migrations** — PrintAgent (kind, platform, capabilities), PrintJob (priority, position, isHeld, executorMode, claim fields), Printer (printerUuid), PrinterPath model. All additive with defaults.
2. **Queue API** — GET /shop/queue, reorder, priority, hold, release, reroute, reprint. All Zod-validated.
3. **Claim/lease** — POST /agents/jobs/:id/claim with atomic version check, lease renewal, release.
4. **Pull back** — POST /agents/jobs/:id/pullback sends DeviceCommand to PC.
5. **Printer sync** — POST /shop/printers/sync merges by printerUuid.
6. **Walk-in** — POST /shop/walkin creates walk-in orders.
7. **Socket events** — queue.updated, task.claimed, task.released, etc. with queueVersion.
8. **Old PrintEXE compatibility** — /jobs/pending filters server-side (held/manual/claimed tasks excluded).

## What needs a real device (cannot test in sandbox)

1. **Flutter app** — not built in this environment (no Flutter SDK). The app architecture, screens, and design system are specified in the task brief + docs/mobile/ARCHITECTURE.md.
2. **IPP printing** — the IPP library (packages/ipp/) needs to be built in Dart. The protocol spec, operations, format negotiation, and status mapping are documented in docs/mobile/IPP.md.
3. **mDNS discovery** — needs a real Android device with Wi-Fi multicast access.
4. **Real printer testing** — follow docs/mobile/DEVICE-TESTS.md.
5. **Lease expiry in production** — the UNCERTAIN state transition needs a real claim + timeout scenario.
6. **Foreground service** — Android 14/15 foreground service type requirements need device testing.
7. **TLS pinning** — ipps:// with self-signed certificates needs a real IPP printer.

## What is intentionally deferred

1. **iOS support** — Android first. iOS needs NSLocalNetworkUsageDescription + NSBonjourServices in Info.plist.
2. **FCM push notifications** — behind a flag. Local notifications work while app is open.
3. **Raw port 9100** — advanced, off by default. Enable per printer only with verified PDL support.
4. **Raster path (URF/PWG)** — the hardest part. Needs real duplex printers for testing. Documented in IPP.md.
5. **Offline file pre-caching** — optional flag, off by default. Privacy trade-off documented.
