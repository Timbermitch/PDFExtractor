import React from 'react';
import type { ExtractedReport } from '../../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

interface Props { report: ExtractedReport }

const COLORS = ['#2563eb','#16a34a','#f59e0b','#dc2626','#0891b2','#7c3aed'];

function makeGoalStatus(report: ExtractedReport) {
  const completed = report.goals.filter(g=>g.status==='completed').length;
  const inProg = report.goals.filter(g=>g.status==='in_progress').length;
  const planned = report.goals.filter(g=>g.status==='planned').length;
  return [
    { name:'Completed', value: completed, color:'#16a34a' },
    { name:'In Progress', value: inProg, color:'#2563eb' },
    { name:'Planned', value: planned, color:'#94a3b8' }
  ].filter(d=>d.value>0);
}

function makeBMPCats(report: ExtractedReport) {
  const counts: Record<string, number> = {};
  report.bmps.forEach(b=>{counts[b.category]=(counts[b.category]||0)+1;});
  return Object.entries(counts).map(([k,v],i)=>({name:k, value:v, color:COLORS[i%COLORS.length]}));
}

function makeImplementationBars(report: ExtractedReport) {
  return report.implementation
    .filter(i=> (i.target!=null || i.achieved!=null))
    .slice(0,15)
    .map(i=>({
      name: (i.description.length>28? i.description.slice(0,25)+'…': i.description) || i.id,
      target: i.target ?? 0,
      achieved: i.achieved ?? 0
    }));
}

function makeMetricBars(report: ExtractedReport) {
  return report.monitoring
    .filter(m=> m.value!=null)
    .slice(0,15)
    .map(m=>({
      name: (m.metric.length>28? m.metric.slice(0,25)+'…': m.metric) || m.id,
      value: m.value || 0
    }));
}

export const ChartsTab: React.FC<Props> = ({ report }) => {
  const goalData = makeGoalStatus(report);
  const bmpData = makeBMPCats(report);
  const implBars = makeImplementationBars(report);
  const metricBars = makeMetricBars(report);

  const empty = !goalData.length && !bmpData.length && !implBars.length && !metricBars.length;

  if (empty) {
    return <div className="card" style={{padding:'1rem'}}><h4 style={{marginTop:0}}>Charts</h4><p style={{fontSize:'12px', opacity:.65}}>Not enough data yet to render charts.</p></div>;
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:'1rem'}}>
      <div className="card" style={{padding:'0.75rem'}}>
        <h4 style={{margin:'0 0 .5rem'}}>Implementation Target vs Achieved</h4>
        {implBars.length ? (
          <div style={{width:'100%', height:300}}>
            <ResponsiveContainer>
              <BarChart data={implBars} margin={{top:10,right:20,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis tick={{fontSize:10}} />
                <Tooltip wrapperStyle={{fontSize:12}} />
                <Legend wrapperStyle={{fontSize:11}} />
                <Bar dataKey="target" name="Target" fill="#2563eb" radius={[3,3,0,0]} />
                <Bar dataKey="achieved" name="Achieved" fill="#16a34a" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p style={{fontSize:'12px', opacity:.6}}>No target/achieved data.</p> }
      </div>
      <div style={{display:'grid', gap:'1rem', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))'}}>
        <div className="card" style={{padding:'0.75rem'}}>
          <h4 style={{margin:'0 0 .5rem'}}>Goal Status Distribution</h4>
          {goalData.length ? (
            <div style={{width:'100%', height:260}}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={goalData} dataKey="value" nameKey="name" outerRadius={80} innerRadius={45} paddingAngle={3}>
                    {goalData.map(e => (<Cell key={e.name} fill={e.color} />))}
                  </Pie>
                  <Tooltip wrapperStyle={{fontSize:12}} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p style={{fontSize:'12px', opacity:.6}}>No goal data.</p> }
        </div>
        <div className="card" style={{padding:'0.75rem'}}>
          <h4 style={{margin:'0 0 .5rem'}}>BMP Category Distribution</h4>
          {bmpData.length ? (
            <div style={{width:'100%', height:260}}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bmpData} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40}>
                    {bmpData.map(d=>(<Cell key={d.name} fill={d.color} />))}
                  </Pie>
                  <Tooltip wrapperStyle={{fontSize:12}} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p style={{fontSize:'12px', opacity:.6}}>No BMP data.</p> }
        </div>
        <div className="card" style={{padding:'0.75rem'}}>
          <h4 style={{margin:'0 0 .5rem'}}>Monitoring Metrics</h4>
          {metricBars.length ? (
            <div style={{width:'100%', height:260}}>
              <ResponsiveContainer>
                <BarChart data={metricBars} margin={{top:10,right:10,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{fontSize:10}} />
                  <Tooltip wrapperStyle={{fontSize:12}} />
                  <Bar dataKey="value" name="Value" fill="#0891b2" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p style={{fontSize:'12px', opacity:.6}}>No numeric monitoring metrics.</p> }
        </div>
      </div>
    </div>
  );
};
