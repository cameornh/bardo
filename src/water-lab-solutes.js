import {WATER_MATERIAL} from './water-material.js';
// Artistic organic-load control: dissolved amber absorption plus unresolved
// suspended organics. It is not a calibrated concentration of pure tannic acid.
export function soluteCoefficients([dye,tannin,sediment],organic=0,turbidity=0){
 const t=Math.max(0,tannin+organic);
 const scatter=[.012,.026,.035].map((v,k)=>v+t*[.19,.14,.075][k]+dye*[.005,.025,.15][k]+sediment*.35+turbidity*[.55,.52,.42][k]);
 const absorption=WATER_MATERIAL.absorption.map((v,k)=>v+dye*[7,2.5,.12][k]+t*[.22,.65,1.5][k]+sediment*[1.5,1.2,.8][k]);
 return {scatter,extinction:scatter.map((v,k)=>v+absorption[k]+turbidity*(1-[.55,.52,.42][k]))};
}
export const SOLUTE_GLSL=`
vec3 soluteScatter(vec3 c,float organic,float turbidity){float t=max(0.,c.y+organic);return vec3(.012,.026,.035)+t*vec3(.19,.14,.075)+c.x*vec3(.005,.025,.15)+c.z*.35+turbidity*vec3(.55,.52,.42);}
vec3 soluteExtinction(vec3 c,float organic,float turbidity){float t=max(0.,c.y+organic);return soluteScatter(c,organic,0.)+vec3(turbidity)+vec3(.28,.065,.035)+c.x*vec3(7,2.5,.12)+t*vec3(.22,.65,1.5)+c.z*vec3(1.5,1.2,.8);}
vec3 labTransmission(float path,float turbidity,float organic){return organic>0.?exp(-soluteExtinction(vec3(0),organic,turbidity)*path):waterTransmission(path,turbidity);}
`;
