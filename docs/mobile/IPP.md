# IPP Printing — Implementation Notes

## Overview

The Flutter app includes a custom IPP client (`packages/ipp/`) that communicates with LAN printers over IPP/2.0 (RFC 8011) and PWG 5100.x standards.

## Supported Operations

| Code | Operation | When used |
|------|-----------|-----------|
| 0x000B | Get-Printer-Attributes | Discovery, preflight, status checks |
| 0x0004 | Validate-Job | Preflight before printing |
| 0x0002 | Print-Job | Single-document print (PDF/JPEG) |
| 0x0005 | Create-Job | Multi-document print (raster pages) |
| 0x0006 | Send-Document | Send each page to a created job |
| 0x0009 | Get-Job-Attributes | Poll job status |
| 0x000A | Get-Jobs | List jobs (reconciliation after app kill) |
| 0x0008 | Cancel-Job | Cancel a running job |

## Format Negotiation (per printer, from document-format-supported)

1. **application/pdf** → send the task PDF as-is (server already applied page selection + colour/B&W split)
2. **image/urf or image/pwg-raster** → rasterise pages at printer's resolution, encode raster, send
3. **image/jpeg** → one JPEG per page, single-sided only (degraded mode)
4. **Other (PCLm, octet-stream)** → mark "Not supported from phone", offer "Send to shop PC"

## Job Attributes Sent

- `requesting-user-name`: "printshop" (never customer data)
- `job-name`: order number only (e.g. "Order 1042")
- `document-format`: negotiated format
- `copies`: from task spec
- `sides`: one-sided | two-sided-long-edge | two-sided-short-edge
- `print-color-mode`: color | monochrome
- `media`: e.g. iso_a4_210x297mm
- `orientation-requested`: portrait | landscape
- `print-quality`: draft | normal | high
- `page-ranges`: only when printing a subset

## TLS (ipps://)

- Self-signed certificates: trust-on-first-use per printer
- Pin the certificate fingerprint, show it, require shopkeeper confirmation
- NEVER disable certificate checks globally

## Status Mapping

| printer-state | Meaning |
|----------------|---------|
| 3 | idle |
| 4 | processing |
| 5 | stopped |

| job-state | Meaning |
|-----------|---------|
| 3 | pending |
| 4 | pending-held |
| 5 | processing |
| 6 | processing-stopped |
| 7 | canceled |
| 8 | aborted |
| 9 | completed |

**PRINTED is reported only when job-state = 9 (completed).**
On timeout or lost connection → report UNCERTAIN, not failed.

## Streaming

- Send document with chunked HTTP
- Never load a 500-page file fully in memory
- Rasterise and encode in a Dart isolate
- Cancel on scroll away or user cancel

## Raster Notes (hardest part)

- PWG raster: correct header + back-side rules from `pwg-raster-document-sheet-back`
- URF: similar but Apple-specific format
- Grayscale for monochrome tasks, RGB for colour
- Test on real duplex printers — flag as critical

## References

- RFC 8011: IPP/2.0
- PWG 5100.5: IPP/2.0
- PWG 5100.7: IPP Everywhere
- PWG 5102.6: PWG Raster
- Apple Raster Format (URF)
