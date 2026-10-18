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
  results.textContent=JSON.stringify({fixture:label,backend:'CPU bonded loads / conservative sand; GPU airborne grains',massError:lab.sand.totalMass()+lab.sand.removedMass-lab.sand.initialMass,peakLoad:lab.sand.stress?.maxLoad,breaks:lab.sand.stress?.failures,windTransport:lab.sand.windMoved,grainEmissions:lab.grains?.emitted,anchored:lab.sand.parcels.filter(p=>p.anchored).length},null,2);};
 const fixture=(length,column=5)=>{lab.configure('ocean');lab.paused=true;lab.wind=0;const parts=stressFixture(lab.sand,{length,column});camera.position.set(2.2,4.1,6.4);controls.target.set(-.4,parts[0].position[1]+.6,3.7);camera.lookAt(controls.target);panel.querySelector('#wind').value='0';panel.querySelector('#wind').oninput();finish(`${length}-segment wet overhang`);};
 const actions=[['Short wet overhang',()=>fixture(1)],['Long wet overhang',()=>fixture(7)],['Wind-loaded sand column',()=>fixture(0,12)],
 ['Dry structure (retained bond)',()=>{for(const p of lab.sand.parcels)p.wet=0;finish('dry structure, 20% residual strength');}],
 ['Stress sand 3 s',()=>{lab.paused=true;for(let i=0;i<90;i++)lab.sand.step(1/30,()=>({density:0,velocity:[0,0,0]}),()=>[lab.wind/lab.spec.scale,0,0],lab.spec.scale);finish('3 seconds of gravity and uniform diagnostic wind');}],
 ['Wind erosion fixture',()=>{lab.configure('ocean');lab.paused=false;lab.wind=35;lab.windTurbulence=1;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;panel.querySelector('#fine').checked=false;panel.querySelector('#lens').checked=false;camera.position.set(-.6,lab.sand.height(-.6,3.4)+.10,3.4);controls.target.set(.8,lab.sand.height(.8,3.4)+.10,3.4);camera.lookAt(controls.target);panel.querySelector('#wind').value='35';panel.querySelector('#wind').oninput();finish('windblown dry beach');}],
 ['Inspect sand stress',()=>finish('current sand loading')]];
 for(const [label,fn] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=fn;panel.append(b);}
}
