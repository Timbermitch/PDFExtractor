import fetch from 'node-fetch';

async function testReprocessing() {
  try {
    console.log('Attempting to reprocess Booths Creek document...');
    
    const response = await fetch('http://localhost:5202/api/documents/booths-creek-bayou-pierre-watershed-plan-2017-2/reprocess', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('Response not OK:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const result = await response.json();
    console.log('Reprocessing successful!');
    console.log('Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testReprocessing();