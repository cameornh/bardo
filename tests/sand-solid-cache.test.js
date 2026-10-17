import test from 'node:test';
import assert from 'node:assert/strict';
import {SandLab} from '../src/sand-lab/lab.js';
import {SAND} from '../src/sand-lab/sand.js';

const empty=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
function fixture(){
 const lab=new SandLab({extensions:{has:()=>false}});
 lab.wind=0;lab.sand.base.fill(-.7);lab.sand.update();
 return lab;
}
function chunk(lab,position,r,wet=0){
 const p={id:lab.sand.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*SAND.packing,packing:SAND.packing,wet,memory:wet,anchored:wet>.35,held:false};
 lab.sand.parcels.push(p);lab.sand.update();return p;
}

test('spray collision stays current when settling removes and reindexes sand clumps',()=>{
 const lab=fixture(),dry=chunk(lab,[0,.04,3],.05),wet=chunk(lab,[1,.3,3],.3,.95);
 lab.syncUniforms();
 lab.sand.step(1/30,empty,calm,10);
 assert.equal(dry.mass,0);assert.deepEqual(lab.sand.parcels,[wet]);
 // Wetting runs before the regular uniform sync in prepareStep. The old
 // index for the surviving wet clump is now outside the parcel array.
 lab.wetting.tracers.push({position:[1,.59,3],velocity:[0,-1,0],kind:0,age:0});
 assert.doesNotThrow(()=>lab.wetting.step(.02,false));
 assert.ok(lab.solid(wet.position,false,false)<-.29);
 assert.equal(lab.u.uSandCount.value,1);
});

test('held sand is collidable at its new position before the next render sync',()=>{
 const lab=fixture(),p=chunk(lab,[1,1,3],.1,.95),old=p.position.slice();
 p.held=true;p.offset=[0,0,0];lab.sandHeld=[p];lab.sandHoldDistance=1;
 lab.syncUniforms();
 lab.moveHeld([-2,1,3],[1,0,0]);
 assert.ok(lab.solid(p.position,false,false)<-.099);
 assert.ok(lab.solid(old,false,false)>.5);
 // Repeated queries must not rebuild/upload an unchanged spatial cache.
 const version=lab.u.uSandBins.value.version;
 lab.solid(p.position,false,false);
 assert.equal(lab.u.uSandBins.value.version,version);
});

test('carving away the last clump clears cached sand collisions immediately',()=>{
 const lab=fixture(),p=chunk(lab,[0,1,3],.1,.95);
 lab.syncUniforms();lab.sand.carve(p.position,.2);
 assert.equal(lab.sand.parcels.length,0);
 assert.ok(lab.solid(p.position,false,false)>.5);
 assert.equal(lab.u.uSandCount.value,0);
});
