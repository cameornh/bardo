import * as THREE from 'three';
import {LabWaterField} from '../src/sand-lab/water-lab-field.js';
import {SceneShaderCompiler} from '../src/webgpu-sand-lab/compiler.js';
import {createSharedFixture} from '../src/webgpu-sand-lab/fixture.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
const out=document.querySelector('#result');
document.querySelector('#check').onclick=async()=>{
 let device;
 try{
  out.textContent='Translating…';const compiler=new SceneShaderCompiler();
  const shader=await compiler.compile('in vec3 position;out vec2 vUv;uniform mat4 projectionMatrix;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position,1.);}','precision highp float;in vec2 vUv;out vec4 color;uniform sampler2D uImage;uniform float scale;void main(){color=textureLod(uImage,vUv,0.)*scale;}');
  const adapter=await navigator.gpu.requestAdapter();device=await adapter.requestDevice();
  const infos=[];for(const code of [shader.vertex,shader.fragment])infos.push((await device.createShaderModule({code}).getCompilationInfo()).messages.map(m=>({type:m.type,line:m.lineNum,message:m.message})));
  out.textContent=JSON.stringify({pass:infos.every(a=>a.every(m=>m.type!=='error')),infos,attributes:shader.attributes,uniforms:shader.uniforms,buffers:shader.buffers,textures:shader.textures,samplers:shader.samplers,features:[...adapter.features],limits:{textures:adapter.limits.maxSampledTexturesPerShaderStage,samplers:adapter.limits.maxSamplersPerShaderStage}},null,2);compiler.stop();
 }catch(e){out.textContent=e.stack;}finally{device?.destroy();}
};
let fixture;
document.querySelector('#scene').onclick=async()=>{
 const compiled=[];
 try{
  fixture?.renderer.dispose();fixture=await createSharedFixture(document.querySelector('#view'),{backend:new URLSearchParams(location.search).get('backend')||'webgpu'});
  for(const job of firstFrameShaderJobs(fixture.draw)){
   out.textContent=JSON.stringify({stage:job.name,compiled},null,2);const began=performance.now();
   await fixture.renderer.compileAsync(job.scene,job.camera);compiled.push({name:job.name,ms:Math.round(performance.now()-began)});
  }
  out.textContent=JSON.stringify({pass:true,compiled,draws:0},null,2);
 }catch(e){out.textContent=JSON.stringify({pass:false,compiled,error:e.stack},null,2);fixture?.renderer.dispose();fixture=null;}
};
document.querySelector('#frame').onclick=async()=>{
 try{if(!fixture)throw Error('Run the shared shader check first');out.textContent='Drawing one bounded beach frame…';const began=performance.now();fixture.draw.render({dt:1/60,adaptive:false});await fixture.complete();out.textContent=JSON.stringify({pass:true,milliseconds:performance.now()-began,programs:fixture.renderer.info.programs,draws:fixture.renderer.info.render.calls},null,2);}
 catch(e){out.textContent=e.stack;fixture?.renderer.dispose();fixture=null;}
};

