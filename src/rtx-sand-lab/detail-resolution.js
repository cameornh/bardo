import {Vector2} from 'three';

// Fine spray/mist is already reconstructed with a depth-aware screen-space
// filter. Accumulate its covariance-projected Gaussians at half linear
// resolution, then use that existing bilateral reconstruction. Physics,
// water/terrain surfaces, SH lighting and particle counts are unchanged.
export function installDetailResolution(detail){
 const full=detail.uniforms.uResolution,local={value:new Vector2(1,1)},render=detail.render.bind(detail);
 // Do not mutate the shared scene uniform: surface depth and the main image
 // keep their original size. UV depth lookups remain normalized in both passes.
 detail.uniforms={...detail.uniforms,uResolution:local};
 detail.material.uniforms.uResolution=local;detail.opticalMaterial.uniforms.uResolution=local;detail.reconstruct.uniforms.uResolution=local;
 detail.screenSize=local.value;
 detail.render=(...args)=>{
  const scale=detail.lab.optimizations?.fineParticleResolution===false?1:.5;
  local.value.set(Math.max(1,Math.ceil(full.value.x*scale)),Math.max(1,Math.ceil(full.value.y*scale)));
  return render(...args);
 };
}
