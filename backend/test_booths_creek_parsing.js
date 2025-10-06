// Test script to verify Booths Creek BMP parsing
import { parseCostTable } from './services/reportBuilder.js';
import fs from 'fs';

// Load the Booths Creek bronze data
const boothsCreekBronze = JSON.parse(fs.readFileSync('./data/bronze/booths-creek-bayou-pierre-watershed-plan-2017-2.json', 'utf8'));

// Create sections object (the parseCostTable expects sections with arrays of lines)
const lines = boothsCreekBronze.rawText ? boothsCreekBronze.rawText.split('\n') : [];
const sections = {
  'rawText': lines
};

console.log('Raw text length:', boothsCreekBronze.rawText ? boothsCreekBronze.rawText.length : 'N/A');

// Let's split into lines and look for our pattern
if (boothsCreekBronze.rawText) {
  const lines = boothsCreekBronze.rawText.split('\n');
  console.log('Total lines:', lines.length);
  
  // Look for our patterns
  const foundLines = lines.filter((line, idx) => {
    if (/Provided below is an estimate of project BMP costs/i.test(line)) {
      console.log(`Found intro line ${idx}: "${line.trim()}"`);
      return true;
    }
    if (/Code\s+Practice\s+Units\s+Cost/i.test(line)) {
      console.log(`Found header line ${idx}: "${line.trim()}"`);
      return true;
    }
    if (/314.*Brush Management.*ac.*\$44\.70/i.test(line)) {
      console.log(`Found data line ${idx}: "${line.trim()}"`);
      return true;
    }
    return false;
  });
  console.log('Found relevant lines:', foundLines.length);
}

// Test the parsing
console.log('\nTesting Booths Creek BMP cost table parsing...');
const result = parseCostTable(sections);

console.log('\nResult:');
console.log('bmpCostTables length:', result.bmpCostTables.length);
console.log('bmpCostTablesNormalized length:', result.bmpCostTablesNormalized.length);

if (result.bmpCostTables.length > 0) {
  console.log('\nFirst table:');
  console.log(JSON.stringify(result.bmpCostTables[0], null, 2));
}

if (result.bmpCostTablesNormalized.length > 0) {
  console.log('\nFirst normalized table:');
  console.log(JSON.stringify(result.bmpCostTablesNormalized[0], null, 2));
}