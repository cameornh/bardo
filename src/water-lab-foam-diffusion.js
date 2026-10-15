// Receiver-only approximation to diffuse transmission through high-albedo
// whitewater. Beer extinction still drives god rays / visibility. A bounded
// scattered fraction reaches the floor instead of treating all extinguished
// sunlight as absorbed. This is not a full multiple-scattering solve.
export function foamDiffuseTransmission(transmission,albedo=.94){
 const t=Math.max(0,Math.min(1,transmission)),tau=-Math.log(Math.max(1e-6,t));
 return .5*albedo*(1-t)*Math.exp(-Math.sqrt(3*(1-albedo))*tau);
}
export const FOAM_DIFFUSION_GLSL=`
uniform bool uFoamFloorScatter;
float foamDiffuseTransmission(float t){t=clamp(t,0.,1.);float tau=-log(max(1e-6,t));return .47*(1.-t)*exp(-sqrt(.18)*tau);}
// Average a small receiver footprint; adjacent foam shadows can share diffuse
// illumination. The footprint expands with optical distance through water.
vec3 foamFloorRadiance(vec3 p,vec3 n){
 if(!uFoamFloorScatter||!uSprayShadows||uSunlight<=0.)return vec3(0);
 vec3 medium=mediumSun(p),ext=soluteExtinction(vec3(0),uTannins,uTurbidity);
 float path=clamp(-log(max(.0001,medium.g))/max(.02,ext.g)/uScale,0.,4.);
 float radius=.12+path*.3;
 vec3 tangent=normalize(cross(n,abs(n.y)<.9?vec3(0,1,0):vec3(1,0,0))),bitangent=cross(n,tangent);
 float diffuse=foamDiffuseTransmission(spraySun(p))*.4;
 for(int i=0;i<4;i++){float a=float(i)*1.5707963268;vec3 q=p+(cos(a)*tangent+sin(a)*bitangent)*radius;diffuse+=foamDiffuseTransmission(spraySun(q))*.15;}
 // Apply the same water/glass absorption and body occlusion as direct light.
 // No floor-specific changes enter the volume/god-ray shadow query.
 return LAB_SUN*uSunlight*medium*bodySun(p,uScale)*diffuse*max(0.,n.y);
}
`;
