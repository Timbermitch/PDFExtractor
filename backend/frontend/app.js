console.log('[embedded-ui] boot');
const $ = s => document.querySelector(s);
const uploadForm = $('#uploadForm');
const fileInput = $('#pdfFile');
const uploadBtn = $('#uploadBtn');
const uploadMsg = $('#uploadMsg');
const processBtn = $('#processBtn');
const processId = $('#processId');
const processMsg = $('#processMsg');
const reportsHost = $('#reportsHost');
const refreshBtn = $('#refreshBtn');
const viewDetailBtn = $('#viewDetailBtn');
const detail = $('#detail');
const filterInput = document.querySelector('#filterInput');
const downloadBtn = document.querySelector('#downloadJsonBtn');
let selectedId = null;

fileInput?.addEventListener('change', () => {
  if(fileInput.files?.length){ uploadBtn.disabled=false; uploadMsg.textContent = `${fileInput.files[0].name} (${(fileInput.files[0].size/1024/1024).toFixed(2)} MB)`; }
  else { uploadBtn.disabled=true; uploadMsg.textContent=''; }
});

uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!fileInput.files?.length) return;
  uploadBtn.disabled=true; uploadBtn.textContent='Uploading...'; uploadMsg.textContent='';
  try {
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const res = await fetch('/upload',{ method:'POST', body: fd });
    if(!res.ok) throw new Error('Upload HTTP '+res.status);
    const json = await res.json();
    uploadMsg.innerHTML = `<span class=success>Uploaded: ${json.id}</span>`;
    processId.value = json.id; processBtn.disabled=false; selectedId=json.id; viewDetailBtn.disabled=false;
  } catch(err){
    uploadMsg.innerHTML = `<span class=error>${err.message}</span>`;
  } finally {
    uploadBtn.disabled=false; uploadBtn.textContent='Upload';
  }
});

