import {asset,part,stamp,material,LIMITS,newStudioLibrary,transform} from './model.js';

const vitreous={density:2500,ior:1.52,roughness:.035,grainDepth:0,porosity:0,
 thermalConductivity:1.1,heatCapacity:840,youngModulus:7e10,yieldStress:3e7,tensileStrength:3e7,
 cohesion:2e7,adhesion:220,fractureDelay:.08,meltingPoint:1670};
const finishes=[
 ['optical-glass','Clear glass','#d6f2f7',{...vitreous,opacity:.075,scattering:.004,absorption:.07}],
 ['silver-mirror','Polished mirror','#f1f4f5',{...vitreous,metallic:1,opacity:1,roughness:.016}],
 ['lamp-ceramic','Luminous ceramic','#ffe6b2',{density:2150,emission:4,roughness:.24,grainDepth:.1,porosity:.01,tensileStrength:2e7}]
];
function makeShape(shape,mid){
 const s=(mode,y,z,size)=>stamp('sphere',mode,[0,y,z],size,mid,0);
 if(shape==='ball')return [s('add',.45,0,[.45,.45,.45])];
 if(shape==='cup'){
  // A cut plane opens the lip. The inner bowl leaves solid walls and a foot.
  return [s('add',.45,0,[.46,.45,.46]),s('subtract',.47,0,[.35,.344,.35]),
   stamp('box','subtract',[0,1.16,0],[.6,.51,.6],mid,0),
   stamp('box','subtract',[0,-.52,0],[.6,.57,.6],mid,0)];
 }
 if(shape==='convex')return [s('add',.54,0,[.54,.54,.165])];
 return [s('add',.54,0,[.54,.54,.245]),...[-1,1].map(sign=>s('subtract',.54,sign*.83,[.78,.78,.78]))];
}
export function installEquipment(lib){
 if(lib.studioEquipmentVersion===1)return lib;
 for(const args of finishes)if(!lib.materials.some(m=>m.id===args[0])&&lib.materials.length<LIMITS.materials)lib.materials.push(material(...args));
 const styles=[['Glass','optical-glass'],['Mirror','silver-mirror'],['Rock','stone'],['Light','lamp-ceramic']];
 for(const [name,mid] of styles){
  if(!lib.materials.some(m=>m.id===mid))continue;
  const optics=name==='Glass'||name==='Mirror';
  for(const shape of (optics?['cup','ball','convex','concave']:['cup','ball'])){
   const id='equipment-'+mid+'-'+shape;
   if(lib.assets.some(a=>a.id===id)||lib.assets.length>=LIMITS.assets)continue;
   const a=asset(name+' '+shape+(['convex','concave'].includes(shape)?' lens':''));
   a.id=id;a.spacing=.05;a.parts=[part(a.name,makeShape(shape,mid))];a.parts[0].id=id+'-body';lib.assets.push(a);
  }
 }
 lib.studioEquipmentVersion=1;return lib;
}
export function placementPose(base,variant,intrinsic,offset,rotation,scale){
 const size=Math.max(.01,Math.min(100,intrinsic*variant.size*scale));
 return {position:base.map((x,k)=>x+offset[k]),rotation:rotation.map((x,k)=>x+(k===1?variant.twist:0)),scale:[size,size,size]};
}

export function opticsBench(){
 const lib=installEquipment(newStudioLibrary());
 lib.world.groundMaterialId='wood';lib.world.instances=[];
 for(const [i,a] of lib.assets.filter(a=>a.id.startsWith('equipment-')).entries()){
  const column=i<8?i%4:i%2,row=i<8?Math.floor(i/4):2+Math.floor((i-8)/2);
  lib.world.instances.push({id:'bench-'+a.id,assetId:a.id,transform:{...transform(),position:[(column-1.5)*1.5,0,(row-1.5)*1.45]}});
 }
 return lib;
}
