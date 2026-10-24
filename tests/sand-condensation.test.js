import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceDrops,DROP_BEADS} from '../src/sand-lab/surface-drops.js';
import {surfaceDropTint} from '../src/sand-lab/surface-drop-renderer.js';
import {detailDisplayRadius} from '../src/sand-lab/water-lab-detail-opacity.js';
import {detailStep} from '../src/sand-lab/water-lab-detail.js';
import {sprayShadowKernel} from '../src/sand-lab/water-lab-spray-shadows.js';
function fixture(wet=1){const lab={spacing:1,sand:{materialAt:()=>wet,distance:p=>p[1]},balls:[],count:0,particleBudget:100,solid:p=>p[1]};return new SurfaceDrops({lab,appendParcels(){},addWaterDeposit(){}});}
const hit={point:[0,0,0],normal:[0,1,0],particle:-1};
test('one rain packet reveals individual, dispersed beads over time instead of a rosette burst',()=>{
 const drops=fixture();drops.impact({volume:.2},hit);assert.equal(drops.beads().length,0);
 let previous=0;for(let i=0;i<200;i++){drops.step(.02);const count=drops.beads().length;assert.ok(count-previous<=1);previous=count;}
 const beads=drops.beads();assert.equal(beads.length,DROP_BEADS);assert.ok(beads.every(b=>b.radius<=.1&&Math.abs(b.position[1]-b.radius*.5)<1e-9));
 // Carpet coverage, not a tight center cluster or concentric placement rings.
 const extents=[0,2].map(k=>Math.max(...beads.map(b=>b.position[k]))-Math.min(...beads.map(b=>b.position[k])));assert.ok(extents.every(x=>x>1));
 const distances=beads.map((b,i)=>Math.min(...beads.filter((_,j)=>j!==i).map(c=>Math.hypot(b.position[0]-c.position[0],b.position[2]-c.position[2]))));
 assert.ok(Math.min(...distances)>.06);assert.ok(distances.reduce((a,b)=>a+b,0)/beads.length>.12);
 assert.equal(drops.volume,.2);
});
test('wet sand continuously retains more surface water while dry sand absorbs it',()=>{
 let previous=0;for(let i=0;i<=20;i++){const wet=i/20,d=fixture(wet);d.impact({volume:.001},hit);d.step(.1);let retained=0;for(const p of d.patches.values())retained+=p.volume;
  assert.ok(retained>=previous);assert.ok(Math.abs(retained-.001*wet*wet)<1e-12);assert.ok(Math.abs(d.volume-.001)<1e-12);if(i===0)assert.equal(d.beads().length,0);previous=retained;
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
