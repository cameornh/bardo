import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceDrops,beadRadius,DROP_MERGE_SECONDS} from '../src/sand-lab/surface-drops.js';
import {makeBody,bodyDistance,cupHydrostatics} from '../src/sand-lab/objects.js';
import {bodyMass,bodyImpulse,integrateOrientation,resolveBodyTerrain,resolveBodyPairs,bodyContactPoints} from '../src/sand-lab/rigid-contacts.js';
import {LabRain} from '../src/sand-lab/water-lab-rain.js';
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function fixture(wet=1){const lab={spacing:.2,spec:{scale:10},sand:{materialAt:()=>wet,distance:p=>p[1]},balls:[],positions:new Float32Array(),velocities:new Float32Array(),chem:new Float32Array(),neighborCounts:new Uint16Array(),get count(){return this.positions.length/4},particleBudget:10000,solid(p){return Math.min(p[1],...this.balls.map(b=>bodyDistance(p,b)))},motion:{position:[0,0,0],tilt:0,spin:0,pitch:0}};lab.rain=new LabRain(lab);return lab;}
const hit=point=>({point,normal:[0,1,0],particle:-1});
test('surface beads are rain-only, smaller than bulk, and dry sand absorbs instead',()=>{
 const dry=fixture(0);dry.rain.impact({volume:.001,velocity:[0,-1,0]},hit([0,0,0]));assert.equal(dry.rain.surfaceDrops.patches.size,0);close(dry.rain.depositVolume,.001);
 const wet=fixture(),drops=wet.rain.surfaceDrops;wet.rain.impact({volume:.001,velocity:[0,-1,0]},hit([0,0,0]));drops.step(.1);assert.equal(drops.beads().length,1);assert.ok(drops.beads().every(b=>b.radius<wet.spacing*.3));assert.equal(drops.fieldItems().length,0);
 assert.equal(drops.impact({volume:.1},{...hit([0,1,0]),particle:0}),false);close(drops.volume,.001);
});
test('nearby accumulation transitions continuously into one parcel without summoning distant rain',()=>{
 const lab=fixture(),d=lab.rain.surfaceDrops,pv=lab.spacing**3;
 d.impact({volume:pv*.5},hit([0,0,0]));d.impact({volume:pv*.5},hit([1,0,0]));d.step(.2);assert.equal(d.births.length,0);
 d.impact({volume:pv*.5},hit([0,0,0]));d.step(.01);assert.equal(d.births.length,1);assert.ok(d.fieldItems()[0].volume<pv*.001);
 const position=d.births[0].position.slice();d.step(.5);assert.ok(d.fieldItems()[0].volume>0&&d.fieldItems()[0].volume<pv);assert.ok(d.beads().length>0);
 d.step(DROP_MERGE_SECONDS);assert.equal(lab.count,1);position.forEach((v,k)=>close(lab.positions[k],v,1e-6));close(d.volume+lab.rain.transferred,pv*1.5);
});
test('rain beads stay attached to moving and rotating glass and do not decorate water',()=>{
 const lab=fixture(0),b=makeBody('glass','sphere',.5,[0,1,0]);lab.balls.push(b);const d=lab.rain.surfaceDrops;
 d.impact({volume:.0001},hit([0,1.5,0]));d.step(.1);assert.equal(d.patches.size,1);let bead=d.beads()[0];assert.ok(Math.abs(bodyDistance(bead.position,b)-bead.radius*.5)<.0001);
 b.position[0]=2;b.tilt=1;bead=d.beads()[0];assert.ok(Math.abs(bodyDistance(bead.position,b)-bead.radius*.5)<.0001);
 lab.waterAt=()=>({density:1});d.step(.3);assert.equal(d.patches.size,0);close(lab.rain.depositVolume,.0001);assert.equal(lab.rain.fieldItems().length,0);
});
function fall(b,floor,seconds=4){for(let i=0;i<seconds*120;i++){const dt=1/120;b.velocity[1]-=9.81*dt;for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*dt;integrateOrientation(b,dt);resolveBodyTerrain(b,floor,dt);}return b;}
test('a cup striking a slope rotates from contact forces and its rim stays above the sand',()=>{
 const b=makeBody('rock','cup',.3,[0,1.2,0]);fall(b,p=>(p[1]-.3*p[0])/Math.sqrt(1.09),2);
 assert.ok(Math.abs(b.tilt)+Math.abs(b.pitch)>.1,JSON.stringify(b));assert.ok(Math.min(...bodyContactPoints(b).map(p=>(p[1]-.3*p[0])/Math.sqrt(1.09)))>-.003);
});
test('sphere contacts resolve a sloping bed at the actual surface, not its centre height',()=>{
 const b=makeBody('glass','sphere',.4,[0,1,0]),floor=p=>(p[1]-.5*p[0])/Math.sqrt(1.25);fall(b,floor,1);assert.ok(floor(b.position)>=b.radius-.001);
});
test('sideways cups collide at their actual walls and exchange angular momentum',()=>{
 const a=makeBody('rock','cup',.4,[-.22,0,0],[1,0,0]),b=makeBody('glass','cup',.4,[.22,.17,0],[-1,0,0]);a.pitch=.7;b.tilt=-.4;
 const before=a.position[0];for(let i=0;i<20;i++)resolveBodyPairs([a,b],1/120);
 assert.ok(a.position[0]<before);const penetration=Math.max(...bodyContactPoints(a).map(p=>-bodyDistance(p,b)),...bodyContactPoints(b).map(p=>-bodyDistance(p,a)));assert.ok(penetration<.006,`${penetration}`);
 assert.ok(Math.hypot(...a.omega)+Math.hypot(...b.omega)>.01);
});
test('off-centre water impulse tips cups and full-immersion buoyancy has no spurious torque',()=>{
 const b=makeBody('rock','cup',.4,[0,0,0]);bodyImpulse(b,[.3,0,0],[0,bodyMass(b),0]);assert.ok(b.omega[2]>0);integrateOrientation(b,.1);assert.ok(b.tilt>0);
 const upright=makeBody('rock','cup',1,[0,0,0]),h=cupHydrostatics(upright,10);assert.ok(Math.hypot(h.center[0],h.center[2])<1e-12);
});

