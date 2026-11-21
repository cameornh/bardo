import {asset, part, seedLibrary, stamp, transform} from './model.js';
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
  base.physics = {fixed:true};
  arm.joint = {...jointDefaults(), parentId:base.id, type:'hinge', anchor:[0,3,0], stiffness:80, damping:6};
  arm.forceKeys = [0,1.5,3].map(time => ({time,force:[0,0,0],torque:[0,0,time===1.5?-160:160]}));
  sample.parts = [base,arm];
  library.assets.push(sample);
  place(library,sample,'joint',[0,0,0]);
  return library;
}

export const studioTests = [
  {id:'library',name:'My library'},
  {id:'materials',name:'Material workbench',create:materialBench},
  {id:'water',name:'Wind and water',create:waterBench},
  {id:'ground',name:'Ground materials',create:groundBench},
  {id:'joints',name:'Joint forces',create:jointBench},
  {id:'sculpts',name:'Example sculpts',create:seedLibrary}
];

export function workbenchStore(test,ground) {
  return {
    load:async()=>({library:test.create(ground),message:test.name+' · changes last for this visit.'}),
    save:async()=>'Test changes are temporary. Export to keep a copy.'
  };
}
