import test from 'node:test';
import assert from 'node:assert/strict';
import {detailEmissionWeight,detailAirExposure,LabDetail} from '../src/water-lab-detail.js';
import {detailFluidState,detailFluidMotion,detailContact,DetailFlowField} from '../src/water-lab-detail-environment.js';
import {detailRadiance} from '../src/water-lab-detail-optics.js';
import {fixtureDistance,createMotion,buildNeighbors} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}};

test('buried turbulence cannot generate air while an exposed surface can',()=>{
  const data=[];for(let z=0;z<7;z++)for(let y=0;y<7;y++)for(let x=0;x<7;x++)data.push(x*.25,y*.25,z*.25,0);
  const positions=new Float32Array(data),surfaceMetrics=new Float32Array(data.length);
  for(let i=0;i<data.length;i+=4)surfaceMetrics.set([0,1,0,5],i);
  const lab={positions,surfaceMetrics,spacing:.25,gpu:{neighbors:buildNeighbors(positions,.25).data}};
  assert.equal(detailAirExposure(lab,(3*7+3)*7+3),0);
  assert.ok(detailAirExposure(lab,(3*7+6)*7+3)>.65);
});

test('whitewater generation scales with physical volume, support and capillary breakup',()=>{
  const reference=detailEmissionWeight(.25,1,18,1);
  assert.ok(Math.abs(8*detailEmissionWeight(.125,1,18,1)-reference)<1e-12);
  assert.ok(detailEmissionWeight(.25,.1,18,1)<reference*.002);
  assert.equal(detailEmissionWeight(.25,1,2,10),0);
  assert.ok(detailEmissionWeight(.25,1,4,1)<reference*.05);
  assert.equal(detailEmissionWeight(.19,.05,18,.02),0);
  assert.ok(detailEmissionWeight(.19,.05,18,.8)>0);
});

function emitVolume(count,spacing,scale=1,neighbors=18){
  const lab={count,spacing,spec:{scale},positions:new Float32Array(count*4),velocities:new Float32Array(count*4),surfaceMetrics:new Float32Array(count*4),neighborCounts:new Uint16Array(count).fill(neighbors)};
  for(let i=0;i<count;i++)lab.surfaceMetrics.set([0,1,0,.55],i*4);
  const detail=new LabDetail(mock);for(let step=0;step<30;step++){detail.emit(lab,1/60);detail.pending=0;}
  const countOut=detail.emitted;detail.dispose();return countOut;
}
test('refining a fixed volume does not multiply foam; small stirred volumes emit much less',()=>{
  const a=emitVolume(1024,.25),b=emitVolume(8192,.125),small=emitVolume(1024,.25,.1),isolated=emitVolume(1024,.25,1,3);
  assert.ok(a>1000);assert.ok(b/a>.8&&b/a<1.2,`${a} vs ${b}`);
  assert.ok(small<a*.01);assert.ok(isolated<a*.03);
});

test('bubbles follow liquid velocity, foam stays near its interface, and dry foam becomes spray',()=>{
  const field={sample:p=>{const rho=Math.max(0,.18-(p[1]-1)*.5);return [rho,rho*2,0,0];}};
  const bubble=detailFluidMotion([0,.4,0],[0,0,0],2,.1,1,.25,field);
  assert.equal(bubble.kind,2);assert.ok(bubble.velocity[0]>1);assert.ok(bubble.velocity[1]>0);
  const foam=detailFluidMotion([0,1.05,0],[0,0,0],1,.1,1,.25,field);
  assert.equal(foam.kind,1);assert.ok(Math.abs(foam.position[1]-1)<.005);
  assert.equal(detailFluidState(1,0),0);assert.equal(detailFluidState(2,.15),1);
  assert.equal(detailFluidState(0,.5),2);
});

test('swept contacts stop fast spray passing through a thin tank wall',()=>{
  const motion=createMotion(),lab={kind:'tank',motion,solid:p=>fixtureDistance(p,'tank',motion),balls:[]};
  const hit=detailContact([1.8,2,0],[2.8,2,0],[100,0,0],.01,lab);
  assert.ok(hit.position[0]<1.98);assert.ok(lab.solid(hit.position)>=.01-1e-8);assert.ok(hit.velocity[0]<=0);
  const falling=detailContact([0,.6,0],[0,-.6,0],[0,-100,0],.01,lab);
  assert.ok(falling.position[1]>.4);assert.ok(falling.velocity[1]>=0);
});

test('a moving wall pushes a marker even if it crossed the entire marker during the step',()=>{
  const previous=createMotion(),motion=createMotion();motion.position[0]=-.5;motion.velocity[0]=-5;
  const lab={kind:'tank',motion,solid:p=>fixtureDistance(p,'tank',motion),balls:[]};
  const hit=detailContact([1.8,2,0],[1.8,2,0],[0,0,0],.01,lab,previous);
  assert.ok(hit.position[0]<1.48);assert.ok(hit.velocity[0]<-4);assert.ok(lab.solid(hit.position)>=.01-1e-8);
});

test('coarse flow interpolation retains a constant liquid velocity',()=>{
  const positions=[];for(let z=-2;z<=2;z++)for(let y=0;y<5;y++)for(let x=-2;x<=2;x++)positions.push(x*.25,1+y*.25,z*.25,0);
  const lab={count:positions.length/4,spacing:.25,positions:new Float32Array(positions),velocities:new Float32Array(positions.length),neighborCounts:new Uint16Array(positions.length/4).fill(20)};
  for(let i=0;i<lab.count;i++)lab.velocities.set([1,-.2,.4],i*4);
  const field=new DetailFlowField(mock);field.update(lab,true);const result=field.sample([.12,1.55,.08]);
  assert.ok(result[0]>.5);[1,-.2,.4].forEach((v,k)=>assert.ok(Math.abs(result[k+1]/result[0]-v)<1e-7));field.dispose();
});

test('water attenuates marker illumination spectrally; bubbles are not luminous white foam',()=>{
  const clear=detailRadiance(1,[.5,.5,.5],1,0,0),deep=detailRadiance(1,[.5,.5,.5],1,3,2),bubble=detailRadiance(2,[.5,.5,.5],1,3,2);
  assert.ok(deep.every((v,k)=>v<clear[k]));assert.ok(deep[2]>deep[0]*2);
  assert.ok(bubble.every((v,k)=>v<deep[k]*.4));
  assert.deepEqual(detailRadiance(0,[.5,.5,.5],1,0,0),[2.4,2.25,1.95]);
});
