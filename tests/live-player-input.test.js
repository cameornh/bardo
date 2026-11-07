import test from 'node:test';
import assert from 'node:assert/strict';
import {installOrbitToolInput} from '../src/rtx-sand-lab/orbit-tool-input.js';
import {Walker} from '../src/rtx-sand-lab/walker.js';
import {playerWaterSurface} from '../src/rtx-sand-lab/player-water-surface.js';
class Surface extends EventTarget{focus(){}setPointerCapture(){}}
function event(type,x=0,y=0){const e=new Event(type);Object.assign(e,{button:0,pointerId:1,clientX:x,clientY:y});return e;}
for(const async of [false,true])test(`mouse capture ${async?'rejection':'throw'} falls back without killing input`,async()=>{
 const canvas=new Surface(),root=new Surface();let actions=0,turns=0,failures=0,requests=0;
 const input=installOrbitToolInput({canvas,root,controls:{mouseButtons:{}},firstPerson:()=>true,locked:()=>false,tool:()=> 'grab-sand',ray:()=>[],action:()=>actions++,wind:()=>{},look:(x,y)=>turns+=x+y,lockUnavailable:()=>failures++,requestLock:()=>{requests++;if(async)return Promise.reject(Error('Chromium bug'));throw Error('Chromium bug');}});
 canvas.dispatchEvent(event('pointerdown'));await Promise.resolve();canvas.dispatchEvent(event('pointermove',20,10));root.dispatchEvent(event('pointerup',20,10));assert.equal(turns,30);assert.equal(actions,0);assert.equal(failures,1);
 canvas.dispatchEvent(event('pointerdown'));root.dispatchEvent(event('pointerup'));assert.equal(actions,1);assert.equal(requests,1);input.dispose();
});
test('floating raises the eyes above water without continuing to fly',()=>{
 const w=new Walker();w.position=[0,-1,0];const solid=()=>({distance:100,normal:[0,1,0]});
 for(let i=0;i<600;i++)w.step(1/60,{buoyant:true},solid,()=>({density:.3,velocity:[0,0,0]}),{waterSurface:0});
 assert.ok(w.position[1]>.20&&w.position[1]<.27,String(w.position));assert.ok(Math.abs(w.velocity[1])<.01);
 for(let i=0;i<60;i++)w.step(1/60,{},solid,()=>({density:.3,velocity:[0,0,0]}),{waterSurface:0});assert.ok(w.position[1]<0);
});
test('surface location remains in physical metres as the beach grows',()=>{
 for(const scale of [5,10,20]){const lab={spec:{scale},spacing:3/scale,waterAt:p=>({density:p[1]*scale<4?.7:0})};assert.ok(Math.abs(playerWaterSurface(lab,[0,3,0])-4)<.01);assert.equal(playerWaterSurface(lab,[0,10,0]),null);}
});
