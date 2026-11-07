import test from 'node:test';import assert from 'node:assert/strict';
import {particleFixture,referenceParticles,compareParticles} from '../src/rtx-sand-lab/fields/particles/verify.js';
import {packParticles,unpackParticles,PARTICLE_LIMITS} from '../src/rtx-sand-lab/fields/particles/pipeline.js';
test('bounded particle packing preserves held flags and global face indexes',()=>{
 const f=particleFixture(),p=packParticles(f.context,f.lab,f.grid,f.geometry);assert.equal(p.n,140);
 const total=f.grid.faces.reduce((s,f)=>s+f.velocity.length,0);
 for(let i=0;i<p.n;i++){assert.equal(p.input[i*68+3],f.context.old[i*4+3]);for(let k=0;k<24;k++){const j=p.input[i*68+16+k];assert.ok(j===-1||j>=0&&j<total);}}
 assert.equal(p.config[16],total*4+f.grid.count);
});
test('unsupported workloads are rejected before GPU dispatch, never truncated',()=>{
 const f=particleFixture(),pack=()=>packParticles(f.context,f.lab,f.grid,f.geometry);
 f.context.old[0]=NaN;assert.throws(pack,/Non-finite/);f.context.old[0]=0;
 f.lab.u.uSandBins.value.image.data[1]=PARTICLE_LIMITS.parcelsPerCell+1;assert.throws(pack,/CPU contacts/);
 f.lab.u.uSandBins.value.image.data[1]=0;f.lab.sandRenderParcels=[{cuts:Array(17).fill({})}];assert.throws(pack,/CPU contacts/);
 f.lab.sandRenderParcels=[];f.context.dt=1;assert.throws(pack,/timestep/);
 assert.throws(()=>unpackParticles(new Float32Array([NaN]),1),/Invalid/);
});
test('CPU reference includes oriented cup contacts, held particles and conserved chemistry',()=>{
 const f=particleFixture(),r=referenceParticles(f);assert.equal(compareParticles(r,r).pass,true);
 for(let i=0;i<f.lab.count;i++){const o=i*4;if(f.context.old[o+3])assert.deepEqual(r.positions.subarray(o,o+4),f.context.old.subarray(o,o+4));else assert.ok(f.lab.solid(Array.from(r.positions.subarray(o,o+3)))>-.001);}
 for(let k=0;k<3;k++){let before=0,after=0;for(let i=0;i<f.lab.count;i++){before+=f.lab.chem[i*4+k];after+=r.transport.chem[i*4+k];}assert.ok(Math.abs(before-after)<1e-5);}
});

test('player capsule participates in exact particle contacts',()=>{
 const f=particleFixture({objects:false,player:true}),r=referenceParticles(f);
 for(let i=0;i<f.lab.count;i++)if(!f.context.old[i*4+3])assert.ok(f.lab.playerDistance(Array.from(r.positions.subarray(i*4,i*4+3)))>-.001);
});
