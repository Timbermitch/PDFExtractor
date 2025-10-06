import React, { useEffect, useState } from 'react';
import { API_BASE, ensureHttp, forceRedetect } from '../../services/api';

export const DebugBar: React.FC = () => {
  const [base, setBase] = useState<string>(API_BASE);
  const [status, setStatus] = useState<'pending'|'ok'|'fail'>('pending');
  const [latency, setLatency] = useState<number|undefined>();
  const [lastTs, setLastTs] = useState<number|undefined>();

  async function doPoll() {
    const start = performance.now();
    try {
      const r = await fetch(`${API_BASE}/health?_=${Date.now()}`, { cache:'no-store' });
      if (r.ok) {
        setStatus('ok');
        setLatency(Math.round(performance.now()-start));
      } else {
        setStatus('fail'); setLatency(undefined);
      }
    } catch { setStatus('fail'); setLatency(undefined); }
    setLastTs(Date.now());
  }
  useEffect(() => {
    let cancelled = false;
    let interval: any;
    async function init() {
      try {
        await ensureHttp();
        if (cancelled) return;
        // ensureHttp updates exported API_BASE reference
        setBase(API_BASE);
        doPoll();
        interval = setInterval(doPoll, 10000);
      } catch {
        /* swallow */
      }
    }
    init();
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, []);

  async function handleRedetect() {
    setStatus('pending');
    await forceRedetect();
    setBase(API_BASE);
    await doPoll();
  }

  const color = status === 'ok' ? '#16a34a' : status === 'fail' ? '#dc2626' : '#d97706';
  return (
    <div style={{position:'fixed', bottom:0, left:0, right:0, background:'#0f172a', color:'#f8fafc', fontSize:'10px', padding:'4px 8px', display:'flex', gap:'1rem', zIndex:9999, alignItems:'center'}}>
      <span style={{display:'flex', alignItems:'center', gap:4}}>
        <span style={{width:8, height:8, borderRadius:4, background:color, display:'inline-block'}} />
        {status === 'pending' ? 'health: probing' : status === 'ok' ? `health: ok${latency!==undefined?` ${latency}ms`:''}` : 'health: unreachable'}
      </span>
      <span>API_BASE: {base}</span>
      <span>ENV(REACT_APP_API_BASE): {process.env.REACT_APP_API_BASE || '(unset)'}</span>
      {lastTs && <span>last:{new Date(lastTs).toLocaleTimeString()}</span>}
      <button onClick={handleRedetect} style={{background:'#1e293b', border:'1px solid #334155', color:'#f1f5f9', fontSize:'0.55rem', padding:'2px 6px', cursor:'pointer'}}>Re-detect</button>
      <span>Mode: {process.env.NODE_ENV}</span>
    </div>
  );
};
