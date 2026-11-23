# Mobile Executor — Architecture

## Overview

Two executor types per shop:
- **PC agent (PrintEXE)**: always-on, automatic. Polls `/jobs/pending`, receives tasks, prints them.
- **Mobile agents (phones)**: manual only. Shopkeeper taps "Print now" on a task. Can print to any LAN IPP printer.

The server is the **only gatekeeper** — it controls who gets which task and when.

## Executor Model

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  Customer   │────▶│              PrintShop Server             │
│  (web/QR)   │     │                                          │
└─────────────┘     │  ┌─────────┐    ┌──────────────────┐    │
                    │  │ Queue   │    │  Dispatcher       │    │
                    │  │ Service │◀──▶│  (filters tasks)  │    │
                    │  └────┬────┘    └────────┬─────────┘    │
                    │       │                  │               │
                    │       │    ┌─────────────┴──────────┐   │
                    │       │    │                        │   │
                    └───────┼────┼────────────────────────┼───┘
                            │    │                        │
                    ┌───────▼────▼───┐        ┌──────────▼───┐
                    │   PC Agent     │        │ Mobile Agent  │
                    │   (PrintEXE)   │        │  (Flutter)    │
                    │   AUTO only    │        │  MANUAL only  │
                    │   Windows queue│        │  LAN IPP      │
                    └────────────────┘        └───────────────┘
```

## Claim/Lease Flow (mobile printing)

```
Phone                    Server                   PC Agent
  │                        │                        │
  │ POST /jobs/:id/claim   │                        │
  │───────────────────────▶│                        │
  │                        │ Atomic UPDATE          │
  │                        │ SET claimedByAgentId   │
  │                        │ WHERE version=?        │
  │                        │ AND claimedByAgentId   │
  │                        │ IS NULL                │
  │                        │                        │
  │  200: lease+fileURL    │                        │
  │◀───────────────────────│                        │
  │                        │                        │
  │ POST /lease/renew      │                        │
  │ (every 15s)            │                        │
  │───────────────────────▶│                        │
  │                        │ Extends lease 60s      │
  │                        │                        │
  │ Download file          │                        │
  │ Print via IPP          │                        │
  │                        │                        │
  │ POST /jobs/:id/status  │                        │
  │ {state: "printed"}     │                        │
  │───────────────────────▶│                        │
  │                        │ Marks PRINTED          │
  │                        │ Publishes task.status  │
  │                        │                        │
```

## Lease Expiry → UNCERTAIN

If the phone dies mid-print (lease expires without PRINTED):
1. Server sets status to `uncertain` (NEVER auto-retry)
2. Dashboard shows "Needs you" for this task
3. Shopkeeper decides: Mark printed / Reprint / Cancel

## Pull Back from PC

```
Phone                    Server                   PC Agent
  │                        │                        │
  │ POST /jobs/:id/pullback│                        │
  │───────────────────────▶│                        │
  │                        │ DeviceCommand:         │
  │                        │ task.release.request   │
  │                        │───────────────────────▶│
  │                        │                        │
  │                        │  PC checks: not started│
  │                        │  task.release.ack      │
  │                        │◀───────────────────────│
  │                        │                        │
  │  200: can claim        │                        │
  │◀───────────────────────│                        │
  │                        │                        │
  │ POST /jobs/:id/claim   │                        │
  │───────────────────────▶│                        │
```

If PC already started → `409 Already printing on Shop PC`

## Queue Ordering

```sql
ORDER BY
  isHeld ASC,           -- non-held first
  priority DESC,        -- urgent (10) before normal (0)
  position ASC,         -- fractional index for drag reorder
  createdAt ASC         -- FIFO for same position
```

## Printer Merging

Same `printerUuid` in same shop → same logical Printer (multiple PrinterPaths).
Different UUIDs → separate Printers (shopkeeper can merge manually).

## Old PrintEXE Compatibility

The server filters `/jobs/pending` to only return:
- `executorMode = 'AUTO'`
- `isHeld = false`
- `claimedByAgentId IS NULL`
- Target printer has eligible PC path

Old PrintEXE builds poll as before — they see fewer tasks (held/manual filtered) but the response shape is identical. **Zero changes needed to old builds.**
