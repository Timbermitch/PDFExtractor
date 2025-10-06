#!/usr/bin/env node
/**
 * Simple regression assertion script.
 * Usage: node backend/scripts/assertGoal.js <sourceId>
 * Reprocesses the given bronze source and asserts that the silver output contains
 * the full canonical Dry Creek style ultimate goal sentence (watershed period).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd){
  return execSync(cmd,{stdio:'pipe'}).toString();
}

const sourceId = process.argv[2];
if(!sourceId){
  console.error('ERROR: sourceId argument required');
  process.exit(2);
}

try {
  run(`node backend/scripts/reprocess.js ${sourceId}`);
} catch(err){
  console.error('Failed to reprocess source:', err.message);
  process.exit(3);
}

const silverPath = path.join(process.cwd(),'backend','data','silver',`${sourceId}.json`);
if(!fs.existsSync(silverPath)){
  console.error('ERROR: silver file not found:', silverPath);
  process.exit(4);
}

const silver = JSON.parse(fs.readFileSync(silverPath,'utf8'));
if(!silver.goals || !silver.goals.length){
  console.error('ASSERT FAIL: No goals extracted');
  process.exit(5);
}

const goal = silver.goals[0].title || '';
const hasWatershed = /overall quality of life in the watershed\.$/i.test(goal.trim());
if(!hasWatershed){
  console.error('ASSERT FAIL: Primary goal missing watershed terminating clause. Got:', goal);
  process.exit(6);
}
const hasBestMgmt = /best management practices/i.test(goal);
if(!hasBestMgmt){
  console.error('ASSERT FAIL: Goal missing "best management practices" phrase. Got:', goal);
  process.exit(7);
}
console.log('ASSERT PASS: Full canonical goal captured.');
process.exit(0);
