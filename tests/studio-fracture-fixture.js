// The center mount holds a single sculpt. The two colored bands are volumes
// of a second material inside that sculpt, with independently editable adhesion.
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';

export function fractureFixture(adhesion=1400){
 const library=seedLibrary(),asset=library.assets[0],p=asset.parts[0];
 const wood=library.materials.find(m=>m.id==='wood');
 Object.assign(wood,{tensileStrength:8e7,adhesion:8e7});
 library.materials.push({...wood,id:'inlay',name:'Inlay',color:'#52858c',adhesion});
 p.physics={fixed:true};
 p.stamps=[
  stamp('box','add',[0,0,0],[2,.22,.32],'wood',0),
  stamp('sphere','subtract',[0,.85,0],[.45,.74,.60],'wood',0),
  ...[-.86,.86].map(x=>stamp('box','paint',[x,0,0],[.24,.5,.5],'inlay',0))
 ];
 library.world.groundMaterialId='stone';library.world.wind={speed:0,heading:0};
 library.world.instances=[{id:'sample',assetId:asset.id,transform:{...transform(),position:[0,2.5,0]}}];
 return library;
}
