import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWalkMouse} from '../src/asset-studio/walk.js';

function emit(target,type,properties={}){
 const event=Object.assign(new Event(type,{cancelable:true}),properties);
 target.dispatchEvent(event);
 return event;
}

function studioMouse(){
 const doc=new EventTarget(),canvas=new EventTarget(),motion=[],transitions=[],captures=[];
 doc.defaultView=new EventTarget();doc.pointerLockElement=null;
 canvas.ownerDocument=doc;canvas.isConnected=true;
 const walk={enabled:true,look:(dx,dy)=>motion.push([dx,dy])};
 const setLock=element=>{doc.pointerLockElement=element;emit(doc,'pointerlockchange');};
 doc.exitPointerLock=()=>setLock(null);
 canvas.setPointerCapture=id=>{
  captures.push(id);
  if(doc.pointerLockElement)throw new DOMException('Pointer is locked','InvalidStateError');
 };
 const mouse=bindWalkMouse(canvas,walk,{
  onLocked:()=>transitions.push('locked'),
  onUnlocked:()=>{transitions.push('unlocked');walk.enabled=false;}
 });
 return {doc,canvas,walk,mouse,setLock,motion,captures,transitions};
}

test('first-person tools never capture the locked pointer and relative movement is applied once',()=>{
 const {doc,canvas,walk,mouse,setLock,motion,captures,transitions}=studioMouse();
 let requests=0;
 canvas.requestPointerLock=()=>{requests++;};
 mouse.request();mouse.request();mouse.captureToolDrag(7);
 assert.equal(requests,1);
 setLock(canvas);mouse.captureToolDrag(7);
 const move={pointerId:7,movementX:9,movementY:-4};
 emit(doc,'pointermove',move);emit(doc,'mousemove',move);
 assert.deepEqual(motion,[[9,-4]]);assert.deepEqual(captures,[]);
 setLock(null); // Browser consumed Escape, so the page never received a keydown.
 assert.equal(walk.enabled,false);assert.deepEqual(transitions,['locked','unlocked']);
 emit(doc,'mousemove',move);assert.equal(motion.length,1);
 mouse.captureToolDrag(8);assert.deepEqual(captures,[8]);mouse.dispose();
});

test('refused native lock leaves right-drag look and primary tools independent',async()=>{
 const {doc,canvas,mouse,motion}=studioMouse();
 let requests=0;
 canvas.requestPointerLock=()=>{requests++;return Promise.reject(new DOMException('Unavailable','NotAllowedError'));};
 mouse.request();await Promise.resolve();
 const down={button:2,pointerType:'mouse',pointerId:1,clientX:20,clientY:40};
 const move={...down,buttons:2,clientX:23,clientY:36};
 emit(canvas,'pointerdown',{...down,button:0});
 emit(doc,'pointermove',{...move,buttons:1});assert.deepEqual(motion,[]);
 emit(canvas,'pointerdown',down);await Promise.resolve();
 emit(doc,'pointermove',{...move,pointerId:2});emit(doc,'pointermove',move);
 emit(doc,'pointerup',move);emit(doc,'pointermove',move);
 emit(canvas,'pointerdown',down);emit(doc.defaultView,'blur');emit(doc,'pointermove',move);
 assert.deepEqual(motion,[[3,-4]]);assert.equal(requests,2);
 assert.equal(emit(canvas,'contextmenu').defaultPrevented,true);
 mouse.dispose();
});

test('leaving while a lock request is pending releases a late grant',()=>{
 const {doc,canvas,walk,mouse,setLock,transitions}=studioMouse();
 canvas.requestPointerLock=()=>{};
 mouse.request();walk.enabled=false;mouse.release();setLock(canvas);
 assert.equal(doc.pointerLockElement,null);assert.deepEqual(transitions,[]);mouse.dispose();
});

test('an expired orbit drag cannot stop the scene',()=>{
 const {canvas,walk,mouse}=studioMouse();walk.enabled=false;
 for(const name of ['InvalidStateError','NotFoundError']){
  canvas.setPointerCapture=()=>{throw new DOMException('',name);};
  assert.doesNotThrow(()=>mouse.captureToolDrag(1));
 }
 canvas.setPointerCapture=()=>{throw new Error('unexpected');};
 assert.throws(()=>mouse.captureToolDrag(1),/unexpected/);
 canvas.isConnected=false;assert.doesNotThrow(()=>mouse.captureToolDrag(1));mouse.dispose();
});
