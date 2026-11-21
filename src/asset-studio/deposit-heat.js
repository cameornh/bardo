import {Vector3} from 'three';
import {activeMass,phaseState,surfaceState} from './material-reactions.js';

// Move a well-mixed fraction of a parcel or bed cell. h is specific enthalpy;
// moisture and dissolved water are extensive, while fuel is a mass fraction.
export function mixDeposit(bed,c,volume,source,cell){
 const m=bed.material,area=cell*cell,priorVolume=c.h*area,incoming=volume*m.density;
 if(!source&&!c.thermal)return;
 if(!c.thermal){
  const s=surfaceState(m,'deposit/'+m.id+'/'+c.x+','+c.z,new Vector3(c.x*cell,0,c.z*cell),area);
  s.mass=priorVolume*m.density;s.water=s.mass*m.moisture;s.bulkWater=s.mass*m.waterContent;
  s.radius=cell*.5;c.thermal=s;s.deposit=c;bed.thermalCells.push(c);
 }
 const dest=c.thermal,prior=dest.mass*(1-dest.lost),total=prior+incoming;
 const src=source??surfaceState(m,'',dest.position,area,incoming);
 const fraction=incoming/activeMass(src);
 dest.h=(prior*dest.h+incoming*src.h)/total;
 dest.fuel=(prior*dest.fuel+incoming*src.fuel)/total;
 dest.water+=src.water*fraction;dest.bulkWater+=src.bulkWater*fraction;
 dest.mass=total;dest.lost=0;Object.assign(dest,phaseState(m,dest.h));
}

export function takeDeposit(source,kg){
 const prior=activeMass(source),remaining=Math.max(0,1-kg/prior);
 source.mass=prior*remaining;source.lost=0;
 source.water*=remaining;source.bulkWater*=remaining;
}
