#!/usr/bin/env node
/**
 * Test Dry Creek regex pattern specifically
 */

const testLine = "Activity Size/Amount Estimated Cost Landowner Match";
const pattern = /Activity.*Size.*Amount.*Estimated Cost.*Landowner Match/i;

console.log('Testing line:', testLine);
console.log('Pattern:', pattern);
console.log('Match result:', pattern.test(testLine));

// Try variations
const variations = [
  /Activity.*Size\/Amount.*Estimated Cost.*Landowner Match/i,
  /Activity\s+Size\/Amount\s+Estimated Cost\s+Landowner Match/i,
  /Activity.*Size.*Amount.*Estimated.*Cost.*Landowner.*Match/i
];

variations.forEach((v, i) => {
  console.log(`Variation ${i+1}:`, v.test(testLine));
});