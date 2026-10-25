import test from 'node:test';import assert from 'node:assert/strict';
import {atmosphereSky} from '../src/sand-lab/atmosphere-model.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {SandEditPolicy} from '../src/rtx-sand-lab/sand-edit-policy.js';
test('direct-light slider scales lunar sky illumination while preserving the star background',()=>{
 const sky=gain=>atmosphereSky([0,1,0],[0,-1,0],{moonPhase:1,moonPosition:[0,1,0],enhancedNightSky:true,directLightIntensity:gain});
 const dark=sky(0),normal=sky(1),bright=sky(3);
 normal.forEach((v,k)=>{assert.ok(v>dark[k]);assert.ok(Math.abs((bright[k]-dark[k])/(v-dark[k])-3)<1e-12);});
 const legacy=gain=>atmosphereSky([0,1,0],[0,-1,0],{directLightIntensity:gain});assert.deepEqual(legacy(0),legacy(1));
});
test('live scene resets install bounded editing and direct illumination still scales moonlit surfaces',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}});lab.enhancedNightSky=true;lab.day=0;lab.lunarDay=14.765295;lab.moonPhaseOffset=0;
 assert.ok(lab.sand.editPolicy instanceof SandEditPolicy);
 lab.sunIntensity=1;lab.syncUniforms();const light=lab.sunlight;assert.ok(light>0&&light<.001);
 lab.sunIntensity=0;lab.syncUniforms();assert.equal(lab.sunlight,0);
 lab.sunIntensity=3;lab.syncUniforms();assert.ok(Math.abs(lab.sunlight/light-3)<1e-12);
 lab.configure('ocean');assert.ok(lab.sand.editPolicy instanceof SandEditPolicy);
});
