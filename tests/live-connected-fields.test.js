import test from 'node:test';
import assert from 'node:assert/strict';
import {particleFixture} from '../src/rtx-sand-lab/fields/particles/verify.js';
import {freshGrid} from '../src/rtx-sand-lab/fields/connected/verify.js';
import {prepareOccupancy,connectivity,packConnected} from '../src/rtx-sand-lab/fields/connected/pack.js';
import {ConnectedFields} from '../src/rtx-sand-lab/fields/connected/pipeline.js';
test('connected occupancy matches reference and reuses unchanged graph',()=>{
 const f=particleFixture(),g=freshGrid(f.grid),c=f.context,solid=p=>f.lab.solid(p.map(v=>v/c.scale))*c.scale;
 const bins=prepareOccupancy(g,c,solid);assert.deepEqual(g.phase,f.grid.phase);assert.deepEqual(g.particleCell,f.grid.particleCell);assert.deepEqual(g.fill,f.grid.fill);
 const graph=g.levels,version=g.topologyVersion;prepareOccupancy(g,c,solid);assert.equal(g.levels,graph);assert.equal(g.topologyVersion,version);
 const members=new Set();for(let i=0;i<g.count;i++)for(let k=bins[i];k<bins[i+1];k++){const j=bins[g.count+1+k];assert.equal(g.particleCell[j],i);assert.equal(c.old[j*4+3],0);assert.ok(!members.has(j));members.add(j);}
 const t=connectivity(g);for(let i=0;i<g.count;i++)assert.equal(t.nodes[i*4+3],g.phase[i]);
});
test('moving occupancy invalidates topology but camera is absent from inputs',()=>{
 const f=particleFixture(),g=freshGrid(f.grid),solid=p=>p[1];prepareOccupancy(g,f.context,solid);const version=g.topologyVersion;
 const moved={...f.context,old:f.context.old.slice()};for(let i=0;i<moved.old.length;i+=4)moved.old[i+1]+=3;
 prepareOccupancy(g,moved,solid);assert.ok(g.topologyVersion>version);
});
test('connected packing preserves moving wall speeds, exact geometry and compact bin membership',()=>{
 const f=particleFixture(),g=freshGrid(f.grid),bins=prepareOccupancy(g,f.context,p=>p[1]);const p=packConnected(f.context,f.lab,g,f.geometry,bins,()=>[2,3,4],()=>[.1,.2,.3]);
 assert.equal(p.n,f.lab.count);assert.equal(p.fieldConfig[1],g.count);assert.deepEqual(p.field.slice(p.config[16]),f.geometry);
 for(let j=0;j<p.faceMeta.length;j+=16)if(!p.faceMeta[j+7])assert.ok(Math.abs(p.faceMeta[j+11]-[.1,.2,.3][p.faceMeta[j+2]])<1e-7);
});
test('invalid pressure result is rejected before field commit',()=>{
 const f=particleFixture(),fields=new ConnectedFields({}),g=f.grid;fields.grid=g;fields.packed={faceMeta:new Float32Array(g.faces.reduce((n,f)=>n+f.velocity.length,0)*16)};
 const faces=fields.packed.faceMeta.length/16;fields.extraBytes=faces*16+(g.count*8+4)*4;const data=new Float32Array(fields.extraBytes/4);data[faces*4]=1;
 const before=g.faces[0].velocity.slice();assert.throws(()=>fields.result(data.buffer,0),/requires CPU fallback/);assert.deepEqual(g.faces[0].velocity,before);
 data.fill(0);data[2]=NaN;assert.throws(()=>fields.result(data.buffer,0),/Non-finite/);
});

import {packHierarchy} from '../src/rtx-sand-lab/fields/connected/multigrid.js';
import {multiply} from '../src/rtx-sand-lab/fields/multigrid.js';
import {BeachFields} from '../src/rtx-sand-lab/fields/beach-fields.js';
test('packed multigrid retains the reference operator and conservative restriction at every level',()=>{
 const levels=particleFixture().grid.levels,base=312,packed=packHierarchy(levels,base),data=packed.data;
 const read=i=>data[i-base];let work=0;
 for(let l=0;l<levels.length;l++){
  const g=levels[l],d=l*8,node=data[d+1],links=data[d+2],x=Float64Array.from({length:g.n},(_,i)=>Math.sin(i*.4)),expected=multiply(g,x);
  assert.equal(data[d+5],work);work+=g.n*3;
  for(let i=0;i<g.n;i++){let value=read(node+i*4)*x[i],magnitude=Math.abs(value);for(let k=read(node+i*4+1);k<read(node+i*4+2);k++){const term=read(links+k*2+1)*x[read(links+k*2)];value-=term;magnitude+=Math.abs(term);}assert.ok(Math.abs(value-expected[i])<Math.max(1,magnitude)*2e-7);}
  if(l){const child=data[d+4],seen=new Set();for(let i=0;i<g.n;i++){for(let j=0;j<read(child+i*2+1);j++){const fine=read(read(child+i*2)+j);assert.equal(levels[l-1].parent[fine],i);assert.ok(!seen.has(fine));seen.add(fine);}}assert.equal(seen.size,levels[l-1].n);}
 }
 assert.equal(packed.work,work);assert.ok(work<=24576);
});
function fakeFields(solve){
 const fields=Object.create(BeachFields.prototype),calls={prepare:0,cpu:0,finish:0,commit:0};
 Object.assign(fields,{lab:{generation:7},particleBackend:'connected',backend:'cpu',stats:{},connected:{validated:true,disabled:false,solve,fields:{commit:()=>calls.commit++}},ensure(){},environment(){return {};},prepare(){calls.prepare++;return [];},solveCPU(){calls.cpu++;return {};},finish(){calls.finish++;return 'cpu result';}});
 return {fields,calls};
}
test('a rejected connected job falls back once without committing partial GPU fields',async()=>{
 const {fields,calls}=fakeFields(async()=>{throw Error('Connected GPU pressure residual requires CPU fallback');});fields.backend='gpu';
 assert.equal(await fields.solveAsync({generation:7}),'cpu result');assert.equal(fields.particleBackend,'cpu');assert.equal(fields.backend,'cpu');assert.deepEqual(calls,{prepare:1,cpu:1,finish:1,commit:0});
});
test('a reset during connected compute discards the obsolete result',async()=>{
 let resolve;const {fields,calls}=fakeFields(()=>new Promise(r=>resolve=r));const step=fields.solveAsync({generation:7});fields.lab.generation=8;resolve({fieldResult:{}});
 assert.equal(await step,null);assert.deepEqual(calls,{prepare:0,cpu:0,finish:0,commit:0});
});
test('oversized field grids and crowded bins stop before GPU submission',()=>{
 const fields=new ConnectedFields({});assert.throws(()=>fields.pack({},null,{count:4097},null),/4096/);
 const f=particleFixture({nx:16,ny:16,nz:9,objects:false});f.context.old.fill(0);assert.throws(()=>prepareOccupancy(freshGrid(f.grid),f.context,()=>1),/bounded work/);
});
