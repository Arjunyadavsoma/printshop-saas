# Checkout Security Verification

## Customer journey trace (verified by code audit)

1. Upload creates order (status: draft). 2. placeOrder → awaiting_payment (30-min window). 3. Customer pays via UPI. 4. Returns → green banner guides to UTR input. 5. submitUtr → POST /o/[token]/payment → Payment row (SUBMITTED), order → payment_submitted. 6. Shopkeeper confirms → paid → queued → printing → ready → collected.

## Security verification

- UTR submission NEVER marks paid (verified: only confirmPayment/webhook can)
- Order created BEFORE payment, explicitly pending (awaiting_payment)
- Fabricated UTR accepted as SUBMITTED but cannot mark paid; shopkeeper is the verification layer
- One UTR blocked per shop (app layer); global DB index is stricter (causes D8 defect on reject/cross-shop reuse)
- Concurrent same-UTR: DB index backstops, loser gets 500 (D7 — needs P2002 catch)
- Refresh/closure: localStorage pending-order + server-side Postgres durability confirmed
- Customer sees real order number + tracking URL in StepConfirmation (verified)
- Shopkeeper UI BROKEN for payment_submitted (D4 — confirm card hidden)
- declaredAmountPaise is customer-attested (not an integrity check)

## Unfixed defects
D4 (shopkeeper confirm UI), D7 (P2002 500), D8 (DB/app UTR semantics conflict), D9 (non-atomic confirm)
