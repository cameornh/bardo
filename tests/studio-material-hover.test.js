import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Raycaster, Scene, Vector3} from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {LiquidParcels} from '../src/asset-studio/liquid-parcels.js';
import {SectionView} from '../src/asset-studio/section-view.js';

test('hover follows loose material above the floor, then a deposit, the floor, and empty sky', () => {
 const view=Object.create(StudioView.prototype);
 const sand={id:'grain',name:'Amber sand'},ground={id:'floor',name:'Kiln tile'};
 const caster=new Raycaster(new Vector3(0,5,0),new Vector3(0,-1,0));
 const packet={position:new Vector3(0,3,0),radius:.25};
 const group={key:'item:part',material:sand,packets:[packet]};
 Object.assign(view,{groups:new Map(),ray:()=>caster.ray,raycaster:caster,groundSurface:ground,
  activePhysics:{matter:{parts:new Map([['item:part/grain',group]])}},
  library:{materials:[sand,ground]},materialIndices:new Map([['grain',0],['floor',1]])});
 assert.equal(view.materialAtPointer(null),sand);
 packet.position.x=2;
 assert.equal(view.materialAtPointer(null),ground);
 view.matterView={beds:new Map([['grain',{bed:{material:sand},ownerAt:()=>group.key,
  raycast:(_,hits)=>hits.push({point:new Vector3(0,.12,0),distance:4.88,face:{normal:new Vector3(0,1,0)}})}]])};
 assert.equal(view.materialAtPointer(null),sand);
 view.matterView.beds.clear();caster.ray.direction.y=1;
 assert.equal(view.materialAtPointer(null),undefined);
});

test('a cut face reports the material of its nearest collider', () => {
 const view=new SectionView({});
 view.sim={R:{Ray:class {}}};
 const record={part:{id:'part'},instance:{id:'item'},asset:{id:'assembly'},
  body:{numColliders:()=>2,collider:i=>({castRayAndGetNormal:()=>({timeOfImpact:3-i,normal:new Vector3(0,1,0)})})},
  field:{shapes:[{materialId:'wood'},{materialId:'copper'}]}};
 view.meshes.set('split',{pieces:new Map([[record,{}]])});
 const ray=new Raycaster(new Vector3(0,5,0),new Vector3(0,-1,0));
 assert.equal(view.pick(ray,null).materialId,'copper');
});

test('lifted drop picking respects its stretch and the distance to nearer surfaces', () => {
 const parcels=new LiquidParcels(new Scene(),{},'','');
 try{
  parcels.update({drops:[{x:0,y:1,z:-5,vx:0,vy:0,vz:9,r:.5}]},new PerspectiveCamera());
  const {ray}=new Raycaster(new Vector3(0,1,0),new Vector3(0,0,-1));
  assert.equal(parcels.intersectsRay(ray,3),false);
  assert.equal(parcels.intersectsRay(ray,4.1),true);
  ray.origin.y+=.5;
  assert.equal(parcels.intersectsRay(ray,10),false);
 }finally{parcels.dispose();}
});
