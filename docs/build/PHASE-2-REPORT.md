# PHASE 2 REPORT — Upload + normalization pipeline + thumbnails + color suggestion
Date: 2026-11-21 · Status: COMPLETE · Suite: vitest 62/62 files, 720 passed / 4 skipped, tsc 0

## Delivered (all REAL toolchain, nothing simulated in this environment)
- src/lib/pipeline/normalize.ts — PDF validation (magic bytes, encrypted-PDF rejection via pdf-lib, geometry), images→PDF via sharp (EXIF rotate, white flatten, 4961px ≈ A4@300dpi cap, then pdf-lib embed), DOCX/DOC/PPTX/XLSX→PDF via REAL LibreOffice `soffice --headless` (timeout 120 s, honest failure codes OFFICE_CONV_FAILED/UNAVAILABLE).
- src/lib/pipeline/color-suggest.ts — REAL Ghostscript `inkcov` per-page CMYK coverage. Discovery: this environment's gs 10.05 (a) uses a bare 4-float output format (parser handles both formats), (b) equalises CMY on gray content (4-color black), so the classifier uses CHROMA = C+M+Y − 3·min(C,M,Y,K) instead of the naive CMY sum — verified against a 10-page mixed doc: exactly pages 3 & 7 flagged color. Fallback labelled `fallback-content-stream` if gs is missing.
- src/lib/pipeline/thumbnails.ts — REAL poppler pdftoppm renders (48 dpi, one PNG/page, cap 120 pages).
- src/lib/pipeline/process.ts — UPLOADED→CONVERTING→READY|FAILED orchestrator (stores normalized pdf + thumbs via the new optional StorageAdapter.put, sha256 checksum, suggestion json).
- Chunked/resumable upload: POST /api/v1/s/[slug]/uploads/init (creates DRAFT order + file row, shop open/accepting checks), PUT .../chunk (streamed append, 50 MB/file guard), DELETE (cancel), POST .../complete (assemble, size guards 50 MB/file + 200 MB/order, magic-vs-declared-type check, original stored, pipeline kicked; ?wait=1 for tests), GET /api/v1/s/[slug]/files/[fileId]?token=… (status + signed thumbnail URLs; 404-not-403 on foreign tokens).
- StorageAdapter interface gains optional `put(key, bytes, contentType)` (in-memory + supabase implement it; presigned-PUT flow unchanged).
- Fixtures: a minimal valid OOXML .docx committed at src/lib/pipeline/fixtures/sample.docx; the REAL LibreOffice conversion is unit-tested against it.

## Tests
pipeline.integration.test.ts (12): kind detection, magic sniffing incl. HEIC ftyp, real PDF geometry+checksum, non-PDF rejection, real sharp image→PDF, real soffice DOCX→PDF, inkcov parser (both formats), chroma classifier (5 cases incl. this build's gray/color shapes), REAL inkcov on mixed doc → [3,7], real pdftoppm thumbnails, processUpload READY (pdf+thumbs+sha256+suggestion stored), corrupt→FAILED(NOT_A_PDF).

## Honest notes
- Chunked upload is server-append (dev/single-process); production S3/R2 multipart is the documented upgrade path (ARCHITECTURE §3.2).
- soffice in this sandbox is real but single-instance; concurrent conversions are serialized by a 120 s timeout each (fine for dev load; production runs the worker container with its own LibreOffice).
