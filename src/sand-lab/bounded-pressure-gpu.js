import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {packNeighborTexture} from './neighbor-texture.js';
import {NativeDensity,nativeDensityAvailable} from './native-density.js';
import {solveDensityCPU} from './density-cpu.js';
import {PressureBudget} from './pressure-budget.js';
import {PressureContacts} from './pressure-contacts.js';
import {PRESSURE_LIMITS,pressureInputError,pressureDrawRanges,pressureComparison} from './bounded-pressure-model.js';
import {PRESSURE_DENSITY_SHADER,PRESSURE_CORRECTION_SHADER} from './bounded-pressure-shaders.js';
import {PressureGeometryGPU,canUsePressureGeometry} from './pressure-geometry-gpu.js';

// Small arithmetic and analytic-contact shaders run in separate stages.
// Complex edited sand retains the original compiled CPU solver.
// This class never requests a context, retries a failed draw, or restores one.
export class BoundedPressureGPU {
 constructor(renderer){
  this.renderer=renderer;this.validated=false;this.stopped=null;this.backend='CPU (GPU pressure not validated)';
  this.geometryValidated=false;this.autoSelect=false;this.budget=new PressureBudget();
  this.u={uPositions:{value:null},uNeighbors:{value:null},uWall:{value:null},uLambda:{value:null},uCount:{value:0},uSpacing:{value:0}};
  const material=(name,fragmentShader)=>{
   const m=new THREE.ShaderMaterial({name,glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader,uniforms:this.u,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
   m.userData.skipObjectWarmup=true;return m;
  };
  this.densityMaterial=material('bounded-pressure-density',PRESSURE_DENSITY_SHADER);
  this.correctionMaterial=material('bounded-pressure-correction',PRESSURE_CORRECTION_SHADER);
  this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.mesh=new THREE.Mesh(this.geometry,this.densityMaterial);this.scene.add(this.mesh);this.camera=new THREE.Camera();
  this.contacts=new PressureContacts();this.height=0;
 }
 stop(reason){this.stopped??=String(reason);this.validated=false;this.geometryValidated=false;this.backend='CPU (GPU pressure stopped: '+this.stopped+')';}
 supported(n){return !this.stopped&&!!this.renderer.extensions?.has('EXT_color_buffer_float')&&Math.ceil(n/64)*8<=(this.renderer.capabilities?.maxTextureSize||0);}
 allocate(n){
  const height=Math.ceil(n/64);if(this.height===height)return;this.disposeTargets();this.height=height;
  const texture=(data,w,h)=>{const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;return t;};
  this.positionData=new Float32Array(64*height*4);this.wallData=this.positionData.slice();this.readback=this.positionData.slice();this.neighborData=new Float32Array(64*height*128);
  this.positionTexture=texture(this.positionData,64,height);this.wallTexture=texture(this.wallData,64,height);this.neighborTexture=texture(this.neighborData,256,height*8);
  const target=()=>new THREE.WebGLRenderTarget(64,height,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.lambda=target();this.corrected=target();this.boundaryTarget=target();this.projected=[target(),target()];this.u.uPositions.value=this.positionTexture;this.u.uWall.value=this.wallTexture;this.u.uNeighbors.value=this.neighborTexture;this.u.uLambda.value=this.lambda.texture;
 }
 validateGeometry(lab,fixtures){
  if(!this.validated||this.geometryAttempted||this.stopped)return {pass:false,reason:'Validated pressure and a fresh geometry check are required.'};
  this.geometryAttempted=true;const rows=[];
  try{
   if(!canUsePressureGeometry(lab))throw Error('Geometry is outside the bounded GPU path.');
   if(!fixtures.length||fixtures.length>4)throw Error('Expected one to four small geometry fixtures.');
   for(const f of fixtures){
    if(f.positions.length/4>256)throw Error('Geometry validation exceeds 256 points.');
    const error=pressureInputError(f.positions,f.neighbors,f.spacing,3);if(error)throw Error(error);
    const expected=solveDensityCPU(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary),actual=this.run(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary,lab,true,true),comparison=pressureComparison(actual,expected,f.positions,f.spacing);
    rows.push({name:f.name,...comparison,ms:this.last.totalMs});if(!comparison.pass)throw Error('GPU geometry differs from CPU contacts.');
   }
   this.geometryValidated=true;return {pass:true,rows};
  }catch(error){this.stop(error.message);return {pass:false,rows,reason:this.stopped};}
 }
 cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab){
  if(lab?.optimizations?.nativeContacts!==false&&nativeDensityAvailable()){this.cpu??=new NativeDensity();return this.cpu.solve(positions,neighbors,spacing,iterations,collide,boundary,lab);}
  return solveDensityCPU(positions,neighbors,spacing,iterations,collide,boundary);
 }
 // Explicit small-fixture validation; never run automatically on a whole beach.
 // Validation is per renderer/session and is revoked permanently on first failure.
 validate(fixtures){
  if(this.attempted||this.stopped)return {pass:false,reason:this.stopped||'Validation already attempted.'};
  this.attempted=true;const rows=[];
  try{
   if(!fixtures.length||fixtures.length>4)throw Error('Expected one to four small validation fixtures.');
   for(const f of fixtures){
    if(f.positions.length/4>PRESSURE_LIMITS.validationParticles)throw Error('Validation fixture exceeds 256 points.');
    const error=pressureInputError(f.positions,f.neighbors,f.spacing,3);if(error)throw Error(error);
    if(!this.supported(f.positions.length/4))throw Error('Float GPU pressure targets unavailable.');
    // Reference deliberately uses full pressure, irrespective of live shortcuts.
    const expected=solveDensityCPU(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary);
    const actual=this.run(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary,null,true);
    const comparison=pressureComparison(actual,expected,f.positions,f.spacing);
    rows.push({name:f.name,...comparison,ms:this.last.totalMs});
    if(!comparison.pass)throw Error('GPU pressure differs from its CPU reference.');
   }
   this.validated=true;this.backend='GPU pressure / CPU contacts';return {pass:true,rows};
  }catch(error){this.stop(error.message);return {pass:false,rows,reason:this.stopped};}
 }
 solve(positions,neighbors,spacing,iterations=3,collide=p=>p,boundary=null,lab=null){
  const start=performance.now(),n=positions.length/4;
  if(!n)return positions.slice();
  // Larger scenes and unsupported controls go directly to the existing CPU
  // implementation; never submit an oversized GPU workload.
  if(n>PRESSURE_LIMITS.particles||iterations>PRESSURE_LIMITS.iterations){
   this.backend='CPU (outside bounded GPU size)';return this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);
  }
  const invalid=pressureInputError(positions,neighbors,spacing,iterations,false);
  if(invalid)throw Error(invalid);
  lab?.syncSandUniforms?.();
  if(!this.geometryValidated||!this.supported(n)||!boundary||!canUsePressureGeometry(lab)){
   this.backend=this.stopped?'CPU (GPU stopped: '+this.stopped+')':'CPU (geometry requires reference contacts)';
   return this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);
  }
  if(this.autoSelect&&(!this.budget.accepts(n)||!this.budget.ready)){
   this.backend='CPU ('+(this.budget.reason||(!this.budget.accepts(n)?'workload outside calibrated range':'measuring pressure cost'))+')';
   const result=this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);this.budget.recordCPU(performance.now()-start,n);return result;
  }
  try{
   const neighborError=pressureInputError(positions,neighbors,spacing,iterations);if(neighborError)throw Error(neighborError);
   const result=this.run(positions,neighbors,spacing,iterations,collide,boundary,lab);
   if(this.autoSelect)this.budget.recordGPU(performance.now()-start);return result;
  }catch(error){this.stop(error.message);return this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);}
 }

 run(positions,neighbors,spacing,iterations,collide=p=>p,boundary=null,lab=null,validation=false,checkGeometry=false){
  const r=this.renderer,n=positions.length/4,start=performance.now();
  if(this.stopped)throw Error(this.stopped);
  if(r.getContext().isContextLost())throw Error('Graphics context unavailable.');
  const gpuGeometry=(this.geometryValidated||checkGeometry)&&canUsePressureGeometry(lab);
  this.allocate(n);if(gpuGeometry){this.geo??=new PressureGeometryGPU();this.geo.prepare(lab,n,spacing);}else this.contacts.begin(positions,spacing,collide,boundary,lab);
  packNeighborTexture(neighbors,this.neighborData,n);this.neighborTexture.needsUpdate=true;
  this.u.uCount.value=n;this.u.uSpacing.value=spacing;
  const previous=r.getRenderTarget(),autoClear=r.autoClear,viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),scissorTest=r.getScissorTest();
  const ranges=pressureDrawRanges(n);let current=positions,contactMs=0,pressureMs=0;
  try{
   r.autoClear=false;
   if(gpuGeometry){
    this.positionData.fill(0);this.positionData.set(positions);this.positionTexture.needsUpdate=true;this.u.uPositions.value=this.positionTexture;this.u.uWall.value=this.boundaryTarget.texture;
    const draw=(material,target)=>{this.mesh.material=material;r.setRenderTarget(target);r.setScissorTest(true);for(const range of ranges){r.setScissor(0,range.y,64,range.height);r.render(this.scene,this.camera);}};
    const pressureStart=performance.now();
    for(let iteration=0;iteration<iterations;iteration++){
     this.geo.u.uPositions.value=this.u.uPositions.value;draw(this.geo.boundary,this.boundaryTarget);draw(this.densityMaterial,this.lambda);draw(this.correctionMaterial,this.corrected);
     this.geo.u.uPositions.value=this.corrected.texture;draw(this.geo.project,this.projected[iteration%2]);this.u.uPositions.value=this.projected[iteration%2].texture;
    }
    r.readRenderTargetPixels(this.projected[(iterations-1)%2],0,0,64,this.height,this.readback);pressureMs=performance.now()-pressureStart;
    current=this.readback.subarray(0,n*4);for(let o=0;o<current.length;o++)if(!Number.isFinite(current[o])||((o%4===3||positions[o-o%4+3]>.5)&&current[o]!==positions[o]))throw Error('Invalid GPU contact result.');
    if(r.getContext().isContextLost())throw Error('Graphics context lost during pressure.');
    this.last={totalMs:performance.now()-start,pressureMs,contactMs:0,particles:n,draws:iterations*4*ranges.length,readbacks:1,contactMemoryBytes:0};
    if(this.last.totalMs>(validation?1000:PRESSURE_LIMITS.stepMs))throw Error('GPU pressure time budget exceeded.');
    this.backend='GPU pressure and simple beach contacts';return current.slice();
   }
   this.u.uWall.value=this.wallTexture;
   for(let iteration=0;iteration<iterations;iteration++){
    const contactStart=performance.now();
    this.wallData.fill(0);this.wallData.set(this.contacts.sample(current));this.wallTexture.needsUpdate=true;
    this.positionData.fill(0);this.positionData.set(current);this.positionTexture.needsUpdate=true;this.u.uPositions.value=this.positionTexture;
    contactMs+=performance.now()-contactStart;
    const pressureStart=performance.now();
    const resultTarget=this.corrected;
    for(const [material,target] of [[this.densityMaterial,this.lambda],[this.correctionMaterial,resultTarget]]){
     this.mesh.material=material;r.setRenderTarget(target);r.setScissorTest(true);
     for(const range of ranges){r.setScissor(0,range.y,64,range.height);r.render(this.scene,this.camera);}
    }
     r.readRenderTargetPixels(resultTarget,0,0,64,this.height,this.readback);pressureMs+=performance.now()-pressureStart;
     const corrected=this.readback.subarray(0,n*4);
     for(let o=0;o<corrected.length;o++)if(!Number.isFinite(corrected[o])||((o%4===3||positions[o-o%4+3]>.5)&&corrected[o]!==positions[o]))throw Error('Invalid GPU pressure result.');
     const projectStart=performance.now();current=this.contacts.project(corrected);contactMs+=performance.now()-projectStart;
    // This prevents subsequent submissions; it cannot preempt a driver draw.
    if(performance.now()-start>(validation?1000:PRESSURE_LIMITS.stepMs))throw Error('GPU pressure time budget exceeded.');
    if(r.getContext().isContextLost())throw Error('Graphics context lost during pressure.');
   }
   this.last={totalMs:performance.now()-start,pressureMs,contactMs,particles:n,draws:iterations*2*ranges.length,readbacks:iterations,contactMemoryBytes:this.contacts.memoryBytes};
   this.backend='GPU pressure / '+this.contacts.backend;return current.slice();
  }finally{
   r.autoClear=autoClear;r.setRenderTarget(previous);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);
  }
 }
 disposeTargets(){for(const key of ['positionTexture','wallTexture','neighborTexture','lambda','corrected','boundaryTarget']){this[key]?.dispose();this[key]=null;}for(const t of this.projected||[])t.dispose();this.projected=null;this.height=0;}
 dispose(){this.disposeTargets();this.geo?.dispose();this.densityMaterial.dispose();this.correctionMaterial.dispose();this.geometry.dispose();this.stop('disposed');}
}
