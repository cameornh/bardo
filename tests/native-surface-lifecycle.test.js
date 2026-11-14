import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSurfaceContext} from '../native/surface.js';
import {nativeWindowVisible} from '../native/window-state.js';
import {SharedSceneWebGPU} from '../src/webgpu-sand-lab/renderer.js';

function fixture(){
 const calls=[],images=[];let visible=true;
 const image=kind=>{const i={kind,destroyed:0,createView(){return {image:i};},destroy(){i.destroyed++;calls.push('destroy '+kind);}};images.push(i);return i;};
 const device={createTexture(config){calls.push('temporary');assert.equal(config.format,'bgra8unorm');assert.deepEqual(config.size,[640,400]);return image('temporary');}};
 const source={configure(){calls.push('configure');},unconfigure(){calls.push('unconfigure');},getCurrentTexture(){calls.push('acquire');return image('window');}};
 const surface={width:640,height:400,getContext:()=>source,present(){calls.push('present');}};
 const context=nativeSurfaceContext(surface,()=>calls.push('reconfigure'),{isVisible:()=>visible});context.configure({device,format:'bgra8unorm'});
 return {context,source,surface,calls,images,device,hide:()=>visible=false,show:()=>visible=true};
}
test('macOS visibility ignores unrelated flags and app focus; Windows minimize suspends',()=>{
 assert.equal(nativeWindowVisible([1,8192,0],true),false);
 assert.equal(nativeWindowVisible([1,8194,0],true),true);
 assert.equal(nativeWindowVisible([0,8194,1],true),false);
 assert.equal(nativeWindowVisible([1,0,1],false),false);
 assert.equal(nativeWindowVisible([1,1,0],false),true);
});
test('hidden in-flight frame uses one temporary image, no native acquire or present, then resumes directly',()=>{
 const f=fixture();f.hide();const a=f.context.getCurrentTexture();assert.equal(f.context.getCurrentTexture(),a);
 assert.equal(f.context.temporary,true);assert.equal(f.context.stats.temporaryBytes,640*400*4);
 assert.equal(f.context.present(),false);assert.equal(f.context.present(),false);assert.equal(a.destroyed,1);
 assert.equal(f.context.stats.temporaryBytes,0);assert.equal(f.context.stats.skipped,1);assert.equal(f.calls.includes('acquire'),false);assert.equal(f.calls.includes('present'),false);
 f.show();const b=f.context.getCurrentTexture();assert.equal(b.kind,'window');assert.equal(f.context.present(),true);assert.equal(b.destroyed,1);assert.equal(f.context.stats.presented,1);assert.equal(f.context.stats.reconfigures,0);
});
test('occlusion during failed acquisition avoids an inappropriate reconfigure retry',()=>{
 const f=fixture();let attempts=0;f.source.getCurrentTexture=()=>{attempts++;f.hide();throw Error('Invalid Surface Status');};
 assert.equal(f.context.getCurrentTexture().kind,'temporary');assert.equal(attempts,1);assert.equal(f.context.stats.reconfigures,0);f.context.present();
});
test('occlusion during reconfigure or the single retry is bounded',()=>{
 for(const at of ['configure','retry']){
  const f=fixture();let attempts=0;f.source.getCurrentTexture=()=>{attempts++;if(attempts===2)f.hide();throw Error('Invalid Surface Status');};
  if(at==='configure')f.source.configure=()=>f.hide();
  assert.equal(f.context.getCurrentTexture().kind,'temporary');assert.equal(attempts,at==='configure'?1:2);assert.equal(f.context.stats.reconfigures,1);f.context.present();
 }
});
test('visible repeated surface failure and device errors still stop immediately',()=>{
 const f=fixture();let attempts=0;f.source.getCurrentTexture=()=>{attempts++;throw Error('Invalid Surface Status');};
 assert.throws(()=>f.context.getCurrentTexture(),/Invalid Surface/);assert.equal(attempts,2);assert.equal(f.images.length,0);
 f.source.getCurrentTexture=()=>{attempts++;f.hide();throw Error('Device lost');};assert.throws(()=>f.context.getCurrentTexture(),/Device lost/);assert.equal(attempts,3);assert.equal(f.images.length,0);
});
test('present failure retires its image; disposed or outstanding surfaces cannot be reused/reconfigured',()=>{
 const f=fixture(),a=f.context.getCurrentTexture();assert.throws(()=>f.context.configure({}),/outstanding/);f.surface.present=()=>{throw Error('present failed');};
 assert.throws(()=>f.context.present(),/present failed/);assert.equal(a.destroyed,1);assert.equal(f.context.present(),false);
 f.hide();const b=f.context.getCurrentTexture();f.context.dispose();f.context.dispose();assert.equal(b.destroyed,1);assert.equal(f.calls.filter(x=>x==='unconfigure').length,1);assert.throws(()=>f.context.getCurrentTexture(),/disposed/);
});
test('hidden allocation remains bounded and rejects invalid dimensions',()=>{
 for(const width of [0,1921,Infinity,NaN]){const f=fixture();f.hide();f.surface.width=width;assert.throws(()=>f.context.getCurrentTexture(),/size/);assert.equal(f.images.length,0);}
});
test('real scene flush can become occluded while awaiting a pipeline without failing or losing its CPU step',async()=>{
 const f=fixture(),events=[];let release;const prepared=new Promise(resolve=>release=resolve),r=Object.create(SharedSceneWebGPU.prototype);
 const draw={type:'draw',state:null,name:'display',program:prepared,attributes:{},uniforms:{},textures:{},samplers:{},viewport:[0,0,640,400],range:{start:0,count:3},count:3,instances:1};
 const pass={setPipeline(){},setViewport(){},setScissorRect(){},draw(){events.push('draw');},end(){}};
 Object.assign(r,{context:f.context,domElement:{width:640,height:400},commands:[draw],temporary:[],info:{render:{}},options:{},uniform(){return {};},pipeline:async()=>({pipeline:{},activeAttributes:[]}),destroyResource(){},
 device:{pushErrorScope(){},async popErrorScope(){return null;},createCommandEncoder(){return {beginRenderPass(descriptor){assert.equal(descriptor.colorAttachments[0].view.image.kind,'temporary');return pass;},finish(){return {};}};},queue:{submit(){events.push('submit');},async onSubmittedWorkDone(){events.push('complete');}}}});
 const flushing=r.flush({cpuWork:()=>events.push('physics')});f.hide();release({key:'display',uniforms:{fields:[],size:0},buffers:{},textures:{},samplers:{},layouts:[],resources:new Map()});
 await flushing;assert.equal(r.failure,undefined);assert.equal(r.flushing,false);assert.deepEqual(events,['draw','submit','complete','physics']);assert.equal(f.context.present(),false);assert.equal(f.calls.includes('acquire'),false);
});
