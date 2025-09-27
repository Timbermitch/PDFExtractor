import React from 'react';

type Status = 'completed' | 'in-progress' | 'planned' | string;

const COLOR_MAP: Record<string, string> = {
  completed: 'border-emerald-300 text-emerald-700 bg-emerald-50',
  'in-progress': 'border-amber-300 text-amber-700 bg-amber-50',
  planned: 'border-slate-300 text-slate-700 bg-slate-50'
};

interface Props { status: Status; }

export const StatusBadge: React.FC<Props> = ({ status }) => {
  const key = status.toLowerCase();
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border';
  return <span className={`${base} ${COLOR_MAP[key] || 'bg-blue-100 text-blue-700 ring-blue-600/20'}`}>{status}</span>;
};
