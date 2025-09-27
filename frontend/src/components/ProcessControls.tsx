import React from 'react';
import { Card } from './ui/Card';

interface Props {
  rawText: string;
  onProcess: () => void;
  disabled?: boolean;
}

export const ProcessControls: React.FC<Props> = ({ rawText, onProcess, disabled }) => {
  return (
    <Card title="Bronze Raw Text" actions={<button onClick={onProcess} disabled={disabled} className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">Process</button>}>
      <div className="relative">
        <div className="h-52 overflow-auto rounded border border-slate-200 bg-slate-50 font-mono text-[11px] leading-relaxed p-3 whitespace-pre-wrap">
          {rawText.slice(0, 8000) || <span className="text-slate-400">No text</span>}
        </div>
        <div className="absolute bottom-1 right-2 text-[10px] text-slate-400">Truncated preview</div>
      </div>
    </Card>
  );
};
