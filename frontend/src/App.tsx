import React, { useState, useEffect } from 'react';
import { UploadArea } from './components/UploadArea';
import { ProcessControls } from './components/ProcessControls';
import { ReportDashboard } from './components/ReportDashboard';
import { ReportList } from './components/ReportList';
import { api } from './services/api';
import { AccuracyRequirements } from './components/AccuracyRequirements';
import { LoadingOverlay } from './components/ui/LoadingOverlay';
import type { ExtractedReport, ReportListItem } from './types';

function App() {
  const [bronze, setBronze] = useState<{ id: string; rawText: string } | null>(null);
  const [report, setReport] = useState<ExtractedReport | null>(null);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string|undefined>();
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(false);

  function handleClear() {
    setBronze(null);
    setReport(null);
    setSelectedId(undefined);
  }

  async function handleUpload(file: File) {
    setLoading(true);
    try {
      const res = await api.upload(file);
      setBronze(res);
    } finally { setLoading(false); }
  }

  async function handleProcess() {
    if (!bronze?.id) return;
    setLoading(true);
    try {
      const structured = await api.process(bronze.id);
      setReport(structured);
    } finally { setLoading(false); }
  }

  async function refreshReports() {
    const list = await api.listReports();
    setReports(list);
  }

  React.useEffect(() => { refreshReports(); }, [report]);

  async function handleSelectReport(id: string) {
    setSelectedId(id);
    const data = await api.export(id, 'json');
    if (data instanceof Blob) {
      console.error('Expected JSON but received Blob when selecting report');
      return;
    }
    setReport({ ...(data as ExtractedReport), id });
  }

  // manage body class for compact density
  useEffect(() => {
    if (compact) document.body.classList.add('compact'); else document.body.classList.remove('compact');
  }, [compact]);

  return (
    <div className="min-h-screen flex flex-col container" style={{paddingTop:'0.5rem'}}>
      <LoadingOverlay show={loading} />
      <main className="flex-1 layout" style={{marginTop:'0.25rem'}}>
        <div className="sidebar" style={{paddingTop:'.25rem'}}>
          <div className="card" style={{display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', padding:'1.1rem .9rem', minHeight:'170px'}}>
            <h1 className="heading" style={{margin:'0 0 0.75rem'}}>PDF Extraction Tool</h1>
            <div style={{flexGrow:1}} />
            <div style={{display:'flex', gap:'.5rem', flexWrap:'wrap', justifyContent:'center'}}>
              <button onClick={refreshReports} className="btn" style={{fontSize:'0.65rem'}}>Refresh</button>
              <button onClick={() => setCompact(c=>!c)} className="btn secondary" style={{fontSize:'0.65rem'}} title="Toggle compact mode">
                {compact ? 'Comfort' : 'Compact'}
              </button>
              <button onClick={handleClear} className="btn outline" style={{fontSize:'0.65rem'}} title="Clear current upload & selection">Clear</button>
            </div>
          </div>
          <UploadArea onFile={handleUpload} disabled={loading} />
          {bronze && !report && (
            <ProcessControls onProcess={handleProcess} rawText={bronze.rawText} disabled={loading} />
          )}
          <div style={{display:'flex', flexDirection:'column', gap:'.4rem'}}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 .25rem'}}>
              <div className="heading" style={{fontSize:'.75rem'}}>Reports</div>
              <button
                className="btn secondary"
                style={{fontSize:'.55rem', padding:'2px 6px'}}
                title="Delete ALL reports"
                onClick={async () => {
                  if (!window.confirm('Delete ALL reports? This cannot be undone.')) return;
                  if (!window.confirm('Are you absolutely sure?')) return;
                  try {
                    await api.deleteAllReports();
                    setReports([]);
                    setBronze(null);
                    setReport(null);
                    setSelectedId(undefined);
                  } catch (e) {
                    console.error('Bulk delete failed', e);
                  }
                }}
              >Del All</button>
            </div>
            <ReportList
              items={reports}
              selectedId={selectedId}
              onSelect={handleSelectReport}
              onExportCSV={(id) => api.downloadCSV(id)}
              onDelete={async (id) => {
                try {
                  await api.deleteReport(id);
                  // refresh list after deletion
                  const list = await api.listReports();
                  setReports(list);
                  if (selectedId === id) {
                    setReport(null);
                    setSelectedId(undefined);
                  }
                } catch (e) {
                  console.error('Delete failed', e);
                }
              }}
            />
            <AccuracyRequirements />
          </div>
        </div>
        <div className="content-stack">
          {!report && <div className="card" style={{fontSize:'.75rem'}}>Select or process a report to view the dashboard.</div>}
          {report && <ReportDashboard report={report} />}
        </div>
      </main>
      <footer style={{marginTop:'2rem', textAlign:'center'}} className="muted">{compact && 'Compact mode enabled'}</footer>
    </div>
  );
}

export default App;
