import {writeFile,mkdir} from 'node:fs/promises';
import {seedLibrary,stamp} from '../src/asset-studio/model.js';
import {bakeCPU,gridSpec,sampleGridCPU,extractSurface} from '../src/asset-studio/sculpt.js';
import {bakeFast,extractSurfaceFast} from '../src/asset-studio/sculpt-fast.js';
import assert from 'node:assert/strict';
const l=seedLibrary(),sculpt=[...l.assets[0].parts[0].stamps];
for(let i=0;i<24;i++)sculpt.push(stamp(i%3===0?'capsule':'sphere',i%4===3?'subtract':'add',[Math.sin(i*2.4)*.7,1+Math.cos(i*1.7)*.7,Math.cos(i*.9)*.7],[.24,.24,.24],i%2?'stone':'clay',.09));
const fixtures=[{name:'starter',stamps:l.assets[0].parts[0].stamps,spacing:.08},{name:'edited-25-stamps',stamps:sculpt,spacing:.06}],results=[];
for(const f of fixtures){
 const g=gridSpec(f.stamps,f.spacing),data=sampleGridCPU(f.stamps,g);assert.deepEqual(bakeFast(f.stamps,f.spacing),bakeCPU(f.stamps,f.spacing));
 for(const fn of [bakeCPU,bakeFast])for(let i=0;i<2;i++)fn(f.stamps,f.spacing);
 const rows=[];for(const optimized of [false,true,true,false,false,true,true,false]){let start=performance.now();const s=(optimized?bakeFast:bakeCPU)(f.stamps,f.spacing),bakeMs=performance.now()-start;start=performance.now();(optimized?extractSurfaceFast:extractSurface)(data,g,f.stamps);rows.push({optimized,bakeMs,extractMs:performance.now()-start,splats:s.positions.length/3});}
 const average=(optimized,key)=>{const r=rows.filter(x=>x.optimized===optimized);return r.reduce((s,x)=>s+x[key],0)/r.length;};
 results.push({name:f.name,grid:g.count,referenceMs:average(false,'bakeMs'),optimizedMs:average(true,'bakeMs'),referenceExtractionMs:average(false,'extractMs'),optimizedExtractionMs:average(true,'extractMs'),rows});
}
const path='tests/results/dual-scene-2026-11-19';await mkdir(path,{recursive:true});await writeFile(path+'/studio-cpu.json',JSON.stringify({pass:true,note:'CPU bake latency; excludes worker messaging, GPU sculpt sampling, upload and drawing. Not an FPS or physics-speed measurement.',results},null,2));console.log(JSON.stringify(results.map(({rows,...x})=>x),null,2));
