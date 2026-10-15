import {WATER_MATERIAL} from '../water-material.js';
// Artistic organic-load control: dissolved amber absorption plus unresolved
// suspended organics. Absorption grows faster than scattering at high load;
// increasing concentration obscures light rather than making opaque orange milk.
// Coefficients are per metre and shared by view and shadow paths.
// It is not a calibrated concentration of pure tannic acid.
export function soluteCoefficients([dye,tannin,sediment],organic=0,turbidity=0){
 const t=Math.max(0,tannin+organic);
 const scatter=[.012,.026,.035].map((v,k)=>v+Math.sqrt(t)*[.085,.072,.05][k]+dye*[.005,.025,.15][k]+sediment*.35+turbidity*[.55,.52,.42][k]);
 const absorption=WATER_MATERIAL.absorption.map((v,k)=>v+dye*[7,2.5,.12][k]+t*(1+.35*t)*[.12,.5,1.3][k]+sediment*[1.5,1.2,.8][k]);
 return {absorption,scatter,extinction:scatter.map((v,k)=>v+absorption[k]+turbidity*(1-[.55,.52,.42][k]))};
}
export const SOLUTE_GLSL=`
vec3 soluteScatter(vec3 c,float organic,float turbidity){float t=max(0.,c.y+organic);return vec3(.012,.026,.035)+sqrt(t)*vec3(.085,.072,.05)+c.x*vec3(.005,.025,.15)+c.z*.35+turbidity*vec3(.55,.52,.42);}
vec3 soluteExtinction(vec3 c,float organic,float turbidity){float t=max(0.,c.y+organic);return soluteScatter(c,organic,0.)+vec3(turbidity)+vec3(.28,.065,.035)+c.x*vec3(7,2.5,.12)+t*(1.+.35*t)*vec3(.12,.5,1.3)+c.z*vec3(1.5,1.2,.8);}
vec3 labTransmission(float path,float turbidity,float organic){return exp(-soluteExtinction(vec3(0),organic,turbidity)*max(0.,path));}
`;