test('a growing rain parcel follows a moved receiver and only one forms per patch at once',()=>{
 const lab=fixture(),b=makeBody('glass','sphere',.5,[0,1,0]);lab.balls.push(b);const d=lab.rain.surfaceDrops,pv=lab.spacing**3;
 d.impact({volume:pv*3},hit([0,1.5,0]));d.step(.1);d.step(.1);assert.equal(d.births.length,1);
 const before=d.births[0].position.slice();b.position[0]+=1;d.step(.1);close(d.births[0].position[0],before[0]+1);
 d.step(1);assert.equal(lab.count,1);close(d.volume+lab.rain.transferred,pv*3);
});
test('transparent sphere shadows do not produce an opaque grazing ring',async()=>{
 const {bodyLightTransmission}=await import('../src/sand-lab/water-lab-body-shadows.js');const b=makeBody('glass','sphere',.5,[0,1,0]);let previous=null;
 for(let i=0;i<=200;i++){const x=i/200*.7,t=bodyLightTransmission([x,0,0],[0,1,0],10,[b],{scale:10,sourceRadius:0});if(x>.485)assert.ok(t.every(v=>v>.5));if(previous!==null)assert.ok(t[0]>=previous-1e-9);previous=t[0];}close(previous,1);
});

test('cups spawned at identical poses separate instead of keeping coincident walls',()=>{
 const a=makeBody('glass','cup',.3,[0,1,0]),b=makeBody('glass','cup',.3,[0,1,0]);
 for(let i=0;i<40;i++)resolveBodyPairs([a,b],1/60);
 assert.ok(Math.hypot(...a.position.map((v,k)=>v-b.position[k]))>.5);
 const depth=Math.max(...bodyContactPoints(a).map(p=>-bodyDistance(p,b)),...bodyContactPoints(b).map(p=>-bodyDistance(p,a)));assert.ok(depth<.002,depth);
});

