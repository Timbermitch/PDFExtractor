#!/usr/bin/env node
// Audit all silver JSON reports for coverage & anomalies.
import fs from 'fs';
import path from 'path';

const SILVER_DIR = path.join(process.cwd(),'backend','data','silver');

function loadJson(fp){
  try { return JSON.parse(fs.readFileSync(fp,'utf-8')); } catch(e){ return { __error: e.message }; }
}

function analyzeReport(r){
  const goals = Array.isArray(r.goals)? r.goals:[];
  const bmps = Array.isArray(r.bmps)? r.bmps:[];
  const title = r.id || r.metadata?.sourceId || 'unknown';
  // Suspicious titles heuristics: repeated words, extremely short, contains raw underscores leftover, or encoding issues
  const suspiciousTitleReasons = [];
  if(/__/.test(title)) suspiciousTitleReasons.push('double_underscore');
  if(title.split(/[-_]/).length < 3) suspiciousTitleReasons.push('too_short_tokens');
  if(/elelment/.test(title)) suspiciousTitleReasons.push('typo:element');
  if(/watersehd/.test(title)) suspiciousTitleReasons.push('typo:watershed');
  // Goal/BMP content anomalies: very long single token or numeric-looking name
  const badGoalSamples = goals.filter(g=> g.title && g.title.split(/\s+/).length < 3).slice(0,3).map(g=>g.title);
  const badBmpSamples = bmps.filter(b=> b.name && b.name.split(/\s+/).length < 2).slice(0,3).map(b=>b.name);
  const zeroGoals = goals.length===0;
  const zeroBMPs = bmps.length===0;
  return {
    id: title,
    goals: goals.length,
    bmps: bmps.length,
    zeroGoals,
    zeroBMPs,
    suspiciousTitle: suspiciousTitleReasons.length? suspiciousTitleReasons: null,
    badGoalSamples: badGoalSamples.length? badGoalSamples : null,
    badBmpSamples: badBmpSamples.length? badBmpSamples : null
  };
}

async function main(){
  if(!fs.existsSync(SILVER_DIR)){
    console.error('Silver directory missing:', SILVER_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  const rows = files.map(f=> ({ file:f, data: loadJson(path.join(SILVER_DIR,f)) }));
  const analyzed = rows.map(r=> analyzeReport(r.data));
  const zeros = analyzed.filter(a=> a.zeroGoals || a.zeroBMPs);
  const badTitles = analyzed.filter(a=> a.suspiciousTitle);
  // Aggregate metrics
  const totalGoals = analyzed.reduce((a,c)=>a+c.goals,0);
  const totalBMPs = analyzed.reduce((a,c)=>a+c.bmps,0);
  const avgGoals = (totalGoals / analyzed.length).toFixed(1);
  const avgBMPs = (totalBMPs / analyzed.length).toFixed(1);

  console.log('=== Silver Coverage Audit ===');
  console.log('Reports:', analyzed.length);
  console.log('Total Goals:', totalGoals, 'Avg/Report:', avgGoals);
  console.log('Total BMPs:', totalBMPs, 'Avg/Report:', avgBMPs);
  console.log('Zero goal reports:', zeros.filter(z=>z.zeroGoals).length);
  console.log('Zero BMP reports:', zeros.filter(z=>z.zeroBMPs).length);
  if(zeros.length){
    console.log('\n-- Zero Coverage Details (first 10) --');
    zeros.slice(0,10).forEach(z=> console.log(`${z.id} | goals=${z.goals} bmps=${z.bmps}`));
  }
  if(badTitles.length){
    console.log('\n-- Suspicious Titles (first 10) --');
    badTitles.slice(0,10).forEach(t=> console.log(`${t.id} -> ${t.suspiciousTitle.join(',')}`));
  }
  const out = { generatedAt: new Date().toISOString(), analyzed, summary:{ total: analyzed.length, totalGoals, totalBMPs, avgGoals: Number(avgGoals), avgBMPs: Number(avgBMPs), zeroGoal: zeros.filter(z=>z.zeroGoals).length, zeroBMP: zeros.filter(z=>z.zeroBMPs).length } };
  const outPath = path.join(process.cwd(),'backend','data','silver_audit_coverage.json');
  fs.writeFileSync(outPath, JSON.stringify(out,null,2));
  console.log('\nAudit JSON:', outPath);
}

main().catch(e=>{ console.error('Audit failed', e); process.exit(1); });
