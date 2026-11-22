// Lift or splash a handful of the actual material under the pointer. Each
// bed node stores volume as thickness times cell area, independent of camera.
import {Vector3} from 'three';
import {BED_CELL} from './material-bed.js';
import {activeMass,phaseState,surfaceState} from './material-reactions.js';
import {takeDeposit} from './deposit-heat.js';

export function disturbDeposit(sim,bed,point,force=null){
 if(!bed||sim.heldDeposit||sim.heldChunk)return false;
 const m=bed.material,area=BED_CELL**2,radius=1.65*BED_CELL;
 const i=Math.round(point.x/BED_CELL),j=Math.round(point.z/BED_CELL),samples=[];
 let total=0;
 for(let x=i-2;x<=i+2;x++)for(let z=j-2;z<=j+2;z++){
  const cell=bed.at(x,z);
  if(!cell?.h)continue;
  const dx=x*BED_CELL-point.x,dz=z*BED_CELL-point.z;
  const weight=Math.max(0,1-(dx*dx+dz*dz)/radius**2);
  const mobile=bed.liquid?(cell.thermal?.melt??1):1;
  const volume=Math.min(.12,cell.h)*area*weight*mobile;
  if(volume<1e-7)continue;
  const r=.87*Math.cbrt(3*volume/(4*Math.PI));
  const top=sim.matter.groundHeight(sim,x*BED_CELL,z*BED_CELL)+(bed.liquid?cell.h:0);
  const position=new Vector3(x*BED_CELL,top+r,z*BED_CELL);
  samples.push({cell,packet:{position,volume,radius:r,material:m,owner:cell.owner,gripOffset:position.clone().sub(point)}});
  total+=volume;
 }
 if(!samples.length||sim.matter.count+samples.length>768)return false;
 const key='handful-'+(++sim.chunkSerial);
 const group=sim.matter.addPackets(sim,key,m,samples.map(s=>s.packet),true,key);
 const state=surfaceState(m,key,point.clone(),4*total**(2/3),total*m.density);
 state.mass=total*m.density;state.h=0;state.fuel=0;state.water=0;state.bulkWater=0;
 for(const {cell,packet} of samples){
  const kg=packet.volume*m.density;
  const source=cell.thermal??surfaceState(m,'',packet.position,area,kg);
  const share=kg/activeMass(source);
  state.h+=source.h*packet.volume/total;state.fuel+=source.fuel*packet.volume/total;
  state.water+=source.water*share;state.bulkWater+=source.bulkWater*share;
  if(cell.thermal)takeDeposit(cell.thermal,kg);
  cell.h=Math.max(0,cell.h-packet.volume/area);
 }
 Object.assign(state,phaseState(m,state.h),{group,radius:Math.cbrt(total)*.4});
 group.thermal=state;sim.materialWorld.loose.set(key,state);bed.version++;
 if(samples.some(s=>s.cell.thermal&&s.cell.thermal===sim.materialWorld.probe))sim.materialWorld.probe=state;
 if(force===null){
  group.grip={target:point.clone()};sim.heldDeposit=group;
 }else{
  const speed=Math.min(4,force*.045/(total*m.density));
  for(const {packet} of samples){
   const v=packet.gripOffset.clone();v.y=0;v.multiplyScalar(.7*speed/radius);v.y=speed;
   packet.body.setLinvel(v,true);
  }
 }
 return true;
}
