import * as THREE from 'three';
import {SharedSceneWebGPU} from '../src/webgpu-sand-lab/renderer.js';
import {createCleanupFixture} from './webgpu-pass-cleanup-fixture.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
const canvas=document.querySelector('#view'),out=document.querySelector('#result'),report={checks:[],runs:[],images:[]};let fixture,variant='beach';
const width=Math.max(96,Math.min(320,Number(new URLSearchParams(location.search).get('width'))||320)),height=Math.round(width*.625);
const timingMode=new URLSearchParams(location.search).get('timings')||'optimized';
const show=value=>out.textContent=JSON.stringify(value,null,2),frame=()=>new Promise(requestAnimationFrame);
function action(id,fn){document.querySelector('#'+id).onclick=async()=>{const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){const failure={name:id,variant,pass:false,error:e.stack};report.checks.push(failure);show(failure);fixture?.renderer.dispose();fixture=null;}finally{buttons.forEach(b=>b.disabled=false);}};}
function policy(r,optimized){r.options.mergePasses=optimized;r.options.compactFormats=optimized;r.timing.enabled=r.timing.supported&&!r.timing.error&&(timingMode==='both'||(timingMode!=='off'&&optimized));}
async function pixels(r,target){const data=new Float32Array(target.width*target.height*4);await r.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,data);return data;}
function difference(a,b){let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(!Number.isFinite(d))throw Error('Non-finite image');max=Math.max(max,d);sum+=d;}return {max,mean:sum/a.length};}
action('tiny',async()=>{
 fixture?.renderer.dispose();fixture=null;const r=await SharedSceneWebGPU.create(canvas);r.autoClear=false;r.setSize(8,4,false);
 try{
  const target=new THREE.WebGLRenderTarget(8,4,{type:THREE.FloatType,depthBuffer:true});
  const red=new THREE.DataTexture(new Float32Array([.2]),1,1,THREE.RedFormat,THREE.FloatType),rg=new THREE.DataTexture(new Float32Array([.3,.4]),1,1,THREE.RGFormat,THREE.FloatType);red.needsUpdate=rg.needsUpdate=true;
  const geometry=new THREE.PlaneGeometry(2,2),camera=new THREE.Camera(),scene=new THREE.Scene(),material=new THREE.ShaderMaterial({name:'format-check',glslVersion:THREE.GLSL3,vertexShader:'void main(){gl_Position=vec4(position,1.);}',fragmentShader:'precision highp float;uniform sampler2D uA,uB;uniform float offset;out vec4 color;void main(){vec4 x=texelFetch(uA,ivec2(0),0),y=texelFetch(uB,ivec2(0),0);color=vec4(x.r+y.r+offset,y.g,x.b+y.b,x.a*y.a);}',uniforms:{uA:{value:red},uB:{value:rg},offset:{value:0}},depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(geometry,material));
  const outputs=[],stats=[];
  for(const optimized of [false,true]){
   policy(r,optimized);r.setRenderTarget(target);r.setClearColor(0,0);r.clear();material.uniforms.offset.value=0;r.render(scene,camera);
   r.setScissor(0,0,4,4);r.setScissorTest(true);material.uniforms.offset.value=.1;r.render(scene,camera);
   // Returning to full coverage must reset the scissor in a merged pass.
   r.setScissorTest(false);material.uniforms.offset.value=.2;r.render(scene,camera);await r.flush();outputs.push(await pixels(r,target));stats.push({...r.frameTimes,timing:r.timing.snapshot()});
  }
  const diff=difference(...outputs);for(let i=0;i<outputs[1].length;i+=4)if(Math.abs(outputs[1][i]-.7)>1e-6||Math.abs(outputs[1][i+1]-.4)>1e-6||outputs[1][i+2]!==0||outputs[1][i+3]!==1)throw Error('Native channel defaults or pass state changed');
  // Normalised data must also preserve RGBA default channels.
  const check={name:'tiny',pass:diff.max===0,diff,stats,features:[...r.device.features]};report.checks.push(check);show(check);target.dispose();geometry.dispose();material.dispose();red.dispose();rg.dispose();
 }finally{r.dispose();}
});
action('prepare',async()=>{
 fixture?.renderer.dispose();fixture=await createCleanupFixture(canvas,{width,height,options:{mergePasses:false,compactFormats:false}});variant='beach';
 for(const job of firstFrameShaderJobs(fixture.draw)){show({phase:'compiling',name:job.name});await fixture.renderer.compileAsync(job.scene,job.camera);}
 fixture.draw.render({dt:0,adaptive:false});await fixture.complete();show({pass:true,phase:'prepared',water:fixture.lab.count,render:fixture.renderer.frameTimes});
});
action('images',async()=>{
 if(!fixture)throw Error('Prepare beach first');const outputs=[],stats=[];
 for(const optimized of [false,true,false]){policy(fixture.renderer,optimized);for(let i=0;i<3;i++){fixture.draw.drawKey=null;fixture.draw.render({dt:0,adaptive:false});await fixture.complete();}stats.push({optimized,frame:fixture.renderer.frameTimes,bytes:fixture.renderer.allocationBytes});outputs.push(await pixels(fixture.renderer,fixture.field.target));}
 const diff=difference(outputs[0],outputs[1]),repeat=difference(outputs[0],outputs[2]),result={variant,pass:diff.max<1e-5&&repeat.max<1e-5,diff,repeat,stats};report.images.push(result);show(result);
});
action('measure',async()=>{
 if(!fixture)throw Error('Prepare beach first');const {lab,draw,renderer}=fixture,blocks=[];lab.paused=true;
 // Equal fixed physical work; same warm-up per block. A/B/B/A reduces order bias.
 for(const optimized of [false,true,true,false]){
  policy(renderer,optimized);resetWorkload();const rows=[];let start;
  for(let i=-8;i<24;i++){
   const began=performance.now();lab.step(lab.timestep);const cpu=performance.now()-began;draw.render({dt:lab.timestep,adaptive:false});await fixture.complete();
   if(i===-1)start=performance.now();if(i>=0)rows.push({frameMs:performance.now()-began,cpuMs:cpu,...renderer.frameTimes});
   if(i%8===0)show({phase:'measuring',variant,optimized,block:blocks.length+1,frame:i+1});await frame();
  }
  const wall=(performance.now()-start)/1000,sorted=rows.map(r=>r.frameMs).sort((a,b)=>a-b);blocks.push({optimized,frames:rows.length,wall,fps:rows.length/wall,realtime:rows.length*lab.timestep/wall,medianMs:sorted[12],p95Ms:sorted[22],bytes:renderer.allocationBytes,rows});
 }
 const summary=[false,true].map(optimized=>{const b=blocks.filter(b=>b.optimized===optimized),wall=b.reduce((s,b)=>s+b.wall,0),frames=b.reduce((s,b)=>s+b.frames,0);return {optimized,fps:frames/wall,realtime:frames*lab.timestep/wall,meanFrameMs:b.flatMap(b=>b.rows).reduce((s,r)=>s+r.frameMs,0)/frames};});
 const result={variant,resolution:[fixture.field.target.width,fixture.field.target.height],water:lab.count,timingMode,physics:'CPU/WASM, one fixed step per frame in both arms',adapter:renderer.adapter.info,summary,blocks};report.runs.push(result);show(result);
});
function addFeatures(){const {lab}=fixture;for(const [i,kind] of ['glass','mirror','rock','light'].entries()){const b=lab.spawn(kind,[-2+i*1.3,3,1],[0,0,-1],i%2?'cup':'sphere');b.position=[-2+i*1.3,2.3,0];b.velocity.fill(0);}lab.rain.enabled=true;lab.rain.rate=150;lab.tannins=.5;lab.sand.carve([0,lab.sand.height(0,3),3],.4);lab.syncUniforms();lab.revision++;}
function resetWorkload(){const {lab,draw}=fixture;lab.configure('ocean');lab.day=variant==='underwater night'?23:14;lab.rain.enabled=false;lab.tannins=0;lab.lunarCycle=false;lab.lunarDay=14.765;lab.seaFoam.reset();lab.clock=0;draw.clock=0;if(variant!=='beach')addFeatures();}
action('busy',async()=>{if(!fixture)throw Error('Prepare beach first');variant='objects rain edited sand';resetWorkload();fixture.draw.render({dt:0,adaptive:false});await fixture.complete();show({pass:true,variant});});
action('night',async()=>{fixture.lab.day=23;fixture.camera.position.set(0,.55,0);fixture.camera.lookAt(0,.8,-2);fixture.camera.updateMatrixWorld();variant='underwater night';fixture.draw.render({dt:0,adaptive:false});await fixture.complete();show({pass:true,variant});});
action('compute',async()=>{if(!fixture)throw Error('Prepare beach first');const result=await fixture.lab.bulkFields.verifyConnected();await frame();const timing=fixture.lab.bulkFields.connected?.timing?.snapshot();report.checks.push({name:'connected',...result,timing});show(report.checks.at(-1));});
action('export',async()=>{show(report);const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.href=url;link.download='webgpu-pass-cleanup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
