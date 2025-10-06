import React, { useState } from 'react';
import type { ReportListItem } from '../types';

interface Props {
  items: ReportListItem[];
  onSelect: (id: string) => void;
  selectedId?: string;
  onExportCSV: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const ReportList: React.FC<Props> = ({ items, onSelect, selectedId, onExportCSV, onDelete }) => {
  const [openPatternFor, setOpenPatternFor] = useState<string|null>(null);
  return (
    <div className="card h-full flex flex-col" style={{padding:'0.6rem 0.65rem'}}>
      <ul className="list-clean" style={{maxHeight:'320px', overflowY:'auto'}}>
        {items.map(r => {
          const active = selectedId === r.id;
          return (
            <li key={r.id} className={`group ${active ? 'selected' : ''}`} style={active ? {borderColor:'#2563eb', background:'#e1effe'}:undefined}>
              <div className="flex items-center justify-between" style={{gap:'.5rem'}}>
                <button onClick={() => onSelect(r.id)} style={{fontFamily:'monospace', fontSize:'10px', letterSpacing:'-.25px', overflow:'hidden', textOverflow:'ellipsis'}} title={r.displayName && r.displayName !== r.id ? r.id : undefined}>
                  {r.displayName || r.id}
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
                {r.costSummary && (
                  <span title={costTooltip(r.costSummary)} style={{fontWeight:500}}>
                    {renderCostBadge(r.costSummary)}
                  </span>
                )}
                {(() => { const patterns = (r as any).metadata?.costPatternsDetected || []; if(!patterns.length) return null; return (
                  <button
                    type="button"
                    onClick={(e)=>{ e.stopPropagation(); setOpenPatternFor(openPatternFor===r.id? null : r.id); }}
                    style={{background:'#f1f5f9', padding:'2px 4px', borderRadius:3, cursor:'pointer', border:'1px solid #e2e8f0'}}
                    title={patterns.map((p: any)=>`${p.id} (${p.confidence ?? 'n/a'})`).join('\n')}
                  >
                    {patterns.length} patt
                  </button>
                ); })()}
                <span style={{marginLeft:'auto', letterSpacing:'.05em', textTransform:'uppercase', color:'#94a3b8'}}>{new Date(r.generatedAt).toLocaleDateString()}</span>
              </div>
              {openPatternFor===r.id && (r as any).metadata?.costPatternsDetected?.length > 0 && (
                <div style={{marginTop:4, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:4, padding:'4px 6px'}}>
                  <div style={{fontSize:'9px', fontWeight:600, marginBottom:2}}>Patterns</div>
                  <ul style={{listStyle:'none', padding:0, margin:0, fontSize:'9px', maxHeight:90, overflowY:'auto'}}>
                    {(r as any).metadata.costPatternsDetected.map((p:any,i:number)=> (
                      <li key={i} style={{display:'flex', justifyContent:'space-between', gap:4}}>
                        <span style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{p.id}</span>
                        <span style={{color:'#64748b'}}>{p.confidence != null ? (p.confidence*100).toFixed(0)+'%' : '—'}</span>
                        <span style={{color:'#0f172a'}}>{compactMoney(p.totalReported || p.totalComputed)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        {!items.length && <li className="text-[11px] text-slate-400">No reports yet.</li>}
      </ul>
    </div>
  );
};

function costTooltip(cs: NonNullable<ReportListItem['costSummary']>) {
  return [
    `Tables: ${cs.tables}`,
    `Reported: ${fmtMoney(cs.totalReported)}`,
    `Computed: ${fmtMoney(cs.totalComputed)}`,
    `Δ: ${fmtMoney(cs.discrepancy)}`
  ].join('\n');
}

function fmtMoney(v?: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function compactMoney(v?: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v/1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function renderCostBadge(cs: NonNullable<ReportListItem['costSummary']>) {
  const primary = cs.totalReported || cs.totalComputed;
  if (!primary) return '—';
  const discrepancy = (cs.totalReported && cs.totalComputed) ? cs.totalReported - cs.totalComputed : 0;
  const hasDisc = Math.abs(discrepancy) > 1; // threshold $1
  return `${compactMoney(primary)}${hasDisc ? '*' : ''}`;
}
