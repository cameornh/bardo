import {lightPathBench,opticsBench} from './studio-equipment.js';
import {asset, part, seedLibrary, stamp, transform} from './model.js';
import {exampleWorlds} from './example-worlds.js';
import {jointDefaults} from './physics-data.js';

function emptyBench(ground) {
  const library = seedLibrary();
  library.assets = [];
  library.world = {groundMaterialId:ground, instances:[]};
  return library;
}
function place(library, sculpt, id, position) {
  library.world.instances.push({id, assetId:sculpt.id, transform:{...transform(),position}});
}

export function materialBench() {
  const library = emptyBench('stone');
  library.world.wind = {speed:.5, heading:0};
  for (const [id,x,z] of [['cotton',0,1.4],['wax',2,1.4],['ice',-2,1.4],['copper',-.6,-.6],['graphite',.6,-.6],['porcelain',2.4,-.6]]) {
    const sample = asset(library.materials.find(m => m.id === id).name);
    sample.id = id;
    const body = part(sample.name,[stamp('box','add',[0,.38,0],[.60,.38,.40],id,0)]);
    body.id = 'sample';
    body.pivot = [0,.38,0];
    sample.parts = [body];
    library.assets.push(sample);
    // Workbench samples fit in a hand. Keep the touching faces coincident as the entire layout is scaled.
    const scale=.2;
    place(library,sample,id,[x*scale,0,z*scale]);
    library.world.instances.at(-1).transform.scale=[scale,scale,scale];
  }
  return library;
}

function waterBench() {
  const library = seedLibrary(), float = library.assets[0], arch = library.assets.find(a => a.id === 'arch');
  library.world.instances = [];
  float.name = 'Wood float';
  float.parts[0].stamps = [stamp('sphere','add',[0,.45,0],[.8,.55,.8],'wood')];
  arch.parts[0].physics = {fixed:true};
  const block = asset('Wood block');
  block.parts = [part('Block',[stamp('box','add',[0,.3,0],[.65,.3,.4],'wood')])];
  library.assets.push(block);
  place(library,float,'float',[0,0,0]);
  place(library,arch,'arch',[-3,0,-1]);
  place(library,block,'block',[1.9,0,-1.2]);
  library.world.groundMaterialId = 'water';
  library.world.wind = {speed:9,heading:25};
  return library;
}

function groundBench(ground) {
  const library = seedLibrary(), arch = library.assets.find(a => a.id === 'arch');
  library.world.groundMaterialId = library.materials.some(m => m.id === ground) ? ground : 'bronze';
  library.materials.find(m => m.id === 'water').organicLoad = .72;
  library.world.instances = [];
  arch.parts[0].physics = {fixed:true};
  place(library,arch,'arch',[-2.5,0,-1.5]);
  for (const [name,id,x,z] of [['Loose sand','sand',-.8,.6],['Water volume','water',1.4,.2],['Wood block','wood',2.2,-2]]) {
    const sample = asset(name);
    sample.parts = [part(name,[stamp('box','add',[0,0,0],[.58,.58,.58],id)])];
    library.assets.push(sample);
    place(library,sample,id,[x,1.25,z]);
  }
  library.world.wind = {speed:ground === 'water' ? 18 : ground === 'sand' ? 32 : 4,heading:20};
  return library;
}

function jointBench() {
  const library = emptyBench('stone'), sample = asset('Joint force test');
  const base = part('Anchored support',[stamp('box','add',[0,3.2,0],[.65,.12,.4],'wood')]);
  const arm = part('Swinging arm',[stamp('capsule','add',[0,2,0],[.18,.8,.18],'wood')]);
  // The crosshead carries the swinging arm. Put the support reaction at the hinge.
  base.pivot = [0,3.12,0];
  base.physics = {fixed:true};
  const timber=library.materials.find(m=>m.id==='wood');
  timber.tensileStrength=2.1e7;
  timber.adhesion=4.5e6;
  arm.joint = {...jointDefaults(), parentId:base.id, type:'hinge', anchor:[0,3,0], stiffness:80, damping:6};
  arm.forceKeys = [0,1.5,3].map(time => ({time,force:[0,0,0],torque:[0,0,time===1.5?-160:160]}));
  sample.parts = [base,arm];
  library.assets.push(sample);
  place(library,sample,'joint',[0,0,0]);
  return library;
}

