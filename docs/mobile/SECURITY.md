# Security — Mobile Executor

## Device tokens
- Mobile agents use the same device-token auth as PrintEXE
- Token is SHA-256 hashed at rest (plaintext never stored)
- Token stored in `flutter_secure_storage` (hardware-backed Keystore on Android)
- Revocation drops the socket + invalidates the token immediately

## TLS (ipps://)
- Self-signed certificates: trust-on-first-use per printer
- Certificate fingerprint pinned after first connection
- Shopkeeper must confirm the fingerprint on first use
- NEVER disable certificate checks globally
- Re-prompt if fingerprint changes (possible MITM)

## File handling
- Task PDFs downloaded via signed URLs (short expiry, order-bound)
- Stored in app-private storage (not shared with other apps)
- Deleted in a `finally` block after printing (or on failure)
- No file contents in logs
- No customer data (names, phones) in logs or analytics

## Permissions (Android)
- INTERNET: API + IPP communication
- ACCESS_WIFI_STATE: check Wi-Fi connectivity
- CHANGE_WIFI_MULTICAST_STATE: mDNS discovery (multicast lock)
- CAMERA: QR scanning for pairing + walk-in document scanning
- FOREGROUND_SERVICE: keep print job alive when backgrounded
- POST_NOTIFICATIONS: order notifications (optional)
- WAKE_LOCK: keep screen/CPU awake during printing

## Lease safety
- Claim sets a 60-second lease
- Heartbeat renews every 15 seconds
- Lease expiry → UNCERTAIN (never auto-retry)
- Shopkeeper decides: mark printed, reprint, or cancel

## Optimistic concurrency
- Every task update carries a `version` field
- Atomic claim: `UPDATE ... WHERE version = ? AND claimedByAgentId IS NULL`
- Exactly one claimer wins (version check guarantees this)

## Audit
- Every queue action writes AuditLog with actor, device, before/after
- Actions: reorder, prioritise, hold, release, claim, pullback, reroute, cancel, reprint, mark printed

## Privacy
- No customer data in job names sent to printers (only order number)
- Walk-in files deleted per shop retention policy
- Sensitive-document flag: files deleted immediately after printing
- Analytics: no PII (no phone numbers, file names, UTRs)
