// Exact constant-wind drag/gravity step: same equation on GPU and reference.
// Visual tracers follow stock that the CPU sand solver already mobilized.
export function grainStep(position,velocity,dt,air,scale){
 const drag=2.5,decay=Math.exp(-drag*dt),integral=(1-decay)/drag;
 const terminal=air.map((v,k)=>v-(k===1?9.81/(scale*drag):0));
 return {position:position.map((v,k)=>v+terminal[k]*dt+(velocity[k]-terminal[k])*integral),velocity:velocity.map((v,k)=>terminal[k]+(v-terminal[k])*decay)};
}
export const GRAIN_MOTION_GLSL=`
void moveGrain(inout vec3 p,inout vec3 v,float dt,vec3 air,float scale){
 float drag=2.5,decay=exp(-drag*dt),integral=(1.-decay)/drag;
 vec3 terminal=air-vec3(0,9.81/(scale*drag),0);
 p+=terminal*dt+(v-terminal)*integral;v=terminal+(v-terminal)*decay;
}`;
