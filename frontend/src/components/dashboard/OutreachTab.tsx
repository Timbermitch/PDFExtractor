import React from 'react';
import type { ExtractedReport } from '../../types';

export const OutreachTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">Outreach</div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table" style={{fontSize:'.65rem'}}>
          <thead><tr><th style={{width:'60%'}}>Activity</th><th>Audience</th></tr></thead>
          <tbody>
            {report.outreach.map(o => <tr key={o.id}><td>{o.activity}</td><td>{o.audience}</td></tr>)}
            {!report.outreach.length && <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic'}}>No outreach.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