test('deeply interlocked equal cups recover while a small sphere can occupy the cavity',()=>{
 const a=makeBody('glass','cup',.3,[0,1,0]),b=makeBody('glass','cup',.3,[.02,1.005,.01]);resolveBodyPairs([a,b],1/60);
 const depth=Math.max(...bodyContactPoints(a).map(p=>-bodyDistance(p,b)),...bodyContactPoints(b).map(p=>-bodyDistance(p,a)));assert.ok(depth<.002,depth);
 const cup=makeBody('rock','cup',.5,[0,1,0]),ball=makeBody('glass','sphere',.1,[0,1,0]);resolveBodyPairs([cup,ball],1/60);assert.deepEqual(ball.position,[0,1,0]);
});

test('adjacent rain beads coalesce across spatial cell borders',()=>{
 const lab=fixture(),d=lab.rain.surfaceDrops,pv=lab.spacing**3;
 d.impact({volume:pv*.5},hit([-.001,0,0]));d.impact({volume:pv*.5},hit([.001,0,0]));d.step(.1);assert.equal(d.births.length,1);close(d.volume,pv);
});

test('the sand-lab body step produces rotation from asymmetric water flow',async()=>{
 const {SandLab}=await import('../src/sand-lab/lab.js'),{cupContains}=await import('../src/sand-lab/objects.js');
 const b=makeBody('rock','cup',.3,[0,.12,0]);b.tilt=.25;
 const lab={balls:[b],spacing:.1,spec:{scale:10},optimizations:{fastSampling:false},wind:0,air:{},sand:{distance:p=>p[1]+3,compact(){}},fluidIndex:null,positions:[],velocities:[],chem:[],indexFluid:SandLab.prototype.indexFluid,waterAt:SandLab.prototype.waterAt,get count(){return this.positions.length/4}};
 for(let x=-10;x<=10;x++)for(let y=-6;y<=0;y++)for(let z=-10;z<=10;z++){const p=[x*.1,y*.1,z*.1];if(bodyDistance(p,b)<.03||cupContains(p,b))continue;lab.positions.push(...p,0);lab.velocities.push(.2+.1*y,0,0,0);}
 lab.positions=new Float32Array(lab.positions);lab.velocities=new Float32Array(lab.velocities);
 for(let i=0;i<120;i++)SandLab.prototype.stepBodies.call(lab,1/120);
 assert.ok(Math.hypot(...b.omega)>.01);assert.ok(b.submerged>.2&&b.submerged<1);assert.ok([...b.position,...b.velocity,b.tilt,b.pitch,b.spin].every(Number.isFinite));
});

test('analytic hollow-body rays agree with independent SDF crossings including rotated rims',async()=>{
 const {bodyRayHit}=await import('../src/sand-lab/body-ray.js');
 for(const shape of ['cup','sphere'])for(const tilt of [0,.7,1.55]){
  const b=makeBody('glass',shape,.3,[.2,.1,-.2]);b.tilt=tilt;b.pitch=.4;
  for(let i=0;i<180;i++){
   const origin=[-.45+i%15*.09,1.1,-.7+Math.floor(i/15)*.09],direction=[0,-1,0],t=bodyRayHit(origin,direction,b,3,0);
   let reference=Infinity,previous=0;for(let step=0;step<1600;step++){const travel=step*.0015,p=origin.map((v,k)=>v+direction[k]*travel);if(bodyDistance(p,b)<=0){let lo=previous,hi=travel;for(let j=0;j<15;j++){const m=(lo+hi)/2;if(bodyDistance(origin.map((v,k)=>v+direction[k]*m),b)>0)lo=m;else hi=m;}reference=(lo+hi)/2;break;}previous=travel;}
   assert.equal(Number.isFinite(t),Number.isFinite(reference),`${shape} ${tilt} ${i}`);if(Number.isFinite(t))close(t,reference,1e-6);
  }
 }
 const cup=makeBody('glass','cup',1,[0,0,0]);close(bodyRayHit([0,3,0],[0,-1,0],cup),3.84);close(bodyRayHit([0,0,0],[1,0,0],cup),.68);assert.equal(bodyRayHit([0,0,0],[0,1,0],cup),Infinity);
});

