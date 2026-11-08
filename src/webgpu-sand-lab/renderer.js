import * as THREE from 'three';
import {shaderUniforms} from '../rtx-sand-lab/shader-dependencies.js';
import {SceneShaderCompiler} from './compiler.js';
import {packUniforms,cloneUniformValue} from './uniforms.js';
import {wait} from '../rtx-sand-lab/fields/particles/pipeline.js';

const align=(n,a)=>Math.ceil(n/a)*a;
const usage=()=>GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST;
const builtinVertex=`uniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat4 viewMatrix;uniform mat3 normalMatrix;uniform vec3 cameraPosition;in vec3 position;in vec3 normal;in vec2 uv;`;
function addBuiltins(source,vertex){
 const declarations=vertex?builtinVertex:'uniform mat4 viewMatrix;uniform vec3 cameraPosition;';
 for(const d of declarations.split(';'))if(d.trim()){
  const name=d.trim().split(/\s+/).at(-1);if(!new RegExp('\\b(?:uniform|in)\\s+\\w+\\s+'+name+'\\b').test(source))source=d+';\n'+source;
 }
 return source;
}
export function sceneSamplerGroups(material){const declared=shaderUniforms(material),groups={};for(const [name,u] of Object.entries(material.uniforms))if(declared.has(name)&&u.value?.isTexture)groups[name]=[u.value.minFilter,u.value.magFilter,u.value.wrapS,u.value.wrapT].join(':');return groups;}
function snapshotMaterial(material){
 if(!material.isShaderMaterial)throw Error('WebGPU scene requires an explicit shared shader: '+material.type);
 const shader={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,uniforms:material.uniforms};material.onBeforeCompile(shader,null);
 const samplerGroups=sceneSamplerGroups(material);
 return {vertex:addBuiltins(shader.vertexShader,true),fragment:addBuiltins(shader.fragmentShader,false),defines:material.defines||{},samplerGroups};
}
function blend(material){
 const factor=new Map([[THREE.ZeroFactor,'zero'],[THREE.OneFactor,'one'],[THREE.SrcColorFactor,'src'],[THREE.OneMinusSrcColorFactor,'one-minus-src'],[THREE.SrcAlphaFactor,'src-alpha'],[THREE.OneMinusSrcAlphaFactor,'one-minus-src-alpha'],[THREE.DstAlphaFactor,'dst-alpha'],[THREE.OneMinusDstAlphaFactor,'one-minus-dst-alpha'],[THREE.DstColorFactor,'dst'],[THREE.OneMinusDstColorFactor,'one-minus-dst']]);
 const operation=v=>v===THREE.MaxEquation?'max':v===THREE.MinEquation?'min':v===THREE.SubtractEquation?'subtract':v===THREE.ReverseSubtractEquation?'reverse-subtract':'add';
 if(material.blending===THREE.NoBlending||(!material.transparent&&material.blending===THREE.NormalBlending))return undefined;
 if(material.blending===THREE.AdditiveBlending)return {color:{srcFactor:material.premultipliedAlpha?'one':'src-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};
 if(material.blending===THREE.CustomBlending){const color={srcFactor:factor.get(material.blendSrc)||'one',dstFactor:factor.get(material.blendDst)||'zero',operation:operation(material.blendEquation)},alpha={srcFactor:factor.get(material.blendSrcAlpha??material.blendSrc)||'one',dstFactor:factor.get(material.blendDstAlpha??material.blendDst)||'zero',operation:operation(material.blendEquationAlpha??material.blendEquation)};for(const b of [color,alpha])if(b.operation==='min'||b.operation==='max')b.srcFactor=b.dstFactor='one';return {color,alpha};}
 return {color:{srcFactor:material.premultipliedAlpha?'one':'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
}

// A bounded WebGPU implementation of the small rendering interface used by the
// live lab. THREE remains responsible for cameras, geometry and scene objects;
// no WebGL context is created and every draw targets a native WebGPU texture.
export class SharedSceneWebGPU {
 static async create(canvas){
  if(!navigator.gpu)throw Error('WebGPU is unavailable in this preview');
  const adapter=await wait(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),3000,'WebGPU adapter');if(!adapter)throw Error('No WebGPU adapter');
  const features=['float32-filterable','float32-blendable'];for(const feature of features)if(!adapter.features.has(feature))throw Error('The shared WebGPU scene requires '+feature+'. Use the WebGL scene on this device.');
  const requiredLimits={};for(const name of ['maxSampledTexturesPerShaderStage','maxSamplersPerShaderStage','maxColorAttachmentBytesPerSample','maxUniformBufferBindingSize'])requiredLimits[name]=adapter.limits[name];
  const request=adapter.requestDevice({requiredFeatures:features,requiredLimits});let expired=false;request.then(d=>{if(expired)d.destroy();},()=>{});
  try{const device=await wait(request,5000,'WebGPU device');return new SharedSceneWebGPU(canvas,adapter,device);}catch(e){expired=true;throw e;}
 }
 constructor(canvas,adapter,device){
  this.isSharedSceneWebGPU=true;this.domElement=canvas;this.adapter=adapter;this.device=device;this.context=canvas.getContext('webgpu');this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device,format:this.format,alphaMode:'opaque'});
  this.compiler=new SceneShaderCompiler();window.addEventListener('pagehide',()=>this.dispose(),{once:true});this.programs=new Map();this.materialPrograms=new WeakMap();this.pipelines=new Map();this.textures=new WeakMap();this.targets=new WeakMap();this.attributes=new WeakMap();this.geometryResources=new WeakMap();this.attributeOwners=new WeakMap();this.samplers=new Map();this.commands=[];this.temporary=[];this.uniformBuffers=[];this.uniformIndex=0;this.allocationBytes=0;this.allocations=new WeakMap();this.resourceBudget=512*1024*1024;
  this.info={programs:[],render:{calls:0,triangles:0},memory:{textures:0}};this.debug={};this.properties=new WeakMap();this.autoClear=true;this.clearColor=new THREE.Color(0);this.clearAlpha=0;this.target=null;this.viewport=new THREE.Vector4(0,0,canvas.width,canvas.height);this.scissor=this.viewport.clone();this.scissorTest=false;
  this.capabilities={maxTextureSize:device.limits.maxTextureDimension2D};this.extensions={has:name=>['EXT_color_buffer_float','KHR_parallel_shader_compile'].includes(name)||(name==='OES_texture_float_linear'&&device.features.has('float32-filterable'))};
  // Only capability probes / timer availability use this compatibility view.
  // Pixel transfer, rendering, compilation and synchronization are native GPU.
  this.gl={isContextLost:()=>!!this.failure,getExtension:()=>null,bindBuffer:()=>{},getParameter:()=>0};
  device.lost.then(info=>{if(!this.disposed)this.failure=Error('WebGPU device lost: '+info.message);});device.addEventListener('uncapturederror',e=>{this.failure??=Error(e.error.message);});
  this.empty=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);this.empty.needsUpdate=true;
 }
 getContext(){return this.gl;}setPixelRatio(){}getPixelRatio(){return 1;}
 getSize(v){return v.set(this.domElement.width,this.domElement.height);}
 setSize(w,h,style=true){this.domElement.width=w;this.domElement.height=h;if(style){this.domElement.style.width=w+'px';this.domElement.style.height=h+'px';}if(!this.target)this.viewport.set(0,0,w,h);}
 getRenderTarget(){return this.target;}setRenderTarget(t){this.target=t;if(t){this.initRenderTarget(t);this.viewport.copy(t.viewport);this.scissor.copy(t.scissor);this.scissorTest=t.scissorTest;}else{this.viewport.set(0,0,this.domElement.width,this.domElement.height);this.scissor.copy(this.viewport);this.scissorTest=false;}}
 setViewport(x,y,w,h){x?.isVector4?this.viewport.copy(x):this.viewport.set(x,y,w,h);}getViewport(v){return v.copy(this.viewport);}
 setScissor(x,y,w,h){x?.isVector4?this.scissor.copy(x):this.scissor.set(x,y,w,h);}getScissor(v){return v.copy(this.scissor);}setScissorTest(v){this.scissorTest=v;}getScissorTest(){return this.scissorTest;}
 setClearColor(c,a=this.clearAlpha){this.clearColor.set(c);this.clearAlpha=a;}getClearColor(c){return c.copy(this.clearColor);}getClearAlpha(){return this.clearAlpha;}
 assertHealthy(){if(this.failure)throw this.failure;}
 reserve(bytes){if(!Number.isSafeInteger(bytes)||bytes<0||this.allocationBytes+bytes>this.resourceBudget)throw Error('WebGPU scene exceeds its 512 MiB rendering budget; reduce resolution before retrying');}
 createBuffer(descriptor){this.reserve(descriptor.size);const resource=this.device.createBuffer(descriptor);this.allocations.set(resource,descriptor.size);this.allocationBytes+=descriptor.size;return resource;}
 createTexture(descriptor){const [w,h]=descriptor.size,bytes=w*h*(descriptor.format==='rgba32float'?16:descriptor.format==='rgba16float'?8:4);if(w>this.device.limits.maxTextureDimension2D||h>this.device.limits.maxTextureDimension2D)throw Error('WebGPU texture exceeds device dimensions');this.reserve(bytes);const resource=this.device.createTexture(descriptor);this.allocations.set(resource,bytes);this.allocationBytes+=bytes;return resource;}
 destroyResource(resource){this.allocationBytes-=this.allocations.get(resource)||0;this.allocations.delete(resource);resource.destroy();}

 formatFor(t){if(t.type===THREE.UnsignedByteType)return 'rgba8unorm';if(t.type===THREE.HalfFloatType)return 'rgba16float';return 'rgba32float';}
 initRenderTarget(target){
  let state=this.targets.get(target);if(state&&state.width===target.width&&state.height===target.height)return state;
  if(state){for(const t of state.colors)this.temporary.push(t.texture);if(state.depth)this.temporary.push(state.depth);}
  const colors=target.textures.map(t=>{const format=this.formatFor(t),texture=this.createTexture({label:t.name||'scene attachment',size:[target.width,target.height],format,usage:usage()});const s={texture,view:texture.createView(),format,width:target.width,height:target.height,version:t.version,target:true};this.textures.set(t,s);return s;});
  const depth=target.depthBuffer?this.createTexture({size:[target.width,target.height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT}):null;
  state={width:target.width,height:target.height,colors,depth,depthView:depth?.createView()};this.targets.set(target,state);
  if(!this.targetDisposers)this.targetDisposers=new WeakSet();if(!this.targetDisposers.has(target)){this.targetDisposers.add(target);target.addEventListener('dispose',()=>{const r=this.targets.get(target);if(r){for(const t of r.colors)this.temporary.push(t.texture);if(r.depth)this.temporary.push(r.depth);this.targets.delete(target);for(const t of target.textures)this.textures.delete(t);}});}return state;
 }
 texture(t){
  t??=this.empty;let state=this.textures.get(t);if(state?.target)return state;
  const image=t.image;if(t.isRenderTargetTexture&&!state){const format=this.formatFor(t),texture=this.createTexture({size:[image.width,image.height],format,usage:usage()});state={texture,view:texture.createView(),format,width:image.width,height:image.height,version:t.version,target:true};this.textures.set(t,state);return state;}
  if(!image?.data)throw Error('WebGPU texture needs a typed data image: '+(t.name||t.type));
  const format=this.formatFor(t),width=image.width,height=image.height;
  if(!state||state.width!==width||state.height!==height||state.format!==format){if(state)this.temporary.push(state.texture);const texture=this.createTexture({label:t.name||'scene data',size:[width,height],format,usage:usage()});state={texture,view:texture.createView(),format,width,height,version:-1};this.textures.set(t,state);if(!this.textureDisposers)this.textureDisposers=new WeakSet();if(!this.textureDisposers.has(t)){this.textureDisposers.add(t);t.addEventListener('dispose',()=>{const r=this.textures.get(t);if(r){this.temporary.push(r.texture);this.textures.delete(t);}});}}
  if(state.version!==t.version){
   const channels=t.format===THREE.RedFormat?1:t.format===THREE.RGFormat?2:4,bytes=format==='rgba32float'?16:format==='rgba16float'?8:4,row=align(width*bytes,256),data=new Uint8Array(row*height),src=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);
   if(channels!==4){const view=new DataView(data.buffer);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*row+x*bytes+3*bytes/4;if(bytes===16)view.setFloat32(at,1,true);else if(bytes===8)view.setUint16(at,0x3c00,true);else data[at]=255;}}
   if(channels===4){for(let y=0;y<height;y++)data.set(src.subarray(y*width*bytes,(y+1)*width*bytes),y*row);}else{const size=bytes/4;for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++)data.set(src.subarray(((y*width+x)*channels+c)*size,((y*width+x)*channels+c+1)*size),y*row+x*bytes+c*size);}
   const buffer=this.createBuffer({size:data.byteLength,usage:GPUBufferUsage.COPY_SRC,mappedAtCreation:true});new Uint8Array(buffer.getMappedRange()).set(data);buffer.unmap();this.temporary.push(buffer);this.commands.push({type:'upload',buffer,texture:state.texture,row,width,height});state.version=t.version;
  }
  return state;
 }
 sampler(t){const mag=t?.magFilter===THREE.LinearFilter?'linear':'nearest',min=t?.minFilter===THREE.LinearFilter?'linear':'nearest',key=[mag,min,t?.wrapS,t?.wrapT].join(':');if(!this.samplers.has(key)){const wrap=x=>x===THREE.RepeatWrapping?'repeat':x===THREE.MirroredRepeatWrapping?'mirror-repeat':'clamp-to-edge';this.samplers.set(key,this.device.createSampler({magFilter:mag,minFilter:min,addressModeU:wrap(t?.wrapS),addressModeV:wrap(t?.wrapT)}));}return this.samplers.get(key);}
 attribute(a,index=false){
  const data=a.isInterleavedBufferAttribute?a.data:a,repeat=Math.max(1,a.meshPerAttribute||data.meshPerAttribute||1),bytes=data.array.byteLength*repeat;let state=this.attributes.get(data);
  if(!state||state.version!==data.version||state.bytes!==bytes||state.repeat!==repeat){if(state)this.temporary.push(state.buffer);const buffer=this.createBuffer({size:align(bytes,4)||4,usage:(index?GPUBufferUsage.INDEX:GPUBufferUsage.VERTEX)|GPUBufferUsage.COPY_DST,mappedAtCreation:true});
   const source=new Uint8Array(data.array.buffer,data.array.byteOffset,data.array.byteLength),destination=new Uint8Array(buffer.getMappedRange());
   if(repeat===1)destination.set(source);else{const stride=(data.stride||a.itemSize)*data.array.BYTES_PER_ELEMENT;for(let i=0;i<data.array.byteLength/stride;i++)for(let k=0;k<repeat;k++)destination.set(source.subarray(i*stride,(i+1)*stride),(i*repeat+k)*stride);}
   buffer.unmap();state={buffer,version:data.version,bytes,repeat};this.attributes.set(data,state);}return state.buffer;
 }
 trackGeometry(geometry){
  // Dynamic sand/rain geometry is replaced during editing. Track shared
  // attributes by owner so disposal neither leaks buffers nor invalidates
  // another geometry that still uses the same attribute.
  this.geometryResources??=new WeakMap();this.attributeOwners??=new WeakMap();
  const keys=new Set([...Object.values(geometry.attributes),geometry.index].filter(Boolean).map(a=>a.isInterleavedBufferAttribute?a.data:a));
  let state=this.geometryResources.get(geometry);
  const release=key=>{const owners=(this.attributeOwners.get(key)||1)-1;if(owners)this.attributeOwners.set(key,owners);else{this.attributeOwners.delete(key);const resource=this.attributes.get(key);if(resource)this.temporary.push(resource.buffer);this.attributes.delete(key);}};
  if(!state){state={keys:new Set()};this.geometryResources.set(geometry,state);geometry.addEventListener('dispose',()=>{for(const key of state.keys)release(key);state.keys.clear();});}
  for(const key of state.keys)if(!keys.has(key))release(key);
  for(const key of keys)if(!state.keys.has(key))this.attributeOwners.set(key,(this.attributeOwners.get(key)||0)+1);
  state.keys=keys;
 }
 async program(material){
  const samplerKey=JSON.stringify(sceneSamplerGroups(material));
  const previous=this.materialPrograms.get(material);if(previous?.version===material.version&&previous.samplerKey===samplerKey)return previous.promise;
  const source=snapshotMaterial(material),key=JSON.stringify(source);let promise=this.programs.get(key);
  if(!promise){promise=(async()=>{const start=performance.now(),s=await this.compiler.compile(source.vertex,source.fragment,source.defines,source.samplerGroups),d=this.device;const vs=d.createShaderModule({label:material.name+' vertex',code:s.vertex}),fs=d.createShaderModule({label:material.name+' fragment',code:s.fragment});
   for(const module of [vs,fs]){const info=await wait(module.getCompilationInfo(),10000,material.name);const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(material.name+': '+errors.map(m=>m.lineNum+': '+m.message).join('\n'));}
   const resources=new Map();for(const code of [s.vertex,s.fragment])for(const match of code.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)[^;]+;/g)){const g=+match[1],b=+match[2],name=match[0].match(/var(?:<[^>]+>)?\s+(\w+)/)?.[1];if(name&&(code.match(new RegExp('\\b'+name+'\\b','g'))||[]).length<2)continue;resources.set(g+':'+b,{group:g,binding:b,code:match[0]});}
   const layouts=[];for(const r of resources.values()){layouts[r.group]??=[];const entry={binding:r.binding,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT};if(/var<uniform>/.test(r.code))entry.buffer={type:'uniform'};else if(/texture_/.test(r.code))entry.texture={sampleType:'float'};else entry.sampler={type:'filtering'};layouts[r.group].push(entry);}
   for(let g=0;g<layouts.length;g++)layouts[g]=d.createBindGroupLayout({entries:layouts[g]||[]});
   const result={...s,vs,fs,key:this.info.programs.length,resources,layouts,layout:d.createPipelineLayout({bindGroupLayouts:layouts})};this.info.programs.push({name:material.name,milliseconds:performance.now()-start});return result;
  })();this.programs.set(key,promise);}const entry={version:material.version,samplerKey,promise};this.materialPrograms.set(material,entry);promise.then(p=>entry.resolved=p,()=>{});return promise;
 }
 compile(scene){const materials=new Set();scene.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);const promise=this.program(m);let done=false,error=null;promise.then(()=>done=true,e=>{done=true;error=e;});this.properties.set(m,{currentProgram:{isReady:()=>done,getUniforms:()=>{if(error)throw error;return{};}}});}});return materials;}
 async compileAsync(scene){const materials=this.compile(scene);await Promise.all([...materials].map(m=>this.program(m)));}
 clear(color=true,depth=true){const state=this.target?this.initRenderTarget(this.target):null;this.commands.push({type:'clear',state,color:color?[this.clearColor.r,this.clearColor.g,this.clearColor.b,this.clearAlpha]:null,depth});}
 clearDepth(){this.clear(false,true);}
 render(scene,camera){
  this.assertHealthy();scene.updateMatrixWorld();camera.updateMatrixWorld();const state=this.target?this.initRenderTarget(this.target):null;if(this.autoClear)this.clear();
  const objects=[];scene.traverseVisible(o=>{if(o.isMesh)objects.push(o);});objects.sort((a,b)=>a.renderOrder-b.renderOrder);
  for(const object of objects){
   const geometry=object.geometry,material=object.material;this.trackGeometry(geometry);if(!material?.visible)continue;const instances=geometry.isInstancedBufferGeometry?geometry.instanceCount:object.isInstancedMesh?object.count:1;if(!instances)continue;
   // Compilation hooks can add exact loop-bound uniforms. Prepare those before
   // taking a draw snapshot, including the first cached lighting update.
   const program=this.program(material);
   const resolved=this.materialPrograms?.get(material)?.resolved,uniforms={};const names=resolved?[...resolved.uniforms.fields.map(f=>f.name),...Object.keys(resolved.textures)]:Object.keys(material.uniforms||{});for(const name of names)if(material.uniforms[name])uniforms[name]=cloneUniformValue(material.uniforms[name].value);
   Object.assign(uniforms,{modelMatrix:object.matrixWorld.elements.slice(),modelViewMatrix:new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,object.matrixWorld).elements,projectionMatrix:camera.projectionMatrix.elements.slice(),viewMatrix:camera.matrixWorldInverse.elements.slice(),normalMatrix:new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,object.matrixWorld)).elements,cameraPosition:camera.position.toArray(),yFactor_:state?-1:1,textureOutputHeight_:state?.height||this.domElement.height});
   const textures={},samplers={};for(const [name,v] of Object.entries(uniforms))if(v?.isTexture||v==null){textures[name]=this.texture(v);samplers[name]=this.sampler(v);}
   const attributes={};for(const [name,a] of Object.entries(geometry.attributes))attributes[name]={buffer:this.attribute(a),itemSize:a.itemSize,stepMode:a.isInstancedBufferAttribute?'instance':'vertex',array:a.array,normalized:a.normalized,stride:a.isInterleavedBufferAttribute?a.data.stride:a.itemSize,offset:a.isInterleavedBufferAttribute?a.offset:0};
   for(const [name,size] of [['uv',2],['normal',3]])if(!attributes[name]){const a=new THREE.Float32BufferAttribute(new Float32Array((geometry.attributes.position?.count||4)*size),size);attributes[name]={buffer:this.attribute(a),itemSize:size,stepMode:'vertex',stride:size,offset:0};this.temporary.push(attributes[name].buffer);}
   const index=geometry.index?{buffer:this.attribute(geometry.index,true),format:geometry.index.array instanceof Uint32Array?'uint32':'uint16',count:geometry.index.count}:null;
   this.commands.push({type:'draw',program,name:material.name,state,uniforms,textures,samplers,attributes,index,instances:Number.isFinite(instances)?instances:1,count:geometry.attributes.position?.count||0,range:{...geometry.drawRange},viewport:this.viewport.toArray(),scissor:this.scissorTest?this.scissor.toArray():null,blend:blend(material),depthTest:material.depthTest,depthWrite:material.depthWrite,depthFunc:material.depthFunc,side:material.side});
  }
  if(this.commands.length>512)throw Error('WebGPU frame command budget exceeded');
 }
 uniform(data){let buffer=this.uniformBuffers[this.uniformIndex];if(!buffer||buffer.size<data.byteLength){if(buffer)this.destroyResource(buffer);buffer=this.createBuffer({size:align(data.byteLength,256),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.uniformBuffers[this.uniformIndex]=buffer;}this.uniformIndex++;this.device.queue.writeBuffer(buffer,0,data);return buffer;}
 async pipeline(c,p){
  const activeAttributes=p.activeAttributes??=Object.entries(p.attributes).filter(([name])=>new RegExp('@location\\('+p.attributes[name]+'\\)').test(p.vertex));const vertexBuffers=activeAttributes.map(([name,location])=>{const a=c.attributes[name];if(!a)throw Error('Missing active attribute '+name+' in '+c.name);return {arrayStride:a.stride*4,stepMode:a.stepMode,attributes:[{shaderLocation:location,offset:a.offset*4,format:a.itemSize===1?'float32':'float32x'+a.itemSize}]};});
  const formats=c.state?.colors.map(t=>t.format)||[this.format],key=p.key+JSON.stringify([vertexBuffers,formats,c.blend,!!c.state?.depth,c.depthTest,c.depthWrite,c.depthFunc,c.side]);let result=this.pipelines.get(key);if(result)return result;
  for(const f of formats)if(f==='rgba32float'&&c.blend&&!this.device.features.has('float32-blendable'))throw Error('This device cannot blend the full precision scene attachment; a validated half precision path is required');
  const descriptor={label:c.name,layout:p.layout,vertex:{module:p.vs,entryPoint:'main',buffers:vertexBuffers},fragment:{module:p.fs,entryPoint:'main',targets:formats.map(format=>({format,blend:c.blend}))},primitive:{topology:'triangle-list',cullMode:'none'}};
  if(c.state?.depth)descriptor.depthStencil={format:'depth32float',depthWriteEnabled:!!c.depthWrite,depthCompare:!c.depthTest?'always':c.depthFunc===THREE.GreaterDepth?'greater':c.depthFunc===THREE.LessDepth?'less':'less-equal'};
  result=wait(this.device.createRenderPipelineAsync(descriptor),30000,c.name+' pipeline').then(pipeline=>({pipeline,activeAttributes}));this.pipelines.set(key,result);return result;
 }
 attachments(state,clear=null,depthClear=false){
  const colors=state?.colors||[{view:this.context.getCurrentTexture().createView()}];
  return {colorAttachments:colors.map(t=>({view:t.view,loadOp:clear?'clear':'load',storeOp:'store',...(clear?{clearValue:clear}:{} )})),...(state?.depth?{depthStencilAttachment:{view:state.depthView,depthLoadOp:depthClear?'clear':'load',depthStoreOp:'store',depthClearValue:1}}:{})};
 }
 async flush({timeoutMs=2000,cpuWork=null}={}){
  this.assertHealthy();if(!this.commands.length&&!this.temporary.length&&!this.flushing){cpuWork?.();return;}if(this.flushing)throw Error('A WebGPU scene frame is already outstanding');this.flushing=true;const commands=this.commands.splice(0),retired=this.temporary.splice(0);this.uniformIndex=0;const d=this.device;
  const began=performance.now();let prepared,encoded;
  try{
   // Compile sequentially before submitting any draw. A failed shader cannot
   // leave a partially queued heavy frame behind it.
   for(const c of commands)if(c.type==='draw'){this.pipelineProgress?.(c.name);c.p=await c.program;c.pipeline=await this.pipeline(c,c.p);}
   prepared=performance.now();d.pushErrorScope('validation');const encoder=d.createCommandEncoder({label:'shared sand scene'});let calls=0;
   for(const c of commands){
    if(c.type==='upload'){encoder.copyBufferToTexture({buffer:c.buffer,bytesPerRow:c.row},{texture:c.texture},[c.width,c.height]);continue;}
    if(c.type==='copy'){encoder.copyTextureToTexture(c.source,c.destination,c.size);continue;}
    if(c.type==='clear'){encoder.beginRenderPass(this.attachments(c.state,c.color,c.depth)).end();continue;}
    const p=c.p,resources=new Map(),uniform=this.uniform(packUniforms(p.uniforms,c.uniforms)),internals=this.uniform(new Float32Array([c.uniforms.yFactor_,c.uniforms.textureOutputHeight_,0,0]));
    for(const [name,b] of Object.entries(p.buffers))resources.set(b.binding.groupIndex+':'+b.binding.bindingIndex,{buffer:name==='LeftOver'?uniform:internals});
    for(const [name,t] of Object.entries(p.textures)){const b=t.textures[0],image=c.textures[name]||this.texture(this.empty);if(p.resources.has(b.groupIndex+':'+b.bindingIndex)&&c.state?.colors.some(t=>t.texture===image.texture))throw Error('Texture feedback in '+c.name+': '+name);resources.set(b.groupIndex+':'+b.bindingIndex,image.view);}
    for(const [name,s] of Object.entries(p.samplers))resources.set(s.binding.groupIndex+':'+s.binding.bindingIndex,c.samplers[s.sourceTexture||name.replace(/Sampler$/,'')]||this.sampler(this.empty));
    const groups=p.layouts.map((layout,g)=>d.createBindGroup({layout,entries:[...p.resources.values()].filter(r=>r.group===g).map(r=>({binding:r.binding,resource:resources.get(g+':'+r.binding)}))}));
    const pass=encoder.beginRenderPass({...this.attachments(c.state),label:c.name});pass.setPipeline(c.pipeline.pipeline);groups.forEach((group,g)=>pass.setBindGroup(g,group));c.pipeline.activeAttributes.forEach(([name],i)=>pass.setVertexBuffer(i,c.attributes[name].buffer));
    const [x,y,w,h]=c.viewport;pass.setViewport(x,y,w,h,0,1);if(c.scissor){const [sx,sy,sw,sh]=c.scissor;pass.setScissorRect(sx,sy,sw,sh);}
    const start=c.range.start||0,count=Math.max(0,Math.min(c.range.count,(c.index?.count??c.count)-start));if(c.index){pass.setIndexBuffer(c.index.buffer,c.index.format);pass.drawIndexed(count,c.instances,start);}else pass.draw(count,c.instances,start);pass.end();calls++;
   }
   d.queue.submit([encoder.finish()]);encoded=performance.now();const completion=wait(d.queue.onSubmittedWorkDone(),timeoutMs,'Shared WebGPU frame');cpuWork?.();await completion;const error=await d.popErrorScope();if(error)throw Error(error.message);this.info.render.calls=calls;this.frameTimes={prepare:prepared-began,encode:encoded-prepared,wait:performance.now()-encoded,total:performance.now()-began};this.assertHealthy();
  }catch(error){this.failure=error;throw error;}finally{for(const resource of retired)this.destroyResource(resource);this.flushing=false;}
 }
 copyTextureToTexture(source,destination,region=null,position={x:0,y:0}){const a=this.texture(source),b=this.texture(destination);this.commands.push({type:'copy',source:{texture:a.texture},destination:{texture:b.texture,origin:[position.x,position.y]},size:[a.width,a.height]});}
 async readRenderTargetPixelsAsync(target,x,y,w,h,output,cubeFace=0,attachment=0){
  await this.flush();const state=this.initRenderTarget(target),t=state.colors[attachment],bytes=t.format==='rgba32float'?16:t.format==='rgba16float'?8:4,row=align(w*bytes,256),d=this.device,buffer=this.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=d.createCommandEncoder();encoder.copyTextureToBuffer({texture:t.texture,origin:[x,y]},{buffer,bytesPerRow:row},[w,h]);d.queue.submit([encoder.finish()]);
  try{await wait(buffer.mapAsync(GPUMapMode.READ),2000,'Scene diagnostic readback');const src=new Uint8Array(buffer.getMappedRange()),dst=new Uint8Array(output.buffer,output.byteOffset,output.byteLength);for(let y=0;y<h;y++)dst.set(src.subarray(y*row,y*row+w*bytes),y*w*bytes);return output;}finally{buffer.unmap();this.destroyResource(buffer);}
 }
 readRenderTargetPixels(){throw Error('Synchronous graphics readback is unavailable on WebGPU; use the asynchronous diagnostic');}
 dispose(){if(this.disposed)return;this.disposed=true;this.compiler.stop();this.device.destroy();}
}
