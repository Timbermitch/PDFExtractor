import React, { useState, useMemo } from 'react';

import type { ExtractedReport } from '../../types';

interface BMPTabProps {
  report: ExtractedReport;
}

const BMPTab: React.FC<BMPTabProps> = ({ report }) => {
  // Calculate overall project totals
  const calculateProjectTotals = () => {
    if (!report.bmpCostTablesNormalized) return null;
    
    let totalProjectCost = 0;
    let totalLandownerMatch = 0;
    let totalPractices = 0;
    
    report.bmpCostTablesNormalized.forEach(table => {
      if (table.totalComputed) totalProjectCost += table.totalComputed;
      if (table.landownerMatchComputed) totalLandownerMatch += table.landownerMatchComputed;
      totalPractices += table.rows?.length || 0;
    });
    
    return { totalProjectCost, totalLandownerMatch, totalPractices };
  };

  const projectTotals = calculateProjectTotals();

  return (
    <div className="tab-content p-6">
      <h2 className="text-3xl font-bold text-gray-900 mb-8 border-b-4 border-blue-500 pb-3">
        BMPs / Budget / Implementation Plan - Cost & Allocation Analysis
      </h2>

      {/* Funding Source Allocation Summary (aggregated across all multi_funding_source_costs tables) */}
      {(() => {
        const fundingTables = (report.bmpCostTablesNormalized || []).filter(t => t.patternId === 'multi_funding_source_costs');
        if (fundingTables.length === 0) return null;

        // Sorting state for practice-level table
        type SortMode = 'default' | 'total' | 'nrcs' | 'producer';
        const [sortMode, setSortMode] = useState<SortMode>('default');

        // Aggregate sums across all such tables
        let producer = 0, nrcs = 0, other = 0, total = 0;
        fundingTables.forEach(t => {
          producer += t.producerComputed || 0;
            nrcs += t.nrcsComputed || 0;
            other += t.otherComputed || 0;
            total += t.totalComputed || t.totalReported || 0;
        });
        if (total === 0) total = producer + nrcs + other; // fallback if computed total missing
        if (total === 0) return null;

        const pct = (v: number) => (v / total * 100);
        const fmt = (v: number) => `$${v.toLocaleString()}`;

        return (
          <div className="mb-10">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
              <span className="bg-teal-100 text-teal-800 px-3 py-1 rounded-full text-sm font-medium mr-3">ALLOCATION</span>
              Funding Source Breakdown
            </h3>
            <div className="bg-white border-2 border-gray-300 shadow p-4 rounded">
              <div className="mb-4">
                <div className="flex justify-between text-sm font-medium text-gray-700 mb-1">
                  <span>Total Budget Captured</span>
                  <span className="font-bold text-gray-900">{fmt(total)}</span>
                </div>
                {/* Proportional bar */}
                <div className="w-full h-6 bg-gray-200 rounded overflow-hidden flex">
                  <div className="h-full bg-blue-600" style={{ width: pct(producer) + '%' }} title={`Producer ${pct(producer).toFixed(1)}%`} />
                  <div className="h-full bg-green-600" style={{ width: pct(nrcs) + '%' }} title={`NRCS ${pct(nrcs).toFixed(1)}%`} />
                  <div className="h-full bg-purple-600" style={{ width: pct(other) + '%' }} title={`EPA-MDEQ ${pct(other).toFixed(1)}%`} />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>Producer</span>
                  <span>NRCS</span>
                  <span>EPA-MDEQ / Other</span>
                </div>
              </div>
              <table className="w-full border-2 border-gray-300">
                <thead>
                  <tr className="bg-gradient-to-r from-teal-600 to-teal-700 text-white text-sm">
                    <th className="border-2 border-gray-300 px-3 py-2 text-left font-bold">Source</th>
                    <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">Amount</th>
                    <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">Share</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="hover:bg-gray-50">
                    <td className="border-2 border-gray-200 px-3 py-2 font-medium text-gray-700">Producer</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right font-semibold text-blue-700">{fmt(producer)}</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right text-gray-700">{pct(producer).toFixed(1)}%</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="border-2 border-gray-200 px-3 py-2 font-medium text-gray-700">NRCS</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right font-semibold text-green-700">{fmt(nrcs)}</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right text-gray-700">{pct(nrcs).toFixed(1)}%</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="border-2 border-gray-200 px-3 py-2 font-medium text-gray-700">EPA-MDEQ / Other</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right font-semibold text-purple-700">{fmt(other)}</td>
                    <td className="border-2 border-gray-200 px-3 py-2 text-right text-gray-700">{pct(other).toFixed(1)}%</td>
                  </tr>
                </tbody>
              </table>
              {fundingTables.length > 1 && (
                <p className="mt-2 text-xs text-gray-500 italic">Aggregated from {fundingTables.length} funding allocation tables.</p>
              )}
            </div>

            {/* Per-practice funding allocation details */}
            {(() => {
              // Combine and sort practice rows
              const unsorted = fundingTables.flatMap(t => t.rows || []);
              if (!unsorted.length) return null;
              const practiceRows = useMemo(() => {
                const rowsCopy = [...unsorted];
                switch(sortMode){
                  case 'total':
                    rowsCopy.sort((a,b)=>(b.totalCost||0)-(a.totalCost||0)); break;
                  case 'nrcs':
                    rowsCopy.sort((a,b)=>(b.nrcsContribution||0)-(a.nrcsContribution||0)); break;
                  case 'producer':
                    rowsCopy.sort((a,b)=>(b.producerContribution||0)-(a.producerContribution||0)); break;
                  case 'default':
                  default:
                    // keep original order (could group by table later)
                    break;
                }
                return rowsCopy;
              }, [unsorted, sortMode]);
              return (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold text-gray-800 flex items-center">
                      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium mr-2">DETAIL</span>
                      Practice-Level Funding Allocation
                    </h4>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500 mr-1">Sort:</span>
                      <button onClick={()=>setSortMode('default')} className={`px-2 py-1 rounded border text-xs ${sortMode==='default'?'bg-gray-800 text-white':'bg-white text-gray-700 hover:bg-gray-100'}`}>Original</button>
                      <button onClick={()=>setSortMode('total')} className={`px-2 py-1 rounded border text-xs ${sortMode==='total'?'bg-blue-700 text-white':'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}>Total $</button>
                      <button onClick={()=>setSortMode('nrcs')} className={`px-2 py-1 rounded border text-xs ${sortMode==='nrcs'?'bg-green-700 text-white':'bg-white text-green-700 border-green-300 hover:bg-green-50'}`}>NRCS $</button>
                      <button onClick={()=>setSortMode('producer')} className={`px-2 py-1 rounded border text-xs ${sortMode==='producer'?'bg-indigo-700 text-white':'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'}`}>Producer $</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-2 border-gray-300 bg-white shadow-sm">
                      <thead>
                        <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm">
                          <th className="border-2 border-gray-300 px-3 py-2 text-left font-bold">Practice</th>
                          <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">Total</th>
                          <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">Producer</th>
                          <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">NRCS</th>
                          <th className="border-2 border-gray-300 px-3 py-2 text-right font-bold">EPA-MDEQ</th>
                          <th className="border-2 border-gray-300 px-3 py-2 text-left font-bold">Share Bar</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm">
                        {practiceRows.map((r, i) => {
                          const total = r.totalCost || 0;
                          const p = r.producerContribution || 0;
                          const n = r.nrcsContribution || 0;
                          const o = r.otherContribution || 0;
                          const denom = total || (p+n+o);
                          const pct = (v:number)=> denom? (v/denom*100):0;
                          return (
                            <tr key={i} className={i % 2 === 0 ? 'bg-gray-25 hover:bg-gray-50' : 'bg-white hover:bg-gray-50'}>
                              <td className="border-2 border-gray-200 px-3 py-2 font-medium text-gray-800 max-w-xs truncate" title={r.name}>{r.name}</td>
                              <td className="border-2 border-gray-200 px-3 py-2 text-right font-semibold text-gray-900">{total? `$${total.toLocaleString()}`:'-'}</td>
                              <td className="border-2 border-gray-200 px-3 py-2 text-right text-blue-700">{p? `$${p.toLocaleString()}`:'-'}</td>
                              <td className="border-2 border-gray-200 px-3 py-2 text-right text-green-700">{n? `$${n.toLocaleString()}`:'-'}</td>
                              <td className="border-2 border-gray-200 px-3 py-2 text-right text-purple-700">{o? `$${o.toLocaleString()}`:'-'}</td>
                              <td className="border-2 border-gray-200 px-3 py-2">
                                <div className="h-4 w-full bg-gray-200 rounded overflow-hidden flex">
                                  <div className="h-full bg-blue-600" style={{ width: pct(p)+'%' }} title={`Producer ${pct(p).toFixed(1)}%`} />
                                  <div className="h-full bg-green-600" style={{ width: pct(n)+'%' }} title={`NRCS ${pct(n).toFixed(1)}%`} />
                                  <div className="h-full bg-purple-600" style={{ width: pct(o)+'%' }} title={`EPA-MDEQ ${pct(o).toFixed(1)}%`} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
      
      {/* Executive Summary Table */}
      {projectTotals && (
        <div className="mb-8">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium mr-3">SUMMARY</span>
            Project Financial Overview
          </h3>
          <table className="w-full border-2 border-gray-400 bg-white shadow-lg">
            <thead>
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <th className="border-2 border-gray-400 px-4 py-3 text-left font-bold">Metric</th>
                <th className="border-2 border-gray-400 px-4 py-3 text-right font-bold">Value</th>
                <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-blue-50">
                <td className="border-2 border-gray-300 px-4 py-3 font-semibold text-gray-700">Total Project Investment</td>
                <td className="border-2 border-gray-300 px-4 py-3 text-right text-2xl font-bold text-blue-600">
                  ${projectTotals.totalProjectCost.toLocaleString()}
                </td>
                <td className="border-2 border-gray-300 px-4 py-3 text-center">
                  <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">Complete</span>
                </td>
              </tr>
              <tr className="hover:bg-green-50">
                <td className="border-2 border-gray-300 px-4 py-3 font-semibold text-gray-700">Landowner Contribution</td>
                <td className="border-2 border-gray-300 px-4 py-3 text-right text-2xl font-bold text-green-600">
                  ${projectTotals.totalLandownerMatch.toLocaleString()}
                </td>
                <td className="border-2 border-gray-300 px-4 py-3 text-center">
                  <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">Required</span>
                </td>
              </tr>
              <tr className="hover:bg-purple-50">
                <td className="border-2 border-gray-300 px-4 py-3 font-semibold text-gray-700">Conservation Practices</td>
                <td className="border-2 border-gray-300 px-4 py-3 text-right text-2xl font-bold text-purple-600">
                  {projectTotals.totalPractices} practices
                </td>
                <td className="border-2 border-gray-300 px-4 py-3 text-center">
                  <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Active</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="report-section">
        {report.bmpCostTablesNormalized && report.bmpCostTablesNormalized.length > 0 ? (
          <>
            {report.bmpCostTablesNormalized.map((table, index) => (
              <div key={index} className="mb-8">
                {/* Section Header */}
                <div className="mb-4">
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2 flex items-center">
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium mr-3">
                      TABLE {index + 1}
                    </span>
                    {table.title || `Conservation Practices - Section ${index + 1}`}
                  </h3>
                  <div className="text-sm text-gray-600 mb-4">
                    <strong>{table.rows?.length || 0}</strong> conservation practices • 
                    Total Investment: <strong>${(table.totalComputed || 0).toLocaleString()}</strong>
                  </div>
                </div>

                {/* Main Detailed Cost Table */}
                {table.rows && table.rows.length > 0 && (
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full border-2 border-gray-400 bg-white shadow-lg">
                      <thead>
                        <tr className="bg-gradient-to-r from-green-600 to-green-700 text-white">
                          <th className="border-2 border-gray-400 px-4 py-3 text-left font-bold">Conservation Practice</th>
                          <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Unit</th>
                          <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Quantity</th>
                          <th className="border-2 border-gray-400 px-4 py-3 text-right font-bold">Unit Cost</th>
                          <th className="border-2 border-gray-400 px-4 py-3 text-right font-bold">Total Cost</th>
                          <th className="border-2 border-gray-400 px-4 py-3 text-right font-bold">Landowner Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className={`hover:bg-gray-50 ${rowIndex % 2 === 0 ? 'bg-gray-25' : 'bg-white'}`}>
                            <td className="border-2 border-gray-300 px-4 py-3 font-semibold text-gray-800">
                              {row.name || 'Conservation Practice'}
                            </td>
                            <td className="border-2 border-gray-300 px-4 py-3 text-center text-gray-700">
                              {row.unit || row.unitRaw || '-'}
                            </td>
                            <td className="border-2 border-gray-300 px-4 py-3 text-center font-medium text-gray-700">
                              {row.quantity ? row.quantity.toLocaleString() : '-'}
                            </td>
                            <td className="border-2 border-gray-300 px-4 py-3 text-right font-medium text-gray-700">
                              {row.unitCost ? `$${row.unitCost.toLocaleString()}` : '-'}
                            </td>
                            <td className="border-2 border-gray-300 px-4 py-3 text-right font-bold text-green-700 text-lg">
                              {row.totalCost ? `$${row.totalCost.toLocaleString()}` : '$0'}
                            </td>
                            <td className="border-2 border-gray-300 px-4 py-3 text-right font-medium text-orange-600">
                              {row.landownerMatch && row.landownerMatch > 0 ? `$${row.landownerMatch.toLocaleString()}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                
                {/* Financial Verification Table */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Totals Verification */}
                  <div>
                    <h4 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium mr-2">TOTALS</span>
                      Financial Verification
                    </h4>
                    <table className="w-full border-2 border-gray-400 bg-white shadow-md">
                      <thead>
                        <tr className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                          <th className="border-2 border-gray-400 px-3 py-2 text-left font-bold text-sm">Category</th>
                          <th className="border-2 border-gray-400 px-3 py-2 text-right font-bold text-sm">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.totalComputed && (
                          <tr className="hover:bg-blue-50">
                            <td className="border-2 border-gray-300 px-3 py-2 font-medium text-gray-700">Project Total (Computed)</td>
                            <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-blue-600">
                              ${table.totalComputed.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {table.totalReported && (
                          <tr className="hover:bg-green-50">
                            <td className="border-2 border-gray-300 px-3 py-2 font-medium text-gray-700">Project Total (Reported)</td>
                            <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-green-600">
                              ${table.totalReported.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {table.discrepancy && Math.abs(table.discrepancy) > 0.01 && (
                          <tr className="hover:bg-red-50 bg-red-25">
                            <td className="border-2 border-gray-300 px-3 py-2 font-bold text-red-700">⚠️ Discrepancy</td>
                            <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-red-600">
                              ${table.discrepancy.toLocaleString()}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Landowner Match Verification */}
                  {(table.landownerMatchComputed || table.landownerMatchReported) && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                        <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium mr-2">MATCH</span>
                        Landowner Contributions
                      </h4>
                      <table className="w-full border-2 border-gray-400 bg-white shadow-md">
                        <thead>
                          <tr className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                            <th className="border-2 border-gray-400 px-3 py-2 text-left font-bold text-sm">Category</th>
                            <th className="border-2 border-gray-400 px-3 py-2 text-right font-bold text-sm">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.landownerMatchComputed && (
                            <tr className="hover:bg-orange-50">
                              <td className="border-2 border-gray-300 px-3 py-2 font-medium text-gray-700">Match (Computed)</td>
                              <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-orange-600">
                                ${table.landownerMatchComputed.toLocaleString()}
                              </td>
                            </tr>
                          )}
                          {table.landownerMatchReported && (
                            <tr className="hover:bg-purple-50">
                              <td className="border-2 border-gray-300 px-3 py-2 font-medium text-gray-700">Match (Reported)</td>
                              <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-purple-600">
                                ${table.landownerMatchReported.toLocaleString()}
                              </td>
                            </tr>
                          )}
                          {table.matchDiscrepancy && Math.abs(table.matchDiscrepancy) > 0.01 && (
                            <tr className="hover:bg-red-50 bg-red-25">
                              <td className="border-2 border-gray-300 px-3 py-2 font-bold text-red-700">⚠️ Match Discrepancy</td>
                              <td className="border-2 border-gray-300 px-3 py-2 text-right font-bold text-red-600">
                                ${table.matchDiscrepancy.toLocaleString()}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (
          <p className="text-gray-500">No BMP cost tables found in this report.</p>
        )}
        
        {(() => {
          // Filter BMPs to only show those with data in Focus Area, Scale, or Confidence columns
          const filteredBmps = report.bmps?.filter(bmp => 
            // Has Focus Area (keyword) data
            (bmp.keyword && bmp.keyword.trim() !== '') ||
            // Has Scale data (both quantity and unit)
            (bmp.quantity && bmp.unit && bmp.unit.trim() !== '') ||
            // Has Confidence data
            (bmp.confidence && bmp.confidence > 0)
          ) || [];

          return filteredBmps.length > 0 ? (
            <div className="mt-12">
              <h3 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
                <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium mr-3">
                  ADDITIONAL
                </span>
                BMP Implementation Details
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Supporting conservation practices with detailed Focus Area, Scale, or Confidence data ({filteredBmps.length} practices)
              </p>
              
              <div className="overflow-x-auto">
                <table className="w-full border-2 border-gray-400 bg-white shadow-lg">
                  <thead>
                    <tr className="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
                      <th className="border-2 border-gray-400 px-4 py-3 text-left font-bold">Practice Name</th>
                      <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Category</th>
                      <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Focus Area</th>
                      <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Scale</th>
                      <th className="border-2 border-gray-400 px-4 py-3 text-center font-bold">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBmps.map((bmp, index) => (
                      <tr key={index} className={`hover:bg-purple-50 ${index % 2 === 0 ? 'bg-gray-25' : 'bg-white'}`}>
                        <td className="border-2 border-gray-300 px-4 py-3 font-semibold text-gray-800">
                          {bmp.name}
                        </td>
                        <td className="border-2 border-gray-300 px-4 py-3 text-center">
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                            {bmp.category}
                          </span>
                        </td>
                        <td className="border-2 border-gray-300 px-4 py-3 text-center text-gray-700">
                          {bmp.keyword && bmp.keyword.trim() !== '' ? (
                            <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">
                              {bmp.keyword}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="border-2 border-gray-300 px-4 py-3 text-center font-medium text-gray-700">
                          {bmp.quantity && bmp.unit && bmp.unit.trim() !== '' ? (
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                              {bmp.quantity} {bmp.unit}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="border-2 border-gray-300 px-4 py-3 text-center">
                          {bmp.confidence && bmp.confidence > 0 ? (
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                              bmp.confidence >= 0.8 ? 'bg-green-100 text-green-800' :
                              bmp.confidence >= 0.6 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {(bmp.confidence * 100).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );
};

export default BMPTab;