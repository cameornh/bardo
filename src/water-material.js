// One water material, independent of the solver, body size, or connectivity.
export const WATER_MATERIAL=Object.freeze({density:1000,ior:1.333,absorption:Object.freeze([.28,.065,.035]),scatter:Object.freeze([.012,.026,.035]),roughness:.12,turbidity:.012});
export function waterTransmittance(distance,turbidity=0){return WATER_MATERIAL.absorption.map((a,i)=>Math.exp(-(a+WATER_MATERIAL.scatter[i]+turbidity)*Math.max(0,distance)));}
export const WATER_MATERIAL_GLSL=`
const float WATER_IOR=1.333;
vec3 waterExtinction(float turbidity){return vec3(.28,.065,.035)+vec3(.012,.026,.035)+vec3(turbidity);}
vec3 waterTransmission(float distance,float turbidity){return exp(-waterExtinction(turbidity)*max(distance,0.));}
vec3 waterVolume(vec3 bottom,float distance,float turbidity,vec3 illumination,float cosine){
 vec3 trans=waterTransmission(distance,turbidity),scattering=vec3(.012,.026,.035)+vec3(.55,.52,.42)*turbidity;
 return bottom*trans+illumination*scattering/waterExtinction(turbidity)*(.75*(1.+cosine*cosine))*(1.-trans);
}
float waterFresnel(float cosine){float f=pow((WATER_IOR-1.)/(WATER_IOR+1.),2.);return f+(1.-f)*pow(1.-clamp(cosine,0.,1.),5.);}
`;
