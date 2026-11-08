import {CONNECTED_WGSL} from '../connected/shaders.js';
import {ConnectedFields,ConnectedPipeline} from '../connected/pipeline.js';

// Only small levels use workgroup memory. The operator, iteration counts,
// precision, restriction and pressure convergence gates remain unchanged.
// All 256 invocations enter this uniform branch and every barrier together.
const localRelax=`
var<workgroup> localX:array<f32,256>;
var<workgroup> localNext:array<f32,256>;
fn relaxLevel(level:u32,lid:u32,passes:u32){
 let n=md(level,0u);
 if(n>256u||c[5].w<.5){relaxStorageLevel(level,lid,passes);return;}
 var rhs=0.;var diagonal=1.;var first=0u;var last=0u;
 let links=md(level,2u);
 if(lid<n){
  localX[lid]=tmp[mgAt(level,lid,0u)];rhs=tmp[mgAt(level,lid,1u)];
  let node=md(level,1u)+lid*4u;diagonal=max(topo[node],1e-20);
  first=u32(topo[node+1u]);last=u32(topo[node+2u]);
 }
 workgroupBarrier();
 for(var s=0u;s<passes;s++){
  if(lid<n){
   let x=localX[lid];var v=diagonal*x;
   for(var k=first;k<last;k++){v-=topo[links+k*2u+1u]*localX[u32(topo[links+k*2u])];}
   localNext[lid]=x+.7*(rhs-v)/diagonal;
  }
  workgroupBarrier();if(lid<n){localX[lid]=localNext[lid];}workgroupBarrier();
 }
 if(lid<n){tmp[mgAt(level,lid,0u)]=localX[lid];}
 storageBarrier();
}
`;
export const LOCAL_PRESSURE_WGSL=CONNECTED_WGSL.replace('fn relaxLevel(', 'fn relaxStorageLevel(')+localRelax;
class LocalPressureFields extends ConnectedFields {
 pack(...args){const packed=super.pack(...args);packed.fieldConfig[23]=this.particles.localEnabled() ? 1:0;return packed;}
}
export class LocalPressurePipeline extends ConnectedPipeline {
 constructor(localEnabled=()=>true){super();this.localEnabled=localEnabled;}
 createFields(){return new LocalPressureFields(this,LOCAL_PRESSURE_WGSL);}
}
