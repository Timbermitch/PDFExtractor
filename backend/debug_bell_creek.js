#!/usr/bin/env node
/**
 * Debug Bell Creek parsing specifically
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from './services/sectionExtractor.js';

const bronzeFile = path.join(process.cwd(), 'data/bronze/bell-creek-muddy-creek-watershed-plan-2012-8.json');
const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
const sections = extractSections(bronzeData.rawText);
const allLines = Object.values(sections).filter(Array.isArray).flat();

console.log('Bell Creek Debug Analysis\n');

// Find table detection patterns
console.log('Looking for table detection patterns:');
allLines.forEach((line, i) => {
  if(/Table.*Funded.*319.*Project.*Budget.*BMPs/i.test(line)) {
    console.log(`  Line ${i}: "${line}" -> DETECTED (Table 8.1)`);
  }
  if(/Practice\s+Area Affected\s+BMP Cost\s+BMP Total/i.test(line)) {
    console.log(`  Line ${i}: "${line}" -> DETECTED (Header)`);
  }
});

// Find the specific lines around the table
const tableStart = allLines.findIndex(l => /Practice.*Area Affected.*BMP Cost.*BMP Total/i.test(l));
if(tableStart !== -1) {
  console.log(`\nTable starts at line ${tableStart}:`);
  const window = allLines.slice(tableStart, tableStart + 20);
  window.forEach((line, i) => {
    console.log(`  ${tableStart + i}: "${line}"`);
    
    // Test our parsing regex
    const m = line.match(/^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*\w+)?\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
    if(m) {
      console.log(`    -> PARSED: ${m[1]} | ${m[2]} ${m[3]} | $${m[4]} | $${m[5]}`);
    }
  });
}