async function measure(label){
 if(!fixture)throw Error('Run the shared shader check first');
 const {lab,draw,renderer}=fixture;lab.paused=true;let accumulator=0,simulated=0,last=performance.now(),began=0;const rows=[];
 for(let i=-16;i<36;i++){
  const now=performance.now(),elapsed=Math.min(.25,(now-last)/1000);last=now;accumulator=Math.min(2/30,accumulator+elapsed);
  let cpu=performance.now(),steps=0;while(accumulator>=lab.timestep&&steps<2){if(lab.bulkFields.particleBackend==='connected'){const context=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(context);lab.finishStep(context,next);}else lab.step(lab.timestep);simulated+=lab.timestep;accumulator-=lab.timestep;steps++;}
  cpu=performance.now()-cpu;const renderStart=performance.now();draw.render({dt:Math.min(.25,elapsed),adaptive:false});await fixture.complete();
  if(i===-1){began=performance.now();simulated=0;}if(i>=0)rows.push({cpu,render:performance.now()-renderStart,gpuFrame:renderer.frameTimes});
  if(i%6===0)out.textContent=JSON.stringify({phase:label,frame:i+1,limit:36},null,2);
  await new Promise(requestAnimationFrame);
 }
 const wall=(performance.now()-began)/1000,times=rows.map(r=>r.cpu+r.render).sort((a,b)=>a-b),pixels=new Float32Array(fixture.field.target.width*fixture.field.target.height*4);
 await renderer.readRenderTargetPixelsAsync(fixture.field.target,0,0,fixture.field.target.width,fixture.field.target.height,pixels);
 const finite=[...pixels].every(Number.isFinite),mean=pixels.reduce((s,v,i)=>s+(i%4<3?v:0),0)/(pixels.length*.75);
 out.textContent=JSON.stringify({pass:finite,backend:renderer.isSharedSceneWebGPU?'WebGPU':'WebGL',phase:label,resolution:[fixture.field.target.width,fixture.field.target.height],browser:navigator.userAgent,renderingMiB:renderer.allocationBytes/1048576,frames:rows.length,wallSeconds:wall,fps:rows.length/wall,simulatedSeconds:simulated,realtime:simulated/wall,medianMs:times[18],p95Ms:times[34],cpuAverageMs:rows.reduce((s,r)=>s+r.cpu,0)/rows.length,renderAverageMs:rows.reduce((s,r)=>s+r.render,0)/rows.length,meanLinear:mean,finite,water:lab.count,objects:lab.balls.length,physics:lab.bulkFields.stats,rows},null,2);
}
function guarded(action){return async()=>{const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await action();}catch(e){out.textContent=e.stack;fixture?.renderer.dispose();fixture=null;}finally{buttons.forEach(b=>b.disabled=false);}};}
document.querySelector('#playback').onclick=guarded(()=>measure('beach playback'));
document.querySelector('#features').onclick=guarded(async()=>{const {lab}=fixture;for(const [i,kind] of ['glass','mirror','rock','light'].entries()){const b=lab.spawn(kind,[-2+i*1.3,3,1],[0,0,-1],i%2?'cup':'sphere');b.position=[-2+i*1.3,2.3,0];b.velocity.fill(0);}lab.rain.enabled=true;lab.rain.rate=150;lab.tannins=.5;lab.sand.carve([0,lab.sand.height(0,3),3],.4);lab.syncUniforms();lab.revision++;await measure('objects rain and edited sand');});
document.querySelector('#night').onclick=guarded(async()=>{fixture.lab.day=23;fixture.camera.position.set(0,.55,0);fixture.camera.lookAt(0,.8,-2);fixture.camera.updateMatrixWorld();await measure('underwater night');});

document.querySelector('#numeric').onclick=guarded(async()=>{if(!fixture)fixture=await createSharedFixture(document.querySelector('#view'));out.textContent='Checking water reconstruction and multigrid against CPU…';const reconstruction=await LabWaterField.verify(fixture.renderer);const pressure=await fixture.lab.bulkFields.verify();out.textContent=JSON.stringify({pass:reconstruction.pass&&pressure.pass,reconstruction,pressure},null,2);});
document.querySelector('#connected').onclick=guarded(async()=>{out.textContent='Validating connected GPU physics…';const report=await fixture.lab.bulkFields.verifyConnected();out.textContent=JSON.stringify(report,null,2);if(report.pass)fixture.lab.bulkFields.particleBackend='connected';});

document.querySelector('#snapshot').onclick=guarded(async()=>{if(!fixture)fixture=await createSharedFixture(document.querySelector('#view'),{backend:new URLSearchParams(location.search).get('backend')||'webgpu'});const variant=new URLSearchParams(location.search).get('snapshot');if(variant&&!fixture.snapshotConfigured){/* Establish the normal loaded scene before testing partial terrain uploads. */fixture.draw.render({dt:0,adaptive:false});await fixture.complete();fixture.snapshotConfigured=true;const {lab,camera}=fixture;if(variant!=='carve')for(const [i,kind] of ['glass','mirror','rock','light'].entries()){const b=lab.spawn(kind,[-2+i*1.3,3,1],[0,0,-1],i%2?'cup':'sphere');b.position=[-2+i*1.3,2.3,0];b.velocity.fill(0);b.held=true;}lab.tannins=.5;if(variant!=='bodies')lab.sand.carve([0,lab.sand.height(0,3),3],.4);if(variant==='night'){lab.day=23;camera.position.set(0,.55,0);camera.lookAt(0,.8,-2);camera.updateMatrixWorld();}lab.syncUniforms();lab.revision++;}
 out.textContent='Rendering an unchanged paused beach for image comparison…';for(let i=0;i<3;i++){fixture.draw.render({dt:0,adaptive:false});await fixture.complete();}const t=fixture.field.target,data=new Float32Array(t.width*t.height*4);await fixture.renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,data);const bytes=new Uint8Array(data.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));document.querySelector('#pixels').textContent=btoa(binary);out.textContent=JSON.stringify({pass:data.every(Number.isFinite),width:t.width,height:t.height,backend:fixture.renderer.isSharedSceneWebGPU?'WebGPU':'WebGL'},null,2);});

