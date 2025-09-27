import React from 'react';
import type { ExtractedReport } from '../../types';

export const GeographyTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">Geographic Areas</div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table" style={{fontSize:'.65rem'}}>
          <thead><tr><th>Area</th></tr></thead>
          <tbody>
            {report.geographicAreas.map(a => <tr key={a.id}><td>{a.area}</td></tr>)}
            {!report.geographicAreas.length && <tr><td style={{textAlign:'center', fontStyle:'italic'}}>No geographic areas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
