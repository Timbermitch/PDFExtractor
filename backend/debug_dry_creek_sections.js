#!/usr/bin/env node
/**
 * Debug section extraction for Dry Creek
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from './services/sectionExtractor.js';

const bronzeFile = path.join(process.cwd(), 'data/bronze/dry-creek-9-key-element-plan-2017-15.json');
const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
const sections = extractSections(bronzeData.rawText);

console.log('Sections found:', Object.keys(sections));

// Find which section has the Activity line
Object.entries(sections).forEach(([sectionName, sectionLines]) => {
  if(Array.isArray(sectionLines)) {
    const activityLineIndex = sectionLines.findIndex(line => 
      line.includes('Activity Size/Amount Estimated Cost Landowner Match'));
    
    if(activityLineIndex !== -1) {
      console.log(`\nActivity line found in section: ${sectionName}`);
      console.log(`At index ${activityLineIndex} of ${sectionLines.length} lines`);
      console.log(`\nSection content around the Activity line:`);
      
      const start = Math.max(0, activityLineIndex - 2);
      const end = Math.min(sectionLines.length, activityLineIndex + 15);
      
      for(let i = start; i < end; i++) {
        const marker = i === activityLineIndex ? ' <-- HEADER' : '';
        console.log(`${String(i).padStart(3, ' ')}: "${sectionLines[i]}"${marker}`);
      }
    }
  }
});