import { describe, expect, it } from 'vitest';
import { parsePageCount } from './parse-page-count';

// Helper: create a minimal valid DOCX (ZIP with docProps/app.xml containing <Pages>)
async function createMinimalDocx(pages: number): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('docProps/app.xml', `<?xml version="1.0"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>${pages}</Pages></Properties>`);
  zip.file('word/document.xml', '<?xml version="1.0"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:document>');
  const buffer = await zip.generateAsync({ type: 'uint8array' });
  return buffer;
}

// Helper: create a minimal valid PDF
function createMinimalPdf(): Uint8Array {
  // Minimal PDF with 3 pages
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000176 00000 n 
0000000237 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
298
%%EOF`;
  return new TextEncoder().encode(content);
}

describe('parsePageCount', () => {
  it('extracts page count from a valid PDF', async () => {
    const bytes = createMinimalPdf();
    const count = await parsePageCount('application/pdf', bytes);
    expect(count).toBe(3);
  });

  it('returns null for a corrupted PDF', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    const count = await parsePageCount('application/pdf', bytes);
    expect(count).toBeNull();
  });

  it('returns null for empty bytes', async () => {
    const count = await parsePageCount('application/pdf', null);
    expect(count).toBeNull();
  });

  it('returns 1 for JPEG images', async () => {
    const count = await parsePageCount('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]));
    expect(count).toBe(1);
  });

  it('returns 1 for PNG images', async () => {
    const count = await parsePageCount('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(count).toBe(1);
  });

  it('extracts page count from a DOCX with <Pages> in app.xml', async () => {
    const bytes = await createMinimalDocx(5);
    const count = await parsePageCount('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes);
    expect(count).toBe(5);
  });

  it('returns null for a DOCX without app.xml', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('word/document.xml', '<xml/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const count = await parsePageCount('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes);
    expect(count).toBeNull();
  });

  it('returns null for a malformed DOCX (not a ZIP)', async () => {
    const bytes = new TextEncoder().encode('not a zip file');
    const count = await parsePageCount('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes);
    expect(count).toBeNull();
  });

  it('returns null for legacy .doc format', async () => {
    const bytes = new Uint8Array(100);
    const count = await parsePageCount('application/msword', bytes);
    expect(count).toBeNull();
  });

  it('returns null for text files', async () => {
    const bytes = new TextEncoder().encode('hello world');
    const count = await parsePageCount('text/plain', bytes);
    expect(count).toBeNull();
  });
});
