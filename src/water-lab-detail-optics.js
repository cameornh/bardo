import {waterTransmittance} from './water-material.js';

// CPU reference for the tracer lighting used by the GPU splat pass. All
// spectral attenuation comes from the shared water material, not a blue tint.
export function detailRadiance(kind,environment,ambient,viewPath,lightPath,turbidity=0) {
  const view=waterTransmittance(viewPath,turbidity),incoming=waterTransmittance(lightPath,turbidity);
  return environment.map((value,k)=>{
    const light=kind===0?2.4+Math.max(0,value):kind===1?1.25+Math.max(0,value):.1+Math.max(0,value)*.8;
    return light*ambient*incoming[k]*view[k];
  });
}
export const DETAIL_LIGHT_GLSL=`
vec3 detailLight(float kind,vec3 environment,float ambient){
  return (kind<.5?vec3(2.4)+max(environment,vec3(0)):kind<1.5?vec3(1.25)+max(environment,vec3(0)):vec3(.1)+max(environment,vec3(0))*.8)*ambient;
}
`;
