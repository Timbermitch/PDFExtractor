#!/usr/bin/env node
/**
 * reprocess_filtered_subset_all.js
 * Force reprocess all PDFs in the filtered subset list (sequential) so that
 * enriched rejection reason fields (rejectReasons, rejectPrimary) are captured
 * in the NDJSON and subsequent aggregation.
 */
import { spawnSync } from 'child_process';

const subset = [
  'Lake_Washington_Watershed_Plan_2007.pdf',
  'Red_Bud_Catalpa_Creek_Watershed_Plan_2016.pdf',
  'Upper_Porter_Bayou_Watershed_Plan_2013.pdf',
  'Middle_Porter_Bayou_Watershed_Plan_2013.pdf',
  'Muddy_Bayou_Opossum_Bayou_9_Key_Element_Plan_2022.pdf',
  'Dry_Creek_9_Key_Element_Plan_2017.pdf',
  'Bear_Lake_9_Key_Elelment_Plan_2018.pdf',
  'Deer_Creek_Watershed_Plan_2008.pdf',
  'Overcup_Slough_Watershed_Plan_2013.pdf',
  'Pickwick_Reservoir_Watershed_Plan_2009.pdf',
  'Old_Fort_Bayou_Watershed_Plan_2019.pdf',
  'Rotten_Bayou_Watershed_Plan_2015.pdf',
  'Ross_Barnett_Reservoir_Watershed_Plan_2011.pdf',
  'Upper_Bay_of_St_Louis_Watershed_Action_Plan_2007.pdf',
  'Tchoutacabouffa_River_Watershed_Action_Plan_2007.pdf',
  'Upper_Piney_Creek_9_Key_Element_Plan_2022.pdf'
];

function run(cmd, args){
  const full = `${cmd} ${args.join(' ')}`;
  console.log('\n[batch] ->', full);
  const res = spawnSync(process.execPath, ['scripts/filtered_subset_extraction_one.js', '--force', ...args], {
    env: { ...process.env, BMP_FILTER: '1' },
    stdio: 'inherit'
  });
  if(res.status !== 0){
    console.warn('[batch] Non-zero exit for', args[0], 'status=', res.status);
  }
}

(async function main(){
  console.log('[batch] Starting forced reprocess of filtered subset (count=', subset.length, ')');
  for(const file of subset){
    run('node', [file]);
  }
  console.log('\n[batch] Reprocess complete. You can now re-run:');
  console.log('  node scripts/aggregate_filtered_subset.js');
  console.log('  node scripts/diff_bmp_filter_impact.js');
})();
