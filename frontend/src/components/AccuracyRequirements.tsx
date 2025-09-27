import React from 'react';

export const AccuracyRequirements: React.FC = () => {
  return (
    <div className="card" style={{padding:'0.65rem 0.7rem', fontSize:'.6rem', lineHeight:1.25}}>
      <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:'.4rem'}}>Accuracy Requirements</div>
      <ul style={{listStyle:'disc', paddingLeft:'1rem', display:'flex', flexDirection:'column', gap:'.25rem', margin:0}}>
        <li>&ge;90% accuracy identifying main Goals, BMPs & Activities</li>
        <li>&ge;90% accuracy extracting quantitative metrics</li>
        <li>0 false positives for exact copied content (names, entities)</li>
        <li>Proper categorization of all content types</li>
      </ul>
      <div style={{marginTop:'.5rem', fontSize:'.5rem', opacity:.6}}>Targets apply to final Silver extraction vs. curated gold truth set.</div>
    </div>
  );
};
