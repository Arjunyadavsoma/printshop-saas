# Payment Reconciliation Security

## Fixed in this audit
- Currency check: non-INR evidence rejected (was missing)
- Receiving-UPI validation: evidence.receivingUpiId compared against shop.upiId (was missing)

## Still missing (engine is dead code — not exploitable)
- DB-level concurrency guard (conditional WHERE processingStatus='pending')
- Incoming-credit vs outgoing-debit direction check
- Explicit refunded check

## Matching rules enforced (code)
1. Currency = INR (FIXED)
2. Receiving UPI ID = shop UPI ID (FIXED)
3. Exact amount (totalAmountPaise === evidence.amountPaise)
4. Same shopId
5. Payable status (awaiting_payment | payment_submitted)
6. Exactly ONE candidate (0 or >1 → manual review)
7. Transaction ref not already used (app + DB UNIQUE)
8. Source trust: toropay/provider_api/manual auto-confirm; gmail requires UTR

## Evidence classification
- Verified (webhook/API): auto-confirm eligible
- Strong secondary (Gmail + UTR + exact match): auto-confirm eligible
- Unverified candidate: manual review (pending)
- Rejected/duplicate: rejected
