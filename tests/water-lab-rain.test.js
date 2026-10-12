import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {LAB_IDS} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}};
const ledger=lab=>lab.volume+lab.rain.unresolvedVolume*lab.spec.scale**3-lab.initialVolume-lab.rain.emitted*lab.spec.scale**3;

test('rain has independent station toggles and a common physical depth rate',()=>{
 const lab=new WaterLab(mock);
 for(const kind of LAB_IDS){lab.configure(kind);assert.equal(lab.rain.enabled,false);lab.rain.enabled=true;lab.rain.rate=5;for(let i=0;i<6;i++)lab.rain.step(.01);assert.ok(lab.rain.drops.length>0);assert.ok(Math.abs((lab.rain.emitted+lab.rain.sourceVolume)*lab.spec.scale/(9.6*8.4)-5/60000*.06)<1e-12);assert.ok(Math.abs(ledger(lab))<1e-9,kind);}
 lab.configure('tank');assert.equal(lab.rain.enabled,true);lab.rain.enabled=false;lab.configure('pool');assert.equal(lab.rain.enabled,true);lab.configure('tank');assert.equal(lab.rain.enabled,false);
});

test('switching rain off stops emission but existing drops still land',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');lab.rain.enabled=true;lab.rain.step(.03);const emitted=lab.rain.emitted,drop=lab.rain.drops[0],y=drop.position[1];lab.rain.enabled=false;lab.rain.step(.1);assert.equal(lab.rain.emitted,emitted);assert.ok(drop.position[1]<y);assert.ok(Math.abs(ledger(lab))<1e-9);
});

test('rain deposits retain fractional volume then become fresh fluid on dry ground',()=>{
 const lab=new WaterLab(mock);lab.configure('glass');const count=lab.count,pv=lab.spacing**3;lab.chem[0]=.4;
 const hit={point:[3,0,0],normal:[0,1,0],particle:-1};
 for(let i=0;i<4;i++){const volume=pv*.3;lab.rain.emitted+=volume;lab.rain.impact({volume,velocity:[0,-8,0]},hit);lab.rain.releaseDeposits();assert.ok(Math.abs(ledger(lab))<1e-12);}
 assert.equal(lab.count,count+1);assert.ok(lab.positions[count*4+1]>0);assert.ok(lab.positions[count*4]>2);assert.equal(lab.chem[0],Math.fround(.4));assert.equal(lab.chem[count*4],0);
 assert.ok(Math.abs(lab.rain.fieldItems().reduce((v,p)=>v+p.volume,0)-pv*.2)<1e-12);
});

test('rain transfers downward momentum into still water without changing existing solute',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');lab.velocities.fill(0);const index=Math.floor(lab.count/2),o=index*4,hit={point:[lab.positions[o],lab.positions[o+1]+lab.spacing*.42,lab.positions[o+2]],normal:[0,1,0],particle:index},volume=lab.spacing**3*.03;
 const before=lab.chem.slice();lab.rain.impact({volume,velocity:[0,-8,0]},hit);
 let momentum=0;for(let i=1;i<lab.velocities.length;i+=4)momentum+=lab.velocities[i]*lab.spacing**3;
 assert.ok(Math.abs(momentum+8*volume)<1e-8);assert.deepEqual(lab.chem,before);assert.ok(lab.rain.depositVolume>0);
});

test('an upright vessel collects sky rain while its inverted bottom shields the interior',()=>{
 for(const inverted of [false,true]){
  const lab=new WaterLab(mock);lab.configure('glass');if(inverted)lab.motion.tilt=Math.PI;
  const volume=lab.spacing**3*.05;lab.rain.emitted=volume;lab.rain.drops=[{position:[0,5,0],velocity:[0,-180,0],volume}];lab.rain.step(.027);
  assert.equal(lab.rain.hits,1);assert.equal(lab.rain.drops.length,0);assert.ok(Math.abs(ledger(lab))<1e-12);
  const deposit=[...lab.rain.deposits.values()][0];if(inverted){assert.equal(deposit.particle,-1);assert.ok(deposit.local);assert.ok(lab.rain.depositPoint(deposit)[1]>3.5);}else{assert.ok(deposit.particle>=0);assert.ok(lab.rain.depositPoint(deposit)[1]<3.4);}
 }
});

test('distributed rain on connected water raises the resolved inventory before individual patches fill',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');const before=lab.count,pv=lab.spacing**3;
 for(let x=0;x<8;x++){
  const particle=x,point=Array.from(lab.positions.subarray(x*4,x*4+3));point[1]+=lab.spacing*.42;
  const volume=pv*.14;lab.rain.emitted+=volume;lab.rain.impact({volume,velocity:[0,-8,0]},{point,normal:[0,1,0],particle});
 }
 lab.rain.releaseDeposits();assert.ok(lab.count>before);assert.ok(Math.abs(ledger(lab))<1e-9);
});


test('rain reserves its incoming volume against the bulk budget without deleting accumulated water',()=>{
 const lab=new WaterLab({extensions:{has:()=>false}});lab.configure('glass');lab.particleBudget=lab.count+1;
 const before=lab.count,initial=lab.volume;lab.rain.enabled=true;lab.rain.rate=120;
 for(let i=0;i<900;i++)lab.rain.step(1/60);
 assert.ok(lab.count<=before+1);assert.equal(lab.rain.capacityLimited,true);
 assert.ok(lab.rain.emitted<=lab.spacing**3+1e-10);
 assert.ok(Math.abs(lab.volume+lab.rain.unresolvedVolume*lab.spec.scale**3-initial-lab.rain.emitted*lab.spec.scale**3)<1e-10);
});
