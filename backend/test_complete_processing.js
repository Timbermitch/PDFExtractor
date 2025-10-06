// Test the complete processing pipeline for Booths Creek
import fs from 'fs';
import path from 'path';
import { extractSections } from './services/sectionExtractor.js';
import { classifyAmbiguous } from './services/classifier.js';
import { buildStructuredReport } from './services/reportBuilder.js';

async function testCompleteProcessing() {
  try {
    console.log('Testing complete processing pipeline for Booths Creek...');
    
    // Read bronze file
    const bronzePath = path.join(process.cwd(), 'data', 'bronze', 'booths-creek-bayou-pierre-watershed-plan-2017-2.json');
    const bronze = JSON.parse(await fs.promises.readFile(bronzePath, 'utf-8'));
    
    console.log('Loaded bronze file, raw text length:', bronze.rawText.length);
    
    // Extract sections
    const sections = extractSections(bronze.rawText);
    console.log('Extracted sections:', Object.keys(sections));
    
    // Classify
    const classified = await classifyAmbiguous(sections);
    console.log('Classified sections:', Object.keys(classified));
    
    // Build structured report
    const structured = buildStructuredReport(classified, { 
      sourceId: 'booths-creek-bayou-pierre-watershed-plan-2017-2', 
      sourceFile: 'booths-creek-bayou-pierre-watershed-plan-2017-2.pdf' 
    });
    
    console.log('\nBMP Cost Tables Found:');
    console.log('bmpCostTables length:', structured.bmpCostTables.length);
    console.log('bmpCostTablesNormalized length:', structured.bmpCostTablesNormalized.length);
    
    if (structured.bmpCostTables.length > 0) {
      console.log('\nFirst BMP Cost Table:');
      console.log('Title:', structured.bmpCostTables[0].title);
      console.log('Rows:', structured.bmpCostTables[0].table.rows.length);
      structured.bmpCostTables[0].table.rows.forEach((row, i) => {
        console.log(`  ${i+1}. ${row.Practice}: ${row.Total}`);
      });
    }
    
    if (structured.bmpCostTablesNormalized.length > 0) {
      console.log('\nNormalized Table Summary:');
      const norm = structured.bmpCostTablesNormalized[0];
      console.log('Total computed cost:', norm.totalComputed);
      console.log('Total rows:', norm.rows.length);
    }
    
    // Write result to see if it persists
    const silverPath = path.join(process.cwd(), 'data', 'silver', 'test-booths-creek-result.json');
    await fs.promises.writeFile(silverPath, JSON.stringify(structured, null, 2));
    console.log('\nResult written to:', silverPath);
    
  } catch (error) {
    console.error('Error in processing:', error.message);
    console.error(error.stack);
  }
}

testCompleteProcessing();