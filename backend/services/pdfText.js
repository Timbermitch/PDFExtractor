/** Pure pdfjs-dist text extractor (no pdf-parse) */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// Ensure worker disabled for Node (avoid attempting to spawn worker thread file)
try { if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = null; } catch (_) {}

// Polyfills required pieces for Node environment
if (typeof global.DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    scale() { return this; }
    translate() { return this; }
    multiply() { return this; }
  }
  global.DOMMatrix = DOMMatrixPolyfill; // eslint-disable-line no-global-assign
}

export async function extractText(buffer) {
  let uint8;
  if (buffer instanceof Uint8Array) uint8 = buffer;
  else if (buffer instanceof ArrayBuffer) uint8 = new Uint8Array(buffer);
  else if (Buffer.isBuffer(buffer)) {
    // Force copy into a fresh contiguous Uint8Array (some internal checks may disallow shared views)
    uint8 = new Uint8Array(buffer.byteLength);
    for (let i=0;i<buffer.byteLength;i++) uint8[i] = buffer[i];
  }
  else throw new Error('Unsupported buffer type for PDF extraction');
  // Debug diagnostics
  if (process.env.PDF_TEXT_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console.log('[pdfText] uint8 length', uint8.length, 'firstBytes', Array.from(uint8.slice(0,8)));
  }

  const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group by approximate y to keep reading order per page
    const lineBuckets = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (!lineBuckets.has(y)) lineBuckets.set(y, []);
      lineBuckets.get(y).push({ x: item.transform[4], text: item.str });
    }
    const sortedY = [...lineBuckets.keys()].sort((a,b)=>b-a); // pdfjs coordinates: higher y = lower on page
    for (const y of sortedY) {
      const segs = lineBuckets.get(y).sort((a,b)=>a.x-b.x).map(s=>s.text.trim()).filter(Boolean);
      if (segs.length) lines.push(segs.join(' '));
    }
    lines.push(''); // page break blank line
  }
  return { text: lines.join('\n'), numpages: doc.numPages };
}
