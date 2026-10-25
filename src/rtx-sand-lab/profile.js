// Opt-in experiment for the separate RTX branch. Snapshot constructors never
// set allowGPUObjectContacts; their existing CPU restriction stays intact.
export const RTX_FRAME_HZ=60;
export const RTX_BACKENDS=['gpu','bounded','safe','cpu'];
export const requiresOpenGLWindow=device=>/Direct3D11|D3D11/.test(device.adapter||'');

export function applyRTXBackend(lab,requested,draw=null,bounded=null){
 if(!RTX_BACKENDS.includes(requested))throw new Error('Unknown RTX backend: '+requested);
 const supported=!!lab.renderer.extensions.has('EXT_color_buffer_float');
 const mode=supported?requested:'cpu',gpu=lab.gpu;
 if(['gpu','bounded'].includes(mode)&&!bounded?.geometryValidated)throw new Error('Validate split GPU pressure before enabling it.');
 gpu.cpu=mode==='cpu';
 gpu.contactGeometry=lab;
 gpu.forceCPUConstraints=mode==='safe'||mode==='cpu';
 gpu.allowGPUObjectContacts=mode==='gpu'||mode==='bounded';
 gpu.boundedPressure=mode==='gpu'||mode==='bounded'?bounded:null;
 lab.optimizations.gpuPressure=mode==='gpu'||mode==='bounded';
 gpu.contactArithmetic=null;
 gpu.neighborOrigin=null;lab.emitterSamples=null;
 if(lab.air){lab.air.cpu=gpu.cpu;lab.air.key=null;lab.air.grid=null;}
 if(lab.detail&&lab.detail.cpu!==gpu.cpu){lab.detail.cpu=gpu.cpu;lab.detail.reset();}
 if(draw){
  for(const name of ['density','sprayShadows','poolShadows','mediumShadows'])if(draw[name]){draw[name].cpu=gpu.cpu;draw[name].key=null;}
  draw.drawKey=null;draw.densityRevision=-1;
 }
 lab.revision++;
 return mode;
}

export function configureRTXLab(lab){
 // Enable every existing optimization, including the accelerated fallback
 // implementations. Alternative pressure solvers are selected separately.
 for(const key of Object.keys(lab.optimizations))lab.optimizations[key]=true;
 Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,adaptivePressure:true,distantOptics:true,viewPassCulling:true});
 lab.frameHz=RTX_FRAME_HZ;lab.physicsBudgetMs=12;
 // Batched transport/readback and asynchronous legacy steps are alternative
 // execution paths. Use the fused/batched route, not both simultaneously.
 lab.asyncSimulation=false;
 return applyRTXBackend(lab,'safe');
}

export function rendererInfo(renderer){
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 return {adapter:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),
  vendor:gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR),version:gl.getParameter(gl.VERSION),
  fragmentTextureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),vertexTextureUnits:gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
  floatTargets:renderer.extensions.has('EXT_color_buffer_float'),maxTextureSize:renderer.capabilities.maxTextureSize,
  api:'WebGL 2 fragment-shader compute (not CUDA or WebGPU)'};
}
