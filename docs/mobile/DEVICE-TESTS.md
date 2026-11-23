# Device Test Checklist — Mobile Executor

Test the PrintShop Shop app on real devices with real printers.

## Devices needed
- 2 Android phones (one mid-range, one low-end)
- 4+ printers (HP, Canon, Epson, Brother, one older model)
- Same Wi-Fi network + a guest Wi-Fi with client isolation

## Test matrix

### 1. Pairing
- [ ] Scan QR from web dashboard → app pairs successfully
- [ ] Device appears in web dashboard devices list
- [ ] Revoke from web → phone's socket drops + token invalid

### 2. Queue
- [ ] Queue loads instantly (cached in drift SQLite)
- [ ] Queue updates live via socket (new orders appear without refresh)
- [ ] Socket disconnects → polling fallback kicks in
- [ ] Long-press drag reorder works (optimistic UI + rollback on conflict)
- [ ] Swipe right = Print now
- [ ] Swipe left = Hold / Move to top
- [ ] Multi-select bulk Hold / Priority works
- [ ] Search by name, phone, order id, pickup code works

### 3. Task detail
- [ ] Page map mini renders correctly (colour pages tinted)
- [ ] Payment state chip shows when unpaid
- [ ] ONE primary action visible at a time
- [ ] Menu actions: Move to top, Set urgent, Hold, Reroute, Send to PC, Cancel, Reprint

### 4. Manual print flow (3 taps)
For EACH printer, test:

| Printer | Model | PDF | Colour | B&W | Duplex | 3-page | 100-page | Out-of-paper | Power-off | PC+phone merge |
|---------|-------|-----|--------|-----|--------|--------|----------|-------------|-----------|----------------|
| HP | _____ | __ | __ | __ | __ | __ | __ | __ | __ | __ |
| Canon | _____ | __ | __ | __ | __ | __ | __ | __ | __ | __ |
| Epson | _____ | __ | __ | __ | __ | __ | __ | __ | __ | __ |
| Brother | _____ | __ | __ | __ | __ | __ | __ | __ | __ | __ |
| Older | _____ | __ | __ | __ | __ | __ | __ | __ | __ | __ |

### 5. Discovery
- [ ] mDNS discovers IPP printers on same Wi-Fi
- [ ] Manual add by IP works when mDNS is blocked
- [ ] Printer UUID persists across IP changes
- [ ] Same physical printer (PC + phone) merges into one logical printer
- [ ] "Not on shop Wi-Fi" banner shows on guest Wi-Fi / mobile data

### 6. Safety
- [ ] App killed mid-job → reconciliation sets UNCERTAIN (no auto-reprint)
- [ ] Network loss mid-print → no blind retry (queries job status first)
- [ ] Lease expiry → task shows "Needs you" on dashboard
- [ ] Two phones claim same task → exactly one wins

### 7. Walk-in printing
- [ ] Choose file (PDF, image, camera scan) → upload → print
- [ ] Price preview shows (if shop bills walk-ins)
- [ ] Walk-in order appears in web dashboard

### 8. Printers tab
- [ ] List shows live status (state, paper, ink levels)
- [ ] Path chips show (Shop PC, This phone)
- [ ] Test print works
- [ ] Rename, Set default, Pause, Remove work
- [ ] "Find printers" discovery runs with progress
- [ ] "Add by IP" works for blocked mDNS networks
- [ ] "Share compatibility report" exports capabilities

## Results template

```
Phone: [model] [OS version]
Printer: [brand] [model] [connection: IPP/USB]
  PDF:     Pass / Fail / N/A
  Colour:  Pass / Fail / N/A
  B&W:     Pass / Fail / N/A
  Duplex:  Pass / Fail / N/A
  3-page:  Pass / Fail / N/A (time: ___s)
  100-page: Pass / Fail / N/A (time: ___s)
  Out-of-paper: Correct error shown? Y/N
  Power-off: UNCERTAIN state? Y/N
  PC+phone merge: Merged? Y/N
  Notes: "..."
```
