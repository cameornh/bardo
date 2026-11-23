import {DataTexture,FloatType,RGBAFormat,Vector4} from 'three';
import {GROUND_FIELD_CELL} from './material-world.js';
import {looseKind} from './loose-matter.js';

// Store exact world-cell addresses so marks survive camera travel and distant edits.
// The material field has at most 150 ground cells; this table has 512 slots.
const slots=512;
const index=(i,j)=>(Math.imul(i,73)^Math.imul(j,151))&(slots-1);
export class GroundFinish{
 constructor(){
  this.data=new Float32Array(slots*4);
  this.texture=new DataTexture(this.data,32,16,RGBAFormat,FloatType);
  this.uniforms={finishMap:{value:this.texture},finishBounds:{value:new Vector4()},finishProbes:{value:0}};
 }
 update(world,ground){
  if(this.world===world&&this.version===world?.version&&this.ground===ground)return;
  this.world=world;this.version=world?.version;this.ground=ground;
  this.data.fill(0);let probes=0,x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  for(const s of world?.tiles.values()??[]){
   if(s.material.id!==ground.id||looseKind(s.material)===2||s.material.phase==='gas')continue;
   const char=s.material.fuelEnergy>0?1-s.fuel:0;
   if(s.finish<.002&&char<.002)continue;
   let slot=index(s.i,s.j),steps=1;
   while(this.data[4*slot+2]){slot=(slot+1)&(slots-1);steps++;}
   this.data.set([s.i,s.j,1+s.finish,char],4*slot);
   probes=Math.max(steps,probes);x0=Math.min(x0,s.i);z0=Math.min(z0,s.j);x1=Math.max(x1,s.i);z1=Math.max(z1,s.j);
  }
  this.uniforms.finishProbes.value=probes;
  if(probes){this.uniforms.finishBounds.value.set(x0-1,z0-1,x1+1,z1+1);this.texture.needsUpdate=true;}
 }
 dispose(){this.texture.dispose();}
}
// Only early-return on uniform finishProbes==0; per-fragment bounds returns
// cause quad-divergence dot seams along finishBounds on Metal/ANGLE WebGL2,
// while empty/out-of-bounds cells already miss on n=0 in the 512-slot table.
export const groundFinishShader=`
 uniform sampler2D finishMap;uniform vec4 finishBounds;uniform int finishProbes;
 vec2 finishCell(ivec2 p){
  int slot=((p.x*73)^(p.y*151))&511;
  vec2 res=vec2(0.);
  for(int n=0;n<finishProbes;n++){
   vec4 t=texelFetch(finishMap,ivec2(slot&31,slot>>5),0);
   if(t.z==0.)break;
   if(all(equal(t.xy,vec2(p)))){res=vec2(t.z-1.,t.w);break;}
   slot=(slot+1)&511;
  }
  return res;
 }
 vec2 groundFinish(vec2 xz){
  if(finishProbes==0)return vec2(0.);
  vec2 p=xz/${GROUND_FIELD_CELL}-.5;
  ivec2 i=ivec2(floor(p));vec2 f=smoothstep(vec2(0.),vec2(1.),fract(p));
  return mix(mix(finishCell(i),finishCell(i+ivec2(1,0)),f.x),
             mix(finishCell(i+ivec2(0,1)),finishCell(i+ivec2(1)),f.x),f.y);
 }`;
