import React from 'react';
import type { ExtractedReport } from '../../types';

export const BMPTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  const categories = Object.entries(report.bmps.reduce<Record<string, number>>((acc,b)=>{acc[b.category]=(acc[b.category]||0)+1;return acc;},{}));
  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header">BMPs</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', padding:'0.75rem'}}>
        <div style={{maxHeight:'320px', overflow:'auto'}}>
          <table className="table" style={{fontSize:'.65rem'}}>
            <thead><tr><th style={{width:'65%'}}>Name</th><th>Category</th></tr></thead>
            <tbody>
              {report.bmps.map(b => <tr key={b.id}><td>{b.name}</td><td>{b.category}</td></tr>)}
              {!report.bmps.length && <tr><td colSpan={2} style={{textAlign:'center', fontStyle:'italic'}}>No BMPs.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{boxShadow:'none', background:'var(--panel-alt)'}}>
          <div className="card-header" style={{fontSize:'11px'}}>Category Counts</div>
          <table className="table" style={{fontSize:'.6rem'}}>
            <thead><tr><th>Category</th><th>Count</th></tr></thead>
            <tbody>{categories.map(([c,count]) => <tr key={c}><td>{c}</td><td>{count}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
