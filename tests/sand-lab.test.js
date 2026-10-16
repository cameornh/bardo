import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SandBed,SAND,moisture,aggregateDensity} from '../src/sand-lab/sand.js';
import {makeBody,bodyDistance,bodySupport,resolveSandContacts,recolorLatest} from '../src/sand-lab/objects.js';
import {resolutionPlan,refineWater} from '../src/sand-lab/water-lab-resolution.js';
import {LAB_PRESETS as newPresets,seedWater} from '../src/sand-lab/water-lab-model.js';
import {LAB_PRESETS as oldPresets} from '../src/water-lab-model.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
test('previous scene modules remain byte-for-byte snapshots',()=>{const files=JSON.parse(readFileSync(new URL('./scene-snapshots.json',import.meta.url)));for(const [file,hash] of Object.entries(files))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,file);});
test('new basin is larger on every physical axis without mutating original preset',()=>{assert.equal(oldPresets.ocean.scale,4);assert.ok(newPresets.ocean.scale>oldPresets.ocean.scale);});
test('sand extraction, partial deposition and residual exchange conserve solid volume',()=>{const b=new SandBed(33),initial=b.totalMass(),y=b.height(0,3),old=y;const pieces=b.extract([0,y,3],.8,[0,0,0],true);assert.ok(pieces.length>0&&b.height(0,3)<old);near(b.totalMass(),initial);for(const p of pieces){p.position[0]+=1;b.deposit(p,p.mass*.37);}near(b.totalMass(),initial);for(const p of pieces)b.deposit(p,p.mass);near(b.totalMass(),initial);assert.ok(b.mass.every(v=>v>=0));});
test('wet compaction reduces volume without deleting mass and has a finite density limit',()=>{const b=new SandBed(33);b.wet.fill(1);const initial=b.totalMass(),height=b.height(0,2);for(let i=0;i<50;i++)b.compact(0,2,1,10);assert.ok(b.height(0,2)<height);near(b.totalMass(),initial);assert.ok(b.packing.every(v=>v<=SAND.maxPacking+1e-10));const packed=b.height(0,2);b.compact(0,2,1,100);near(b.height(0,2),packed,1e-6);});
test('slow drying preserves compacted shape and plastic memory',()=>{const b=new SandBed(17);b.wet.fill(1);b.compact(0,3,1,10);const height=b.height(0,3);b.wet.fill(moisture(1,false,1200));assert.ok(b.wet[0]>.1);near(b.height(0,3),height);assert.ok(b.memory.some(v=>v>.9));});
test('dry aggregates start buoyant and become negatively buoyant after saturation',()=>{assert.ok(aggregateDensity(0)<1);assert.ok(aggregateDensity(moisture(0,true,12))>1);assert.ok(moisture(1,false,30)>.9);});
test('dry landing transfers all grain stock into the terrain in one step',()=>{const b=new SandBed(17),initial=b.totalMass(),p=b.extract([0,b.height(0,3),3],.6)[0];assert.ok(p);p.position[1]=b.height(p.position[0],p.position[2]);b.step(.03,()=>({density:0,velocity:[0,0,0]}),()=>[0,0,0]);assert.equal(p.mass,0);assert.ok(!b.parcels.includes(p));near(b.totalMass(),initial,1e-8);assert.ok(b.mass.every(v=>v>=0));});
test('cups have an open interior and a closed bottom in any orientation',()=>{const b=makeBody('glass','cup',1,[0,2,0]);assert.ok(bodyDistance([0,2,0],b)>.5);assert.ok(bodyDistance([0,1,0],b)<0);assert.ok(bodyDistance([.84,2,0],b)<0);assert.ok(bodyDistance([0,3.3,0],b)>0);b.tilt=Math.PI/2;assert.ok(bodyDistance([1,2,0],b)<0);assert.ok(bodyDistance([0,2,0],b)>.5);});
test('color edits only the most recently spawned material instance',()=>{const a=makeBody('mirror','sphere',1,[0,0,0]),b=makeBody('light','cup',1,[2,0,0]),before=a.color.slice();recolorLatest([a,b],[.1,.8,.2]);assert.deepEqual(a.color,before);assert.deepEqual(b.color,[.1,.8,.2]);assert.equal(a.ratio,1);assert.equal(b.ratio,1);});

test('water resolution and physical size have independent, bounded controls',()=>{const spec=newPresets.ocean,base=seedWater('ocean',spec),coarse=resolutionPlan(spec,base.length,1,1,32768),fine=resolutionPlan(spec,base.length,1,2.2,32768),large=resolutionPlan(spec,base.length,2,2.2,32768),extreme=resolutionPlan(spec,base.length,1,100,32768);assert.ok(fine.factor>coarse.factor*2);assert.equal(large.factor,fine.factor);near(large.targetSpacing,fine.targetSpacing*2);assert.ok(refineWater(base,spec.spacing,fine.factor).length<32768);assert.ok(extreme.limited);assert.ok(extreme.factor**3*base.length<32768);});
test('cup ground support follows tilt and the actual bottom thickness',()=>{const b=makeBody('glass','cup',1,[0,0,0]);near(bodySupport(b,[0,-1,0]),1.16);b.tilt=Math.PI/4;assert.ok(bodySupport(b,[0,-1,0])>1.4);b.tilt=Math.PI/2;near(bodySupport(b,[0,-1,0]),1);});
test('mobile sand contacts hollow cup walls without teleporting into the bed',()=>{const b=makeBody('glass','cup',1,[0,2,0]),p={position:[0,1.05,0],velocity:[0,-1,0],mass:.001,packing:.56,held:false};const mass=p.mass;resolveSandContacts([p],[b],1/60);assert.ok(p.position[1]>1.2);assert.ok(p.velocity[1]>=0);near(p.mass,mass);assert.ok(b.velocity[1]<0);});

