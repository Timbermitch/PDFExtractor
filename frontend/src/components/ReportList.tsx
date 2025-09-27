import React from 'react';
import type { ReportListItem } from '../types';

interface Props {
  items: ReportListItem[];
  onSelect: (id: string) => void;
  selectedId?: string;
  onExportCSV: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const ReportList: React.FC<Props> = ({ items, onSelect, selectedId, onExportCSV, onDelete }) => {
  return (
    <div className="card h-full flex flex-col" style={{padding:'0.6rem 0.65rem'}}>
      <ul className="list-clean" style={{maxHeight:'320px', overflowY:'auto'}}>
        {items.map(r => {
          const active = selectedId === r.id;
          return (
            <li key={r.id} className={`group ${active ? 'selected' : ''}`} style={active ? {borderColor:'#2563eb', background:'#e1effe'}:undefined}>
              <div className="flex items-center justify-between" style={{gap:'.5rem'}}>
                <button onClick={() => onSelect(r.id)} style={{fontFamily:'monospace', fontSize:'10px', letterSpacing:'-.25px', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {r.id}
                </button>
                <div style={{display:'flex', gap:'.35rem'}}>
                  <button onClick={() => onExportCSV(r.id)} className="btn" style={{fontSize:'9px', padding:'2px 6px'}}>CSV</button>
                  {onDelete && (
                    <button
                      onClick={() => { if (window.confirm('Delete this report?')) onDelete(r.id); }}
                      className="btn secondary"
                      style={{fontSize:'9px', padding:'2px 6px'}}
                      title="Delete report">
                      Del
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center" style={{gap:'.75rem', fontSize:'9px', color:'#5d6b7a'}}>
                <span>Goals {r.summary.totalGoals}</span>
                <span>BMPs {r.summary.totalBMPs}</span>
                <span style={{marginLeft:'auto', letterSpacing:'.05em', textTransform:'uppercase', color:'#94a3b8'}}>{new Date(r.generatedAt).toLocaleDateString()}</span>
              </div>
            </li>
          );
        })}
        {!items.length && <li className="text-[11px] text-slate-400">No reports yet.</li>}
      </ul>
    </div>
  );
};
