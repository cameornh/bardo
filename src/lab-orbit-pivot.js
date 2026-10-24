// Opt-in camera control for tests 11/12; no changes to the snapshot controls.
import * as THREE from 'three';
export function orbitPivot(position,direction,distance){return position.map((v,k)=>v+direction[k]*distance);}
export function installOrbitPivot(camera,controls,input,output,{scale=()=>1,enabled=()=>true}={}){
 let maximum=camera.position.distanceTo(controls.target),distance=maximum,updating=false;
 const direction=new THREE.Vector3();
 const sync=()=>{const unit=scale();input.disabled=!enabled();input.min=Math.min(maximum,Math.max(controls.minDistance||0,maximum*.01));input.max=maximum;input.step=(maximum-Number(input.min))/1000||.001;input.value=Math.min(maximum,distance);output.textContent=(distance*unit).toFixed(2)+' m';};
 const apply=()=>{if(!enabled())return;updating=true;camera.getWorldDirection(direction);controls.target.fromArray(orbitPivot(camera.position.toArray(),direction.toArray(),distance));const position=camera.position.clone(),rotation=camera.quaternion.clone(),damping=controls.enableDamping;controls.enableDamping=false;controls.update();camera.position.copy(position);camera.quaternion.copy(rotation);controls.update();controls.enableDamping=damping;updating=false;sync();};
 input.oninput=()=>{distance=Math.min(maximum,Math.max(Number(input.min),Number(input.value)));apply();};
 controls.addEventListener('change',()=>{if(updating||!enabled())return;distance=camera.position.distanceTo(controls.target);sync();});
 return {reset(){maximum=distance=camera.position.distanceTo(controls.target);sync();},rescale(factor){maximum*=factor;distance*=factor;sync();},refresh:sync,apply,get distance(){return distance;},get maximum(){return maximum;}};
}
