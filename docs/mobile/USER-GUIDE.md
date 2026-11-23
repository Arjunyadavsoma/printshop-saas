# Shopkeeper Guide — PrintShop Shop App

## What is it?

The PrintShop Shop app lets you print from your phone. Your shop PC (PrintEXE) stays automatic — it prints orders as they come in. Your phone is for manual control: print specific orders, prioritise the queue, hold tasks, and print walk-in files.

## Getting started (5 minutes)

1. **Install the app** on your Android phone
2. **Open the web dashboard** on your shop PC → Settings → Devices → "Add this phone"
3. **Scan the QR code** with the app
4. **Grant permissions** when prompted (Wi-Fi, camera, notifications)
5. **Find your printers** — the app discovers IPP printers on your Wi-Fi automatically

## The Queue (home screen)

Your print queue shows all tasks in order. Each row shows:
- Order number + customer name
- Page split ("9 B&W, 3 colour")
- Target printer
- Status pill (Waiting, Held, Printing, Needs you)
- Age timer

**Actions:**
- **Tap a task** → see details + print options
- **Long-press + drag** → reorder the queue
- **Swipe right** → Print now
- **Swipe left** → Hold or Move to top
- **Search** → find by name, phone, order number, or pickup code

## Printing from your phone (3 taps)

1. **Tap "Print now"** on a task
2. **Choose a printer** (only reachable printers shown, with status dots)
3. **Confirm** — shows "Will print 3 colour pages, 1 copy, double-sided" → tap Print

The app handles the rest: downloads the file, sends it to the printer via IPP, reports the result.

## If something goes wrong

- **"Not on shop Wi-Fi"** → your phone is on mobile data or guest Wi-Fi. Connect to the same Wi-Fi as your printers.
- **"Not supported from phone"** → this printer only works through the PC. Tap "Send to shop PC".
- **"Needs you"** → a print job was interrupted. Tap the task to decide: Mark printed, Reprint, or Cancel.
- **Printer offline** → check the printer is on and connected to Wi-Fi. Try "Find printers" to rediscover.

## Walk-in printing

1. Tap the **Print** tab
2. Choose a file (PDF, photo, or scan with camera)
3. Pick pages, copies, colour
4. Choose a printer
5. Print

The order is recorded in your dashboard.

## Managing printers

- **Printers tab** → see all printers with live status
- **Test print** → verify a printer works
- **Set as default** → colour or B&W
- **Rename** → give it a friendly name
- **Pause** → stop new orders going to it
- **Find printers** → discover new printers on your Wi-Fi
- **Add by IP** → for networks where discovery is blocked

## Your phone and PC work together

- **PC is automatic** — it prints orders as they come in
- **Phone is manual** — you choose what to print and when
- **Same printer, two paths** — if both your PC and phone can reach the same printer, it shows as one printer with two paths
- **Pull back** — if a task is waiting on the PC, you can pull it back to your phone (only if the PC hasn't started printing yet)

## Security

- Your phone token is stored securely (hardware-backed)
- Files are deleted after printing
- No customer data is sent to the printer (only the order number)
- Revoke your phone anytime from the web dashboard
