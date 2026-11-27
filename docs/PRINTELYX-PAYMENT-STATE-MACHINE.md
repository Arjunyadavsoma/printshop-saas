# Payment State Machine

## Order status (state-machine.ts) — server-side enforced
draft → awaiting_payment → payment_submitted → paid → queued → printing → partially_printed → ready → collected
Terminal: cancelled, failed, expired, paid_on_pickup
All transitions validated by assertOrderTransition. Same-status is idempotent.

## Payment status (payment-state-machine.ts)
PENDING/SUBMITTED → CONFIRMED | REJECTED → REFUNDED_NOTE
Idempotent same-status. REJECTED/REFUNDED_NOTE terminal. CONFIRMED→REJECTED blocked.

## Gateway lifecycle (lifecycle.service.ts)
created → pending → paid/failed/expired via applyPaymentTransition (real Prisma $transaction, conditional WHERE status, UNIQUE arbitration).

## Invariants enforced
- Frontend never sets paid (only server-side transitions)
- Order cannot be finalized twice (conditional WHERE + payment state machine)
- Unpaid order cannot enter shopkeeper paid/ready workflow (state machine)
- Webhook cannot settle wrong order (tenant isolation in session lookup)
- Amount mismatch rejected (400)
- Failed payment never reverses paid status
