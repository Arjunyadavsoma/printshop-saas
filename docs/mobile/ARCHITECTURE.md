# Architecture — Mobile Executor + Two-Executor Print Queue

## Executors

| Executor | Device | Mode | Auto-claims? | Prints when? |
|----------|--------|------|-------------|--------------|
| PC Agent (PrintEXE) | Shop Windows PC | AUTO | Yes (polls /jobs/pending) | Automatically when task is queued |
| Mobile Agent | Shopkeeper's phone | MANUAL_ONLY | No (shopkeeper taps Print) | Only when shopkeeper taps "Print now" |

A shop may have one PC agent + multiple mobile agents (phones).

## Print Task Lifecycle

```
Customer pays → Server splits into tasks (colour set / B&W set)
    ↓
Task is QUEUED (priority=0, isHeld=false, executorMode=AUTO, position=assigned)
    ↓
┌─────────────────┐                    ┌─────────────────┐
│ PC Agent polls  │                    │ Shopkeeper opens│
│ /jobs/pending   │                    │ queue on phone  │
│ (server filters │                    │ (sees all tasks)│
│  AUTO+unheld)   │                    │                 │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
    Dispatched                              Taps "Print now"
    (agent receives)                             │
         │                                  Claim (atomic)
    Printing                              (version check)
         │                                      │
    Completed                             Lease (60s, renew 15s)
         │                                      │
    ✓ Done                               Download → IPP Print
                                              │
                                         Report status
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                               Completed           Lease expired
                               ✓ Done              → UNCERTAIN
                                                  (shopkeeper decides)
```

## Claim/Lease Sequence

```
Phone                    Server                   PC Agent
  |                        |                         |
  | POST /jobs/:id/claim   |                         |
  |----------------------->|                         |
  |                        | Atomic UPDATE           |
  |                        | WHERE version = N       |
  |                        | AND claimedByAgentId    |
  |                        |     IS NULL             |
  |                        |                         |
  |  200 OK                |                         |
  |  {lease, fileUrl}      |                         |
  |<-----------------------|                         |
  |                        |                         |
  | POST /lease/renew      |                         |
  |  (every 15s)           |                         |
  |----------------------->|                         |
  |                        | Extends lease +60s      |
  |                        |                         |
  | POST /jobs/:id/status  |                         |
  |  {state: "completed"}  |                         |
  |----------------------->|                         |
  |                        | Marks PRINTED           |
  |                        | Clears claim            |
  |                        |                         |
```

## Pull Back from PC

```
Phone                    Server                   PC Agent
  |                        |                         |
  | POST /jobs/:id/pullback|                         |
  |----------------------->|                         |
  |                        | DeviceCommand:          |
  |                        |   task.release.request  |
  |                        |------------------------>|
  |                        |                         |
  |                        |    task.release.ack     |
  |                        |    (only if not started)|
  |                        |<------------------------|
  |                        |                         |
  |  200 OK (can claim)    |                         |
  |  OR 409 (already       |                         |
  |  printing)             |                         |
  |<-----------------------|                         |
```

## Queue Ordering

```
ORDER BY
  isHeld ASC,           -- non-held first
  priority DESC,        -- urgent (10) before normal (0)
  position ASC,         -- fractional index (drag reorder)
  createdAt ASC         -- FIFO for same position
```

## Printer Merging

Same physical printer reported by PC (Windows queue) and phone (LAN IPP):
1. PC reports printer with `printerUuid` from IPP Get-Printer-Attributes
2. Phone discovers printer via mDNS, queries IPP, gets same `printerUuid`
3. Server matches by `printerUuid` within the same shop → same Printer record
4. Each agent creates its own PrinterPath (WINDOWS_QUEUE vs LAN_IPP)
5. If UUIDs don't match (different printers), shopkeeper can merge manually

## Old PrintEXE Compatibility

The server filters `/jobs/pending`:
- Only `executorMode='AUTO'` tasks → old PrintEXE never sees MANUAL_ONLY tasks
- Only `isHeld=false` → old PrintEXE never sees held tasks
- Only `claimedByAgentId IS NULL` → old PrintEXE never sees claimed tasks
- Response shape unchanged → old builds parse it without modification

**Old PrintEXE builds need zero changes.**
