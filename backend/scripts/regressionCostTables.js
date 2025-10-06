#!/usr/bin/env node
/**
 * Simple regression assertions for cost table parsing.
 * No test framework dependency; exits non-zero on failure.
 */
import fs from 'fs';
import path from 'path';

const silverDir = path.join(process.cwd(),'data','silver');

function load(id){
  const p = path.join(silverDir, id + '.json');
  if(!fs.existsSync(p)) throw new Error('Missing silver report '+id);
  return JSON.parse(fs.readFileSync(p,'utf8'));
}

function fail(msg){
  console.error('\n[FAIL] '+msg); 
  process.exitCode = 1;
}
function pass(msg){
  console.log('[PASS] '+msg);
}

function approxEqual(a,b,tol=2){
  if(a==null || b==null) return false;
  return Math.abs(a-b) <= tol;
}

// --- Ellison Creek assertions -------------------------------------------------
function testEllison(){
  const ellisonId = fs.readdirSync(silverDir).find(f=>/^ellison-creek-9-key-element-plan-2021.*\.json$/.test(f))?.replace(/\.json$/,'');
  if(!ellisonId){ console.warn('[SKIP] Ellison Creek silver not found.'); return; }
  const r = load(ellisonId);
  if(!Array.isArray(r.bmpCostTablesNormalized) || !r.bmpCostTablesNormalized.length){ fail('Ellison: missing bmpCostTablesNormalized'); return; }
  const full = r.bmpCostTablesNormalized.find(t=>t.id==='full_project_implementation') || r.bmpCostTablesNormalized[0];
  const phase1 = r.bmpCostTablesNormalized.find(t=>/phase1/.test(t.id||''));
  if(!full) fail('Ellison: full project table not found'); else pass('Ellison: full project table present');
  if(!phase1) console.warn('[WARN] Ellison: phase1 table not found');
  const expectedFullBMPs = [
    'Grade Stabilization Structure','Sediment Basin','Grassed Waterway','Heavy Use Area Protection','Stream Crossing','Tank/Trough','Cover Crops','Fencing','Dikes','Diversions','Pond','Terraces','Forage and Biomass Planting','Streambank and Shoreline Protection','Coordination, Plan Revision'
  ];
  const names = new Set(r.bmps.map(b=>b.name));
  expectedFullBMPs.forEach(n=>{ if(!names.has(n)) fail('Ellison: expected BMP missing '+n); });
  if(full.totalReported!=null && full.totalComputed!=null){
    if(!approxEqual(full.totalReported, full.totalComputed, 5000)){ // loose tolerance due to potential multi-row roll ups
      fail(`Ellison: total mismatch reported=${full.totalReported} computed=${full.totalComputed}`);
    } else {
      pass('Ellison: totals within tolerance');
    }
  }
}

