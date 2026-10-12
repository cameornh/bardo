import test from 'node:test';
import assert from 'node:assert/strict';
import { beachBed,stepBeachReference,sandBrush,glassBallMass,submergedVolume,stepBeachBall,windAt,BEACH_DT } from '../src/beach-model.js';
import { WATER_MATERIAL,waterTransmittance } from '../src/water-material.js';
import { WATER_DENSITY } from '../src/fluid.js';
import { grassRay } from '../src/grass-ray.js';

const mass=f=>f.reduce((s,x,i)=>s+(i%4===0?x:0),0);
test('shoreline solver preserves a still lake and wet/dry balance over sloping ground',()=>{
 const n=16,bed=Float32Array.from({length:n*n},(_,i)=>beachBed(i%n*.75-6,Math.floor(i/n)*.75-6));let f=new Float32Array(n*n*4),a=f.slice();for(let i=0;i<bed.length;i++)f[i*4]=Math.max(0,-bed[i]);const initial=f.slice();
 for(let i=0;i<120;i++){const next=stepBeachReference(f,a,bed,n,.75,BEACH_DT);f=next.flow;a=next.aux;}
 assert.ok(Math.abs(mass(f)-mass(initial))<1e-5);for(let i=0;i<f.length;i++)if(i%4!==3)assert.ok(Math.abs(f[i]-initial[i])<1e-5);
});
test('a nudged isolated volume moves, remains nonnegative, and conserves water',()=>{
 const n=20,bed=Float32Array.from({length:n*n},(_,i)=>{const x=i%n,z=Math.floor(i/n);return x===0||z===0||x===n-1||z===n-1?2:-.7;});let f=new Float32Array(n*n*4),a=f.slice();for(let i=0;i<bed.length;i++)f[i*4]=Math.max(0,-bed[i]);f[(10*n+10)*4]+=.4;const initial=mass(f),center=f[(10*n+10)*4];
 for(let i=0;i<240;i++){const next=stepBeachReference(f,a,bed,n,.75,BEACH_DT,{mobileBed:false});f=next.flow;a=next.aux;}
 assert.ok(f.every(Number.isFinite));for(let i=0;i<f.length;i+=4)assert.ok(f[i]>=0);assert.ok(Math.abs(mass(f)-initial)/initial<1e-5);assert.ok(f[(10*n+10)*4]<center-.2);
});
test('sand nudges conserve bed volume including brushes near an active-region edge',()=>{
 const n=32,bed=new Float32Array(n*n);for(const point of [[12,12],[.1,.2],[23.8,11]]){const before=bed.reduce((a,b)=>a+b,0);sandBrush(bed,n,.75,[0,0],point,2,.8);assert.ok(Math.abs(bed.reduce((a,b)=>a+b,0)-before)<1e-5);}assert.ok(Math.max(...bed)>.2);assert.ok(Math.min(...bed)<-.01);
});
test('wet sand retains moisture after water leaves and later dries',()=>{
 const n=4,bed=new Float32Array(16);let f=new Float32Array(64),a=f.slice();for(let i=0;i<f.length;i+=4)f[i]=.2;for(let k=0;k<90;k++){const next=stepBeachReference(f,a,bed,n,.75,BEACH_DT);f=next.flow;a=next.aux;}assert.ok(a[0]>.99);f.fill(0);for(let k=0;k<60;k++)a=stepBeachReference(f,a,bed,n,.75,BEACH_DT).aux;assert.ok(a[0]>.9&&a[0]<1);
});
test('hollow glass buoyancy approaches displaced mass and follows moving water',()=>{
 const radius=.45,ball={position:[0,1,0],velocity:[0,0,0],spin:[0,0,0],radius,mass:glassBallMass(radius)};
 const sample=()=>({bed:-4,surface:0,h:4,u:.5,v:.3,dx:0,dz:0,wet:1});for(let i=0;i<1200;i++)stepBeachBall(ball,BEACH_DT,sample,[0,0]);
 assert.ok(Math.abs(submergedVolume(radius,ball.position[1],0)*WATER_MATERIAL.density-ball.mass)/ball.mass<.01);assert.ok(ball.position[0]>3&&ball.position[2]>2);assert.ok(ball.position.every(Number.isFinite));
});
test('water optical properties do not depend on container or extent',()=>{
 assert.equal(WATER_DENSITY,WATER_MATERIAL.density);const shallow=waterTransmittance(.15,.012),deep=waterTransmittance(12,.012);assert.ok(shallow.every(x=>x>.9));assert.ok(deep[2]>deep[1]&&deep[1]>deep[0]);assert.ok(waterTransmittance(2,.2).every((v,i)=>v<waterTransmittance(2,.012)[i]));assert.equal(WATER_MATERIAL.ior,1.333);
});
test('zero turbulence gives steady directional wind and zero speed gives still air',()=>{assert.deepEqual(windAt(1,2,3,0,0),[0,0]);assert.deepEqual(windAt(1,2,3,7,0,0),[0,7]);const b=windAt(20,-5,300,7,Math.PI/2,0);assert.ok(Math.abs(b[0]-7)<1e-10&&Math.abs(b[1])<1e-10);});

