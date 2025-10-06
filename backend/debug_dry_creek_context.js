#!/usr/bin/env node
/**
 * Show context around Dry Creek Activity line
 */
import fs from 'fs';
import path from 'path';

const bronzeFile = path.join(process.cwd(), 'data/bronze/dry-creek-9-key-element-plan-2017-15.json');
const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
const lines = bronzeData.rawText.split('\n');

console.log('Total lines in raw text:', lines.length);

const activityLineIndex = lines.findIndex(line => line.includes('Activity Size/Amount Estimated Cost Landowner Match'));

console.log(`Activity header found at line ${activityLineIndex + 1} (0-based: ${activityLineIndex})`);

if(activityLineIndex !== -1) {
  const start = Math.max(0, activityLineIndex - 5);
  const end = Math.min(lines.length, activityLineIndex + 15);
  
  console.log(`\nShowing lines ${start + 1} to ${end}:`);
  for(let i = start; i < end; i++) {
    const marker = i === activityLineIndex ? ' <-- HEADER' : '';
    console.log(`${String(i + 1).padStart(3, ' ')}: "${lines[i]}"${marker}`);
  }
}