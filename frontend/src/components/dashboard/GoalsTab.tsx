import React from 'react';
import type { ExtractedReport } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';

export const GoalsTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">All Goals</div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table">
          <thead><tr><th style={{width:'70%'}}>Title</th><th>Status</th></tr></thead>
          <tbody>
            {report.goals.map(g => <tr key={g.id}><td>{g.title}</td><td><StatusBadge status={g.status.replace('_','-')} /></td></tr>)}
            {!report.goals.length && <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic'}}>No goals.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
