import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {IncrementalSculpt} from '../src/asset-studio/sculpt-incremental.js';
import {sculptFixture,editStamp,sculptSpacing} from '../tests/studio-incremental-fixture.js';
const rows=[],cold=[];
// Prime both paths before ABBA; measured jobs append the same eight strokes.
for(const optimized of [false,true]){const c=new IncrementalSculpt(),s=sculptFixture();optimized?c.update(s,sculptSpacing):bakeFast(s,sculptSpacing);s.push(editStamp(24));optimized?c.update(s,sculptSpacing):bakeFast(s,sculptSpacing);}
for(let block=0;block<8;block++){
 const optimized=[false,true,true,false][block%4],s=sculptFixture(),cache=new IncrementalSculpt(),start=performance.now();
 optimized?cache.update(s,sculptSpacing):bakeFast(s,sculptSpacing);cold.push({block,optimized,ms:performance.now()-start});
 for(let edit=24;edit<32;edit++){
  s.push(editStamp(edit));const t=performance.now(),r=optimized?cache.update(s,sculptSpacing):{surface:bakeFast(s,sculptSpacing)},ms=performance.now()-t;
  rows.push({block,edit,optimized,ms,stats:r.stats,splats:r.surface.materials.length});
 }
 assert.deepEqual(cache.grid?cache.update(s,sculptSpacing).surface:bakeFast(s,sculptSpacing),bakeFast(s,sculptSpacing));
}
const stats=(values)=>{const a=values.slice().sort((a,b)=>a-b);return {mean:values.reduce((s,x)=>s+x,0)/values.length,p95:a[Math.floor((a.length-1)*.95)]};};
const reference=stats(rows.filter(x=>!x.optimized).map(x=>x.ms)),incremental=stats(rows.filter(x=>x.optimized).map(x=>x.ms));
const result={pass:true,note:'CPU sampling + extraction only, excludes worker delivery, uploads and drawing; not FPS or physics throughput.',reference,incremental,speedup:reference.mean/incremental.mean,cold,rows};
console.log(JSON.stringify({...result,rows:undefined},null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2));
