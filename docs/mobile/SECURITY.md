# Security — Mobile Executor

## Device tokens
- Mobile agents use the same device-token auth as PC agents (SHA-256 hashed, never stored plaintext)
- Token rotation: old token honoured for 10-min grace window, then invalidated
- Revocation: `PATCH /shop/devices/:id { isEnabled: false }` drops the socket + invalidates the token immediately

## TLS pinning (ipps://)
- Self-signed certificates: trust-on-first-use per printer
- Certificate fingerprint pinned on first connection
- Shopkeeper must confirm the fingerprint before first print
- Never disable certificate checks globally
- If the fingerprint changes (MITM or cert renewal): refuse to print, show warning

## File handling
- Task PDFs downloaded via signed URLs (5-min expiry, order-bound)
- Stored in app-private storage (not accessible by other apps)
- Deleted in a `finally` block after printing (or on app exit)
- No file names or customer data in logs
- EXIF data: not relevant (files are PDFs from the server, not phone-camera images — walk-in camera scans are sent to the server for conversion)

## Permissions (Android)
- `INTERNET` — API + IPP communication
- `ACCESS_WIFI_STATE` — check Wi-Fi connection
- `CHANGE_WIFI_MULTICAST_STATE` — mDNS discovery
- `CAMERA` — QR scanning for pairing + walk-in camera scan
- `FOREGROUND_SERVICE` — keep print job alive when app is backgrounded
- `POST_NOTIFICATIONS` — order notifications (optional)
- `USE_BIOMETRIC` — optional app lock

## Execution safety
- Claim → lease heartbeat (15s) → download → print → report → cleanup
- If the app is killed mid-job: next launch reconciles with server (Get-Jobs) → UNCERTAIN
- Network loss: never retry Print-Job blindly (may duplicate). Query job status first.
- Wrong network: probe printer before Print. If unreachable: "Not on same Wi-Fi" + "Send to shop PC"

## Audit
Every queue action writes AuditLog:
- `queue.reorder`, `queue.priority`, `queue.hold`, `queue.release`, `queue.reroute`, `queue.reprint`
- `queue.claim`, `queue.release`, `queue.lease_expired`
- Actor (user or device), before/after values

## Privacy
- No customer phone numbers, file names, or UTR in logs or analytics
- job-name uses order number only (no customer data in IPP attributes)
- Walk-in files: processed server-side, same retention as online orders (24h after pickup)
