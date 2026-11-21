import {asset,part,seedLibrary,stamp,transform} from '../src/asset-studio/model.js';

// Independent authored library. The two electrical bars share a face. Both
// bars are anchored. The other samples rest freely on the stone.
export function materialBench(){
 const lib=seedLibrary();lib.assets=[];lib.world.instances=[];lib.world.groundMaterialId='stone';
 lib.world.wind={speed:.5,heading:0};
 for(const [id,x,z] of [['cotton',0,1.4],['wax',2,1.4],['ice',-2,1.4],['copper',-.60,-.6],['graphite',.60,-.6],['porcelain',2.4,-.6]]){
  const a=asset(lib.materials.find(m=>m.id===id).name);
  a.id=id;a.parts=[part(a.name,[stamp('box','add',[0,.38,0],[.60,.38,.40],id,0)])];a.parts[0].id='sample';a.parts[0].pivot=[0,.38,0];a.parts[0].physics={fixed:id==='copper'||id==='graphite'};
  lib.assets.push(a);lib.world.instances.push({id,assetId:id,transform:{...transform(),position:[x,0,z]}});
 }
 return lib;
}