test('sand relaxes a steep mound conservatively and moisture increases its resting slope',()=>{
 const n=12,bed=new Float32Array(n*n);bed[6*n+6]=2;const flow=new Float32Array(n*n*4);let dry=flow.slice(),wet=flow.slice();for(let i=0;i<wet.length;i+=4)wet[i]=1;
 for(let k=0;k<120;k++){dry=stepBeachReference(flow,dry,bed,n,.75,BEACH_DT).aux;wet=stepBeachReference(flow,wet,bed,n,.75,BEACH_DT).aux;}
 const delta=a=>a.reduce((v,x,i)=>v+(i%4===3?x:0),0);assert.ok(Math.abs(delta(dry))<1e-5&&Math.abs(delta(wet))<1e-5);assert.ok(dry[(6*n+6)*4+3]<-.3);assert.ok(wet[(6*n+6)*4+3]>dry[(6*n+6)*4+3]);
});

test('blade-ray density is rotation invariant and rejects oversized off-axis footprints',()=>{
 for(let k=0;k<32;k++){const a=k*Math.PI/16,c=Math.cos(a),s=Math.sin(a),rotate=([x,y,z])=>[c*x+s*z,y,-s*x+c*z];const hit=grassRay(rotate([0,0,-1]),rotate([0,0,2]),rotate([0,1,0]),.3,.025);assert.ok(Math.abs(hit.depth-2)<1e-10);assert.ok(Math.abs(hit.density-1)<1e-10);
  const miss=grassRay(rotate([0,0,-1]),rotate([.3,0,.11]),rotate([0,1,0]),.3,.025);assert.ok(miss.density<1e-25,'a near-plane quad cannot shade pixels a blade does not cover');}
 assert.ok(grassRay([0,0,1],[0,0,2],[0,1,0],.3,.025).depth<0,'a blade behind the ray is rejected');
});

