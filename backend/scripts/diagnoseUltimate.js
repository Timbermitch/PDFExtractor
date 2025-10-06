import fs from 'fs';
import path from 'path';

const id = process.argv[2];
if(!id){
  console.error('Usage: node scripts/diagnoseUltimate.js <bronze-id>');
  process.exit(1);
}
const bronzePath = path.join(process.cwd(),'data','bronze',`${id}.json`);
if(!fs.existsSync(bronzePath)){
  console.error('Bronze not found:', bronzePath);
  process.exit(1);
}
const bronze = JSON.parse(fs.readFileSync(bronzePath,'utf-8'));
const raw = bronze.rawText || '';
const lower = raw.toLowerCase();
const marker = 'the ultimate goal is to bring about';
const idx = lower.indexOf(marker);
if(idx === -1){
  console.log('Marker not found.');
  process.exit(0);
}
const window = raw.slice(idx, idx + 1200);
console.log('--- RAW WINDOW START ---');
console.log(window);
console.log('--- RAW WINDOW END (length', window.length,') ---');