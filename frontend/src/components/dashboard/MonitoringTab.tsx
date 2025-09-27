import React from 'react';
import type { ExtractedReport } from '../../types';

export const MonitoringTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">Monitoring Metrics</div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table" style={{fontSize:'.65rem'}}>
          <thead><tr><th style={{width:'60%'}}>Metric</th><th>Value</th><th>Unit</th></tr></thead>
          <tbody>
            {report.monitoring.map(m => <tr key={m.id}><td>{m.metric}</td><td>{m.value ?? '—'}</td><td>{m.unit ?? '—'}</td></tr>)}
            {!report.monitoring.length && <tr><td colSpan={3} style={{textAlign:'center', fontStyle:'italic'}}>No metrics.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