function sculptBench(){
 const library=seedLibrary(),[orb,arch,stem]=library.assets;
 const [base,arm]=stem.parts;
 base.physics={fixed:true};
 base.stamps.push(stamp('box','add',[-.43,1.28,0],[.10,1.10,.13],'bronze',.02),
  stamp('box','add',[-.19,2.32,0],[.32,.10,.13],'bronze',.02));
 base.pivot=[-.43,.2,0];
 arm.pivot=[0,2.32,0];arm.stamps[0].position=[0,1.53,0];arm.stamps.at(-1).position=[0,.74,0];
 arm.joint={...jointDefaults(),parentId:base.id,type:'hinge',anchor:arm.pivot.slice(),looseness:6,stiffness:120,damping:55};
 // A light cap allows the slender stem to swing under a finite applied torque.
 arm.stamps.at(-1).materialId='wood';
 arm.stamps.at(-1).size=[.31,.17,.31];
 arm.stamps[0].size=[.17,.80,.17];
 arm.forceKeys=[0,.75,1.5,2.25,3].map((time,i)=>({time,force:[0,0,0],torque:[0,0,[0,230,0,-230,0][i]]}));
 arm.keys=[];
 const timber=library.materials.find(m=>m.id==='wood');
 timber.tensileStrength=2.1e7;timber.adhesion=4.5e6;
 orb.parts[0].stamps[0].position[1]=.9;
 arch.parts[0].pivot=[0,1.3,0];
 return library;
}

function fractureBench(){
 const library=emptyBench('stone');
 // Matched test stock isolates grain geometry. Actual material presets retain
 // their authored densities and strengths in the other scenes and library.
 for(const [i,[id,grain]] of [['porcelain',0],['wood',.95],['graphite',-.95]].entries()){
  const material=library.materials.find(m=>m.id===id);
  Object.assign(material,{name:material.name+' test stock',density:700,youngModulus:2e7,
   friction:.6,restitution:.1,tensileStrength:2500,yieldStress:12000,cohesion:120,fractureGrain:grain,fractureDelay:.18});
  const sample=asset(material.name);
  sample.parts=[part('Specimen',[stamp('box','add',[0,0,0],[.28,.24,.25],id,0)])];
  library.assets.push(sample);
  place(library,sample,id,[(i-1)*1.55,.90,0]);
  library.world.instances.at(-1).transform.rotation=[9,0,42];
 }
 return library;
}

export const studioTests = [
  {id:'library',name:'My library'},
  ...exampleWorlds,
  {id:'light-paths',name:'Lens focus and mirror bounce',create:lightPathBench,framing:{direction:[3,2.3,5],groundMargin:.45},guide:'Select a mount and rotate it to move the light on the floor. Lamp cones point along local −Z. Change the cone angle in Materials.'},
  {id:'optics',name:'Cups, balls and lenses',create:opticsBench,tool:'lift',guide:'Inspect the open cups and curved lenses, then grab material or place another sample.'},
  {id:'fracture',name:'Fracture comparison',create:fractureBench,tool:'nudge',guide:'Drop three equal-mass samples by pressing Play. From left to right, compare even grains, fibres and layers. The samples share bulk strength and overload time. Reset to repeat the drop.'},
  {id:'materials',name:'Material workbench',create:materialBench,tool:'field',guide:'Point at a sample to probe it or choose a material action. Try heating ice, wetting felt, or attaching a supply and a return across the two touching conductors.'},
  {id:'water',name:'Wind and water',create:waterBench,tool:'splash',guide:'Click beside a float to send it a wave. Change the wind heading, or lift a handful of water and throw it at the arch.'},
  {id:'ground',name:'Ground materials',create:groundBench,tool:'lift',guide:'Play to drop sand, water and wood onto the same floor. Click to grab material, scroll to change its distance and click again to drop it. Change the ground material and repeat to compare the landings.'},
  {id:'joints',name:'Joint forces',create:jointBench,tool:'nudge',guide:'Play to swing the arm. Drag against its motion, then turn off joint animation forces to watch the swing settle.'},
  {id:'sculpts',name:'Example sculpts',create:sculptBench,guide:'Edit a sample to inspect its shapes. In the world, press Play to see the stem swing from its bracket and try nudging the clay.'}
];

export function workbenchStore(test,ground,seed) {
  return {
    load:async()=>({library:test.create(ground,seed),message:test.name+' · changes last for this visit.'}),
    save:async()=>'Test changes are temporary. Export to keep a copy.'
  };
}
