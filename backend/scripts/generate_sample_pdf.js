#!/usr/bin/env node
/**
 * Generate a small synthetic watershed plan style PDF for upload testing.
 * Includes:
 *  - Title & goals section text
 *  - BMP list bullet style
 *  - Cost estimate table fragment resembling known patterns
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// When executed from backend directory process.cwd() already ends in 'backend'
// so writing to 'backend/data/raw' produced a nested backend/backend path. Use data/raw directly.
const OUT_DIR = path.join(process.cwd(),'data','raw');
await fs.promises.mkdir(OUT_DIR,{recursive:true});
const outPath = path.join(OUT_DIR,'sample.pdf');

const doc = new PDFDocument({margin:50});
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

doc.fontSize(18).text('Sample Watershed Plan', {align:'center'});
doc.moveDown();

doc.fontSize(12).text('Goals:');
doc.list([
  'Reduce sediment loading by 30% within five years.',
  'Install structural BMPs to stabilize streambanks.',
  'Enhance aquatic habitat diversity through targeted BMP implementation.'
]);

doc.moveDown().fontSize(12).text('Best Management Practices (BMPs):');
doc.list([
  'Sediment Basin',
  'Cover Crops',
  'Streambank Stabilization',
  'Heavy Use Area Protection'
]);

doc.addPage();
doc.fontSize(14).text('Cost Estimate: Phase 1 Implementation');
doc.moveDown(0.5).fontSize(10);

// Simulated table lines (pattern friendly)
const rows = [
  ['Sediment Basin', '2 each', '$12,500'],
  ['Cover Crops', '800 ac', '$58,400'],
  ['Streambank Stabilization', '1,200 ft', '$172,904'],
  ['Heavy Use Area Protection', '6 each', '$36,000'],
];
// Header styled similarly to detected pattern
const header = 'BMPs    Amount    Estimated Cost';
doc.text(header);
rows.forEach(r=>{
  const line = `${r[0]}    ${r[1]}    ${r[2]}`;
  doc.text(line);
});
doc.text('Total Estimated Cost    $279,804');

doc.moveDown().fontSize(10).fillColor('gray').text('Generated synthetic document for parser regression and manual upload testing.');

doc.end();

await new Promise(res=>stream.on('finish',res));
console.log(`[generate] Created sample PDF at ${outPath}`);
