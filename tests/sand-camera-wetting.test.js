import test from 'node:test';
import assert from 'node:assert/strict';
import {LabWetting} from '../src/sand-lab/water-lab-wetting.js';

const make=()=>new LabWetting({spec:{scale:10},rain:{enabled:false,deposits:new Map()}});
const opacity=w=>{const u=w.uniforms();w.updateUniforms(u);return u.uLensCount.value?u.uLensDrops.value[0].w:0;};

test('camera spray fades smoothly and clears within eight seconds without fresh water',()=>{
 const w=make();w.addLens(.7,[.5,.5]);w.stepLens(.2);let previous=opacity(w);assert.ok(previous>.95);
 let lastVisible=previous;
 for(let i=0;i<480;i++){w.stepLens(1/60);const next=opacity(w);assert.ok(next<=previous+1e-10);assert.ok(previous-next<.02);if(next>0)lastVisible=next;previous=next;}
 assert.equal(w.lens.length,0);assert.ok(lastVisible<.001);
});

test('new spray refreshes an existing camera drop without restarting its appearance fade-in',()=>{
 const w=make();w.addLens(1,[.5,.5]);w.stepLens(3.8);const p=w.lens[0],faded=opacity(w);assert.ok(faded<.5);
 w.addLens(.7,[p.x,p.y]);assert.equal(w.lens.length,1);assert.equal(w.lens[0],p);assert.ok(opacity(w)>.95);
 w.stepLens(2);assert.equal(w.lens.length,1);w.stepLens(8);assert.equal(w.lens.length,0);
});

test('camera evaporation follows elapsed time consistently and does not dry other surfaces faster',()=>{
 const a=make(),b=make();a.addLens(1,[.5,.5]);b.addLens(1,[.5,.5]);a.spots=[{local:[0,0,0],radius:.01,age:0}];
 for(let i=0;i<180;i++)a.stepLens(1/60);for(let i=0;i<30;i++)b.stepLens(.1);
 assert.ok(Math.abs(opacity(a)-opacity(b))<1e-9);assert.ok(Math.abs(a.lens[0].radius-b.lens[0].radius)<1e-9);assert.equal(a.spots[0].radius,.01);assert.equal(a.spots[0].age,0);
});
