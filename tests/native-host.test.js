import test from 'node:test';
import assert from 'node:assert/strict';
import {splitWideAttachments} from '../src/webgpu-sand-lab/attachment-limits.js';
import {installDOM} from '../native/dom.js';
import {NativeUI} from '../native/ui.js';

test('native MRT splitting preserves every output, order and full precision',()=>{
 const colors=Array.from({length:3},(_,i)=>({format:'rgba32float',id:i}));
 const state={colors,width:12,height:8};const clear={type:'clear',state,color:[0,0,0,0]},draw={type:'draw',state,name:'records'},upload={type:'upload'};
 const result=splitWideAttachments([clear,draw,upload],32);
 assert.equal(result.length,5);assert.equal(result[0].state,result[2].state);assert.equal(result[1].state,result[3].state);
 assert.deepEqual(result[2].state.colors,[colors[0],colors[1],null]);assert.deepEqual(result[3].state.colors,[null,null,colors[2]]);assert.equal(result[4],upload);
 assert.equal(state.colors,colors);assert.equal(splitWideAttachments([draw],64)[0],draw);
 assert.throws(()=>splitWideAttachments([{...draw,state:{...state,depth:{}}}],32),/depth-bearing/);
 assert.throws(()=>splitWideAttachments([draw],8),/exceeds/);
});
test('native controls emit the existing browser input/change handlers once',()=>{
 const d=installDOM({width:640,height:400,getContext:()=>({})});d.document.body.innerHTML='<button id="test-controls-toggle">Hide</button><aside id="panel"><label>Wind <output>3</output><input id="wind" type="range" min="0" max="80" step=".5" value="3"></label><label><input id="check" type="checkbox">Arrows</label><select id="select"><option value="a">A</option><option value="b">B</option></select><button id="action">Action</button><canvas id="slice" width="32" height="20"></canvas></aside>';
 const ui=new NativeUI(d);ui.width=640;ui.height=400;const counters={};
 for(const id of ['wind','check','select','action','slice']){const e=d.document.getElementById(id);for(const event of ['input','change','click','pointermove'])e['on'+event]=()=>counters[id+event]=(counters[id+event]||0)+1;}
 function click(id,kind){ui.build(640,400);const h=ui.hits.find(h=>h.el.id===id&&(!kind||h.kind===kind));assert.ok(h,id);ui.pointer('down',h.x+h.w*.75,h.y+5);return h;}
 const h=click('wind');ui.pointer('up',h.x+h.w*.75,h.y+5);assert.equal(d.document.getElementById('wind').value,'60');assert.equal(counters.windchange,1);
 click('check');assert.equal(d.document.getElementById('check').checked,true);assert.equal(counters.checkinput,1);assert.equal(counters.checkchange,1);
 click('select');click('select','option:1');assert.equal(d.document.getElementById('select').value,'b');assert.equal(counters.selectinput,1);assert.equal(counters.selectchange,1);
 click('action');assert.equal(counters.actionclick,1);
 const c=ui.hits.find(h=>h.el.id==='slice');ui.pointer('move',c.x+4,c.y+4);assert.equal(counters.slicepointermove,1);
 d.document.getElementById('panel').hidden=true;ui.build(640,400);assert.equal(ui.hits.length,1);
});
test('native canvas, mouse lock and resizing keep shared control semantics',async()=>{
 let locked=false;const d=installDOM({width:640,height:400,getContext:()=>42,lock:v=>locked=v});const c=d.document.createElement('canvas');c.id='view';d.document.body.append(c);assert.equal(c.getContext('webgpu'),42);assert.equal(c.clientWidth,640);
 let changes=0;d.document.addEventListener('pointerlockchange',()=>changes++);await c.requestPointerLock();assert.equal(locked,true);assert.equal(d.document.pointerLockElement,c);d.document.exitPointerLock();assert.equal(locked,false);assert.equal(changes,2);
 let resizes=0;d.events.addEventListener('resize',()=>resizes++);d.resize(800,500);assert.equal(c.clientWidth,800);assert.equal(resizes,1);
 const slice=d.document.createElement('canvas');slice.width=32;slice.height=16;assert.ok(slice.getContext('2d'));assert.equal(d.canvasImage(slice).width,32);
});

test('native presentation explicitly retires swapchain images once per frame',async()=>{
 const {nativeSurfaceContext}=await import('../native/surface.js');let acquired=0,presented=0,destroyed=0;const source={configure(){},getCurrentTexture(){acquired++;return {destroy(){destroyed++;}};}};
 const context=nativeSurfaceContext({getContext:()=>source,present(){presented++;}});context.configure({});assert.equal(context.getCurrentTexture(),context.getCurrentTexture());assert.equal(acquired,1);context.present();context.present();assert.equal(presented,1);assert.equal(destroyed,1);context.getCurrentTexture();context.present();assert.equal(acquired,2);assert.equal(destroyed,2);
});

test('outdated native surfaces retry once; other errors and repeated failures propagate',async()=>{
 const {nativeSurfaceContext}=await import('../native/surface.js');let attempts=0,configures=0,fail=true;
 const source={configure(){configures++;},getCurrentTexture(){attempts++;if(fail){fail=false;throw Error('Invalid Surface Status');}return {destroy(){}};}};
 const c=nativeSurfaceContext({getContext:()=>source,present(){}});c.configure({});assert.ok(c.getCurrentTexture());assert.equal(attempts,2);assert.equal(configures,2);c.present();
 source.getCurrentTexture=()=>{attempts++;throw Error('Device lost');};assert.throws(()=>c.getCurrentTexture(),/Device lost/);assert.equal(attempts,3);
 source.getCurrentTexture=()=>{attempts++;throw Error('Invalid Surface Status');};assert.throws(()=>c.getCurrentTexture(),/Invalid Surface/);assert.equal(attempts,5);
});
