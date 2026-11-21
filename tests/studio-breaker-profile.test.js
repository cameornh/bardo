import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,PlaneGeometry,ShaderMaterial,Vector3,BufferAttribute} from 'three';
import {WindSea} from '../src/asset-studio/ocean.js';
import {lipPoint,crestLevel,breakerProfile} from '../src/asset-studio/breaking-wave.js';
import {BreakingGrid} from '../src/asset-studio/breaking-grid.js';
import {windAt} from '../src/asset-studio/wind.js';
import {planarSurface} from '../src/asset-studio/surface-support.js';
import {stamp,seedLibrary,validateLibrary} from '../src/asset-studio/model.js';

test('a crest is continuous at birth and across its sides, can overturn, and rejoins the same surface',()=>{
 const sea=new WindSea();sea.breakCrest(0,0,2,1,0);const c=sea.crests[0];
 for(const t of [0,c.duration]){
  for(const u of [.16,.63,.98]){const p=lipPoint(c,0,u,t);assert.ok(Math.abs(p.y)<1e-10&&Math.abs(p.x-p.baseX)<1e-10);}
 }
 sea.sampleTime(c.duration/2);
 for(const s of [-1,1])assert.equal(lipPoint(c,s,.7,sea.time).y,0);
 const points=Array.from({length:101},(_,i)=>lipPoint(c,0,.25+.006*i,sea.time));
 assert.ok(points.some((p,i)=>i&&p.x<points[i-1].x),'water must actually turn back over itself');
 for(const p of points)assert.ok(crestLevel(c,p.x,p.z)>=p.y-.008,'buoyancy sees the upper envelope');
 assert.equal(crestLevel(c,0,c.span+1),0);
 assert.ok(breakerProfile.every(Number.isFinite));
});

test('mesh refinement replaces and restores the original triangles without duplicate sheets',()=>{
 const base=new PlaneGeometry(12,12,32,32);base.rotateX(-Math.PI/2);
 base.setAttribute('spacing',new BufferAttribute(new Float32Array(base.attributes.position.count).fill(.38),1));
 const mesh=new Mesh(base,new ShaderMaterial()),initial=base.index.array.slice(),grid=new BreakingGrid(mesh);
 const sea=new WindSea();sea.breakCrest(0,0,2,1,0);sea.sampleTime(.4);
 grid.update(sea,new Vector3());assert.ok(grid.active.size>0);
 assert.equal(grid.mesh.geometry.instanceCount,grid.active.size);
 for(let i=0;i<initial.length;i++)assert.equal(base.index.array[i],grid.active.has(Math.floor(i/6))?0:initial[i]);
 sea.breakCrest(.04,.01,2,1,0);assert.equal(sea.crests.length,1);
 sea.reset();grid.update(sea,new Vector3());assert.equal(grid.mesh.visible,false);assert.deepEqual(initial,base.index.array);grid.dispose();
});

test('hard box surfels cover exterior faces and carry finite supports up to the authored edges',()=>{
 const stamps=[stamp('box','add',[0,0,0],[.3,.09,.17],'copper',0),stamp('box','add',[-.19,.06,0],[.1,.07,.17],'copper',0)];
 const s=planarSurface(stamps,.055);assert.ok(s.materials.length);
 for(let i=0;i<s.positions.length;i+=3){
  const p=s.positions.slice(i,i+3),n=s.normals.slice(i,i+3);
  assert.equal(n.reduce((a,b)=>a+Math.abs(b),0),1);
  assert.ok(p.every((x,k)=>s.supportMin[i+k]<=x&&x<=s.supportMax[i+k]));
  const outside=p.map((x,k)=>x+.0001*n[k]);
  assert.ok(!stamps.some(b=>outside.every((x,k)=>Math.abs(x-b.position[k])<b.size[k])));
 }
 assert.equal(planarSurface([stamp('sphere')],.055),null);
});

test('wind turbulence is optional, smooth in time and space, independent of view and persistent',()=>{
 const w={speed:20,heading:32,turbulence:.8};
 assert.deepEqual(windAt({...w,turbulence:0},3),{...w,turbulence:0});
 assert.equal(windAt({...w,speed:0},1).speed,0);
 const a=windAt(w,4,1,3),near=windAt(w,4.001,1.001,3);assert.ok(Math.abs(a.speed-near.speed)<.04&&Math.abs(a.heading-near.heading)<.1);
 assert.notDeepEqual(a,windAt(w,9,1,3));assert.notDeepEqual(a,windAt(w,4,23,3));
 const sea=new WindSea(20,32);const versions=sea.bands.map(b=>b.version);sea.setWind(20,32,.8);
 assert.deepEqual(sea.bands.map(b=>b.version),versions);sea.sampleTime(3);assert.notEqual(sea.airX,sea.wx*sea.speed);
 const l=seedLibrary();l.world.wind=w;assert.equal(validateLibrary(JSON.parse(JSON.stringify(l))).world.wind.turbulence,.8);
 l.world.wind.turbulence=2;assert.throws(()=>validateLibrary(l));
});
