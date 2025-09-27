import React from 'react';
import type { ExtractedReport } from '../types';
import { Card } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';

interface Props { report: ExtractedReport; }

// Charts removed for simplified minimalist design.

export const ReportDashboard: React.FC<Props> = ({ report }) => {
  const completed = report.goals.filter(g=>g.status==='completed').length;
  const inProgress = report.goals.filter(g=>g.status==='in_progress').length;
  const planned = report.goals.filter(g=>g.status==='planned').length;
  const categories = Object.entries(report.bmps.reduce<Record<string, number>>((acc,b)=>{acc[b.category]=(acc[b.category]||0)+1;return acc;},{}));

  return (
  <div style={{display:'flex', flexDirection:'column', gap:'0.9rem'}}>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
        <h2 className="heading" style={{margin:0}}>Report</h2>
        {report.id && <span style={{fontFamily:'monospace', fontSize:'10px', background:'#e2e8f0', padding:'2px 6px', borderRadius:'4px'}}>{report.id}</span>}
        <span style={{marginLeft:'auto', fontSize:'10px', color:'#64748b'}}>{new Date(report.generatedAt).toLocaleString()}</span>
      </div>
      <div className="card" style={{padding:'0.7rem 0.85rem'}}>
        <div className="small-grid" style={{marginBottom:'0.35rem'}}>
          <div className="metric-box"><h4>Completion</h4><p>{Math.round(report.summary.completionRate*100)}%</p></div>
          <div className="metric-box"><h4>Goals</h4><p>{report.summary.totalGoals}</p></div>
            <div className="metric-box"><h4>BMPs</h4><p>{report.summary.totalBMPs}</p></div>
          <div className="metric-box"><h4>Breakdown</h4><p style={{fontSize:'.6rem'}}>{completed} / {inProgress} / {planned}</p></div>
        </div>
        <div className="progress-bar" style={{marginTop:'0.4rem'}}><span style={{'--value':`${Math.round(report.summary.completionRate*100)}%` } as any}></span></div>
      </div>
      <div style={{display:'grid', gap:'1rem', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))'}}>
        <Card title="Monitoring Metrics">
          <table className="table" style={{fontSize:'.65rem'}}>
            <thead>
              <tr>
                <th style={{width:'60%'}}>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {report.monitoring.map(m => (
                <tr key={m.id}>
                  <td>{m.metric}</td>
                  <td>{m.value ?? '—'}</td>
                </tr>
              ))}
              {!report.monitoring.length && (
                <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic', opacity:.6}}>No monitoring metrics.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Outreach Activities">
          <table className="table" style={{fontSize:'.65rem'}}>
            <thead>
              <tr>
                <th style={{width:'60%'}}>Activity</th>
                <th>Audience</th>
              </tr>
            </thead>
            <tbody>
              {report.outreach.map(o => (
                <tr key={o.id}>
                  <td>{o.activity}</td>
                  <td>{o.audience}</td>
                </tr>
              ))}
              {!report.outreach.length && (
                <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic', opacity:.6}}>No outreach activities.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="card" style={{overflow:'hidden'}}>
        <div className="card-header">Goals</div>
        <div style={{maxHeight:'220px', overflow:'auto'}}>
          <table className="table">
            <thead><tr><th>Title</th><th>Status</th></tr></thead>
            <tbody>
              {report.goals.map(g => <tr key={g.id}><td>{g.title}</td><td><StatusBadge status={g.status.replace('_','-')} /></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-header">BMP Categories</div>
        <table className="table">
          <thead><tr><th>Category</th><th>Count</th></tr></thead>
          <tbody>
            {categories.map(([c,count]) => <tr key={c}><td>{c}</td><td>{count}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};
