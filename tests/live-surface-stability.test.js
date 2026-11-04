import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterSurfaceState,StableBlobFamilies} from '../src/rtx-sand-lab/water-surface-state.js';
import {traceBudgeted,edgeRayBudget} from '../src/rtx-sand-lab/edge-mirage.js';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';

const lab=()=>({generation:1,spacing:.25,count:1,steps:0,time:0,kind:'ocean',positions:new Float32Array([0,2,0,0]),velocities:new Float32Array(4),neighborCounts:new Uint16Array([25]),chem:new Float32Array(4),spec:{scale:1}});
test('kernel width changes smoothly without modifying physics or advancing during redraws',()=>{
 const l=lab(),state=new WaterSurfaceState();state.update(l);const positions=l.positions.slice();
 l.steps++;l.time+=1/60;l.neighborCounts[0]=5;const count=state.update(l)[0];
 assert.ok(count>23&&count<25);assert.equal(l.neighborCounts[0],5);assert.deepEqual(l.positions,positions);
 l.time+=1/60;assert.equal(state.update(l)[0],count,'An in-flight step must not change the displayed kernel');
 for(let i=0;i<60;i++){l.steps++;l.time+=1/60;state.update(l);}assert.ok(Math.abs(state.counts[0]-5)<.1);
});
test('water filtering is independent of redraw count and camera and survives appended rain water',()=>{
 const a=lab(),b=lab(),x=new WaterSurfaceState(),y=new WaterSurfaceState();x.update(a);y.update(b);
 for(let i=0;i<60;i++){for(const l of [a,b]){l.time+=1/60;l.steps++;l.neighborCounts[0]=i%2?5:25;}x.update(a);for(let k=0;k<5;k++){b.camera=[k,i,-k];y.update(b);}assert.deepEqual(x.counts,y.counts);}
 const prior=x.counts[0];a.count=2;a.neighborCounts=new Uint16Array([25,8]);x.update(a);assert.equal(x.counts[0],prior);assert.equal(x.counts[1],8);
 a.generation++;a.time=0;assert.deepEqual([...x.update(a)],[25,8]);
});
test('a momentarily sparse sheet never changes rendering families; sustained detached water does',()=>{
 const l=lab(),f=new StableBlobFamilies();f.update(l);
 for(let i=0;i<120;i++){l.steps++;l.time+=1/60;l.neighborCounts[0]=i%3===0?1:25;assert.equal(f.update(l).length,0);}
 l.neighborCounts[0]=0;for(let i=0;i<30;i++){l.steps++;l.time+=1/60;f.update(l);}assert.equal(f.active.size,1);
 const age=f.sparseAge[0];for(let i=0;i<20;i++)f.update(l);assert.equal(f.sparseAge[0],age);
 l.generation++;l.steps=0;l.time=0;assert.equal(f.update(l).length,0);
});
test('grazing artifacts are actual iteration exhaustion, with every distance sample accounted for',()=>{
 const sphere=p=>Math.hypot(...p)-1;
 const scene=p=>Math.min(sphere(p),p[2]+1.5),origin=[1.005,0,3],direction=[0,0,-1];
 const clean=traceBudgeted(scene,origin,direction);assert.equal(clean.hit,true);assert.equal(clean.exhausted,false);
 for(const iterations of [16,32,48]){
  let calls=0;const hit=traceBudgeted(p=>{calls++;return scene(p);},origin,direction,{iterations});
  assert.equal(hit.hit,false);assert.equal(hit.exhausted,true);assert.equal(hit.samples,iterations);assert.equal(calls,iterations);
 }
 for(const strength of [0,.4,1,2])assert.equal(traceBudgeted(sphere,[0,0,3],direction,{iterations:edgeRayBudget(strength)}).hit,true);
 assert.equal(edgeRayBudget(0),256);assert.equal(edgeRayBudget(1),64);assert.equal(edgeRayBudget(2),16);
 const sky=traceBudgeted(()=>20,[0,0,0],direction,{iterations:64});assert.equal(sky.exhausted,false);assert.equal(sky.samples,1);
});
test('live mirage changes primary visibility only; physics, secondary rays, and historical renderers stay intact',()=>{
 const renderer={extensions:{has:()=>false,get:()=>null},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},render(){assert.fail('Unexpected GPU work');}};
 const lab=new LiveSandLab(renderer),field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 const historical=new WaterLabRenderer(field,lab),live=new LiveWaterRenderer(field,lab),source=live.backgroundScene.children[0].material.fragmentShader;
 assert.doesNotMatch(historical.backgroundScene.children[0].material.fragmentShader,/traceEdgeOpaque/);
 for(const scene of [live.waterScene,live.submergedScene,live.shellScene,live.photonScene])assert.doesNotMatch(scene.children[0].material.fragmentShader,/traceEdgeOpaque/);
 assert.match(source,/float t=uEdgeRayBudget==0\?traceOpaque\(uEye,ray\):traceEdgeOpaque\(uEye,ray\);/);
 assert.match(source,/float h=opaque\(p\);/,'Real union tracing includes the geometry in front of a receiver');
 assert.match(source,/sandCellExit\(p,d\)/,'Carved terrain keeps conservative bin crossings');
 const positions=lab.positions.slice(),revision=lab.revision,shaderVersion=live.backgroundScene.children[0].material.version;
 live.drawKey='cached';live.edgeMirage.strength=0;
 assert.equal(live.drawKey,null);assert.equal(live.u.uEdgeRayBudget.value,0);assert.equal(live.backgroundScene.children[0].material.version,shaderVersion,'Changing strength must not recompile shaders');
 assert.deepEqual(lab.positions,positions);assert.equal(lab.revision,revision);
});