processBtn?.addEventListener('click', async () => {
  const id = processId.value.trim(); if(!id){ processMsg.textContent='Enter an id'; return; }
  processBtn.disabled=true; processMsg.textContent='Processing...';
  try {
    const res = await fetch('/process',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    if(!res.ok) throw new Error('Process HTTP '+res.status);
    const json = await res.json();
    processMsg.innerHTML = `<span class=success>Processed ✓ (${json.id||id})</span>`; selectedId = json.id || id; viewDetailBtn.disabled=false; await loadReports();
  } catch(err){ processMsg.innerHTML = `<span class=error>${err.message}</span>`; }
  finally { processBtn.disabled=false; }
});

async function loadReports(){
  try {
    const r = await fetch('/reports');
    if(!r.ok) throw new Error('Reports HTTP '+r.status);
    const json = await r.json();
    let reports = json.reports || [];
    const f = (filterInput?.value||'').trim().toLowerCase();
    if(f) reports = reports.filter(rep => rep.id.toLowerCase().includes(f));
    if(!reports.length){ reportsHost.textContent='(none)'; return; }
    reportsHost.innerHTML = reports.map(rep => `<div class="rep" data-id="${rep.id}"><span class="pill">${rep.costSummary? 'COST':'-'}</span>${rep.id}</div>`).join('');
    reportsHost.querySelectorAll('.rep').forEach(div => div.addEventListener('click', () => { selectedId=div.dataset.id; processId.value=selectedId; viewDetailBtn.disabled=false; downloadBtn.disabled=false; document.querySelectorAll('.rep').forEach(r=>r.style.background=''); div.style.background='#243142'; }));
  } catch(err){ reportsHost.textContent='Error: '+err.message; }
}

refreshBtn?.addEventListener('click', loadReports);
filterInput?.addEventListener('input', loadReports);
viewDetailBtn?.addEventListener('click', loadDetail);
downloadBtn?.addEventListener('click', async () => {
  if(!selectedId) return;
  try {
    const r = await fetch('/report/'+encodeURIComponent(selectedId));
    if(!r.ok) throw new Error('Download HTTP '+r.status);
    const json = await r.json();
    const blob = new Blob([JSON.stringify(json,null,2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = selectedId + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  } catch(err){ alert(err.message); }
});

async function loadDetail(){
  if(!selectedId){ detail.textContent='No selection'; return; }
  detail.textContent='Loading detail...';
  try {
    const r = await fetch('/report/'+encodeURIComponent(selectedId));
    if(!r.ok) throw new Error('Detail HTTP '+r.status);
    const rep = await r.json();
    renderReport(rep);
  } catch(err){ detail.innerHTML = `<span class=error>${err.message}</span>`; }
}

function renderReport(rep){
  const summary = rep.summary || {};
  const goals = rep.goals || [];
  const bmps = rep.bmps || [];
  const costTables = rep.bmpCostTables || rep.costTables || [];
  const tabs = [
    { id:'summary', label:'Summary', render: ()=> summaryTab(summary, rep) },
    { id:'goals', label:`Goals (${goals.length})`, render: ()=> goalsTab(goals) },
    { id:'bmps', label:`BMPs (${bmps.length})`, render: ()=> bmpsTab(bmps) },
    { id:'cost', label:`Cost Tables (${costTables.length})`, render: ()=> costTab(costTables) },
    { id:'raw', label:'Raw JSON', render: ()=> rawTab(rep) }
  ];
  detail.innerHTML = `
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem;">${tabs.map(t=>`<button class="btn tab-btn" data-tab="${t.id}" style="background:#273445;">${t.label}</button>`).join('')}</div>
    <div id="tabHost" style="background:#10161d;border:1px solid #232c36;padding:.65rem;border-radius:6px;max-height:430px;overflow:auto;font-size:.6rem;line-height:1.35;"></div>`;
  const tabHost = document.querySelector('#tabHost');
  function select(id){
    const tab = tabs.find(t=>t.id===id) || tabs[0];
    tabHost.innerHTML = tab.render();
    document.querySelectorAll('.tab-btn').forEach(b=> b.style.outline='none');
    const btn = document.querySelector(`.tab-btn[data-tab="${tab.id}"]`); if(btn) btn.style.outline='2px solid #3d6ea4';
  }
  detail.querySelectorAll('.tab-btn').forEach(b=> b.addEventListener('click', ()=> select(b.dataset.tab)));
  select('summary');
}

function summaryTab(s, rep){
  const kpi = (k,v)=>`<div style="background:#1a2129;padding:.55rem .65rem;border:1px solid #2a3644;border-radius:6px;flex:1 1 130px;">
    <div style="font-size:.52rem;opacity:.6;text-transform:uppercase;letter-spacing:.08em;">${k}</div>
    <div style="font-size:.9rem;font-weight:600;margin-top:.15rem;">${v ?? '–'}</div>
  </div>`;
  const kpis = [
    kpi('Goals', s.totalGoals),
    kpi('BMPs', s.totalBMPs),
    kpi('Activities', s.totalActivities),
    kpi('Primary Goals', s.primaryGoals),
    kpi('Avg Goal Conf', s.avgGoalConfidence),
    kpi('Strong Goals', s.strongGoals)
  ];
  return `<div style="display:flex;flex-wrap:wrap;gap:.55rem;margin-bottom:.8rem;">${kpis.join('')}</div>`;
}

function goalsTab(goals){
  if(!goals.length) return '<em>No goals</em>';
  return `<table style="width:100%;border-collapse:collapse;font-size:.55rem;">`+
    `<thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Pollutant</th><th>Reduction%</th><th>Conf</th></tr></thead>`+
    `<tbody>${goals.slice(0,500).map(g=>`<tr>`+
      `<td>${g.id}</td>`+
      `<td>${escapeHtml(g.shortTitle||g.title||'')}</td>`+
      `<td>${g.status||''}</td>`+
      `<td>${g.pollutant||''}</td>`+
      `<td>${g.reductionPercent||''}</td>`+
      `<td>${g.confidence??''}</td>`+
    `</tr>`).join('')}</tbody></table>`;
}

function bmpsTab(bmps){
  if(!bmps.length) return '<em>No BMPs</em>';
  return `<table style="width:100%;border-collapse:collapse;font-size:.55rem;">`+
    `<thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Qty</th><th>Unit</th><th>TotalCost</th></tr></thead>`+
    `<tbody>${bmps.slice(0,800).map(b=>`<tr>`+
      `<td>${b.id}</td>`+
      `<td>${escapeHtml(b.name||'')}</td>`+
      `<td>${b.category||''}</td>`+
      `<td>${b.quantity??''}</td>`+
      `<td>${b.unit||''}</td>`+
      `<td>${b.totalCost??''}</td>`+
    `</tr>`).join('')}</tbody></table>`;
}

function costTab(costTables){
  if(!costTables.length) return '<em>No cost tables</em>';
  return costTables.map(ct => {
    const rows = (ct.table?.rows)||[]; const cols = ct.table?.columns || Object.keys(rows[0]||{});
    return `<div style="margin-bottom:1rem;">`+
      `<div style="font-weight:600;margin:.2rem 0 .4rem;">${escapeHtml(ct.title||ct.id||'Cost Table')}</div>`+
      `<table style="width:100%;border-collapse:collapse;font-size:.5rem;">`+
        `<thead><tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`+
        `<tbody>${rows.slice(0,300).map(r=>`<tr>${cols.map(c=>`<td>${escapeHtml(r[c]??'')}</td>`).join('')}</tr>`).join('')}</tbody>`+
      `</table>`+
    `</div>`;
  }).join('');
}

function rawTab(rep){
  return `<pre style="white-space:pre-wrap;font-size:.5rem;">${escapeHtml(JSON.stringify(rep,null,2))}</pre>`;
}

function escapeHtml(s){ return (s||'').toString().replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

// Initial load
loadReports();
console.log('[embedded-ui] ready');
