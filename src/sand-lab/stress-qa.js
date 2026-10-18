import * as THREE from 'three';
// Explicit, resettable load fixtures; never mutate saved terrain on startup.
export function stressFixture(bed,{length=2,column=5,wet=.95,z=3.7,x=-1.5}={}){
 const y=bed.height(x,z),r=.12,parts=[];
 const add=(position,r)=>{const p={id:bed.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*.56,packing:.56,wet,memory:.95,anchored:true};bed.parcels.push(p);parts.push(p);};
 for(let i=0;i<column;i++)add([x,y+.2+i*.22,z],i?r:.22);
 for(let i=1;i<=length;i++)add([x+i*.22,y+.2+(column-1)*.22,z],r);
 bed.initialMass=bed.totalMass()+bed.removedMass;bed.update();return parts;
}
export function installSandStressQA({lab,camera,controls,panel,results}){
 const finish=label=>{lab.sand.update();lab.syncUniforms();lab.revision++;panel.querySelector('#pause').textContent=lab.paused?'Resume':'Pause';
  results.textContent=JSON.stringify({fixture:label,backend:'CPU bonded loads / conservative sand; GPU airborne grains',massError:lab.sand.totalMass()+lab.sand.removedMass-lab.sand.initialMass,peakLoad:lab.sand.stress?.maxLoad,breaks:lab.sand.stress?.failures,windTransport:lab.sand.windMoved,brushHit:lab.sandWind?.brush?.point,grainEmissions:lab.grains?.emitted,grains:lab.grains?.inspect(camera),anchored:lab.sand.parcels.filter(p=>p.anchored).length},null,2);};
 const fixture=(length,column=5)=>{lab.configure('ocean');lab.paused=true;lab.wind=0;const parts=stressFixture(lab.sand,{length,column});camera.position.set(2.2,4.1,6.4);controls.target.set(-.4,parts[0].position[1]+.6,3.7);camera.lookAt(controls.target);panel.querySelector('#wind').value='0';panel.querySelector('#wind').oninput();finish(`${length}-segment wet overhang`);};
 const dryDune=()=>{const b=lab.sand;for(let k=0;k<b.mass.length;k++){const x=k%b.n*b.dx-5.5,z=Math.floor(k/b.n)*b.dz-4.9,q=Math.max(0,1-(x*x+(z-3.6)**2)/1.4**2);b.mass[k]+=q*q*.9*b.packing[k]*b.area;}b.initialMass=b.totalMass();b.update();};
 const actions=[['Short wet overhang',()=>fixture(1)],['Long wet overhang',()=>fixture(7)],['Wind-loaded sand column',()=>fixture(0,12)],
 ['Dry structure (retained bond)',()=>{for(const p of lab.sand.parcels)p.wet=0;finish('dry structure, 20% residual strength');}],
 ['Stress sand 3 s',()=>{lab.paused=true;for(let i=0;i<90;i++)lab.sand.step(1/30,()=>({density:0,velocity:[0,0,0]}),()=>[lab.wind/lab.spec.scale,0,0],lab.spec.scale);finish('3 seconds of gravity and uniform diagnostic wind');}],
 ['Wind erosion fixture',()=>{lab.configure('ocean');dryDune();lab.paused=false;lab.wind=35;lab.windTurbulence=1;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;panel.querySelector('#fine').checked=false;panel.querySelector('#lens').checked=false;camera.position.set(-1.3,2.5,4.8);controls.target.set(0,2.2,3.6);camera.lookAt(controls.target);panel.querySelector('#wind').value='35';panel.querySelector('#wind').oninput();finish('windblown dry beach');}],
 ['Wind brush fixture',()=>{lab.configure('ocean');dryDune();lab.paused=true;lab.wind=0;lab.tool='wind';lab.radius=.3;lab.windStrength=180;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;for(const [id,value] of [['wind','0'],['brush','180'],['radius','3']]){panel.querySelector('#'+id).value=value;panel.querySelector('#'+id).oninput();}panel.querySelector('#tool').value='wind';panel.querySelector('#tool').onchange();panel.querySelector('#fine').checked=false;panel.querySelector('#lens').checked=false;camera.position.set(-.4,2.65,4.5);controls.target.set(0,lab.sand.height(0,3.6),3.6);camera.lookAt(controls.target);finish('brush aimed at dry sand; Resume and hold the viewport');}],
 ['Hold wind brush 3 s',()=>{lab.tool='wind';lab.windAudit={until:lab.time+3,ray:{origin:camera.position.toArray(),direction:camera.getWorldDirection(new THREE.Vector3()).toArray()}};lab.paused=false;finish('three simulation seconds of centered wind brush');}],
 ['Inspect sand stress',()=>finish('current sand loading')]];
 for(const [label,fn] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=fn;panel.append(b);}
}
