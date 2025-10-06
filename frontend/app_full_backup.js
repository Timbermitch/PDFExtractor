// Backup of original (complex) app.js before minimal isolation test.
// Timestamp: 2025-10-03
// ---------------------------------------------
// Restored listing UI script (reports table + detail panel). Goals/BMPs appear only for selected report.
const el = sel => document.querySelector(sel);
const state = { raw: [], filtered: [], lastQuery: '', costFilter: 'all', sort: 'alpha', selectedId: null };

console.log('[boot] script start (backup file)');

function fmt(n){ return (n==null || isNaN(n)) ? '' : Number(n).toLocaleString(undefined,{maximumFractionDigits:0}); }
function setStatus(area, msg, cls=''){ const target = el(area); if(target) target.innerHTML = msg ? `<span class="${cls}">${msg}</span>` : ''; }

// ---- Upload UI enhancements / diagnostics ----
const fileInput = el('#pdfFile');
const uploadBtn = el('#uploadForm button[type=submit]');
if(uploadBtn){ uploadBtn.disabled = true; uploadBtn.style.opacity = '.6'; }
// Mark app initialized for watchdog
window.__APP_INITTED = true;
// Inline hook used by form onsubmit attribute as a redundancy if module listener not bound
window.__inlineUploadHook = (ev) => {
  console.log('[upload:inlineHook] invoked');
  // If our normal listener attached (flag), let it run and prevent native
  if(window.__UPLOAD_LISTENER_BOUND){
    ev.preventDefault();
    return false;
  }
  console.warn('[upload:inlineHook] primary listener missing, falling back to native form submit (iframe)');
  return true; // allow native submit to iframe
};
// If user clicks disabled button, open file dialog
if(uploadBtn){
  uploadBtn.addEventListener('click', (ev) => {
    if(uploadBtn.disabled){
      ev.preventDefault();
      if(fileInput){ fileInput.click(); }
    }
  });
}
if(fileInput){
  fileInput.addEventListener('change', () => {
    console.log('[upload] change event files=', fileInput.files);
    if(!fileInput.files.length){
      if(uploadBtn){ uploadBtn.disabled = true; uploadBtn.style.opacity='.6'; uploadBtn.textContent = 'Upload'; }
      setStatus('#uploadStatus','');
      return;
    }
    const f = fileInput.files[0];
    if(uploadBtn){ uploadBtn.disabled = false; uploadBtn.style.opacity='1'; uploadBtn.textContent = `Upload (${f.name.slice(0,32)})`; }
    setStatus('#uploadStatus', `${(f.size/1024/1024).toFixed(2)} MB selected`,'fade');
  });
}

async function fetchReports(){
  try {
    const t0 = performance.now();
    const res = await fetch('/reports');
    const json = await res.json();
    state.raw = json.reports || [];
    const dur = performance.now()-t0;
    el('#status').innerHTML = `<span class=fade>${state.raw.length} reports loaded in ${dur.toFixed(0)} ms</span>`;
    applyFilters();
  } catch(e){
    el('#status').innerHTML = `<span class=fade>Load error: ${e.message}</span>`;
  }
}

function applyFilters(){
  const q = state.lastQuery.trim().toLowerCase();
  const cf = state.costFilter;
  state.filtered = state.raw.filter(r => {
    const hasCost = !!r.costSummary;
    if(cf==='with' && !hasCost) return false;
    if(cf==='without' && hasCost) return false;
    if(!q) return true;
    const hay = [r.id, r.displayName, JSON.stringify(r.costSummary||''), JSON.stringify(r.summary||'')].join('\n').toLowerCase();
    return q.split(/\s+/).every(tok => hay.includes(tok));
  });
  sortNow();
  renderTable();
}

function sortNow(){
  const k = state.sort;
  const by = fn => state.filtered.sort((a,b)=> (fn(b)-fn(a)) );
  switch(k){
    case 'tables': by(r=>r.costSummary?.tables||0); break;
    case 'reported': by(r=>r.costSummary?.totalReported||0); break;
    case 'computed': by(r=>r.costSummary?.totalComputed||0); break;
    case 'discrepancy': by(r=>Math.abs(r.costSummary?.discrepancy)||0); break;
    case 'patternCount': by(r=>r.costSummary?.patternCount||0); break;
    default: state.filtered.sort((a,b)=> a.id.localeCompare(b.id));
  }
}

function highlight(text, q){
  if(!q) return text;
  const tokens = q.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  let out = text;
  tokens.forEach(tok => {
    const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig');
    out = out.replace(re, m => `<mark>${m}</mark>`);
  });
  return out;
}

