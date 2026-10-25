import {BoundedPressureGPU} from '../sand-lab/bounded-pressure-gpu.js';
import {PressureGeometryGPU,canUsePressureGeometry} from '../sand-lab/pressure-geometry-gpu.js';
import {PRESSURE_LIMITS,pressureInputError} from '../sand-lab/bounded-pressure-model.js';

// Keep neighborhood pressure and geometry in separate programs. In particular,
// never compile the historical shader with sand CSG nested inside pressure.
export class RTXPressureGPU extends BoundedPressureGPU {
 constructor(renderer){
  super(renderer);this.geo=new PressureGeometryGPU();
  for(const m of [this.densityMaterial,this.correctionMaterial,this.geo.boundary,this.geo.project])m.userData.rtxOptionalCompute=true;
 }
 dispatch(positions,neighbors,spacing,iterations,collide,boundary,lab,inputs=null){
  const n=positions.length/4;
  if(!n||!this.validated||!this.geometryValidated||!this.supported(n)||n>PRESSURE_LIMITS.particles||iterations>PRESSURE_LIMITS.iterations||!boundary||!canUsePressureGeometry(lab))return null;
  const reuse=inputs?.neighborsUnchanged&&this.checkedNeighbors===neighbors;
  const invalid=pressureInputError(positions,neighbors,spacing,iterations,!reuse);if(invalid)throw Error(invalid);
  this.checkedNeighbors=neighbors;
  const start=performance.now(),target=this.run(positions,neighbors,spacing,iterations,collide,boundary,lab,false,false,true,inputs);
  return {texture:target.texture,finish:result=>{
   if(result.length!==positions.length)throw Error('Incorrect deferred pressure result length.');
   for(let o=0;o<result.length;o++)if(!Number.isFinite(result[o])||((o%4===3||positions[o-o%4+3]>.5)&&result[o]!==positions[o])){
    this.stop('Invalid deferred pressure result.');throw Error(this.stopped);
   }
   this.last.totalMs=performance.now()-start;
   // The same bounded draws run as the validated reference. Disable future
   // GPU pressure dispatches if the completed step exceeded its wall budget.
   if(this.last.totalMs>PRESSURE_LIMITS.stepMs)this.stop('GPU pressure time budget exceeded.');
  }};
 }
 solve(positions,neighbors,spacing,iterations=3,collide=p=>p,boundary=null,lab=null){
  const n=positions.length/4;if(!n)return positions.slice();
  if(n>PRESSURE_LIMITS.particles||iterations>PRESSURE_LIMITS.iterations||!this.validated||!this.supported(n)){
   this.backend=this.stopped?'CPU pressure ('+this.stopped+')':'CPU pressure (outside validated GPU bounds)';
   return this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);
  }
  const invalid=pressureInputError(positions,neighbors,spacing,iterations);if(invalid)throw Error(invalid);
  lab?.syncSandUniforms?.();
  // Edited sand uses reference boundary samples, but neighbor pressure remains
  // on the GPU. Simple terrain/boulders/cups use GPU contacts as well.
  try{return this.run(positions,neighbors,spacing,iterations,collide,boundary,lab);}
  catch(error){this.stop(error.message);return this.cpuSolve(positions,neighbors,spacing,iterations,collide,boundary,lab);}
 }
}
