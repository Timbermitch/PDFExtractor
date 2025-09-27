import React, { useState } from 'react';
import type { ExtractedReport } from '../types';
import { Tabs } from './dashboard/Tabs';
import { SummaryTab } from './dashboard/SummaryTab';
import { GoalsTab } from './dashboard/GoalsTab';
import { BMPTab } from './dashboard/BMPTab';
import { ImplementationTab } from './dashboard/ImplementationTab';
import { MonitoringTab } from './dashboard/MonitoringTab';
import { OutreachTab } from './dashboard/OutreachTab';
import { GeographyTab } from './dashboard/GeographyTab';
import { ChartsTab } from './dashboard/ChartsTab';

interface Props { report: ExtractedReport; }

export const ReportDashboard: React.FC<Props> = ({ report }) => {
  const [active, setActive] = useState<string>('summary');
  const tabs = [
    { key: 'summary', label: 'Summary' },
    { key: 'goals', label: 'Goals' },
    { key: 'bmps', label: 'BMPs' },
    { key: 'implementation', label: 'Implementation' },
    { key: 'monitoring', label: 'Monitoring' },
    { key: 'outreach', label: 'Outreach' },
    { key: 'geography', label: 'Geography' },
    { key: 'charts', label: 'Charts' }
  ];

  return (
    <div style={{display:'flex', flexDirection:'column', gap:'0.9rem'}}>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
        <h2 className="heading" style={{margin:0}}>Report</h2>
        {report.id && <span style={{fontFamily:'monospace', fontSize:'10px', background:'#e2e8f0', padding:'2px 6px', borderRadius:'4px'}}>{report.id}</span>}
        <span style={{marginLeft:'auto', fontSize:'10px', color:'#64748b'}}>{new Date(report.generatedAt).toLocaleString()}</span>
      </div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === 'summary' && <SummaryTab report={report} />}
      {active === 'goals' && <GoalsTab report={report} />}
      {active === 'bmps' && <BMPTab report={report} />}
      {active === 'implementation' && <ImplementationTab report={report} />}
      {active === 'monitoring' && <MonitoringTab report={report} />}
      {active === 'outreach' && <OutreachTab report={report} />}
      {active === 'geography' && <GeographyTab report={report} />}
      {active === 'charts' && <ChartsTab report={report} />}
    </div>
  );
};