function renderTable(){
  const host = el('#tableHost');
  if(!host) return;
  if(!state.filtered.length){ host.innerHTML = '<div class=empty>No reports match filters.</div>'; updateMeta(); return; }
  const q = state.lastQuery;
  let html = '<table><thead><tr><th>Report</th><th>Cost Summary</th><th>Patterns</th><th>Generated</th><th></th></tr></thead><tbody>';
  state.filtered.forEach(r => {
    const cost = r.costSummary;
    const costCell = cost ? `\n      <div class=flex style=\"display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;\">\n        <span class=\"pill cost-yes\">COST</span>\n        <span class=mono>${fmt(cost.totalComputed)||fmt(cost.totalReported)||''}</span>\n      </div>\n      <div class=small>Tables: ${cost.tables} ${cost.discrepancy?`<span class=pill>${fmt(cost.discrepancy)} Δ</span>`:''}</div>` : '<span class="pill cost-no">NONE</span>';
    const patterns = cost?.patternCount ? `<span class=badge>${cost.patternCount} patterns</span>` : '<span class=fade>-</span>';
    html += `<tr data-id="${r.id}" class="row">\n      <td><div class=mono style=\"white-space:nowrap;\">${highlight(r.id,q)}</div><div class=small fade>${highlight(r.displayName||'',q)}</div></td>\n      <td>${costCell}</td>\n      <td>${patterns}</td>\n      <td class=small>${r.generatedAt? new Date(r.generatedAt).toLocaleDateString():''}</td>\n      <td><button data-view="${r.id}" class="viewBtn" style="padding:.35rem .6rem;background:#303848;border:0;color:#fff;border-radius:4px;cursor:pointer;font-size:.6rem;">View</button></td>\n    </tr>`;
  });
  html += '</tbody></table>';
  host.innerHTML = html;
  host.querySelectorAll('button.viewBtn').forEach(btn => btn.addEventListener('click', () => loadDetail(btn.dataset.view)) );
  host.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('dblclick', ()=> loadDetail(tr.dataset.id)) );
  updateMeta();
}

function updateMeta(){
  const total = state.raw.length; const vis = state.filtered.length;
  const withCost = state.filtered.filter(r=>r.costSummary).length;
  el('#metaCounts')?.textContent = `${vis}/${total} shown • ${withCost} with cost tables`;
}

async function loadDetail(id){
  if(!id) return;
  state.selectedId = id;
  el('#detailId').textContent = id;
  setStatus('#detailContent', '<div class=small>Loading...</div>');
  try {
    const res = await fetch(`/report/${encodeURIComponent(id)}`);
    if(!res.ok){ throw new Error(`HTTP ${res.status}`); }
    const json = await res.json();
    renderDetail(json);
    el('#processId').value = id;
  } catch(e){
    setStatus('#detailContent', `<span class=fade>Error: ${e.message}</span>`);
  }
}

function renderDetail(json){
  // cost tables
  let costHtml = '';
  if(Array.isArray(json.bmpCostTablesNormalized)){
    costHtml = json.bmpCostTablesNormalized.map((t,i)=>{
      const rows = (t.rows||[]).slice(0,8).map(r=> `<tr><td>${r.name||r.Item||''}</td><td class=mono>${fmt(r.totalCost||r.Cost)}</td></tr>`).join('');
      return `<details ${i===0?'open':''}><summary>Cost Table ${i+1} (${(t.rows||[]).length} rows)</summary><table class=small><thead><tr><th>Name</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    }).join('');
  } else if (json.bmpCostTableNormalized) {
    const t = json.bmpCostTableNormalized;
    const rows = (t.rows||[]).slice(0,12).map(r=> `<tr><td>${r.name||r.Item||''}</td><td class=mono>${fmt(r.totalCost||r.Cost)}</td></tr>`).join('');
    costHtml = `<details open><summary>Cost Table (${(t.rows||[]).length} rows)</summary><table class=small><thead><tr><th>Name</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  } else {
    costHtml = '<div class=fade>No cost tables extracted.</div>';
  }
  // goals & bmps for selected report only
  const goals = json.goals || [];
  const bmps = json.bmps || json.BMPs || [];
  const goalsHtml = goals.length ? `<ul class=compact>${goals.slice(0,30).map(g=>`<li>${(g.title||g.name||g.goal||'').toString().slice(0,120) || '<span class=fade>Untitled</span>'}</li>`).join('')}</ul>` : '<div class=fade>No goals.</div>';
  const bmpsHtml = bmps.length ? `<ul class=compact>${bmps.slice(0,30).map(b=>`<li>${(b.name||b.title||'').toString().slice(0,120) || '<span class=fade>Untitled</span>'}</li>`).join('')}</ul>` : '<div class=fade>No BMPs.</div>';

  const meta = `<div class=small style="margin:.4rem 0 .6rem;">Goals: ${goals.length} • BMPs: ${bmps.length}</div>`;
  const rawBtn = `<button id="viewRawJson" style="margin-top:.6rem;padding:.4rem .6rem;background:#444;border:0;border-radius:4px;color:#fff;font-size:.6rem;cursor:pointer;">Raw JSON</button>`;
  el('#detailContent').innerHTML = meta + costHtml + `<div class=sectionLabel>Goals</div>` + goalsHtml + `<div class=sectionLabel>BMPs</div>` + bmpsHtml + rawBtn;
  el('#viewRawJson').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(json,null,2)], { type:'application/json'});
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if(!w){ alert('Popup blocked.'); }
  });
}

