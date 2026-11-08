import {packHierarchy} from './multigrid.js';
import {ParticlePipeline,wait} from '../particles/pipeline.js';
import {prepareOccupancy,packConnected,connectivity} from './pack.js';
import {CONNECTED_WGSL} from './shaders.js';
import {multiply,norm} from '../multigrid.js';
import {MATERIAL,WATER} from '../../../fluid-fields/model.js';
export class ConnectedFields {
 constructor(particles){this.particles=particles;this.uploads=0;}
 async initialize(){
  const d=this.particles.device;d.pushErrorScope('validation');const module=d.createShaderModule({label:'connected field kernels',code:CONNECTED_WGSL});
  const info=await wait(module.getCompilationInfo(),5000,'Connected field compilation'),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.lineNum+': '+e.message).join('\n'));
  this.layout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...Array.from({length:6},(_,i)=>({binding:i+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:i<2||i===5?'storage':'read-only-storage'}}))]});
  const layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]});this.pipelines={};
  for(const entryPoint of ['stencils','deposit','extend','extended','advect','viscosity','rhs','compatible','pressure','project'])this.pipelines[entryPoint]=await wait(d.createComputePipelineAsync({label:'connected-'+entryPoint,layout,compute:{module,entryPoint}}),5000,entryPoint+' compilation');
  const error=await d.popErrorScope();if(error)throw Error(error.message);return this;
 }
 pack(context,lab,grid,geometry){
  if(grid.count>4096)throw Error('Connected field grid exceeds 4096 cells');
  const start=performance.now();const resetPressure=this.cachedGrid!==grid;this.grid=grid;this.context=context;
  const bins=prepareOccupancy(grid,context,this.environment.solid),packed=packConnected(context,lab,grid,geometry,bins,this.environment.wind,this.environment.wall);
  if(this.cachedGrid!==grid||this.version!==grid.topologyVersion){
   const {nodes,links,closed}=connectivity(grid);this.hierarchyOffset=nodes.length+links.length+closed.length;const mg=packHierarchy(grid.levels,this.hierarchyOffset);if(mg.work>24576)throw Error('Multigrid work budget exceeded');this.topology=new Float32Array(this.hierarchyOffset+mg.data.length);this.topology.set(mg.data,this.hierarchyOffset);this.topology.set(nodes);this.topology.set(links,nodes.length);this.topology.set(closed,nodes.length+links.length);this.linkOffset=nodes.length;this.closedOffset=nodes.length+links.length;this.cachedGrid=grid;this.version=grid.topologyVersion;this.dirty=true;
  }
  const cfg=new Float32Array(32);cfg.set(packed.fieldConfig);cfg[20]=this.linkOffset;cfg[21]=this.closedOffset;cfg[22]=resetPressure?1:0;cfg[24]=this.hierarchyOffset;cfg[25]=grid.levels.length;packed.fieldConfig=cfg;
  this.packed=packed;this.prepareMs=performance.now()-start;this.extraBytes=grid.faces.reduce((n,f)=>n+f.velocity.length,0)*16+(grid.count*8+4)*4;
  return packed;
 }
 encode(encoder,buffers,timingBatch){
  const p=this.particles,d=p.device,U=GPUBufferUsage,x=this.packed;
  const cfg=p.buffer('connectedConfig',128,U.UNIFORM|U.COPY_DST),meta=p.buffer('connectedFaces',14000*64+32768*68,U.STORAGE|U.COPY_DST),bins=p.buffer('connectedBins',(32768+4097)*4,U.STORAGE|U.COPY_DST),topo=p.buffer('connectedTopology',200000*4,U.STORAGE|U.COPY_DST),tmp=p.buffer('connectedWork',(14000*4+4096*8+4+24576)*4,U.STORAGE|U.COPY_SRC);
  if(x.faceMeta.length>14000*16||this.topology.length>200000)throw Error('Connected field storage budget exceeded');
  d.queue.writeBuffer(cfg,0,x.fieldConfig);d.queue.writeBuffer(meta,0,x.faceMeta);d.queue.writeBuffer(meta,x.faceMeta.byteLength,x.input);d.queue.writeBuffer(bins,0,x.bins);
  if(this.dirty){d.queue.writeBuffer(topo,0,this.topology);this.dirty=false;this.uploads++;}
  const bind=d.createBindGroup({layout:this.layout,entries:[cfg,buffers[1],buffers[2],meta,bins,topo,tmp].map((buffer,binding)=>({binding,resource:{buffer}}))});this.tmp=tmp;
  const dispatch=(key,n)=>{const pass=encoder.beginComputePass({timestampWrites:p.timing?.writes(timingBatch,'field-'+key)});pass.setPipeline(this.pipelines[key]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(key==='pressure'?1:Math.ceil(n/64));pass.end();};
  const faces=x.faceMeta.length/16;dispatch('stencils',x.n);dispatch('deposit',faces);for(let i=0;i<3;i++){dispatch('extend',faces);dispatch('extended',faces);}dispatch('advect',faces);dispatch('viscosity',faces);dispatch('rhs',this.grid.count);dispatch('compatible',this.grid.count);dispatch('pressure',this.grid.count);dispatch('project',faces);
 }
 copy(encoder,buffers,read,offset){const faces=this.packed.faceMeta.length/16;encoder.copyBufferToBuffer(buffers[2],0,read,offset,faces*16);encoder.copyBufferToBuffer(this.tmp,faces*16,read,offset+faces*16,(this.grid.count*8+4)*4);}
 result(buffer,offset){
  const g=this.grid,faces=this.packed.faceMeta.length/16,data=new Float32Array(buffer,offset,this.extraBytes/4).slice(),phi=Float64Array.from(data.subarray(faces*4,faces*4+g.count)),rhs=Float64Array.from(data.subarray(faces*4+g.count*5,faces*4+g.count*6));
  if(!data.every(Number.isFinite))throw Error('Non-finite connected GPU result');
  const error=multiply(g.levels[0],phi).map((v,i)=>v-rhs[i]),absoluteResidual=norm(error),relativeResidual=absoluteResidual/Math.max(norm(rhs),1e-12);
  if(relativeResidual>1e-3&&absoluteResidual>1e-8)throw Error('Connected GPU pressure residual '+relativeResidual.toExponential(2)+' requires CPU fallback');
  return {faces:data.subarray(0,faces*4),potential:phi,rhs,absoluteResidual,relativeResidual,iterations:data[faces*4+g.count*8],levels:g.levels.length,backend:'WebGPU connected deposition / multigrid-PCG / projection',topologyUploads:this.uploads,prepareMs:this.prepareMs};
 }
 commit(result){
  const g=this.grid;let at=0;for(const f of g.faces)for(let i=0;i<f.velocity.length;i++,at++){f.velocity[i]=result.faces[at*4];f.before[i]=result.faces[at*4+1];f.wall[i]=this.packed.faceMeta[at*16+11];}
  for(let i=0;i<g.count;i++)g.pressure[i]=g.phase[i]?result.potential[i]*MATERIAL[WATER].density/this.context.dt:0;
 }
}
export class ConnectedPipeline extends ParticlePipeline {
 async initialize(gpu){await super.initialize(gpu);try{this.fields=await new ConnectedFields(this).initialize();}catch(e){this.dispose();throw e;}return this;}
 async solve(context,lab,grid,{environment,geometry=null,debug=false}={}){
  this.fields.environment=environment||{solid:p=>lab.solid(p.map(v=>v/context.scale))*context.scale,wind:()=>[0,0,0],wall:()=>[0,0,0]};
  const r=await super.solve(context,lab,grid,{geometry,debug,connected:this.fields});r.stats.backend='WebGPU deposition / pressure / particles / contacts';r.stats.storageBytes=Object.entries(this.buffers).reduce((sum,[key,b])=>sum+(key==='readback'?0:b.size),0);return r;
 }
}
