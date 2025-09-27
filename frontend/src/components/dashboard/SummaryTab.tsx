import React from 'react';
import type { ExtractedReport } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';

interface Props { report: ExtractedReport; }

export const SummaryTab: React.FC<Props> = ({ report }) => {
  const completed = report.summary.goalStatus?.completed ?? report.goals.filter(g=>g.status==='completed').length;
  const inProgress = report.summary.goalStatus?.inProgress ?? report.goals.filter(g=>g.status==='in_progress').length;
  const planned = report.summary.goalStatus?.planned ?? report.goals.filter(g=>g.status==='planned').length;
  return (
    <div style={{display:'flex', flexDirection:'column', gap:'0.75rem'}}>
      <div className="card" style={{padding:'0.7rem 0.85rem'}}>
        <div className="small-grid" style={{marginBottom:'0.35rem'}}>
          <div className="metric-box"><h4>Completion</h4><p>{Math.round(report.summary.completionRate*100)}%</p></div>
          <div className="metric-box"><h4>Goals</h4><p>{report.summary.totalGoals}</p></div>
          <div className="metric-box"><h4>BMPs</h4><p>{report.summary.totalBMPs}</p></div>
          <div className="metric-box"><h4>Activities</h4><p>{report.summary.totalActivities ?? report.implementation.length}</p></div>
          <div className="metric-box"><h4>Metrics</h4><p>{report.summary.totalMetrics ?? report.monitoring.length}</p></div>
        </div>
        <div className="progress-bar" style={{marginTop:'0.4rem'}}><span style={{'--value':`${Math.round(report.summary.completionRate*100)}%` } as any}></span></div>
        <div style={{display:'flex', gap:'0.75rem', marginTop:'0.5rem', fontSize:'11px', flexWrap:'wrap'}}>
          <span>Completed: {completed} ({Math.round((report.summary.goalStatus?.pctCompleted ?? (completed / Math.max(1, report.summary.totalGoals)))*100)}%)</span>
          <span>In Progress: {inProgress} ({Math.round((report.summary.goalStatus?.pctInProgress ?? (inProgress / Math.max(1, report.summary.totalGoals)))*100)}%)</span>
          <span>Planned: {planned} ({Math.round((report.summary.goalStatus?.pctPlanned ?? (planned / Math.max(1, report.summary.totalGoals)))*100)}%)</span>
          {report.summary.bmpCategories && <span style={{marginLeft:'auto'}}>BMP Categories: {Object.keys(report.summary.bmpCategories).length}</span>}
        </div>
      </div>
      <div className="card" style={{overflow:'hidden'}}>
        <div className="card-header">Recent Goals</div>
        <div style={{maxHeight:'180px', overflow:'auto'}}>
          <table className="table">
            <thead><tr><th>Title</th><th>Status</th></tr></thead>
            <tbody>
              {report.goals.slice(0,8).map(g => <tr key={g.id}><td>{g.title}</td><td><StatusBadge status={g.status.replace('_','-')} /></td></tr>)}
              {!report.goals.length && <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic'}}>No goals.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
