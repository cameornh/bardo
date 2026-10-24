import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBody} from '../src/sand-lab/objects.js';
import {SurfaceDrops,DROP_BEADS} from '../src/sand-lab/surface-drops.js';
import {surfaceDropTint} from '../src/sand-lab/surface-drop-renderer.js';
import {detailDisplayRadius} from '../src/sand-lab/water-lab-detail-opacity.js';
import {detailStep} from '../src/sand-lab/water-lab-detail.js';
import {sprayShadowKernel} from '../src/sand-lab/water-lab-spray-shadows.js';
function fixture(wet=1,objects=true){const body=makeBody('rock','cup',5,[0,4.2,0]),lab={spacing:1,sand:{materialAt:()=>wet,distance:p=>p[1]},balls:objects?[body]:[],count:0,particleBudget:100,solid:p=>p[1]},rain={lab,runoff:0,appendParcels(){},addWaterDeposit(){},addDeposit(hit,volume){this.runoff+=volume;}};return new SurfaceDrops(rain);}
const hit={point:[0,0,0],normal:[0,1,0],particle:-1};
test('individual rain contacts leave one bead each instead of growing reservoir clusters',()=>{
 const drops=fixture();drops.impact({volume:.002},hit);for(let i=0;i<100;i++)drops.step(.02);assert.equal(drops.beads().length,1);
 for(let i=1;i<48;i++){const x=(i%8-3.5)*.15,z=(Math.floor(i/8)-2.5)*.15;drops.impact({volume:.002},{...hit,point:[x,0,z]});drops.step(.08);}
 const beads=drops.beads();assert.equal(beads.length,48);assert.ok(beads.every(b=>b.radius<=.1&&Math.abs(b.position[1]-b.radius*.5)<1e-9));
 assert.ok(Math.abs(drops.volume-.096)<1e-12);
});
test('all sand wetness levels absorb or shed rain without condensation',()=>{
 for(let i=0;i<=20;i++){const wet=i/20,d=fixture(wet,false);d.impact({volume:.001},hit);d.step(.1);
  assert.equal(d.beads().length,0);assert.equal(d.patches.size,0);assert.ok(Math.abs(d.rain.runoff-.001*wet*wet)<1e-12);assert.ok(Math.abs(d.volume+d.rain.runoff-.001)<1e-12);
 }
});
test('beads use a half-strength blue water tint that continuously becomes amber with tannins',()=>{
 const blue=surfaceDropTint(0),amber=surfaceDropTint(1);assert.ok(blue[2]>blue[0]);assert.ok(amber[0]>amber[2]);
 let previous=blue;for(let i=1;i<=100;i++){const c=surfaceDropTint(i/100);assert.ok(c.every((v,k)=>v>=.5&&v<=1&&Math.abs(v-previous[k])<.025));previous=c;}
});
test('smaller bubbles have matching visible and shadow radii without changing spray or mist',()=>{
 for(const kind of [0,1,2,3])assert.equal(detailDisplayRadius(1,kind),kind===2?.55:1);
 const layout={axes:[[1,0,0],[0,1,0],[0,0,1]],span:[10,10,10],size:256},kernel=kind=>sprayShadowKernel([0,1,0,.5],[1,0,0,2],[.3,kind,.5,1],layout);
 assert.ok(Math.abs(kernel(2).sigma/kernel(1).sigma-.55)<1e-9);
});
test('rain mist slowly rises into an airborne blanket rather than sinking into its receiver',()=>{
 for(const scale of [1,10,50]){let p=[0,0,0],v=[0,.3/scale,0];for(let i=0;i<500;i++){const r=detailStep(p,v,3,scale,.01,i*.01,0,0,null,1,0,[0,0,0],true);p=r.position;v=r.velocity;}
  assert.ok(p[1]*scale>1.3&&p[1]*scale<1.7);assert.ok(v[1]>0);
 }
});

test('a long rainfall has a bounded bead budget without discarding rain mass',async()=>{
 const {SURFACE_BEAD_LIMIT}=await import('../src/sand-lab/surface-drops.js'),d=fixture();
 d.impact({volume:.2},hit);d.step(.1);const existing=[...d.patches.values()][0];existing.beads=Array.from({length:SURFACE_BEAD_LIMIT},()=>existing.beads[0]);
 d.impact({volume:.2},{...hit,point:[3,0,0]});d.step(.2);
 assert.equal([...d.patches.values()].reduce((n,p)=>n+p.beads.length,0),SURFACE_BEAD_LIMIT);assert.equal(d.volume,.4);
});
