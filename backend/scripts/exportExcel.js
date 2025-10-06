#!/usr/bin/env node
/**
 * Multi-sheet Excel export for a processed Silver report.
 * Usage:
 *   node backend/scripts/exportExcel.js <reportId> [outputPath]
 * Example:
 *   node backend/scripts/exportExcel.js dry-creek-9-key-element-plan-2017-8
 * Output default: backend/data/gold/<reportId>.xlsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [,, reportId, explicitOut] = process.argv;
  if (!reportId) {
    console.error('Usage: node backend/scripts/exportExcel.js <reportId> [outputPath]');
    process.exit(1);
  }
  const silverDirCandidates = [
    path.join(process.cwd(), 'backend', 'data', 'silver'),
    path.join(process.cwd(), 'data', 'silver'),
    path.join(__dirname, '..', 'data', 'silver')
  ];
  let reportPath = null;
  for (const dir of silverDirCandidates) {
    const p = path.join(dir, `${reportId}.json`);
    if (fs.existsSync(p)) { reportPath = p; break; }
  }
  if (!reportPath) {
    console.error('[exportExcel] Could not locate silver JSON for id:', reportId);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'pdf-extractor';
  workbook.created = new Date();

  function addSheet(name, header, rows) {
    const ws = workbook.addWorksheet(name);
    ws.addRow(header);
    header.forEach((_, idx) => { ws.getColumn(idx+1).width = Math.min(60, Math.max(12, header[idx].length + 2)); });
    rows.forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    return ws;
  }

  // Metadata sheet (provenance + quick stats)
  const metaRows = [];
  metaRows.push(['reportId', raw.id || reportId]);
  metaRows.push(['exportedAt', new Date().toISOString()]);
  if (raw.generatedAt) metaRows.push(['generatedAt', raw.generatedAt]);
  if (raw.metadata?.sourceFile) metaRows.push(['sourceFile', raw.metadata.sourceFile]);
  metaRows.push(['goals.count', (raw.goals||[]).length]);
  metaRows.push(['bmps.count', (raw.bmps||[]).length]);
  metaRows.push(['implementation.count', (raw.implementation||[]).length]);
  metaRows.push(['monitoring.count', (raw.monitoring||[]).length]);
  metaRows.push(['outreach.count', (raw.outreach||[]).length]);
  metaRows.push(['geographicAreas.count', (raw.geographicAreas||[]).length]);
  addSheet('Metadata', ['key','value'], metaRows);

  // Summary sheet
  const s = raw.summary;
  addSheet('Summary', ['metric','value'], [
    ['totalGoals', s.totalGoals],
    ['totalBMPs', s.totalBMPs],
    ['completionRate', s.completionRate],
    ['totalActivities', s.totalActivities],
    ['totalMetrics', s.totalMetrics],
    ['goals.completed', s.goalStatus.completed],
    ['goals.inProgress', s.goalStatus.inProgress],
    ['goals.planned', s.goalStatus.planned],
    ['goals.pctCompleted', s.goalStatus.pctCompleted],
    ['goals.pctInProgress', s.goalStatus.pctInProgress],
    ['goals.pctPlanned', s.goalStatus.pctPlanned],
    ...Object.entries(s.bmpCategories || {}).map(([k,v]) => [`bmpCategories.${k}`, v])
  ]);

  addSheet('Goals', ['id','title','status','targetValue','unit','source'],
    (raw.goals||[]).map(g => [g.id, g.title, g.status, g.targetValue ?? '', g.unit ?? '', g.source ?? ''])
  );

  addSheet('BMPs', ['id','name','category','keyword','source'],
    (raw.bmps||[]).map(b => [b.id, b.name, b.category, b.keyword ?? '', b.source ?? ''])
  );

  addSheet('Implementation', ['id','description','date','target','achieved','source'],
    (raw.implementation||[]).map(i => [i.id, i.description, i.date ?? '', i.target ?? '', i.achieved ?? '', i.source ?? ''])
  );

  addSheet('Monitoring', ['id','metric','value','unit','source'],
    (raw.monitoring||[]).map(m => [m.id, m.metric, m.value ?? '', m.unit ?? '', m.source ?? ''])
  );

  addSheet('Outreach', ['id','activity','audience','source'],
    (raw.outreach||[]).map(o => [o.id, o.activity, o.audience ?? '', o.source ?? ''])
  );

  addSheet('Geography', ['id','area','source'],
    (raw.geographicAreas||[]).map(g => [g.id, g.area, g.source ?? ''])
  );

  const outDir = explicitOut ? path.dirname(explicitOut) : path.join(process.cwd(), 'backend','data','gold');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = explicitOut ? explicitOut : path.join(outDir, `${reportId}.xlsx`);
  await workbook.xlsx.writeFile(outPath);
  console.log('[exportExcel] wrote', outPath);
}

main().catch(e => {
  console.error('[exportExcel] failed', e);
  process.exit(1);
});
