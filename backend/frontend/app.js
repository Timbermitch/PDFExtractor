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
    const reports = json.reports || [];
    if(!reports.length){ reportsHost.textContent='(none)'; return; }
    reportsHost.innerHTML = reports.map(rep => `<div class="rep" data-id="${rep.id}"><span class="pill">${rep.costSummary? 'COST':'-'}</span>${rep.id}</div>`).join('');
    reportsHost.querySelectorAll('.rep').forEach(div => div.addEventListener('click', () => { selectedId=div.dataset.id; processId.value=selectedId; viewDetailBtn.disabled=false; document.querySelectorAll('.rep').forEach(r=>r.style.background=''); div.style.background='#243142'; }));
  } catch(err){ reportsHost.textContent='Error: '+err.message; }
}

refreshBtn?.addEventListener('click', loadReports);
viewDetailBtn?.addEventListener('click', loadDetail);

async function loadDetail(){
  if(!selectedId){ detail.textContent='No selection'; return; }
  detail.textContent='Loading detail...';
  try {
    const r = await fetch('/report/'+encodeURIComponent(selectedId));
    if(!r.ok) throw new Error('Detail HTTP '+r.status);
    const json = await r.json();
    detail.innerHTML = `<div><strong>${selectedId}</strong></div><pre style="white-space:pre-wrap;font-size:.55rem;max-height:300px;overflow:auto;">${escapeHtml(JSON.stringify(json,null,2))}</pre>`;
  } catch(err){ detail.innerHTML = `<span class=error>${err.message}</span>`; }
}

function escapeHtml(s){ return s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

// Initial load
loadReports();
console.log('[embedded-ui] ready');
