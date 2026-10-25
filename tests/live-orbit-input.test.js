import test from 'node:test';
import assert from 'node:assert/strict';
import {MOUSE} from 'three';
import {installOrbitToolInput} from '../src/rtx-sand-lab/orbit-tool-input.js';
class Surface extends EventTarget{focus(){}setPointerCapture(){}}
const event=(type,x=0,y=0,button=0)=>{const e=new Event(type);Object.assign(e,{clientX:x,clientY:y,button,pointerId:1});return e;};
function setup(){const canvas=new Surface(),root=new Surface(),controls={mouseButtons:{}},state={tool:'grab-sand',first:false,locked:false,actions:0,locks:0,wind:false};
 const input=installOrbitToolInput({canvas,controls,root,firstPerson:()=>state.first,locked:()=>state.locked,tool:()=>state.tool,ray:e=>[e.clientX,e.clientY],action:()=>state.actions++,wind:v=>state.wind=v,requestLock:()=>state.locks++});return {canvas,root,controls,state,input};}
test('orbit dragging is available with a selected tool, while a click uses that tool once',()=>{
 const {canvas,root,controls,state}=setup();assert.equal(controls.mouseButtons.LEFT,MOUSE.ROTATE);assert.equal(controls.mouseButtons.RIGHT,MOUSE.ROTATE);
 canvas.dispatchEvent(event('pointerdown'));canvas.dispatchEvent(event('pointermove',30,40));root.dispatchEvent(event('pointerup',30,40));assert.equal(state.actions,0);
 canvas.dispatchEvent(event('pointerdown',20,20));root.dispatchEvent(event('pointerup',22,20));assert.equal(state.actions,1);
 state.tool='orbit';canvas.dispatchEvent(event('pointerdown'));root.dispatchEvent(event('pointerup'));assert.equal(state.actions,1);
});
test('wind paints on left hold, right drag stays free, and lost focus clears input',()=>{
 const {canvas,root,state,input}=setup();state.tool='wind';canvas.dispatchEvent(event('pointerdown'));assert.equal(state.actions,1);assert.equal(state.wind,true);
 root.dispatchEvent(event('blur'));assert.equal(state.wind,false);canvas.dispatchEvent(event('pointerdown',0,0,2));root.dispatchEvent(event('pointerup',40,0,2));assert.equal(state.actions,1);
 canvas.dispatchEvent(event('pointerdown'));input.dispose();root.dispatchEvent(event('pointerup'));assert.equal(state.actions,2);
});
test('first-person keeps pointer lock and immediate clicks; cancelled drags do not grab',()=>{
 const {canvas,root,state}=setup();state.first=true;canvas.dispatchEvent(event('pointerdown'));assert.equal(state.locks,1);assert.equal(state.actions,0);
 state.locked=true;canvas.dispatchEvent(event('pointerdown'));assert.equal(state.actions,1);
 state.first=false;canvas.dispatchEvent(event('pointerdown'));root.dispatchEvent(event('pointercancel'));root.dispatchEvent(event('pointerup'));assert.equal(state.actions,1);
});
