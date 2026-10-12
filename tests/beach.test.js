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
 for(let i=0;i<240;i++){const next=stepBeachReference(f,a,bed,n,.75,BEACH_DT);f=next.flow;a=next.aux;}
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
test('zero wind is still and direction rotates the same wind field',()=>{assert.deepEqual(windAt(1,2,3,0,0),[0,0]);const a=windAt(1,2,3,7,0),b=windAt(1,2,3,7,Math.PI/2);assert.ok(Math.abs(a[1]-b[0])<1e-10);assert.ok(Math.abs(b[1])<1e-10);});

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