// --- Dry Creek assertions -----------------------------------------------------
function testDryCreek(){
  const dry = 'dry-creek-9-key-element-plan-2017-13';
  if(!fs.existsSync(path.join(silverDir,dry+'.json'))){ console.warn('[SKIP] Dry Creek silver not found'); return; }
  const r = load(dry);
  const activityTable = r.bmpCostTablesNormalized?.find(t=>t.landownerMatchReported!=null || (Array.isArray(t.rows) && t.rows.some(row=>row.landownerMatch!=null)));
  if(!activityTable){ fail('Dry Creek: activity/match table not detected'); return; }
  pass('Dry Creek: activity/match table present');
  const actNames = new Set(r.bmps.map(b=>b.name));
  ['Fencing','Water Facilities','Heavy Use Areas','Stream Crossings','Ponds','Sediment Basins','Nutrient Management','Critical Area Planting','Establishment of Permanent Vegetation','Forage and Biomass Planting'].forEach(n=>{
    if(!actNames.has(n)) fail('Dry Creek: expected activity BMP missing '+n);
  });
  if(activityTable.totalReported!=null && activityTable.totalComputed!=null){
    if(!approxEqual(activityTable.totalReported, activityTable.totalComputed, 50)) fail(`Dry Creek: estimated cost total mismatch reported=${activityTable.totalReported} computed=${activityTable.totalComputed}`);
    else pass('Dry Creek: estimated cost totals within tolerance');
  }
  if(activityTable.landownerMatchReported!=null && activityTable.landownerMatchComputed!=null){
    if(!approxEqual(activityTable.landownerMatchReported, activityTable.landownerMatchComputed, 50)) fail(`Dry Creek: match total mismatch reported=${activityTable.landownerMatchReported} computed=${activityTable.landownerMatchComputed}`);
    else pass('Dry Creek: landowner match totals within tolerance');
  }
  // Sanity: each row with landownerMatch should parse numeric
  const badRows = (activityTable.rows||[]).filter(r=>r['Landowner Match'] && !/\$[0-9]/.test(r['Landowner Match']));
  if(badRows.length) fail('Dry Creek: rows with non-monetary match values: '+badRows.map(r=>r.Activity||r.BMP).join(', '));
  // Normalized rows numeric check
  const norm = r.bmpCostTablesNormalized.find(t=>t.id===activityTable.id);
  if(norm){
    const nullCosts = norm.rows.filter(rr=>rr.landownerMatch==null && /Fencing|Water Facilities|Heavy Use Areas|Stream Crossings|Ponds|Sediment Basins|Nutrient Management/.test(rr.name));
    if(nullCosts.length) fail('Dry Creek: expected landownerMatch numeric for rows: '+nullCosts.map(r=>r.name).join(', '));
  }
}

// --- Steele Bayou assertions -------------------------------------------------
function testSteeleBayou(){
  const steeleId = fs.readdirSync(silverDir).find(f=>/^steele-bayou-watershed-plan-2009.*\.json$/.test(f))?.replace(/\.json$/,'');
  if(!steeleId){ console.warn('[SKIP] Steele Bayou silver not found.'); return; }
  const r = load(steeleId);
  if(!Array.isArray(r.bmpCostTablesNormalized) || !r.bmpCostTablesNormalized.length){ fail('Steele Bayou: missing bmpCostTablesNormalized'); return; }
  const practiceTable = r.bmpCostTablesNormalized.find(t=>t.id?.includes('practice_costs') || /Agricultural.*BMP/i.test(t.title||'')) || r.bmpCostTablesNormalized[0];
  if(!practiceTable) fail('Steele Bayou: practice costs table not found'); else pass('Steele Bayou: practice costs table present');
  const expectedPractices = [
    'Water Control Structures','Large Overfall Pipes','Water Diversion Pads (feet)','Bank Stabilization','Rip-Rap Weirs'
  ];
  const names = new Set(r.bmps.map(b=>b.name));
  expectedPractices.forEach(n=>{ if(!names.has(n)) fail('Steele Bayou: expected practice missing '+n); });
  if(practiceTable.totalReported!=null && practiceTable.totalComputed!=null){
    if(!approxEqual(practiceTable.totalReported, practiceTable.totalComputed, 1000)){
      fail(`Steele Bayou: total mismatch reported=${practiceTable.totalReported} computed=${practiceTable.totalComputed}`);
    } else {
      pass('Steele Bayou: totals within tolerance');
    }
  }
  if(practiceTable.rows.length >= 5) pass('Steele Bayou: found expected number of practices (5+)');
  else fail(`Steele Bayou: expected 5+ practices, found ${practiceTable.rows.length}`);
}

function main(){
  console.log('Running cost table regression checks...');
  try { testEllison(); } catch(e){ fail('Ellison test crashed: '+e.message); }
  try { testDryCreek(); } catch(e){ fail('Dry Creek test crashed: '+e.message); }
  try { testSteeleBayou(); } catch(e){ fail('Steele Bayou test crashed: '+e.message); }
  if(process.exitCode){
    console.error('\nOne or more regression checks FAILED');
    process.exit(process.exitCode);
  } else {
    console.log('\nAll regression checks passed');
  }
}

main();
