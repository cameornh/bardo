import test from 'node:test';
import assert from 'node:assert/strict';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {buildNeighbors,solveDensity,collideBoundary} from '../src/sand-lab/water-lab-model.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {LabTransportGPU} from '../src/sand-lab/transport-gpu.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {EmitterProbes} from '../src/sand-lab/emitter-probes.js';
import {verifyPerformancePaths} from '../src/sand-lab/performance-paths-verify.js';

test('safe scalar constraints match the reference for tilted cups, overlapping bodies and held samples',()=>{
 const bodies=[makeBody('glass','cup',.3,[.17,.14,0]),makeBody('rock','sphere',.24,[-.25,.21,0])];bodies[0].tilt=.63;bodies[0].pitch=.41;
 const solid=p=>Math.min((p[1]+.1-.2*p[0])*.65,...bodies.map(b=>bodyDistance(p,b))),points=[];
 for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=0;x<7;x++)points.push((x-3.1)*.13,(y-.2)*.13,(z-2.3)*.13,points.length%36===0?1:0);
 const positions=new Float32Array(points),s=.14,neighbors=buildNeighbors(positions,s).data,collide=p=>collideBoundary(p,s*.12,solid);
 for(const iterations of [1,3,5])for(const boundary of [null,solid]){
  const actual=solveDensityCPU(positions,neighbors,s,iterations,collide,boundary),expected=solveDensity(positions,neighbors,s,iterations,collide,boundary).positions;
  let error=0;for(let i=0;i<actual.length;i++){error=Math.max(error,Math.abs(actual[i]-expected[i]));if(positions[i-i%4+3]>.5)assert.equal(actual[i],positions[i]);}
  assert.ok(error<1e-6,error);assert.ok(actual.every(Number.isFinite));
 }
 assert.deepEqual(solveDensityCPU(new Float32Array(),new Float32Array(),.1),new Float32Array());
});

test('all eight object types use CPU contacts in the full beach without issuing graphics calls',()=>{
 const forbidden=()=>assert.fail('object constraints submitted graphics work'),renderer={extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};
 const lab=new SandLab(renderer);lab.tidesEnabled=false;lab.lunarCycle=false;
 for(const kind of ['glass','mirror','rock','light'])for(const shape of ['sphere','cup']){
  lab.configure('ocean');lab.wind=0;lab.objectRadius=.3;lab.rain.enabled=false;
  lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);
  lab.sand.parcels[0].cuts=[{offset:[.02,.01,0],radius:.025}];lab.sand.update();
  const body=lab.spawn(kind,[-2,2,3],[0,-1,0],shape);body.tilt=.7;
  const c=lab.prepareStep(1/60),n=lab.count;
  const actual=lab.gpu.solve(c.predicted,c.s,p=>lab.collide(p),3,p=>lab.solid(p),false,true);
  assert.equal(n,12852);assert.equal(actual.length,n*4);assert.ok(actual.every(Number.isFinite));
  assert.equal(lab.gpu.cpu,false);assert.equal(lab.gpu.cpuContacts,true);assert.ok(lab.u.uSandCount.value>0);
  assert.deepEqual(lab.gpu.resultTexture.image.data.slice(0,actual.length),actual);
 }
 lab.gpu.dispose();
});

test('spray probes and performance QA cannot reintroduce GPU object contact work',()=>{
 const forbidden=()=>assert.fail('object contact probe submitted graphics work');
 const renderer={extensions:{has:()=>true},getRenderTarget:forbidden,render:forbidden,compileAsync:forbidden};
 const lab=new SandLab(renderer);lab.spawn('glass',[0,2,0],[0,-1,0]);lab.syncUniforms();
 const probes=new EmitterProbes(renderer,lab.u);
 assert.equal(probes.update(lab.gpu,null,lab.count,lab.spacing),null);assert.equal(probes.target,undefined);
 const qa=verifyPerformancePaths(renderer,lab);assert.equal(qa.skipped,true);assert.equal(qa.pass,false);
 assert.match(qa.backend,/CPU object contacts/);assert.equal(probes.material.userData.skipObjectWarmup,true);
 probes.dispose();lab.gpu.dispose();
});

test('safe contact results feed GPU transport without overwriting the prediction',()=>{
 let target=null,draws=0;const renderer={extensions:{has:()=>true},getRenderTarget:()=>target,setRenderTarget:t=>target=t,render(){draws++;}};
 const lab=new SandLab(renderer);lab.objectRadius=.3;lab.spawn('glass',[0,2,0],[0,-1,0]);lab.syncUniforms();
 const p=new Float32Array([0,.3,0,0,.13,.3,0,0]),next=lab.gpu.solve(p,.2,p=>p,3,null,false,true);
 assert.equal(draws,0);const predicted=lab.gpu.texture,solved=lab.gpu.resultTexture,transport=new LabTransportGPU(renderer);
 transport.solve(p,p,new Float32Array(8),new Float32Array(8),lab.gpu.neighbors,.2,10,1/60,p,lab.gpu,true);
 assert.equal(draws,1);assert.equal(transport.u.uNext.value,solved);assert.equal(transport.u.uPredicted.value,predicted);
 assert.deepEqual(solved.image.data.slice(0,8),next);assert.deepEqual(predicted.image.data.slice(0,8),p);
 transport.dispose();lab.gpu.dispose();
});

test('empty-scene draws and explicit warmup cannot compile the disabled object constraint program',async()=>{
 const {LabFluidGPU}=await import('../src/sand-lab/water-lab-gpu.js');
 const renderer={extensions:{has:()=>true},render(){},compileAsync(){assert.fail('unsafe object warmup');}};
 installProgramSpecialization(renderer,()=>true);
 const gpu=new LabFluidGPU(renderer,{uStation:{value:6},uBodyCount:{value:0}});
 renderer.render(gpu.scene,gpu.camera);await renderer.warmObjectPrograms([gpu.scene],gpu.camera);
 gpu.scene.children[0].material=gpu.correctionMaterial;renderer.render(gpu.scene,gpu.camera);await renderer.warmObjectPrograms([gpu.scene],gpu.camera);
 gpu.dispose();
});
