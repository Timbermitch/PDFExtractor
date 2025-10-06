import React, { useState, useMemo } from 'react';
import type { ExtractedReport, Goal } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';

function GoalRow({ g, index }: { g: Goal; index: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const details = [g.parameter, g.reductionPercent, g.targetValue, g.achievedValue, g.baselineValue, g.deadline, g.responsible];
  const hasMeta = details.some(v => v !== undefined && v !== null);
  const sentence = g.description || g.title;
  const words = sentence.split(/\s+/);
  const preview = words.length > 22 ? words.slice(0,22).join(' ') + ' …' : sentence;
  return (
    <>
      <tr>
        <td style={{whiteSpace:'nowrap'}}>Goal {index+1}</td>
        <td style={{fontSize:'0.62rem', lineHeight:1.15}}>
          <div style={{marginBottom:'.25rem'}}>{expanded ? sentence : preview}</div>
          {words.length > 22 && (
            <button
              type="button"
              onClick={()=>setExpanded(e=>!e)}
              style={{
                background:'none',
                border:'none',
                color:'#2563eb',
                cursor:'pointer',
                fontSize:'0.55rem',
                padding:0
              }}
              title={expanded ? 'Collapse' : 'Expand full sentence'}
            >{expanded ? 'Show less' : 'Show full'}</button>
          )}
        </td>
        <td><StatusBadge status={g.status.replace('_','-')} /></td>
      </tr>
      {hasMeta && (
        <tr className="subrow">
          <td colSpan={3} style={{fontSize:'0.65rem', lineHeight:1.25}}>
            <div style={{display:'flex', flexWrap:'wrap', gap:'.5rem'}}>
              {g.parameter && <span><strong>Parameter:</strong> {g.parameter}</span>}
              {g.reductionPercent!=null && <span><strong>Reduction:</strong> {g.reductionPercent}%</span>}
              {g.targetValue!=null && <span><strong>Target:</strong> {g.targetValue}{g.unit? ' '+g.unit: ''}</span>}
              {g.achievedValue!=null && <span><strong>Achieved:</strong> {g.achievedValue}{g.achievedUnit? ' '+g.achievedUnit: ''}{g.achievedYear? ` (${g.achievedYear})`:''}</span>}
              {g.baselineValue!=null && <span><strong>Baseline:</strong> {g.baselineValue}{g.baselineUnit? ' '+g.baselineUnit: ''}{g.baselineYear? ` (${g.baselineYear})`:''}</span>}
              {g.deadline && <span><strong>Deadline:</strong> {g.deadline}</span>}
              {g.responsible && <span><strong>Responsible:</strong> {g.responsible}</span>}
            </div>
            {g.source && <div style={{marginTop:'.35rem', opacity:.7}}><em>Source:</em> {g.source}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

export const GoalsTab: React.FC<{report: ExtractedReport}> = ({ report }) => {
  const [paramFilter, setParamFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]); // selected status values
  const [sortKey, setSortKey] = useState<'status' | 'title' | 'target'>('status');

  const parameterOptions = useMemo(() => {
    const set = new Set<string>();
    report.goals.forEach(g => { if (g.parameter) set.add(g.parameter); });
    return Array.from(set).sort();
  }, [report.goals]);

  // Determine a canonical goal: heuristic choose longest sentence (by word count) as representative
  const canonicalId = useMemo(() => {
    if (!report.goals.length) return null;
    let max = -1; let id: string | null = null;
    report.goals.forEach(g => {
      const len = (g.description || g.title).split(/\s+/).length;
      if (len > max) { max = len; id = g.id; }
    });
    return id;
  }, [report.goals]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { completed:0, in_progress:0, planned:0 };
    report.goals.forEach(g => { if (counts[g.status] != null) counts[g.status]++; });
    return counts;
  }, [report.goals]);

  function toggleStatus(s: string) {
    setStatusFilters(curr => curr.includes(s) ? curr.filter(x=>x!==s) : [...curr, s]);
  }

  const filtered = useMemo(() => {
    return report.goals.filter(g => {
      if (paramFilter && g.parameter !== paramFilter) return false;
      if (statusFilters.length && !statusFilters.includes(g.status)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [g.title, g.parameter||'', g.responsible||'', g.description||''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a,b) => {
      if (sortKey === 'title') return (a.title.localeCompare(b.title));
      if (sortKey === 'target') return ((b.targetValue||0) - (a.targetValue||0));
      // status ordering: completed -> in_progress -> planned
      const order: Record<string, number> = { completed:0, in_progress:1, planned:2 };
      const diff = order[a.status] - order[b.status];
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });
  }, [report.goals, paramFilter, statusFilters, search, sortKey]);

  return (
    <div className="card" style={{overflow:'hidden'}}>
      <div className="card-header" style={{display:'flex', flexWrap:'wrap', alignItems:'center', gap:'.4rem'}}>
        <span style={{flexGrow:1, fontWeight:600}}>Goals ({filtered.length}/{report.goals.length})</span>
        <div style={{display:'flex', gap:'.3rem'}}>
          {(['completed','in_progress','planned'] as const).map(s => {
            const active = statusFilters.includes(s);
            const labelMap: Record<string,string> = { completed:'Completed', in_progress:'In Progress', planned:'Planned' };
            return (
              <button
                key={s}
                type="button"
                onClick={()=>toggleStatus(s)}
                style={{
                  fontSize:'0.55rem',
                  padding:'2px 6px',
                  borderRadius:'12px',
                  border: active ? '1px solid #2563eb' : '1px solid #94a3b8',
                  background: active ? '#2563eb' : 'transparent',
                  color: active ? '#fff' : '#334155',
                  cursor:'pointer'
                }}
                title={`${labelMap[s]} (${statusCounts[s]} total)`}
              >{labelMap[s]} ({statusCounts[s]})</button>
            );
          })}
        </div>
        <select value={paramFilter} onChange={e=>setParamFilter(e.target.value)} style={{fontSize:'0.55rem'}}>
          <option value=''>Parameter: All</option>
          {parameterOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sortKey} onChange={e=>setSortKey(e.target.value as any)} style={{fontSize:'0.55rem'}}>
          <option value='status'>Sort: Status</option>
          <option value='title'>Sort: Title</option>
          <option value='target'>Sort: Target Value</option>
        </select>
        <input
          type="text"
          placeholder="Search goals"
          value={search}
          onChange={e=>setSearch(e.target.value)}
          style={{fontSize:'0.55rem', padding:'2px 4px', width:'150px'}}
        />
      </div>
      <div style={{maxHeight:'350px', overflow:'auto'}}>
        <table className="table">
          <thead><tr><th style={{width:'10%'}}>#</th><th style={{width:'70%'}}>Description</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((g,i) => (
              <React.Fragment key={g.id}>
                {canonicalId === g.id && (
                  <tr style={{background:'#f1f5f9'}}>
                    <td colSpan={3} style={{fontSize:'0.55rem', fontWeight:600, color:'#334155'}}>
                      Canonical longest goal below:
                    </td>
                  </tr>
                )}
                <GoalRow g={g} index={i} />
              </React.Fragment>
            ))}
            {!filtered.length && <tr><td colSpan={3} style={{textAlign:'center', fontStyle:'italic'}}>No goals.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
