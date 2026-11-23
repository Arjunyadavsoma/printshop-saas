# IPP — Internet Printing Protocol Implementation

## Overview
The Flutter app implements a small IPP client library (`packages/ipp`) to print directly to LAN printers without a Windows driver.

## Protocol
- IPP/2.0 with 1.1 fallback (RFC 8011)
- Transport: HTTP POST to `ipp://` (port 631) or `ipps://` (TLS, port 443/631)
- Content-Type: `application/ipp`
- Binary message format: version (2 bytes) + operation (2 bytes) + request-id (4 bytes) + attribute-groups + data

## Operations

| Code | Name | Purpose |
|------|------|---------|
| 0x000B | Get-Printer-Attributes | Query capabilities (formats, sides, media, resolution, marker levels) |
| 0x0004 | Validate-Job | Preflight: check if the printer will accept this job |
| 0x0002 | Print-Job | Send document + print in one operation |
| 0x0005 | Create-Job | Start a job (returns job-id) |
| 0x0006 | Send-Document | Send document data to an existing job |
| 0x0009 | Get-Job-Attributes | Query job status |
| 0x000A | Get-Jobs | List jobs |
| 0x0008 | Cancel-Job | Cancel a job |

## Job Attributes

| Attribute | Values | Notes |
|-----------|--------|-------|
| requesting-user-name | "printshop" | No customer data |
| job-name | Order number only | e.g. "Order 1042" |
| document-format | application/pdf, image/urf, image/pwg-raster, image/jpeg | Negotiated per printer |
| copies | 1-100 | From task spec |
| sides | one-sided, two-sided-long-edge, two-sided-short-edge | From task spec |
| print-color-mode | color, monochrome | From task spec (colour set vs B&W set) |
| media | iso_a4_210x297mm, na_letter_8.5x11in | From task spec |
| orientation-requested | 3 (portrait), 4 (landscape) | From task spec |
| print-quality | 3 (draft), 4 (normal), 5 (high) | Default normal |
| page-ranges | "1-3,5" | Only when needed |

**Never send unsupported values** — always check `xxx-supported` attributes first.

## Format Negotiation (per printer)

1. **application/pdf** (if listed in document-format-supported): Send the task PDF as-is. Server already applied page selection + colour/B&W split.
2. **image/urf or image/pwg-raster**: Rasterise pages at printer's resolution. Grayscale for B&W. Handle duplex via sides + pwg-raster-document-sheet-back. **Hardest part — test on real duplex printers.**
3. **image/jpeg**: One JPEG per page. Single-sided only. Degraded mode.
4. **Other (PCLm, octet-stream)**: Mark "Not supported from phone." Offer "Send to shop PC."

## TLS (ipps://)

- Self-signed certificates: trust-on-first-use per printer
- Pin the certificate fingerprint on first connection
- Show fingerprint to shopkeeper for confirmation
- Never disable certificate checks globally

## Status Mapping

### Printer states (printer-state)
| Value | Meaning |
|-------|---------|
| 3 | idle |
| 4 | processing |
| 5 | stopped |

### Printer reasons (printer-state-reasons)
| Reason | Plain message |
|--------|--------------|
| media-empty | "No paper" |
| media-jam | "Paper jam" |
| door-open | "Door open" |
| toner-low | "Toner low" |
| marker-supply-low | "Ink low" |
| offline | "Printer offline" |

### Job states (job-state)
| Value | Meaning | App action |
|-------|---------|-----------|
| 3 | pending | Waiting |
| 4 | pending-held | Held |
| 5 | processing | Printing |
| 6 | processing-stopped | Stopped — check reasons |
| 7 | canceled | Cancelled |
| 8 | aborted | Failed |
| 9 | completed | **Report PRINTED** |

On timeout or lost connection → report **UNCERTAIN**, not failed.

## References
- RFC 8011: IPP/2.0
- PWG 5100.5: IPP Everywhere
- PWG 5102.x: PWG Raster
- Apple Raster Format (URF)
