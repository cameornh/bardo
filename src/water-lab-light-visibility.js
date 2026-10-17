import {FOUNTAIN_VISIBILITY_GLSL} from './water-lab-fountain-light.js';
import {MEDIUM_SHADOW_GLSL} from './water-lab-medium-shadows.js';
import {SPRAY_SHADOW_GLSL} from './water-lab-spray-shadows.js';
import {POOL_SHADOW_GLSL} from './water-lab-pool-shadows.js';
import {BODY_SHADOW_GLSL} from './water-lab-body-shadows.js';
// Geometry uniforms/functions precede this shared shader in every receiver.
export const LAB_LIGHT_VISIBILITY_GLSL=`
${SPRAY_SHADOW_GLSL}
${POOL_SHADOW_GLSL}
${BODY_SHADOW_GLSL}
${MEDIUM_SHADOW_GLSL}
${FOUNTAIN_VISIBILITY_GLSL}
vec3 sunTransmission(vec3 p,float scale){return spraySun(p)*bodySun(p,scale)*mediumSun(p)*(uStation==8?fountainVisibility(p,normalize(vec3(-.4,1,.3))):1.);}
vec3 poolTransmission(vec3 p,int lamp,float scale){vec3 delta=poolLamp(lamp)-p;float r=length(delta);return sprayPool(p,lamp)*bodyTransmission(p,delta/max(.0001,r),r,scale,.06,0.)*mediumPool(p,lamp);}
`;
