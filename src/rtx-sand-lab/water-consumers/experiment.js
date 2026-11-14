import * as THREE from 'three';
import {waterColumns,waterConfig,WATER_LIMIT} from './model.js';
import {SURFACE_INPUT_WGSL,FLOW_INPUT_WGSL} from './shaders.js';
import {wait} from '../fields/particles/pipeline.js';
export {waterColumns,waterConfig,SURFACE_INPUT_WGSL};

// A single uploaded snapshot serves flow kernels, rain contact and persistent
// foam; their output stays
// GPU-resident through transport/drawing. Physics mirrors are not discarded.
export class WaterConsumers {
 constructor(renderer){this.r=renderer;this.d=renderer.device;this.buffers=[];this.outputs=[];this.queued=new Set();this.stats={snapshots:0,uploadBytes:0,sea:0,rain:0,flow:0,fallbacks:0};}
 buffer(size,usage){const b=this.r.createBuffer({size:Math.max(16,size),usage});this.buffers.push(b);return b;}
 output(size,height=size){
  const proxy=new THREE.DataTexture(null,size,height,THREE.RGBAFormat,THREE.FloatType),texture=this.r.createTexture({label:'shared water surface',size:[size,height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const resource={texture,view:texture.createView(),width:size,height,format:'rgba32float',target:true};this.r.textures.set(proxy,resource);this.outputs.push({proxy,...resource});return this.outputs.at(-1);
 }
 async prepare(seaSize=96,rainSize=128){
  if(seaSize!==96||rainSize!==128)throw Error('Shared water inputs require the validated 96/128 surface sizes');
  const U=GPUBufferUsage;this.seaSize=seaSize;this.rainSize=rainSize;
  this.water=this.buffer(WATER_LIMIT*80,U.STORAGE|U.COPY_DST);this.columns=this.buffer((65536+WATER_LIMIT)*4,U.STORAGE|U.COPY_DST);
  this.bed=this.buffer(seaSize**2*4,U.STORAGE|U.COPY_DST);this.bodies=this.buffer(256*16,U.STORAGE|U.COPY_DST);
  this.raw=this.buffer(seaSize**2*32,U.STORAGE);this.seaConfig=this.buffer(48,U.UNIFORM|U.COPY_DST);this.rainConfig=this.buffer(48,U.UNIFORM|U.COPY_DST);
  this.seaSurface=this.output(seaSize);this.seaFlow=this.output(seaSize);this.rainSurface=this.output(rainSize);this.flowInputs=[0,1,2].map(()=>this.output(64,WATER_LIMIT/64));this.flowConfig=this.buffer(48,U.UNIFORM|U.COPY_DST);
  const d=this.d;d.pushErrorScope('validation');
  try{
   const entries=[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...[1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}})),{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},...[6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba32float'}}))];
   this.layout=d.createBindGroupLayout({entries});const layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]}),module=d.createShaderModule({code:SURFACE_INPUT_WGSL,label:'shared water visual inputs'});this.pipelines={};
   for(const entryPoint of ['sea','rain','focus'])this.pipelines[entryPoint]=await wait(d.createComputePipelineAsync({label:'water consumers '+entryPoint,layout,compute:{module,entryPoint}}),30000,'Water consumers compilation');
   this.flowPipeline=await wait(d.createComputePipelineAsync({label:'shared water flow inputs',layout:'auto',compute:{module:d.createShaderModule({code:FLOW_INPUT_WGSL}),entryPoint:'main'}}),30000,'Flow input compilation');
  }finally{const error=await d.popErrorScope();if(error)throw Error(error.message);}
  return this;
 }
 snapshot(lab){
  const key=[lab.positions,lab.velocities,lab.chem,lab.surfaceMetrics,lab.neighborCounts,lab.aerationActivity];
  if(this.key&&key.every((v,i)=>v===this.key[i])&&this.revision===lab.revision&&this.generation===lab.generation)return this.index;
  // Multiple distinct snapshots before submission would overwrite bindings.
  // Keep the reference path rather than changing an already queued frame.
  if(this.pending){this.stats.fallbacks++;return null;}
  const index=waterColumns(lab,this.seaSize,this.rainSize);if(!index||lab.balls.length>256){this.stats.fallbacks++;return null;}
  const n=lab.count;if(!n)return null;
  const write=(offset,array,length,fallback=0)=>{let data=array;if(!data||data.length!==length){data=new Float32Array(length).fill(fallback);if(array)data.set(array.subarray(0,length));}else if(!(data instanceof Float32Array))data=Float32Array.from(data);this.d.queue.writeBuffer(this.water,offset*4,data);this.stats.uploadBytes+=data.byteLength;};
  write(0,lab.positions,n*4);write(n*4,lab.velocities,n*4);write(n*8,lab.chem,n*4);write(n*12,lab.surfaceMetrics,n*4);write(n*16,lab.neighborCounts,n,18);write(n*17,lab.aerationActivity,n*2);
  this.d.queue.writeBuffer(this.columns,0,index.heads);this.d.queue.writeBuffer(this.columns,index.heads.byteLength,index.next);this.stats.uploadBytes+=index.heads.byteLength+index.next.byteLength;
  this.key=key;this.index=index;this.revision=lab.revision;this.generation=lab.generation;this.stats.snapshots++;return index;
 }
 flow(lab,field){
  if(this.queued.has('flow')){this.stats.fallbacks++;return false;}
  const index=this.snapshot(lab);if(!index)return false;
  const s=lab.spacing,n=lab.count,layout=field.setup(s,lab.fieldBounds);field.allocateItems(n,Math.ceil(6*Math.max(.018,s*.85*.95)/layout.dx)+1);
  this.d.queue.writeBuffer(this.flowConfig,0,waterConfig(lab,index,0));
  const bind=this.d.createBindGroup({layout:this.flowPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.flowConfig}},{binding:1,resource:{buffer:this.water}},...this.flowInputs.map((o,i)=>({binding:i+2,resource:o.view}))]});this.pending=(this.pending||0)+1;this.queued.add('flow');
  this.r.commands.push({type:'compute',encode:(encoder,timestamps=()=>undefined)=>{this.pending--;this.queued.delete('flow');const pass=encoder.beginComputePass({label:'water flow inputs',timestampWrites:timestamps('water flow inputs')});pass.setPipeline(this.flowPipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}});
  ['uCenters','uChannels','uShapes'].forEach((name,i)=>field.uniforms[name].value=this.flowInputs[i].proxy);
  try{field.renderGPU(n);}finally{['centers','channels','shapes'].forEach((name,i)=>field.uniforms[['uCenters','uChannels','uShapes'][i]].value=field[name]);}
  this.stats.flow++;return true;
 }
 enqueue(lab,kind){
  if(this.queued.has(kind)){this.stats.fallbacks++;return false;}
  const index=this.snapshot(lab);if(!index)return false;
  const sea=kind==='sea',size=sea?this.seaSize:this.rainSize,config=sea?this.seaConfig:this.rainConfig;
  // Terrain remains exact CPU geometry, including raised/cut sand. Its cache
  // follows geometry revision, never the camera or an arbitrary time cadence.
  if(sea&&(this.terrain!==lab.sand||this.terrainRevision!==lab.sand.revision)){
   const heights=new Float32Array(size*size);for(let z=0;z<size;z++)for(let x=0;x<size;x++)heights[z*size+x]=lab.terrainHeight((x+.5)*11/size-5.5,(z+.5)*9.8/size-4.9);
   this.d.queue.writeBuffer(this.bed,0,heights);this.terrain=lab.sand;this.terrainRevision=lab.sand.revision;this.stats.uploadBytes+=heights.byteLength;
  }
  const bodyData=new Float32Array(Math.max(4,lab.balls.length*4));lab.balls.forEach((b,i)=>bodyData.set([...b.position,b.radius],i*4));this.d.queue.writeBuffer(this.bodies,0,bodyData);
  this.d.queue.writeBuffer(config,0,waterConfig(lab,index,size,lab.balls.length));
  const output=sea?this.seaSurface:this.rainSurface,entries=[config,this.water,this.columns,this.bed,this.bodies,this.raw].map((buffer,binding)=>({binding,resource:{buffer}})).concat([{binding:6,resource:output.view},{binding:7,resource:this.seaFlow.view}]);
  const bind=this.d.createBindGroup({layout:this.layout,entries});this.pending=(this.pending||0)+1;this.queued.add(kind);
  this.r.commands.push({type:'compute',encode:(encoder,timestamps=()=>undefined)=>{this.pending--;this.queued.delete(kind);for(const stage of sea?['sea','focus']:['rain']){const pass=encoder.beginComputePass({label:'water consumers '+stage,timestampWrites:timestamps('water consumers '+stage)});pass.setPipeline(this.pipelines[stage]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(size/8),Math.ceil(size/8));pass.end();}}});this.stats[kind]++;return true;
 }
 dispose(){if(this.pending||this.r.flushing)throw Error('Flush shared water work before disposal');for(const b of this.buffers)this.r.destroyResource(b);for(const o of this.outputs){this.r.textures.delete(o.proxy);this.r.destroyResource(o.texture);o.proxy.dispose();}}
}
export async function installWaterConsumers(draw){
 if(draw.waterConsumers)return draw.waterConsumers;
 const r=draw.renderer,lab=draw.lab;if(!r.isSharedSceneWebGPU)return {backend:'CPU reference',enabled:false};
 const gpu=new WaterConsumers(r);try{await gpu.prepare(lab.seaFoam.size);}catch(error){gpu.dispose();throw error;}
 const foam=lab.seaFoam,surface=foam.surface,seaUpdate=surface.update,rain=draw.rainSurface,rainUpdate=rain.update;
 const flow=lab.detail.flow.field,flowUpdate=flow.updateBulk;
 const result={enabled:true,gpu,backend:'shared GPU flow/foam/rain inputs; exact CPU physics mirrors retained'};
 const active=()=>result.enabled&&lab.optimizations?.sharedWaterInputs!==false;
 flow.updateBulk=function(current){if(!active()||this.cpu||!gpu.flow(current,this))return flowUpdate.call(this,current);};
 surface.update=function(current){if(active()&&!current.gpu.cpu&&gpu.enqueue(current,'sea')){foam.u.uSeaSurface.value=gpu.seaSurface.proxy;foam.u.uSeaFlow.value=gpu.seaFlow.proxy;return this;}foam.u.uSeaSurface.value=foam.surfaceTexture;foam.u.uSeaFlow.value=foam.flowTexture;return seaUpdate.call(this,current);};
 rain.update=function(current){const useGPU=active()&&!current.gpu.cpu;if(this.sharedActive!==useGPU)this.revision=undefined;this.sharedActive=useGPU;if(this.revision===current.revision&&this.generation===current.generation)return;if(useGPU&&gpu.enqueue(current,'rain')){this.texture=gpu.rainSurface.proxy;draw.u.uRainSurface.value=this.texture;this.revision=current.revision;this.generation=current.generation;}else{this.texture=originalRain;draw.u.uRainSurface.value=this.texture;rainUpdate.call(this,current);}};
 const originalRain=rain.texture;
 result.dispose=()=>{gpu.dispose();flow.updateBulk=flowUpdate;surface.update=seaUpdate;rain.update=rainUpdate;rain.texture=originalRain;rain.revision=undefined;draw.u.uRainSurface.value=originalRain;foam.u.uSeaSurface.value=foam.surfaceTexture;foam.u.uSeaFlow.value=foam.flowTexture;foam.surfaceElapsed=Infinity;delete draw.waterConsumers;};
 draw.waterConsumers=result;return result;
}

export {SeaFoamSurface} from '../../sand-lab/sea-foam-model.js';
export {rainSurfaceHeights} from '../../sand-lab/rain-surface.js';
