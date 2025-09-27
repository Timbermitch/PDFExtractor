import React from 'react';
import { Spinner } from './Spinner';

export const LoadingOverlay: React.FC<{ show: boolean; label?: string }> = ({ show, label = 'Working...' }) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-xl bg-white/90 border border-slate-200 shadow-lg">
        <Spinner size={32} />
        <p className="text-xs font-medium text-slate-600 tracking-wide">{label}</p>
      </div>
    </div>
  );
};
