import {BoundedPressureGPU} from '../sand-lab/bounded-pressure-gpu.js';
import {PressureGeometryGPU} from '../sand-lab/pressure-geometry-gpu.js';
import {PRESSURE_LIMITS,pressureInputError} from '../sand-lab/bounded-pressure-model.js';

// Keep neighborhood pressure and geometry in separate programs. In particular,
// never compile the historical shader with sand CSG nested inside pressure.
export class RTXPressureGPU extends BoundedPressureGPU {
 constructor(renderer){
  super(renderer);this.geo=new PressureGeometryGPU();
  for(const m of [this.densityMaterial,this.correctionMaterial,this.geo.boundary,this.geo.project])m.userData.rtxOptionalCompute=true;
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
