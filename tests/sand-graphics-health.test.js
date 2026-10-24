import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLabContext,createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';

function canvas(context=null){
 const listeners=new Map();
 return {listeners,requests:0,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),getContext(type){this.requests++;assert.equal(type,'webgl2');if(!context)listeners.get('webglcontextcreationerror')?.({statusMessage:'GPU process unavailable'});return context;}};
}
test('unavailable graphics preserves the browser reason without initializing or retrying the renderer',()=>{
 const c=canvas();let initialized=0,reported;
 assert.throws(()=>createLabRenderer(class {constructor(){initialized++;}},{canvas:c},e=>reported=e),/GPU process unavailable/);
 assert.equal(initialized,0);assert.equal(c.requests,1);assert.match(reported.message,/scene has not started/);assert.equal(c.listeners.size,0);
});
test('the renderer reuses the successfully requested context',()=>{
 const gl={},c=canvas(gl),r=createLabRenderer(class {constructor(options){this.options=options;}},{canvas:c,antialias:false},()=>assert.fail());
 assert.equal(r.options.context,gl);assert.equal(r.options.canvas,c);assert.equal(c.requests,1);
});
function fixture(){
 const c=canvas(),reports=[];let renders=0,lost=false;
 const renderer={domElement:c,debug:{},getContext:()=>({isContextLost:()=>lost}),render(){renders++;}};
 const guard=installGraphicsGuard(renderer,e=>reports.push(e));
 return {renderer,guard,reports,c,get renders(){return renders;},lose(){lost=true;}};
}
test('lost contexts halt future draws and report once',()=>{
 const f=fixture();f.renderer.render();f.lose();assert.throws(()=>f.renderer.render(),/context lost/);assert.throws(()=>f.renderer.render(),/context lost/);
 assert.equal(f.renders,1);assert.equal(f.reports.length,1);assert.equal(f.guard.failed,true);
});
test('shader failures stop draws and preserve the first diagnostic',()=>{
 const f=fixture(),gl={getProgramInfoLog:()=>'',getShaderInfoLog:()=>'',getShaderSource:()=>'#define SHADER_NAME WaterDensity\n'};
 assert.throws(()=>f.renderer.debug.onShaderError(gl,{}, {},{}),/WaterDensity/);
 assert.throws(()=>f.renderer.render(),/WaterDensity/);f.guard.stop(new Error('secondary failure'));
 assert.equal(f.renders,0);assert.equal(f.reports.length,1);assert.match(f.reports[0].message,/no error log/);
});
test('async warmup failures latch before another draw can run',async()=>{
 const c=canvas(),reports=[],renderer={domElement:c,debug:{},getContext:()=>({isContextLost:()=>false}),render(){assert.fail('draw after failure');},compileAsync:()=>Promise.reject(new Error('warmup failed'))};
 const guard=installGraphicsGuard(renderer,e=>reports.push(e));await assert.rejects(renderer.compileAsync(),/warmup failed/);
 assert.throws(()=>renderer.render(),/warmup failed/);assert.equal(reports.length,1);assert.equal(guard.failed,true);
});
