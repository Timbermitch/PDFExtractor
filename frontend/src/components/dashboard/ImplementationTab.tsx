import React from 'react';
import type { ExtractedReport } from '../../types';

export const ImplementationTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">Implementation Activities</div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table" style={{fontSize:'.65rem'}}>
          <thead><tr><th style={{width:'55%'}}>Description</th><th>Date</th><th>Target</th><th>Achieved</th></tr></thead>
          <tbody>
            {report.implementation.map(i => <tr key={i.id}><td>{i.description}</td><td>{i.date || '—'}</td><td>{i.target ?? '—'}</td><td>{i.achieved ?? '—'}</td></tr>)}
            {!report.implementation.length && <tr><td colSpan={4} style={{textAlign:'center', fontStyle:'italic'}}>No activities.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
