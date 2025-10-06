#!/usr/bin/env node
/**
 * Find where BMP data lines are in Dry Creek sections
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from './services/sectionExtractor.js';

const bronzeFile = path.join(process.cwd(), 'data/bronze/dry-creek-9-key-element-plan-2017-15.json');
const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
const sections = extractSections(bronzeData.rawText);

console.log('Looking for BMP data lines (should contain dollar amounts):\n');

Object.entries(sections).forEach(([sectionName, sectionLines]) => {
  if(Array.isArray(sectionLines)) {
    // Look for lines with BMP data (containing $amounts and specific items like Fencing)
    const bmpLines = [];
    sectionLines.forEach((line, i) => {
      if(line.includes('Fencing') && line.includes('$') || 
         line.includes('Water Facilities') || 
         line.includes('Heavy Use Areas') ||
         line.includes('Nutrient Management')) {
        bmpLines.push({index: i, line});
      }
    });
    
    if(bmpLines.length > 0) {
      console.log(`Section: ${sectionName} (${sectionLines.length} lines total)`);
      bmpLines.forEach(item => {
        console.log(`  ${item.index}: "${item.line}"`);
      });
      console.log('');
    }
  }
});