test('wind turbulence varies smoothly and is periodic with the distant field',async()=>{
 const {windPressure,airVelocity}=await import('../src/beach-wind.js');
 const calm=windAt(3,7,5,8,.3,0),gust=windAt(3,7,5,8,.3,1),strong=windAt(3,7,5,8,.3,2);for(let k=0;k<2;k++){assert.ok(Math.abs(strong[k]-calm[k]-2*(gust[k]-calm[k]))<1e-10);assert.ok(Math.abs(gust[k]-windAt(515,519,5,8,.3,1)[k])<1e-10);}assert.equal(windPressure(3,7,5,8,.3,0),0);
 const jet={origin:[0,4,0],direction:[0,-.6,.8],radius:1,strength:30,length:40};const a=airVelocity([0,1,4],0,0,0,jet);assert.ok(a[1]<-10&&a[2]>10);assert.deepEqual(airVelocity([0,6,-4],0,0,0,jet),[0,0,0]);assert.ok(Math.hypot(...airVelocity([20,1,4],0,0,0,jet))<.01);
});
test('wind creates waves from rest, while unforced periodic water remains flat',()=>{
 const n=12,dx=2,bed=new Float32Array(n*n).fill(-2),initial=new Float32Array(n*n*4);for(let i=0;i<initial.length;i+=4)initial[i]=2;
 const run=wind=>{let flow=initial.slice(),aux=initial.slice().fill(0);for(let i=0;i<100;i++){const next=stepBeachReference(flow,aux,bed,n,dx,BEACH_DT,{wind,time:i*BEACH_DT,periodic:true,mobileBed:false,turbulence:1.5});flow=next.flow;aux=next.aux;}return flow;};const still=run(0),windy=run(14);for(let i=0;i<initial.length;i++)assert.equal(still[i],initial[i]);assert.ok(Math.abs(mass(windy)-mass(initial))<1e-4);assert.ok(windy.some((v,i)=>i%4===0&&Math.abs(v-2)>.01));assert.ok(windy.some((v,i)=>i%4===2&&v>.05));
});
test('rock barriers deflect water without being eroded into sand',()=>{
 const n=16,bed=new Float32Array(n*n).fill(-1),bedrock=new Uint8Array(n*n);let f=new Float32Array(n*n*4),a=f.slice();for(let z=4;z<12;z++){bed[z*n+8]=2;bedrock[z*n+8]=1;}for(let i=0;i<bed.length;i++){f[i*4]=Math.max(0,-bed[i]);f[i*4+1]=f[i*4]*.5;}for(let k=0;k<100;k++){const next=stepBeachReference(f,a,bed,n,.65,BEACH_DT,{bedrock});f=next.flow;a=next.aux;}assert.ok(f.every(Number.isFinite));for(let i=0;i<bed.length;i++)if(bedrock[i]){assert.equal(f[i*4],0);assert.equal(a[i*4+3],0);}assert.ok(f.some((v,i)=>i%4===2&&Math.abs(v)>.02),'flow turns around the barrier');
});
test('body storage grows beyond twelve balls and contacts conserve momentum',async()=>{
 const {BodyTexture,solveBallContacts}=await import('../src/beach-bodies.js');const bodies=Array.from({length:300},(_,i)=>({position:[i*2,0,0],velocity:[0,0,0],radius:.4,mass:3}));const packed=new BodyTexture();packed.update(bodies);assert.ok(packed.capacity>=600);assert.equal(packed.data[299*8],598);bodies[0].velocity[0]=2;bodies[1].position[0]=.7;assert.equal(solveBallContacts(bodies),1);assert.ok(Math.abs(bodies[0].velocity[0]+bodies[1].velocity[0]-2)<1e-10);assert.ok(bodies[1].position[0]-bodies[0].position[0]>=.79999);packed.dispose();
});
test('raised underwater mounds displace water, preserve its volume, and expose dry peaks',async()=>{
 const {BeachSimulation}=await import('../src/beach-gpu.js');const s=new BeachSimulation({extensions:{has:()=>false}},{n:48,dx:.4,origin:[-9.6,-9.6],ocean:false});s.bedrock.fill(0);s.bed.fill(-.2);s.flow.fill(0);s.aux.fill(0);for(let i=0;i<s.flow.length;i+=4)s.flow[i]=.2;s.upload();const before=mass(s.flow);s.nudgeSand(0,0,2,1.5);assert.ok(Math.abs(mass(s.flow)-before)<1e-4);let dry=0;for(let i=0;i<s.bed.length;i++)if(s.bed[i]>.05){assert.equal(s.flow[i*4],0);dry++;}assert.ok(dry>0);const peak=s.sample(0,0);assert.ok(peak.h<.01,'dry cells cannot reconstruct a water tower');s.dispose();
});
test('sand parcels borrow and return terrain volume, with wet test-05 cohesion',async()=>{
 const {BeachSimulation}=await import('../src/beach-gpu.js'),{BeachParcels,sedimentProperties}=await import('../src/beach-parcels.js'),{GRAIN_MATERIALS}=await import('../src/granular.js');const s=new BeachSimulation({extensions:{has:()=>false}},{n:48,dx:.5,origin:[-12,4],ocean:false});s.wind=0;s.bedrock.fill(0);const p=new BeachParcels(s);assert.equal(sedimentProperties(0).friction,GRAIN_MATERIALS[1].friction);assert.equal(sedimentProperties(1).cohesion,GRAIN_MATERIALS[2].cohesion);p.nudge([0,s.sample(0,14).bed,14],[1,0,0],1);assert.equal(p.items.length,64);const terrainDelta=s.impulses.reduce((v,x,i)=>v+(i%4===3?x:0),0)*s.dx**2;assert.ok(Math.abs(p.sandVolume+terrainDelta)<1e-7);for(let i=0;i<600;i++)p.step(BEACH_DT,[]);assert.ok(p.items.length<64,'sand settles back into the field');assert.ok(Math.abs(p.sandVolume+s.impulses.reduce((v,x,i)=>v+(i%4===3?x:0),0)*s.dx**2)<1e-6);s.dispose();
});
test('underwater sand slumping exchanges water with neighbours instead of lifting its column',()=>{
 const n=12,bed=new Float32Array(n*n).fill(-2);bed[6*n+6]=-1;let flow=new Float32Array(n*n*4),aux=flow.slice();for(let i=0;i<bed.length;i++){flow[i*4]=-bed[i];aux[i*4]=1;}const initial=mass(flow);for(let i=0;i<90;i++){const next=stepBeachReference(flow,aux,bed,n,.65,BEACH_DT);flow=next.flow;aux=next.aux;}assert.ok(Math.abs(mass(flow)-initial)<1e-4);assert.ok(Math.abs(bed[6*n+6]+aux[(6*n+6)*4+3]+flow[(6*n+6)*4])<.02);
});
test('pending material transfers survive leaving and returning to a simulation tile',async()=>{
 const {BeachSimulation}=await import('../src/beach-gpu.js');const s=new BeachSimulation({extensions:{has:()=>false}},{n:48,dx:.5,origin:[-12,4],ocean:false});const before=mass(s.flow);assert.ok(s.queueTransfer(0,14,.05,.02));s.recenter(100,16);s.recenter(0,16);assert.ok(Math.abs((mass(s.flow)-before)*s.dx**2-.05)<1e-5);assert.ok(s.savedBed.size>0);assert.equal(s.hasImpulses,false);s.dispose();
});
