import test from 'node:test';
import assert from 'node:assert/strict';
import {SandLab} from '../src/sand-lab/lab.js';
import {beachScalePlan,seedBeach,physicalBeachHeight} from '../src/sand-lab/beach-scale.js';
import {Walker} from '../src/sand-lab/walker.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('world resolution is measured in metres at every supported width and quality',()=>{
 for(const q of [1,2.2,3]){let previous=0;for(const width of [44,110,165,220]){
  const p=beachScalePlan(width/110,q),seed=seedBeach(p);near(p.spacing*p.scale,4.2/q);assert.equal(seed.resolutionInfo.limited,false);assert.ok(seed.items.length>previous);previous=seed.items.length;
  const cell=width/(p.sandCells-1);assert.ok(cell<=4.2/q*.9);assert.ok(cell>=4.2/q*.9*.91);assert.ok(seed.items.length<=p.particleBudget);assert.ok(p.particleBudget<=131072);near(p.depthMeters,16.5);
  for(const [x,z] of [[0,10],[12,30],[-8,-5]])near(physicalBeachHeight(x/p.scale,z/p.scale,p)*p.scale,physicalBeachHeight(x/10,z/10,beachScalePlan(1,q))*10);
 }}
});
test('live beach expands counts while boulder metres, separation and player body stay constant',()=>{
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true}),w=new Walker();let original;
 for(const multiplier of [1,1.5,2]){
  lab.configure('ocean',multiplier);const scale=lab.spec.scale,layout=lab.balls.map(b=>[b.position[0]*scale,b.position[2]*scale,b.radius*scale]);if(!original)original=layout;else layout.forEach((b,i)=>b.forEach((v,k)=>near(v,original[i][k])));
  lab.setPlayer([0,2,3],[0,0,0],w.radius/scale,w.eyeHeight/scale);near(lab.player.radius*scale,.28);near((lab.player.height+2*lab.player.radius)*scale,1.65);
  near(lab.spacing*scale,4.2/2.2);near(lab.sand.totalMass(),lab.sand.initialMass);assert.equal(lab.sand.n,beachScalePlan(multiplier,2.2).sandCells);
 }
 lab.configure('ocean',.4);assert.ok(lab.balls.every(b=>Math.abs(b.position[0])+b.radius<5.5&&Math.abs(b.position[2])+b.radius<4.9));lab.gpu.dispose();
});
