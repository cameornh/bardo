import * as THREE from 'three';
import {atmosphereSky,DEFAULT_SUN,atmosphereTransmission} from '../sand-lab/atmosphere-model.js';
import {projectSH} from '../sh.js';
import {wait} from '../rtx-sand-lab/fields/particles/pipeline.js';
import {OPAQUE_WGSL,SPLAT_WGSL,FILTER_WGSL,COMPOSITE_WGSL} from './render-shaders.js';
import {sandAlbedo} from '../sand-lab/sand-material.js';
import {LIMITS} from './model.js';

export class ResidentRenderer {
 constructor(sim,canvas,{width=640,height=360}={}){if(!Number.isInteger(width)||!Number.isInteger(height)||width<64||height<36||width>LIMITS.width||height>LIMITS.height)throw Error('Prototype drawing budget exceeded');this.sim=sim;this.d=sim.device;this.canvas=canvas;this.width=width;this.height=height;this.resources=[];this.camera=new THREE.PerspectiveCamera(55,width/height,.025,150);this.camera.position.set(4.8,4,4.4);this.camera.lookAt(0,.65,0);this.camera.updateMatrixWorld();}
 buffer(label,data,usage){const b=this.d.createBuffer({label,size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});this.d.queue.writeBuffer(b,0,data);this.resources.push(b);return b;}
 texture(label,format,usage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT,width=this.width,height=this.height){const t=this.d.createTexture({label,size:[width,height],format,usage});this.resources.push(t);return t;}
 async initialize(){
  const d=this.d;this.canvas.width=this.width;this.canvas.height=this.height;this.context=this.canvas.getContext('webgpu');if(!this.context)throw Error('WebGPU canvas unavailable');this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
  this.uniform=this.buffer('resident view',new Float32Array(160),GPUBufferUsage.UNIFORM);
  const f=this.sim.fixture;this.sun=f.sun||new THREE.Vector3(-.275,Math.sqrt(3)/2,.35).normalize().toArray();const W=96,H=48,pixels=new Uint16Array(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const az=((x+.5)/W-.5)*Math.PI*2,el=(.5-(y+.5)/H)*Math.PI;const rgb=atmosphereSky([Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)],this.sun);for(let k=0;k<3;k++)pixels[(y*W+x)*4+k]=THREE.DataUtils.toHalfFloat(rgb[k]);pixels[(y*W+x)*4+3]=THREE.DataUtils.toHalfFloat(1);}
  this.sky=this.texture('resident sky','rgba16float',GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST,W,H);d.queue.writeTexture({texture:this.sky},pixels,{bytesPerRow:W*8},[W,H]);this.sh=projectSH(v=>atmosphereSky(v,this.sun));
  const V=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
  this.globalLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:V,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
  this.global=d.createBindGroup({layout:this.globalLayout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:this.sky.createView()},{binding:2,resource:d.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat'})}]});
  this.opaque=this.texture('opaque color and depth','rgba16float');this.z=this.texture('opaque z','depth32float');this.waterZ=this.texture('water z','depth32float');this.surface=this.texture('Gaussian front depth','r32float');this.filtered=this.texture('horizontal depth filter','r32float');this.smooth=this.texture('vertical depth filter','r32float');this.thickness=this.texture('Gaussian optical thickness','rgba16float');
  this.splatLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}}]});
  this.splatBind=d.createBindGroup({layout:this.splatLayout,entries:[{binding:0,resource:{buffer:this.sim.state}},{binding:1,resource:this.opaque.createView()}]});
  this.filterLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
  this.filterBindings=[this.surface,this.filtered,this.smooth].map((t,i)=>d.createBindGroup({layout:this.filterLayout,entries:[{binding:0,resource:t.createView()},{binding:1,resource:{buffer:this.buffer('filter axis '+i,new Int32Array(i===1?[0,1,0,0]:[1,0,0,0]),GPUBufferUsage.UNIFORM)}}]}));
  this.compositeLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}}]});
  this.compositeBind=d.createBindGroup({layout:this.compositeLayout,entries:[this.opaque,this.smooth,this.thickness].map((t,binding)=>({binding,resource:t.createView()}))});
  const module=async(label,code)=>{const m=d.createShaderModule({label,code});const info=await wait(m.getCompilationInfo(),5000,label);const errors=info.messages.filter(e=>e.type==='error');if(errors.length)throw Error(errors.map(e=>label+':'+e.lineNum+' '+e.message).join('\n'));return m;};
  const land=await module('resident opaque',OPAQUE_WGSL),splat=await module('resident Gaussian projection',SPLAT_WGSL),filter=await module('resident depth filter',FILTER_WGSL),composite=await module('resident water lighting',COMPOSITE_WGSL);
  const pipeline=async(name,m,vertex,fragment,targets,group=null,extra={})=>wait(d.createRenderPipelineAsync({label:name,layout:d.createPipelineLayout({bindGroupLayouts:[this.globalLayout,...(group?[group]:[])]}),vertex:{module:m,entryPoint:vertex,...(extra.vertex||{})},fragment:{module:m,entryPoint:fragment,targets},primitive:{topology:'triangle-list'},...(extra.depthStencil?{depthStencil:extra.depthStencil}:{})}),5000,name);
  this.backgroundPipeline=await pipeline('sky',land,'quad','background',[{format:'rgba16float'}]);
  this.landPipeline=await pipeline('sand and rocks',land,'terrain','land',[{format:'rgba16float'}],null,{vertex:{buffers:[{arrayStride:36,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x3'}]}]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
  this.surfacePipeline=await pipeline('water Gaussian depth',splat,'splat','surface',[{format:'r32float'}],this.splatLayout,{depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
  const additive={color:{operation:'add',srcFactor:'one',dstFactor:'one'},alpha:{operation:'add',srcFactor:'one',dstFactor:'one'}};
  this.thicknessPipeline=await pipeline('water Gaussian thickness',splat,'splat','thickness',[{format:'rgba16float',blend:additive}],this.splatLayout);
  this.filterPipeline=await pipeline('depth filter',filter,'quad','depthSmooth',[{format:'r32float'}],this.filterLayout);
  this.compositePipeline=await pipeline('water composite',composite,'quad','composite',[{format:this.format}],this.compositeLayout);
  this.makeTerrain();this.update();return this;
 }
 makeTerrain(){
  const f=this.sim.fixture,data=[],indices=[];const add=(p,n,color)=>{data.push(...p,...n,...color);};const nx=96,nz=86;
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const px=x/nx*11-5.5,pz=z/nz*9.8-4.9,h=f.sand.height(px,pz),e=.008,n=new THREE.Vector3(-(f.sand.height(px+e,pz)-f.sand.height(px-e,pz))/(2*e),1,-(f.sand.height(px,pz+e)-f.sand.height(px,pz-e))/(2*e)).normalize();add([px,h,pz],n.toArray(),sandAlbedo(0));}
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const i=z*(nx+1)+x;indices.push(i,i+nx+1,i+1,i+1,i+nx+1,i+nx+2);}
  for(const b of f.balls){const sphere=new THREE.SphereGeometry(b.radius,32,20),p=sphere.attributes.position.array,n=sphere.attributes.normal.array,base=data.length/9;for(let i=0;i<p.length;i+=3)add([p[i]+b.position[0],p[i+1]+b.position[1],p[i+2]+b.position[2]],Array.from(n.subarray(i,i+3)),b.color);for(const i of sphere.index.array)indices.push(base+i);sphere.dispose();}
  this.vertices=this.buffer('terrain vertices',new Float32Array(data),GPUBufferUsage.VERTEX);this.indices=this.buffer('terrain indices',new Uint32Array(indices),GPUBufferUsage.INDEX);this.indexCount=indices.length;
 }
 update({organic=0,exposure=1,debug=0}={}){
  const a=new Float32Array(160),cam=this.camera;cam.updateMatrixWorld();a.set(cam.matrixWorldInverse.elements,0);a.set(cam.projectionMatrix.elements,16);a.set(cam.projectionMatrixInverse.elements,32);a.set(cam.matrixWorld.elements,48);a.set([...cam.position.toArray(),1],64);a.set([this.width,this.height,this.sim.fixture.spacing,this.sim.fixture.positions.length/4],68);a.set([...this.sun,0],72);const transmission=atmosphereTransmission([0,.02,0],this.sun);a.set([1.9*transmission[0],1.75*transmission[1],1.45*transmission[2],0],76);a.set([organic,this.sim.fixture.scale,exposure,debug],80);for(let i=0;i<16;i++)a.set(this.sh.subarray(i*3,i*3+3),84+i*4);this.sim.fixture.balls.forEach((b,i)=>a.set([...b.position,b.radius],148+i*4));this.d.queue.writeBuffer(this.uniform,0,a);
 }
 encode(e){
  const attachment=t=>({view:t.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]});
  const pass=(label,target,pipeline,bind=null,instances=0,z=null)=>{const p=e.beginRenderPass({label,colorAttachments:[attachment(target)],...(z?{depthStencilAttachment:{view:z.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});p.setPipeline(pipeline);p.setBindGroup(0,this.global);if(bind)p.setBindGroup(1,bind);p.draw(instances?6:3,instances||1);p.end();};
  pass('sky',this.opaque,this.backgroundPipeline);
  const land=e.beginRenderPass({colorAttachments:[{view:this.opaque.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:this.z.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});land.setPipeline(this.landPipeline);land.setBindGroup(0,this.global);land.setVertexBuffer(0,this.vertices);land.setIndexBuffer(this.indices,'uint32');land.drawIndexed(this.indexCount);land.end();
  pass('Gaussian water depth',this.surface,this.surfacePipeline,this.splatBind,this.sim.fixture.positions.length/4,this.waterZ);pass('Gaussian thickness',this.thickness,this.thicknessPipeline,this.splatBind,this.sim.fixture.positions.length/4);
  for(let i=0;i<4;i++){pass('filter x',this.filtered,this.filterPipeline,this.filterBindings[i===0?0:2]);pass('filter y',this.smooth,this.filterPipeline,this.filterBindings[1]);}pass('composite',this.context.getCurrentTexture(),this.compositePipeline,this.compositeBind);
 }
 dispose(){this.context?.unconfigure();for(const r of this.resources)r.destroy();this.resources=[];}
}
