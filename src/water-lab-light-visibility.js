import {SPRAY_SHADOW_GLSL} from './water-lab-spray-shadows.js';
import {POOL_SHADOW_GLSL} from './water-lab-pool-shadows.js';
import {BODY_SHADOW_GLSL} from './water-lab-body-shadows.js';
// Geometry uniforms/functions precede this shared shader in every receiver.
export const LAB_LIGHT_VISIBILITY_GLSL=`
${SPRAY_SHADOW_GLSL}
${POOL_SHADOW_GLSL}
${BODY_SHADOW_GLSL}
vec3 sunTransmission(vec3 p,float scale){return spraySun(p)*bodySun(p,scale);}
vec3 poolTransmission(vec3 p,int lamp,float scale){vec3 delta=poolLamp(lamp)-p;float r=length(delta);return sprayPool(p,lamp)*bodyTransmission(p,delta/max(.0001,r),r,scale,.06,0.);}
`;