import {boundaryShape,reconstructionKernel,reconstructionSample} from '../src/sand-lab/reconstruction.js';
import {SandLab} from '../src/sand-lab/lab.js';
test('sphere carving removes the spherical surface intersection and accounts for removed sand',()=>{
 const bed=new SandBed(129);bed.base.fill(-.7);const initial=bed.totalMass(),removed=bed.carve([0,0,0],.5);
 assert.ok(Math.abs(removed/(2*Math.PI*.5**3/3*SAND.packing)-1)<.08);
 near(bed.totalMass()+bed.removedMass,initial,1e-9);assert.ok(bed.height(0,0)<-.45);near(bed.height(1,0),0,1e-9);
 assert.ok(bed.carve([0,0,0],.5)<1e-10);assert.ok(bed.mass.every(v=>v>=0));
});
test('water carving keeps surviving momentum and chemistry aligned and clears stale indices',()=>{
 const lab={positions:new Float32Array([0,0,0,0,2,0,0,1,0,3,0,0]),velocities:new Float32Array([1,2,3,0,4,5,6,0,7,8,9,0]),chem:new Float32Array([.1,0,0,0,.2,0,0,0,.3,0,0,0]),spacing:.2,carvedWater:0,revision:0,gpu:{neighborOrigin:[]},detail:{remapEmitters(ids){this.retained=ids;}},held:{ids:[1]}};
 Object.defineProperty(lab,'count',{get(){return this.positions.length/4;}});
 assert.equal(SandLab.prototype.carveWater.call(lab,[0,0,0],1),1);assert.equal(lab.count,2);assert.deepEqual(Array.from(lab.velocities),[4,5,6,0,7,8,9,0]);near(lab.chem[0],.2,1e-7);near(lab.carvedWater,.008);assert.equal(lab.held,null);assert.equal(lab.gpu.neighborOrigin,null);assert.deepEqual(lab.detail.retained,[1,2]);
});
test('sand reconstruction has continuous slope across cell boundaries',()=>{
 const bed=new SandBed(33),k=16*33+16;bed.mass[k]+=.15;const x=0,z=0,e=1e-5;
 const left=(bed.height(x,z)-bed.height(x-e,z))/e,right=(bed.height(x+e,z)-bed.height(x,z))/e;
 assert.ok(Math.abs(left-right)<.003);assert.ok(Number.isFinite(left));
});
test('a dry deposit distributes across cells with bounded peak height',()=>{
 const bed=new SandBed(65),initial=bed.totalMass(),p={position:[0,0,0],mass:.003,packing:.56,wet:0,memory:0};const before=bed.height(0,0);bed.parcels.push(p);bed.deposit(p,p.mass);
 near(bed.totalMass(),initial+.003);assert.ok(bed.height(0,0)-before<.04);assert.ok(bed.mass.every(v=>v>=0));
});
test('boundary water kernels flatten in the normal direction and preserve volume normalization',()=>{
 const shape=boundaryShape(.08,.2);assert.ok(shape.flatten<.5&&shape.widen>1);assert.deepEqual(boundaryShape(4,.2),{widen:1,flatten:1});
 const p={position:[0,0,0],radius:.21,volume:.01,flatten:shape.flatten,normal:[0,1,0]},k=reconstructionKernel(p);
 near(k.amplitude*(2*Math.PI)**1.5*k.sigma**3*k.ratio,p.volume);
 assert.ok(reconstructionSample(p,[.15,0,0])>reconstructionSample(p,[0,.15,0])*8);
 const rotated={...p,normal:[1,0,0]};near(reconstructionSample(rotated,[.15,0,0]),reconstructionSample(p,[0,.15,0]));
});

import {buildNeighbors,NEIGHBORS} from '../src/sand-lab/water-lab-model.js';
test('cell-pair neighbors cover the support and remain symmetric',()=>{
 const n=210,s=.2,p=new Float32Array(n*4);for(let i=0;i<n;i++)p.set([(i%10)*.23+Math.sin(i)*.017,Math.floor(i/10)%7*.23,Math.floor(i/70)*.23],i*4);
 const {data,overflow}=buildNeighbors(p,s);assert.equal(overflow,0);
 for(let i=0;i<n;i++){const actual=new Set(Array.from(data.subarray(i*NEIGHBORS,(i+1)*NEIGHBORS)).filter(j=>j>=0)),expected=[];for(let j=0;j<n;j++)if(i!==j&&Math.hypot(p[i*4]-p[j*4],p[i*4+1]-p[j*4+1],p[i*4+2]-p[j*4+2])<s*2.65)expected.push(j);assert.deepEqual([...actual].sort((a,b)=>a-b),expected);for(const j of actual)assert.ok(data.subarray(j*NEIGHBORS,(j+1)*NEIGHBORS).includes(i));}
});
