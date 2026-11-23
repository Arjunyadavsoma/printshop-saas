# Printer Compatibility

## What works from the phone

| Printer type | PDF | Raster (URF/PWG) | JPEG | Duplex | Notes |
|-------------|-----|-------------------|------|--------|-------|
| IPP Everywhere (modern) | ✅ | ✅ | ✅ | ✅ | Best experience. Auto-discovered via mDNS. |
| AirPrint (HP, Canon, Epson, Brother post-2012) | ✅ | ✅ (URF) | ✅ | ✅ | Usually works. Check document-format-supported. |
| Mopria-certified | ✅ | ✅ (PWG) | ✅ | ✅ | Android-native. Usually works. |
| Older network printers (pre-2010) | ❌ | ❌ | ❌ | ❌ | Windows driver or USB only. Use "Send to shop PC". |
| PCLm-only printers | ❌ | ❌ | ❌ | ❌ | Rare. Mark "Not supported from phone". |

## What does NOT work from the phone

- Printers that only work through a Windows driver (GDI, XPS-only)
- USB-only printers (no network interface)
- Printers behind a Windows print server that doesn't expose IPP
- Printers on a different VLAN/subnet (unless routable)

## What to do when a printer isn't supported

1. The app shows "Not supported from phone" with the printer's reported capabilities
2. Offers "Send to shop PC" — the task goes back to the PC agent's queue
3. Offers "Use Android system print dialog" as a manual fallback

## Network requirements

- Phone and printer must be on the **same Wi-Fi network**
- Guest Wi-Fi with client isolation → printers unreachable
- Mobile data → printers unreachable
- The app detects this and shows "Not on shop Wi-Fi" with explanation

## Discovery

- mDNS/DNS-SD: `_ipp._tcp`, `_ipps._tcp`, `_pdl-datastream._tcp`
- Fallback: manual add by IP/hostname
- Optional: bounded subnet probe (ports 631, 9100) — requires consent, /24 only

## Raw port 9100

- Advanced, off by default
- Enable per printer only when the printer's `pdl` list contains a language you can generate
- Never guess — verify the printer supports a known page description language
