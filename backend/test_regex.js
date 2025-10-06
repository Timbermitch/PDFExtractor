#!/usr/bin/env node
/**
 * Test specific line parsing for Bell Creek
 */

const testLine = "Water and Sediment Control Basin 4 structures $10,000/ ea $40,000";

console.log('Testing line:', testLine);
console.log('');

// Current regex pattern
const pattern1 = /^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*\w+)?\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/;

console.log('Pattern 1 (current):');
const match1 = testLine.match(pattern1);
console.log('Match:', match1 ? match1 : 'No match');

// More flexible pattern
const pattern2 = /^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*\/?\s*\w*\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/;

console.log('\nPattern 2 (more flexible):');
const match2 = testLine.match(pattern2);
console.log('Match:', match2 ? match2 : 'No match');

// Even more flexible
const pattern3 = /^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)[^$]*\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/;

console.log('\nPattern 3 (very flexible):');
const match3 = testLine.match(pattern3);
console.log('Match:', match3 ? match3 : 'No match');