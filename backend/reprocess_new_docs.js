import fetch from 'node-fetch';

async function reprocessDocument(docId) {
  try {
    console.log(`Reprocessing ${docId}...`);
    
    const response = await fetch('http://localhost:5202/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: docId
      })
    });
    
    if (!response.ok) {
      console.error('Response not OK:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return false;
    }
    
    const result = await response.json();
    console.log(`Successfully reprocessed ${docId}!`);
    console.log('BMP Cost Tables found:', result.bmpCostTables?.length || 0);
    console.log('BMP Cost Tables Normalized found:', result.bmpCostTablesNormalized?.length || 0);
    
    if (result.bmpCostTablesNormalized?.length > 0) {
      const firstTable = result.bmpCostTablesNormalized[0];
      console.log(`  Total cost computed: $${firstTable.totalComputed?.toLocaleString()}`);
      console.log(`  Number of BMP rows: ${firstTable.rows?.length}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

async function reprocessAllNewDocuments() {
  const documents = [
    'booths-creek-bayou-pierre-watershed-plan-2017-2',
    'chunky-okatibbee-watershed-plan-2007',
    'luxapallila-creek-watershed-plan-2004-2'
  ];
  
  for (const docId of documents) {
    await reprocessDocument(docId);
    console.log('---');
  }
}

reprocessAllNewDocuments();