document.querySelector('#audit').onclick=guarded(async()=>{const rows={};const {draw,renderer}=fixture;for(const [name,t] of Object.entries({caustics:draw.caustics,density:draw.density.target,medium:draw.mediumShadows.target,backgroundHit:draw.splitSurfaces.get(draw.backgroundScene).target,background:draw.background,water:draw.water,waterHit:draw.splitSurfaces.get(draw.waterScene).target,reflection:draw.splitSurfaces.get(draw.waterScene).opticalStages[1].target,transmission:draw.splitSurfaces.get(draw.waterScene).opticalStages[3].target,composite:fixture.field.target})){if(!t)continue;const w=t.width,h=t.height,x=Math.floor((t.width-w)/2),y=Math.floor((t.height-h)/2),half=t.texture.type===THREE.HalfFloatType,data=half?new Uint16Array(w*h*4):new Float32Array(w*h*4);await renderer.readRenderTargetPixelsAsync(t,x,y,w,h,data);const values=half?Float32Array.from(data,THREE.DataUtils.fromHalfFloat):data,probes=[];for(let py=0;py<16;py++)for(let px=0;px<16;px++){const at=(Math.floor((py+.5)*h/16)*w+Math.floor((px+.5)*w/16))*4;probes.push(...values.slice(at,at+4));}rows[name]={size:[t.width,t.height],mean:[0,1,2,3].map(k=>values.reduce((s,v,i)=>s+(i%4===k?v:0),0)/(w*h)),probes};}rows.uploaded={};for(const name of ['uSand','uSandParcels','uSandBins','uBodies','uBodyExtra']){const texture=draw.u[name]?.value;if(!texture)continue;const target=new THREE.WebGLRenderTarget(texture.image.width,texture.image.height,{type:THREE.FloatType,depthBuffer:false});const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:'void main(){gl_Position=vec4(position,1.);}',fragmentShader:'precision highp float;uniform sampler2D source;out vec4 color;void main(){color=texelFetch(source,ivec2(gl_FragCoord.xy),0);}',uniforms:{source:{value:texture}},depthTest:false,depthWrite:false});const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const previous=renderer.getRenderTarget();renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());await fixture.complete();const data=new Float32Array(target.width*target.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,data);rows.uploaded[name]=Array.from(data);renderer.setRenderTarget(previous);target.dispose();geometry.dispose();material.dispose();}rows.inputs=Object.fromEntries(Object.entries(draw.u).filter(([k,v])=>rows.uploaded[k]&&v.value?.image?.data).map(([k,v])=>[k,Array.from(v.value.image.data)]));rows.mediumUniforms=Object.fromEntries(Object.entries(draw.mediumShadows.uniforms).filter(([,v])=>!v.value?.isTexture).map(([k,v])=>[k,v.value?.toArray?.()||v.value]));if(renderer.isSharedSceneWebGPU){const p=await renderer.program(draw.mediumShadows.material);rows.mediumShader={fragment:p.fragment,uniforms:p.uniforms};}document.querySelector('#pixels').textContent=JSON.stringify(rows);out.textContent=JSON.stringify({pass:true,audit:true,backend:renderer.isSharedSceneWebGPU?'WebGPU':'WebGL'},null,2);});

// Compilation and drawing use the same single-operation guard as playback.
for(const id of ['check','scene','frame']){const button=document.querySelector('#'+id),action=button.onclick;button.onclick=guarded(action);}
