#!/usr/bin/env node
/**
 * Debug Dry Creek parsing specifically
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from './services/sectionExtractor.js';

const bronzeFile = path.join(process.cwd(), 'data/bronze/dry-creek-9-key-element-plan-2017-15.json');
const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
const sections = extractSections(bronzeData.rawText);
const allLines = Object.values(sections).filter(Array.isArray).flat();

console.log('Dry Creek Debug Analysis\n');

// Look for activity match pattern
console.log('Looking for Activity/Size/Amount/Estimated Cost/Landowner Match pattern:');
allLines.forEach((line, i) => {
  if(/Activity.*Size.*Amount.*Estimated Cost.*Landowner Match/i.test(line)) {
    console.log(`  Line ${i}: "${line}" -> DETECTED`);
  }
  if(/Activity.*Size\/Amount.*Estimated Cost.*Landowner Match/i.test(line)) {
    console.log(`  Line ${i}: "${line}" -> DETECTED (with slash)`);
  }
});

// Look for specific content patterns
console.log('\nLooking for relevant content:');
allLines.forEach((line, i) => {
  if(line.includes('Activity') && line.includes('Cost')) {
    console.log(`  Line ${i}: "${line}"`);
  }
  if(line.includes('Landowner Match')) {
    console.log(`  Line ${i}: "${line}" -> Contains Landowner Match`);
  }
});

// Look at a window around where table might be
const costLines = allLines.map((line, i) => ({ line, index: i }))
  .filter(item => item.line.includes('Cost') && item.line.includes('Activity'));

if(costLines.length > 0) {
  console.log(`\nFound potential table headers:`);
  costLines.forEach(item => {
    console.log(`Line ${item.index}: "${item.line}"`);
    
    // Show context
    const start = Math.max(0, item.index - 2);
    const end = Math.min(allLines.length, item.index + 10);
    console.log('Context:');
    for(let j = start; j < end; j++) {
      console.log(`  ${j}: "${allLines[j]}"`);
    }
    console.log('');
  });
}