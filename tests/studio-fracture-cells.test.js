import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {fractureGrid} from '../src/asset-studio/fracture-grid.js';
import {cellShapes,fractureCells} from '../src/asset-studio/fracture-cells.js';
import {impulseReach,firstSurfaceHit} from '../src/asset-studio/ground-tools.js';
import {strikeGround} from '../src/asset-studio/ground-interaction.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {WindSea} from '../src/asset-studio/ocean.js';
const materials=new Map(seedLibrary().materials.map(m=>[m.id,m]));
const box=(center,half,materialId='wood')=>({type:'box',center,half,materialId});
const volume=s=>s.volume??8*s.half[0]*s.half[1]*s.half[2];
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);

test('Voronoi fracture preserves carved volume and material seams with complementary oblique hulls',()=>{
 const solid=[box([0,-.4,0],[1,.2,.5]),box([-.6,.1,0],[.4,.3,.5]),box([.6,.1,0],[.4,.3,.5]),box([0,.46,0],[1,.06,.5],'copper')];
 const grid=fractureGrid(solid,[1,1.3,1],materials),cells=fractureCells(grid),ids=grid.nodes.map(n=>n.index);
 assert.deepEqual(cells.sites,fractureCells(fractureGrid(solid,[1,1.3,1],materials)).sites);
 for(const source of solid){
  const pieces=cells.sourcePieces[solid.indexOf(source)];
  close(pieces.reduce((v,p)=>v+volume(p.shape),0),volume(source));
  assert.ok(pieces.every(p=>p.shape.materialId===source.materialId));
 }
 close(cellShapes(grid,ids).reduce((sum,p)=>sum+volume(p),0),solid.reduce((sum,p)=>sum+volume(p),0));
 let oblique=0;
 for(const [i,shapes] of cells.parts.entries()){
  assert.ok(shapes.length);
  for(const s of shapes)for(const f of s.faces??[]){
   const j=f.neighbor;if(j==null)continue;
   assert.ok(cells.parts[j].some(s=>s.faces?.some(g=>g.neighbor===i&&g.normal.dot(f.normal)<-.999999&&
    f.points.every(p=>g.points.some(q=>p.distanceToSquared(q)<1e-12)))));
   if(Math.max(...f.normal.toArray().map(Math.abs))<.98)oblique++;
  }
 }
 assert.ok(oblique>12);
});
test('the tool wave attenuates exponentially across water, independently of the wind crest search',()=>{
 const sea=new WindSea(),reach=impulseReach(materials.get('water'));
 sea.splash(0,0,1,0,0,reach);
 for(const r of [.32,.64,1.28,2]){
  sea.sampleTime(r/2);close(sea.height(r,0)/(.14*Math.exp(-1.3*r/2)),Math.exp(-r/reach));
 }
 assert.ok(Math.exp(-2/reach)<.002);assert.ok(Math.exp(-2/impulseReach(materials.get('stone')))>.5);
 const a=new WindSea(38,0),b=new WindSea(38,0);b.splash(150,150);let count=0;
 for(let k=0;k<32;k++){
  for(const s of [a,b]){s.sampleTime(k/8);s.crests=[];s.advanceBreakers();}
  assert.deepEqual(a.crests.map(c=>[c.x,c.z]),b.crests.map(c=>[c.x,c.z]));count+=a.crests.length;
 }
 assert.ok(count>0);
});
test('a grazing click strikes the nearest visible crest with several more crossings behind it',()=>{
 const ray=new Ray(new Vector3(0,.45,0),new Vector3(1,-.01,0).normalize());
 const h=x=>Math.sin(2*x)*.7,hit=firstSurfaceHit(ray,h,500,5);
 assert.ok(hit.x>0&&hit.x<.5);close(hit.y,h(hit.x),.00002);
});

test('float and solid contacts receive the material-specific exponential impulse at their nearest point',async()=>{
 for(const ground of ['water','stone']){
  const library=seedLibrary(),asset=library.assets[0];
  asset.parts[0].stamps=[stamp('box','add',[0,0,0],[.15,.15,.15],'wood',0)];
  library.world.groundMaterialId=ground;library.world.wind={speed:0,heading:0};
  library.world.instances=[0,2].map(x=>({id:'probe'+x,assetId:asset.id,transform:{...transform(),position:[x,.15,0]}}));
  const sim=await StudioPhysics.create(library,'world',asset.id);
  try{
   strikeGround(sim,new Vector3(),1000);assert.equal(sim.pulses.length,2);
   const [near,far]=sim.pulses.map(p=>p.force.y);
   close(near,1000,.01);close(far/near,Math.exp(-1.85/impulseReach(sim.groundMaterial)),1e-5);
   if(ground==='water')assert.ok(far/near<.004);else assert.ok(far/near>.65);
  }finally{sim.dispose();}
 }
});
