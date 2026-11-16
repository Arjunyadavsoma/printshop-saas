# Notifications System Design

**Phase:** 5
**Status:** Implemented (outbox + service + in-app/email/sms channels; push deferred)
**Date:** 2026-11-16

## 1. Problem

The Phase 0 audit found no notifications system. The Email + SMS
adapters existed (stub + interface), but there was no:

- Durable notification record.
- Deduplication of retried events (a retried webhook would send
  duplicate notifications).
- Retry strategy with backoff.
- Delivery tracking.
- Failure handling.
- User preferences / read state.
- Templates.

## 2. Design — outbox pattern

The implementation uses the **transactional outbox pattern**:

1. When an event occurs, the NotificationService writes a row to
   the `Notification` table (status=pending). This is the source of
   truth — the row IS the intent to send.
2. A cron (Phase 7) drains the outbox by calling
   `NotificationService.dispatchPending`, which picks rows with
   `nextAttemptAt <= now` + `status=pending` and dispatches each
   via its channel adapter.
3. On success, the row is marked `sent`. On failure, the row's
   `attempts` is incremented, an exponential-backoff
   `nextAttemptAt` is scheduled, and `lastError` is recorded. After
   `maxAttempts` (default 5), the row is `failed`.

### 2.1 Deduplication

The `dedupKey` column is `UNIQUE`. The repository's `enqueue` method
checks for an existing row with the same dedupKey before inserting;
if one exists, it returns the existing row (no duplicate). This is
the guarantee that a retried webhook, a duplicate Socket.IO event,
or a cron re-run does not create a second notification.

`buildDedupKey(eventType, recipientId, entityId)` is a stable
`eventType:recipientId:entityId` join. Returns null when any
component is missing (no dedup — used for marketing broadcasts).

### 2.2 Channels

| Channel | Status | Notes |
|---|---|---|
| `email` | ✅ Wired via `StubEmailAdapter` | Swap to `ResendEmailAdapter` / `PostmarkEmailAdapter` by changing the container binding |
| `sms` | ✅ Wired via `StubSmsAdapter` | Swap to `Msg91SmsAdapter` / `TwilioSmsAdapter` by changing the container binding |
| `in_app` | ✅ Delivered as the row itself | The client polls `GET /api/v1/me/notifications`; no adapter call |
| `push` | ⚠️ Deferred — throws "not yet implemented" | Requires FCM / APNS adapter + device-token registration |

### 2.3 Retry strategy

- `maxAttempts` defaults to 5 (configurable per notification).
- Backoff: 30s, 2m, 8m, 32m, 128m (capped at 128 minutes).
- After `maxAttempts`, the row is `failed` (terminal).
- `lastError` records the most recent failure message.

### 2.4 Event types

The system is event-type-agnostic — any string is accepted. The
Phase 5 prompt listed these events; the service can carry any of
them:

| Event | Channel(s) | Recipient |
|---|---|---|
| `shop.approved` | in_app, email | Shop owner |
| `shop.suspended` | in_app, email | Shop owner |
| `subscription.expiring` | in_app, email | Shop owner |
| `subscription.renewed` | in_app, email | Shop owner |
| `order.created` | in_app, email | Shop owner + customer |
| `order.paid` | in_app, email, sms | Shop owner + customer |
| `order.printing` | in_app, sms | Customer |
| `order.ready` | in_app, email, sms | Customer |
| `order.cancelled` | in_app, email | Customer |
| `payment.received` | in_app, email | Shop owner |
| `payment.failed` | in_app, email | Customer |
| `print.failed` | in_app, email | Shop owner |
| `refund.processed` | in_app, email | Customer |
| `delivery.updated` | in_app, sms | Customer |

The route layer that fires these events is wired incrementally —
the Phase 5 deliverable is the outbox + service + channels, not the
event wiring at every call site.

### 2.5 Routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/me/notifications` | Any authenticated role | List the caller's in-app notifications (filters by `recipientId = principal.userId`, `channel=in_app`) |
| POST | `/api/v1/me/notifications/:id/read` | Owner of the notification | Mark an in-app notification as read (idempotent) |

