// Shared only by tests 11 and 12. Trace the actual scene rather than a planar
// screenshot or a sky-only substitute: this also works for off-screen objects,
// tilted surfaces and individual liquid blobs. The existing Fresnel split in
// shadeWater controls the energy; surface motion changes the reflection through
// its reconstructed normal, never through a wind-speed switch.
export const WATER_SCENE_REFLECTION_GLSL = `
uniform bool uWaterSceneReflections;
vec3 waterSceneRadiance(vec3 origin,vec3 direction){
 float distance=traceOpaque(origin,direction);
 vec3 color=sky(direction);
 if(distance<9999.){
  vec3 hit=origin+direction*distance;
  // Specular receivers must see the reflected ray, not the real camera.
  color=reflectedSurfaceColor(hit,opaqueNormal(hit),-direction);
 }
 vec3 glassNormal;
 float glassDistance=traceGlass(origin,direction,distance,glassNormal);
 if(glassDistance<distance)
  color=shadeGlass(origin+direction*glassDistance,glassNormal,direction,color);
 return color;
}
vec3 waterSceneReflection(vec3 p,vec3 n,vec3 incident){
 vec3 direction=reflect(incident,n);
 if(!uWaterSceneReflections)return sky(direction);
 return waterSceneRadiance(p+n*clamp(uSpacing*.01,.00004,.003),direction);
}
`;

// Double-precision reference for the bounded GPU optical query (QA only).
// Scene callbacks provide their own geometry and radiance, as in the shader.
export function waterSceneReflectionCPU(p,n,incident,scene){
 const dot=n.reduce((sum,v,k)=>sum+v*incident[k],0);
 const direction=incident.map((v,k)=>v-2*dot*n[k]);
 if(scene.enabled===false)return scene.sky(direction);
 const bias=Math.max(.00004,Math.min(.003,scene.spacing*.01));
 const origin=p.map((v,k)=>v+n[k]*bias);
 const distance=scene.traceOpaque(origin,direction);
 const at=t=>origin.map((v,k)=>v+direction[k]*t);
 let color=distance<9999?scene.shadeOpaque(at(distance),direction.map(v=>-v)):scene.sky(direction);
 const glass=scene.traceGlass(origin,direction,distance);
 if(glass.distance<distance)color=scene.shadeGlass(at(glass.distance),glass.normal,direction,color);
 return color;
}
