import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

async function reprocess(id){
  const bronzePath = path.join(root, 'data', 'bronze', `${id}.json`);
  if(!fs.existsSync(bronzePath)){
    console.error('Bronze not found', id);
    return;
  }
  const bronze = JSON.parse(await fs.promises.readFile(bronzePath,'utf-8'));
  const rawText = bronze.rawText;
  const sections = extractSections(rawText);
  const classified = await classifyAmbiguous(sections);
  let structured = buildStructuredReport(classified, { sourceId: id, sourceFile: `${id}.pdf` });
  structured = { ...structured, id };
  const silverPath = path.join(root, 'data', 'silver', `${id}.json`);
  await fs.promises.writeFile(silverPath, JSON.stringify(structured,null,2));
  console.log('[reprocess] wrote', silverPath, 'goals:', structured.goals.length);
  structured.goals.slice(0,6).forEach(g=> console.log(' -', g.title));
}

const ids = process.argv.slice(2);
if(!ids.length){
  console.error('Usage: node scripts/reprocess.js <id1> <id2> ...');
  process.exit(1);
}
for(const id of ids){
  await reprocess(id);
}