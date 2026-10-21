import {sandMaterial} from './sand-material.js';
const clamp=x=>Math.max(0,Math.min(1,x));
export const AIR_DENSITY=1.225;
// Test 12's unresolved particle model. All values are physical (m, s, kg)
// except cohesion [0,1]. Yield stress is an artistic effective surface stress,
// not the much larger tensile strength of an entire bonded sand structure.
export function sandParticleMaterial(wet=0,memory=0){
 const response=sandMaterial(wet,memory),cohesion=response.adhesion,threshold=response.entrainmentSpeed;
 return {density:2650,cohesion,yieldStress:.5*AIR_DENSITY*threshold**2,
  surfaceTension:0,dispersion:response.dispersion,drag:2.5,
  albedo:[.68,.44,.19].map(v=>v*(1-.35*clamp(wet)))};
}
// Dynamic pressure must overcome binding/capillary stress. Water uses a
// boundary shear fraction; a still submerged surface cannot be eroded by air.
// A future non-solid material supplies properties here, not an enum branch.
export function particleRelease(material,{speed,density=AIR_DENSITY,shear=1,length=.001}){
 const stress=.5*density*speed*speed*shear;
 const threshold=material.yieldStress+material.surfaceTension/Math.max(1e-6,length);
 const excess=Math.max(0,Math.sqrt(stress/(.5*AIR_DENSITY))-Math.sqrt(threshold/(.5*AIR_DENSITY)));
 return {stress,threshold,excess,ratio:stress/Math.max(1e-12,threshold),dispersion:material.dispersion};
}
const hash=i=>{const v=Math.sin(i*12.9898)*43758.5453;return v-Math.floor(v);};
// Independently stratified births and size-dependent drag keep loose grains
// from following one identical trajectory. Cohesion suppresses that spread.
export function grainBirth(event,index,scale){
 const id=event.seed*4099+index*17,m=event.material||sandParticleMaterial(event.wet,event.memory),n=event.normal||[0,1,0];
 const radius=.018+.035*hash(id+7),spread=event.spread??.03;
 const jitter=[0,1,2].map(k=>(hash(id+k*131)-.5)*spread*2),vn=jitter.reduce((s,v,k)=>s+v*n[k],0);
 const deviation=(.4+Math.min(7,(event.speed||20)*.1))*m.dispersion/scale;
 const velocity=event.velocity.map((v,k)=>v+(hash(id+k*57+13)-.5)*deviation*2+n[k]*hash(id+31)*deviation*.45);
 return {position:event.position.map((v,k)=>v+jitter[k]-n[k]*vn),velocity,
  life:1.2+hash(id)*1.5,delay:hash(id+89)*Math.min(.12,event.duration??.12),
  radius,drag:m.drag*(.035/radius)**1.3,density:m.density,albedo:m.albedo};
}
