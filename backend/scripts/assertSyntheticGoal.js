import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const id = 'synthetic-goal-demo';
function run(cmd){ execSync(cmd, { stdio:'inherit' }); }
try {
  run(`node backend/scripts/reprocess.js ${id}`);
  const silverPath = path.join(process.cwd(),'backend','data','silver',`${id}.json`);
  const raw = fs.readFileSync(silverPath,'utf8');
  const json = JSON.parse(raw);
  const goal = json.goals[0]?.title || '';
  const expectFrag = 'restore riparian habitat and reduce sediment loads';
  if(!goal.includes(expectFrag)){
    console.error('ASSERT FAIL: synthetic goal missing fragment');
    console.error('Got:', goal);
    process.exit(1);
  }
  if(!/35/.test(goal) || !/percent/.test(goal.toLowerCase())){
    console.error('ASSERT FAIL: expected 35 percent phrase');
    console.error('Got:', goal);
    process.exit(1);
  }
  console.log('ASSERT PASS: synthetic goal captured.');
} catch(e){
  console.error('Synthetic goal assertion failed', e.message);
  process.exit(1);
}
