import * as THREE from 'three';
import { QUAD_VERTEX } from './shaders.js';
import { photonInputs, photonKernel, photonGPUAvailability, photonLedger } from './photon-gpu-data.js';
import { PHOTON_TRACE_FRAGMENT, PHOTON_DEPOSIT_VERTEX, PHOTON_DEPOSIT_FRAGMENT, PHOTON_FILTER_FRAGMENT, PHOTON_REDUCE_FRAGMENT } from './photon-gpu-shaders.js';

export class GPUPhotons{
 constructor(renderer){
  this.renderer=renderer;this.materials=new Map();this.queue=Promise.resolve();const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  this.device=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'Graphics device hidden by browser';
  this.unavailable=photonGPUAvailability({floatTargets:!!gl.getExtension('EXT_color_buffer_float'),floatBlend:!!gl.getExtension('EXT_float_blend'),attachments:Math.min(gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),gl.getParameter(gl.MAX_DRAW_BUFFERS)),vertexTextures:gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),device:this.device});
  this.timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 }
 solve(scene,options){
  const job=this.queue.catch(()=>{}).then(()=>{if(this.disposed)throw new Error('GPU photon solver disposed');return this.solveNow(scene,options);});
  this.queue=job;return job;
 }
 dispose(){this.disposed=true;this.queue.catch(()=>{}).then(()=>{for(const m of this.materials.values())m.dispose();this.materials.clear();});}
 async solveNow(scene,{count=scene.config.photons,size=256,paths=true,readMaps=false}={}){
  if(this.unavailable)throw new Error(this.unavailable);
  const start=performance.now(),renderer=this.renderer,gl=renderer.getContext(),scratch=[],outputs=[];
  const own=x=>(scratch.push(x),x);
  const target=(w,h,n=2)=>own(new THREE.WebGLRenderTarget(w,h,{count:n,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  const texture=(data,w,h)=>{const t=own(new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType));t.needsUpdate=true;return t;};
  const input=photonInputs(scene,count),u=Object.assign(this.uniforms??= {},{
   uOrigins:{value:texture(input.origins,input.width,input.height)},uDirections:{value:texture(input.directions,input.width,input.height)},
   uPacketWidth:{value:input.width},uPacketCount:{value:count},uMapSize:{value:size},uRecordPaths:{value:false},uWhite:{value:scene.light.color==='white'},uDispersion:{value:scene.config.dispersion},
   uVolumeCount:{value:scene.volumes.length},uCentersLT:{value:Array.from({length:12},()=>new THREE.Vector3())},uSizesLT:{value:Array.from({length:12},()=>new THREE.Vector3())},uShapesLT:{value:Array.from({length:12},()=>new THREE.Vector4())},uParamsLT:{value:Array.from({length:12},()=>new THREE.Vector4())},
   uEndpoints:{value:null},uMapA:{value:null},uMapB:{value:null},uAxis:{value:0},uKernel:{value:texture(photonKernel(size,scene.config.gather),size,3)}
  });
  scene.volumes.forEach((v,i)=>{u.uCentersLT.value[i].fromArray(v.center);u.uSizesLT.value[i].fromArray(v.size);u.uShapesLT.value[i].set(v.type,v.medium,Math.cos(v.rotation),Math.sin(v.rotation));u.uParamsLT.value[i].fromArray(v.params);});
  const camera=new THREE.Camera(),plane=own(new THREE.PlaneGeometry(2,2));
  const material=(vertexShader,fragmentShader,extra={})=>{let m=this.materials.get(fragmentShader);if(!m){m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,uniforms:u,depthTest:false,depthWrite:false,...extra});this.materials.set(fragmentShader,m);}m.uniforms=u;return m;};
  const quad=fragment=>{const s=new THREE.Scene();s.add(new THREE.Mesh(plane,material(QUAD_VERTEX,fragment)));return s;};
  const trace=quad(PHOTON_TRACE_FRAGMENT),filter=quad(PHOTON_FILTER_FRAGMENT),reduce=quad(PHOTON_REDUCE_FRAGMENT);
  const packets=target(input.width,input.height,3),raw=target(size,size*2),horizontal=target(size,size*2),filtered=target(size,size*2);
  for(const t of filtered.textures)t.minFilter=t.magFilter=THREE.LinearFilter;
  const g=own(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*4*3),3));
  const deposit=new THREE.Scene(),points=new THREE.Points(g,material(PHOTON_DEPOSIT_VERTEX,PHOTON_DEPOSIT_FRAGMENT,{transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor}));points.frustumCulled=false;deposit.add(points);
  const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  let query=null,queryOpen=false,success=false;
  const draw=(s,t)=>{
   const onError=renderer.debug.onShaderError;let failure=null;
   renderer.debug.onShaderError=(gl,program,vs,fs)=>{failure=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs)].join('\n');};
   try{renderer.setRenderTarget(t);renderer.render(s,camera);}finally{renderer.debug.onShaderError=onError;}
   if(failure)throw new Error(`Photon shader failed: ${failure}`);
  };
  const read=(t,index,w=t.width,h=t.height)=>renderer.readRenderTargetPixelsAsync(t,0,0,w,h,new Float32Array(w*h*4),undefined,index);
  try{
   // Keep driver/compiler failures local so a supported-but-broken GPU backend
   // can fall back without disabling the rest of the engine renderer.
   const onError=renderer.debug.onShaderError;let shaderError=null;
   renderer.debug.onShaderError=(gl,program,vs,fs)=>{shaderError=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs)].join('\n');};
   try{for(const s of [trace,filter,reduce,deposit])await renderer.compileAsync(s,camera);}finally{renderer.debug.onShaderError=onError;}
   if(shaderError)throw new Error(shaderError);
   if(gl.isContextLost())throw new Error('Graphics context lost');
   if(this.timer){query=gl.createQuery();gl.beginQuery(this.timer.TIME_ELAPSED_EXT,query);queryOpen=true;}
   draw(trace,packets);u.uEndpoints.value=packets.textures[0];
   renderer.setRenderTarget(raw);renderer.setClearColor(0,0);renderer.clear();draw(deposit,raw);
   u.uMapA.value=raw.textures[0];u.uMapB.value=raw.textures[1];draw(filter,horizontal);
   u.uAxis.value=1;u.uMapA.value=horizontal.textures[0];u.uMapB.value=horizontal.textures[1];draw(filter,filtered);
   let reduced=packets,w=input.width,h=input.height,first=true;
   do{const next=target(Math.ceil(w/2),Math.ceil(h/2));u.uMapA.value=reduced.textures[first?1:0];u.uMapB.value=reduced.textures[first?2:1];draw(reduce,next);reduced=next;w=next.width;h=next.height;first=false;}while(w>1||h>1);
   if(queryOpen){gl.endQuery(this.timer.TIME_ELAPSED_EXT);queryOpen=false;}
   const ledgerReads=[read(reduced,0),read(reduced,1)];
   let pathReads=[];
   if(paths){const pathTarget=target(36,28,3);u.uRecordPaths.value=true;draw(trace,pathTarget);pathReads=[read(pathTarget,0),read(pathTarget,1)];}
   const mapReads=readMaps?[read(filtered,0),read(filtered,1)]:[];
   // Restore immediately, before yielding for readback. Animation can continue.
   renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);
   const [losses,received]=await Promise.all(ledgerReads),ledger=photonLedger(losses,received,scene.light.power);
   let gpuMs=null;if(query&&gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(this.timer.GPU_DISJOINT_EXT))gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;
   const segments=[];
   if(paths){const [a,b]=await Promise.all(pathReads);for(let i=0;i<a.length;i+=4)if(b[i+3]>0)segments.push({a:Array.from(a.subarray(i,i+3)),b:Array.from(b.subarray(i,i+3)),channel:Math.round(a[i+3]),power:b[i+3]});}
   const maps=await Promise.all(mapReads);
   outputs.push(filtered);success=true;
   return {scene,count,size,ledger,segments,ms:performance.now()-start,gpuMs,backend:'GPU · WebGL 2',directTexture:filtered.textures[0],causticTexture:filtered.textures[1],direct:maps[0],caustic:maps[1],dispose:()=>filtered.dispose()};
  }finally{
   if(queryOpen)gl.endQuery(this.timer.TIME_ELAPSED_EXT);
   if(query)gl.deleteQuery(query);
   // Only synchronous submission changes renderer state. An async completion
   // must not restore a stale framebuffer over another scene's render state.
   if(!success&&renderer.getRenderTarget()&&scratch.includes(renderer.getRenderTarget()))renderer.setRenderTarget(previous);
   renderer.setClearColor(clear,alpha);
   for(const resource of scratch)if(!outputs.includes(resource))resource.dispose();
  }
 }
}