Tenancy: a notification owned by a different user returns 404 (not
403) — avoid leaking that the notification exists.

### 2.6 User preferences / read state / retention

- `readAt` records when the user opened an in-app notification.
  The `unreadOnly=1` query param filters.
- User preferences (channel opt-in/opt-out per event type) is
  deferred — the current implementation sends on the channel the
  caller specifies. A preferences table will be added when the
  UI surfaces the choice.
- Retention: the rows are kept for audit. A cleanup cron (Phase 7)
  can prune very old `sent` rows if needed; no notification is
  deleted while still `pending` or `failed`.

### 2.7 Templates

The current implementation passes the body as a pre-formatted
string. A template engine (Handlebars / MJML) is deferred — the
caller is responsible for formatting. The `payload` JSON column
stores template variables + action buttons for future template
expansion.

## 3. Migration

`prisma/migrations/20261116020000_add_notifications/migration.sql`:

```sql
-- Notification table (idempotent, additive — no existing tables touched).
-- dedupKey UNIQUE, indexes on (shopId, status), (recipientId, status),
-- (nextAttemptAt), (eventType).
```

Additive — no data backfill needed.

## 4. Tests

`src/lib/services/notification.service.test.ts` (13 tests) verifies:

1. `enqueue` writes a pending row.
2. `enqueue` is idempotent on `dedupKey` — a retried event returns
   the existing row, not a duplicate.
3. Two events with different dedupKeys create two rows.
4. `buildDedupKey` returns null when recipient or entity is missing.
5. `dispatchPending` sends an email via the adapter + marks the
   row sent.
6. `dispatchPending` records a failure + schedules exponential
   backoff when the adapter throws.
7. After `maxAttempts`, the row is `failed` (terminal) with the
   correct attempt count.
8. `notifyInApp` writes a row with `channel=in_app` + dedupKey.
9. `notifyInApp` is idempotent.
10. `dispatchPending` does NOT call any adapter for in_app
    notifications (the row IS the delivery).
11. `listForRecipient` returns only the caller's in-app
    notifications.
12. `markRead` sets `readAt`; `unreadOnly` excludes read rows.
13. The push channel throws "not yet implemented" (defensive —
    the row backs off instead of being marked sent without
    delivery).

All 13 tests pass. Total unit tests: 619 (up from 606 baseline;
+13 from Phase 5).

## 5. Acceptance criteria — status

| Criterion | Status |
|---|---|
| Central event creation | ✅ `NotificationService.enqueue` |
| Durable notification records | ✅ `Notification` table |
| Queue / outbox pattern | ✅ Outbox + cron drain |
| Retry strategy | ✅ Exponential backoff, maxAttempts=5 |
| Idempotency | ✅ dedupKey UNIQUE, `enqueue` returns existing row on duplicate |
| Delivery tracking | ✅ status (pending/sent/failed/skipped), sentAt, attempts, lastError |
| Failure handling | ✅ recordAttemptFailure + markFailed |
| User preferences | ⚠️ Deferred — channel opt-in/opt-out per event type |
| Notification templates | ⚠️ Deferred — caller formats the body |
| Read/unread state | ✅ readAt + unreadOnly filter |
| Expiration/retention | ⚠️ Deferred — Phase 7 cleanup cron |
| Provider abstraction | ✅ EmailAdapter + SMSAdapter interfaces; container binds the concrete |
| Duplicate suppression on retried jobs/webhooks | ✅ dedupKey UNIQUE |

## 6. Remaining work

- **Push channel** — FCM / APNS adapter + device-token registration
  on the customer + shopkeeper accounts.
- **User preferences** — per-event-type channel opt-in/opt-out.
- **Template engine** — Handlebars / MJML for email body + subject.
- **Event wiring** — call `notifyInApp` / enqueue email at the
  right call sites (order paid, subscription expiring, etc.).
- **Cleanup cron** — prune very old `sent` notifications (Phase 7).
- **UI** — in-app notification bell + list + read state.
