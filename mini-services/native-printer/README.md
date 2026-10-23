# PrintShop Native Printer

Local Windows printing service for **PrintShop SaaS**. Runs on the shopkeeper's
Windows computer and submits PDFs to the Windows print queue using
[`windows-pdf-printer-native`](https://www.npmjs.com/package/windows-pdf-printer-native)
(direct GDI32 + PDFium — no SumatraPDF / Adobe Reader required).

## Quick start (for shopkeepers)

You only do steps 1–3 once. After that, you just start the service each morning.

### 1. Install Node.js 22+

Download from <https://nodejs.org/en/download> and run the Windows Installer
with default options. Verify:

```powershell
node --version
# → v22.x.x or higher
```

### 2. Download this folder

Download the `mini-services/native-printer` folder from the PrintShop repo and
extract it somewhere permanent, e.g. `C:\PrintShop\native-printer`.

The folder should contain:

- `index.js` — the service code
- `package.json` — dependency list
- `README.md` — this file

### 3. Install dependencies (one-time)

Open PowerShell in the `native-printer` folder (Shift + right-click in the
folder → "Open PowerShell window here"), then:

```powershell
cd C:\PrintShop\native-printer
npm install
```

This downloads `windows-pdf-printer-native` + its native binaries. It can take
1–2 minutes the first time. If you see `node-gyp` or build errors, install the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
(C++ workload) and re-run `npm install`.

### 4. Generate the pairing code

```powershell
node index.js pair --origin=https://printshop-saas-three.vercel.app
```

(Replace the URL with your actual PrintShop website address.)

You'll see:

```
══════════════════════════════════════════════════════
  PrintShop Native Printer — Pairing Code
══════════════════════════════════════════════════════

  Pairing code:  PS-XXXXXXXX-XXXXXXXX-XXXXXXXX

══════════════════════════════════════════════════════
```

The code is saved to `.pairing-state.json` on your computer and is valid for
15 minutes.

### 5. Enter the pairing code on the website

On the PrintShop website → Printer Setup page → select **Native Windows
Printer** as the engine → paste the code → click **Confirm pairing**.

### 6. Start the service

```powershell
node index.js
```

You'll see:

```
══════════════════════════════════════════════════════
  PrintShop Native Printer service running
  → http://127.0.0.1:32192
  → Health check: http://127.0.0.1:32192/health
  → Paired origin: https://printshop-saas-three.vercel.app
  → Press Ctrl+C to stop.
══════════════════════════════════════════════════════
```

**⚠️ Leave this PowerShell window open while printing.** Closing it stops the
service and prints will fail.

Verify the service is reachable — open
<http://127.0.0.1:32192/health> in your browser. You should see JSON with
`"service":"printshop-native-printer"` and `"libraryLoaded":true`.

### 7. Print!

Open any order on the PrintShop website → click **Print** next to a file →
review the settings → click **Confirm Print**. The document goes straight to
your Windows printer.

## Daily usage

Each morning:

```powershell
cd C:\PrintShop\native-printer
node index.js
```

Leave the window open. That's it — the pairing token lasts 24 hours, so you
don't need to re-pair every day (only when the token expires, the website will
tell you).

To stop the service: press `Ctrl+C` in the PowerShell window.

## Security

- Binds to `127.0.0.1` **only** — never exposed to your LAN or the internet
- Origin-based pairing — only the website you paired with can send print jobs
- Bearer token authentication (24h expiry, stored in your browser's
  localStorage — not a cookie, so immune to CSRF)
- 25 MB max PDF size
- Rate limited (20 jobs/minute)
- Strict request schema validation — no arbitrary file paths, only PDF bytes
- Host header validation (prevents DNS rebinding)
- CORS: only the paired origin

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Service not reachable` | Is `node index.js` still running? Open <http://127.0.0.1:32192/health> — if it fails, the service is down. |
| `Library not loaded` | Run `npm install` again. Check `node --version` is v22+. |
| `Origin mismatch` | The `--origin` must match your website. Re-run the pairing command with the correct origin. |
| `Pairing code expired` | Codes last 15 minutes. Re-run `node index.js pair --origin=...` |
| `Token expired (24h)` | Click **Disconnect** on the website, then re-pair. |
| `CORS error in console` | You changed the website URL (e.g. a new preview deployment). Re-pair with the new origin. |
| `Build errors during npm install` | Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload), then re-run `npm install`. |
| `No printers detected` | Install a printer in Windows first (Settings → Bluetooth & devices → Printers → Add device). |

## Architecture

```
┌─────────────────┐   HTTPS    ┌──────────────────┐  loopback  ┌─────────────────────┐
│  PrintShop web  │ ─────────▶ │ PrintShop API    │ ─────────▶ │  Windows Printer    │
│  (browser)      │            │ (Vercel)         │            │  (your shop)         │
│                 │            │                  │            │                      │
│  1. GET print-  │            │  2. presigned    │            │  native-printer      │
│     url         │            │     PDF URL (60s)│            │  (Node.js @32192)    │
│                 │            │                  │            │                      │
│  3. fetch PDF   │◀───────────│                  │            │  windows-pdf-printer │
│     bytes       │            │                  │            │  -native (GDI32)     │
│                 │            │                  │            │                      │
│  4. POST /v1/   │ ──────────────────────────────────────────▶│  5. submit to Windows│
│     jobs (PDF)  │            (direct browser → loopback)     │     print queue      │
│                 │                                              │                      │
│  6. poll status │ ──────────────────────────────────────────▶│  7. return job state │
└─────────────────┘                                              └──────────────────────┘
```

The browser talks to the native-printer service **directly over loopback**
(`http://127.0.0.1:32192`). The PrintShop API only generates short-lived
presigned PDF URLs — it never sees the PDF bytes flow to the printer.

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Service health + library status |
| `POST` | `/v1/pair` | none | Exchange a pairing code for a bearer token |
| `GET` | `/v1/printers` | Bearer | List available Windows printers |
| `POST` | `/v1/jobs` | Bearer | Submit a PDF print job (multipart: `file`, `printerName`, `copies`, `duplex`, `paperSize`, `color`, `orientation`) |
| `GET` | `/v1/jobs/:id` | Bearer | Get job status |
| `POST` | `/v1/jobs/:id/retry` | Bearer | Retry a failed job |
| `POST` | `/v1/jobs/:id/cancel` | Bearer | Cancel a printing job |

## Requirements

- **Node.js 22+** (for `windows-pdf-printer-native` N-API addons)
- **Windows 7+** (for GDI32 + PDFium)
- A Windows-installed printer (Settings → Bluetooth & devices → Printers)

## License

MIT — see the repository LICENSE.