// Upload flow
const uploadForm = el('#uploadForm');
if(uploadForm){
  console.log('[instrument] uploadForm present, attaching submit listener');
  window.__UPLOAD_LISTENER_BOUND = true;
}
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  console.log('[upload] submit handler triggered at', new Date().toISOString());
  const dbg = el('#uploadStatus');
  if(dbg){ dbg.style.color = '#fff'; dbg.style.fontWeight='600'; }
  const file = el('#pdfFile').files[0];
  if(!file){
    setStatus('#uploadStatus','No file selected – choose a PDF.','fade');
    if(fileInput) fileInput.click();
    return;
  }
  setStatus('#uploadStatus','Uploading...');
  if(uploadBtn){ uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…'; }
  const fd = new FormData(); fd.append('file', file);
  try {
    console.time('upload');
    const res = await fetch('/upload', { method:'POST', body: fd });
    console.timeEnd('upload');
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${txt.slice(0,200)}`);
    }
    const json = await res.json();
    console.log('[upload] response', json);
    setStatus('#uploadStatus',`Uploaded: ${json.id}`);
    el('#processId').value = json.id;
    await fetchReports();
    loadDetail(json.id);
  } catch(e){
    console.error('Upload failed', e);
    setStatus('#uploadStatus', 'Error: '+e.message, 'fade');
  } finally {
    if(uploadBtn){
      uploadBtn.disabled = false;
      uploadBtn.textContent = file ? `Upload (${file.name.slice(0,32)})` : 'Upload';
    }
  }
});

// Process flow
el('#processBtn')?.addEventListener('click', async () => {
  const id = el('#processId').value.trim();
  if(!id){ setStatus('#processStatus','Enter an ID first','fade'); return; }
  setStatus('#processStatus','Processing...');
  try {
    const res = await fetch('/process', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    if(!res.ok){ throw new Error(`HTTP ${res.status}`); }
    const json = await res.json();
    setStatus('#processStatus', 'Processed ✓');
    await fetchReports();
    loadDetail(json.id||id);
  } catch(e){ setStatus('#processStatus', 'Error: '+e.message, 'fade'); }
});

// Filter events
el('#search')?.addEventListener('input', e => { state.lastQuery=e.target.value; applyFilters(); });
window.addEventListener('keydown', e=>{ if(e.key==='/' && document.activeElement!==el('#search')){ e.preventDefault(); el('#search').focus(); }});
el('#costFilter')?.addEventListener('change', e => { state.costFilter=e.target.value; applyFilters(); });
el('#sort')?.addEventListener('change', e => { state.sort=e.target.value; applyFilters(); });

fetchReports();

// Global diagnostics
if(!el('#uploadForm')){
  console.warn('[ui] #uploadForm not found in DOM at script execution time');
}
window.addEventListener('error', ev => {
  console.error('[global error]', ev.message, ev.error);
});
window.addEventListener('unhandledrejection', ev => {
  console.error('[unhandled rejection]', ev.reason);
});

console.log('%cPDF Extractor UI Loaded rev2 (backup)','background:#8a4fff;color:#fff;padding:2px 6px;border-radius:3px;');

// Watchdog: if after 1s no init flag, inject visible warning (helps if cached stale HTML without script loaded)
setTimeout(() => {
  if(!window.__APP_INITTED){
    const h = document.createElement('div');
    h.style.position='fixed'; h.style.top='0'; h.style.left='0'; h.style.right='0'; h.style.padding='8px'; h.style.background='#8a1f1f'; h.style.color='#fff'; h.style.fontSize='12px'; h.style.zIndex='9999';
    h.textContent='UI script failed to initialize (watchdog). Hard refresh (Ctrl+Shift+R).';
    document.body.appendChild(h);
    console.warn('[watchdog] app init flag missing');
  }
}, 1000);

// Iframe fallback listener: if native form submission occurs, capture JSON and update UI
const iframe = document.getElementById('uploadFrame');
if(iframe){
  iframe.addEventListener('load', () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if(!doc) return;
      const text = doc.body?.innerText || '';
      if(!text.trim()) return;
      console.log('[upload:iframe] raw response text', text.slice(0,500));
      const json = JSON.parse(text);
      setStatus('#uploadStatus', `Uploaded (iframe): ${json.id}`);
      el('#processId').value = json.id;
      fetchReports().then(()=> loadDetail(json.id));
    } catch(err){
      console.warn('[upload:iframe] parse issue', err);
    }
  });
}