test('spawning a cup invalidates the sphere-only fluid lookup before rigid integration',async()=>{
 const {SandLab}=await import('../src/sand-lab/lab.js'),lab=new SandLab({extensions:{has:()=>false}});lab.wind=0;
 lab.waterAt([0,1,0]);assert.equal(lab.fluidIndex.fast,true);
 lab.spawn('glass',[0,3,0],[0,0,-1],'cup');assert.equal(lab.fluidIndex,null);
 lab.stepBodies(1/60);assert.ok(lab.fluidIndex.bins);assert.ok(lab.balls[0].position.every(Number.isFinite));
});

test('background object warmup cannot be completed by a subsequent empty-scene draw',async()=>{
 const THREE=await import('three'),{installProgramSpecialization}=await import('../src/sand-lab/program-specialization.js');
 const material=new THREE.ShaderMaterial({uniforms:{uBodyCount:{value:0}},vertexShader:'uniform int uBodyCount;',fragmentShader:'uniform int uBodyCount;'}),scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(),material));let compiling,finish;
 const renderer={render(s){s.traverse(o=>{if(o.material){const shader={vertexShader:o.material.vertexShader,fragmentShader:o.material.fragmentShader};o.material.onBeforeCompile(shader);o.material.lastCompiled=shader.fragmentShader;}});},compileAsync(s){compiling=s;const m=s.children[0].material,shader={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.onBeforeCompile(shader);m.lastCompiled=shader.fragmentShader;return new Promise(resolve=>finish=resolve);}};
 installProgramSpecialization(renderer,()=>true);renderer.render(scene,{});const ready=renderer.warmObjectPrograms([scene],{});let complete=false;ready.then(()=>complete=true);
 renderer.render(scene,{});await Promise.resolve();assert.equal(complete,false);assert.notEqual(compiling.children[0].material,material);assert.match(material.lastCompiled,/const int uBodyCount=0/);assert.match(compiling.children[0].material.lastCompiled,/uniform int uBodyCount/);
 finish();await ready;assert.equal(complete,true);assert.equal(material.uniforms.uBodyCount.value,0);
});

test('sand/object constraints cannot submit GPU work, including deferred and packed modes',async()=>{
 const {LabFluidGPU}=await import('../src/sand-lab/water-lab-gpu.js');let target=null;const draws=[];
 const renderer={extensions:{has:()=>true},getRenderTarget:()=>target,setRenderTarget:t=>target=t,render(scene){const m=scene.children[0].material;draws.push({name:m.name,input:m.uniforms.uPositions.value,output:target.texture});}};
 const gpu=new LabFluidGPU(renderer,{uStation:{value:6},uBodyCount:{value:1}}),positions=new Float32Array([0,.01,0,0,.12,.01,0,1]);
 for(const packed of [false,true])for(const reuse of [false,true])for(const deferred of [false,true]){
  gpu.uniforms.uPackedGpuNeighbors.value=packed;gpu.uniforms.uReuseBoundary.value=reuse;
  const result=gpu.solve(positions,.2,p=>[p[0],Math.max(.024,p[1]),p[2]],3,p=>p[1],deferred,deferred);
  assert.equal(draws.length,0);assert.ok(result[1]>=.024-1e-8);assert.deepEqual(result.slice(4),positions.slice(4));
  assert.notEqual(gpu.resultTexture,gpu.texture);assert.deepEqual(gpu.resultTexture.image.data.slice(0,8),result);
  assert.deepEqual(gpu.texture.image.data.slice(0,8),positions);assert.equal(target,null);
  assert.match(gpu.constraintBackend,/CPU object contacts/);
 }
 gpu.uniforms.uBodyCount.value=0;draws.length=0;gpu.solve(positions,.2,p=>p,3,null,false,true);
 assert.equal(draws.length,6);assert.equal(gpu.constraintBackend,'GPU');
 assert.equal(gpu.material.userData.skipObjectWarmup,true);assert.equal(gpu.correctionMaterial.userData.skipObjectWarmup,true);
 gpu.dispose();
});
