#!/usr/bin/env node
/**
 * Test the enhanced cost table parsing for Bell Creek, Dry Creek, and Upper Piney Creek
 */
import fs from 'fs';
import path from 'path';
import { parseCostTable } from './services/reportBuilder.js';
import { extractSections } from './services/sectionExtractor.js';

const testFiles = [
  'bell-creek-muddy-creek-watershed-plan-2012-8',
  'dry-creek-9-key-element-plan-2017-15', 
  'upper-piney-creek-9-key-element-plan-2022-8'
];

console.log('Testing enhanced cost table parsing...\n');

testFiles.forEach(fileId => {
  const bronzeFile = path.join(process.cwd(), `data/bronze/${fileId}.json`);
  if (!fs.existsSync(bronzeFile)) {
    console.log(`❌ ${fileId}: Bronze file not found`);
    return;
  }

  try {
    const bronzeData = JSON.parse(fs.readFileSync(bronzeFile, 'utf8'));
    const sections = extractSections(bronzeData.rawText);
    
    // Debug: Check what lines contain our detection patterns
    const allLines = Object.values(sections).filter(Array.isArray).flat();

    
    const result = parseCostTable(sections);

    console.log(`📊 ${fileId}:`);
    console.log(`   Tables found: ${result.bmpCostTables.length}`);
    
    result.bmpCostTables.forEach((table, i) => {
      console.log(`   Table ${i + 1}: ${table.title}`);
      console.log(`     Columns: ${table.table?.columns?.join(' | ') || 'none'}`);
      console.log(`     Rows: ${table.table?.rows?.length || 0}`);
      console.log(`     Total: $${table.table?.total?.toLocaleString() || 'unknown'}`);
      
      if(table.table?.rows?.length > 0) {
        console.log(`     Sample row: ${JSON.stringify(table.table.rows[0])}`);
      }
    });
    
    result.bmpCostTablesNormalized.forEach((normTable, i) => {
      console.log(`   Normalized ${i + 1}: ${normTable.rows.length} rows, Total: $${normTable.totalComputed?.toLocaleString() || 'unknown'}`);
      if(normTable.discrepancy && Math.abs(normTable.discrepancy) > 1) {
        console.log(`     ⚠️  Discrepancy: $${normTable.discrepancy.toLocaleString()}`);
      }
    });
    console.log('');
    
  } catch (error) {
    console.log(`❌ ${fileId}: Error - ${error.message}`);
    console.log('');
  }
});

console.log('Test complete!');