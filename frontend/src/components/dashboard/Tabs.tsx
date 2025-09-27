import React from 'react';

interface TabDef { key: string; label: string; }
interface Props { tabs: TabDef[]; active: string; onChange: (k: string) => void; }

export const Tabs: React.FC<Props> = ({ tabs, active, onChange }) => {
  return (
    <div style={{display:'flex', gap:'0.4rem', borderBottom:'1px solid var(--border)', marginBottom:'0.75rem', flexWrap:'wrap'}}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding:'4px 10px',
            fontSize:'12px',
            border:'1px solid var(--border)',
            background: active===t.key ? 'var(--accent-soft)' : 'var(--panel)',
            color: active===t.key ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: active===t.key ? '2px solid var(--accent)' : '1px solid var(--border)',
            borderRadius:'4px 4px 0 0'
          }}
        >{t.label}</button>
      ))}
    </div>
  );
};
