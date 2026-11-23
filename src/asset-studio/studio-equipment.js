import {asset,part,stamp,material,LIMITS,newStudioLibrary,transform} from './model.js';

const vitreous={density:2500,ior:1.52,roughness:.035,grainDepth:0,porosity:0,
 thermalConductivity:1.1,heatCapacity:840,youngModulus:7e10,yieldStress:3e7,tensileStrength:3e7,
 cohesion:2e7,adhesion:220,fractureDelay:.08,meltingPoint:1670};
const ceramic={density:2150,emission:4,roughness:.24,grainDepth:.1,porosity:.01,tensileStrength:2e7};
const finishes=[
 ['optical-glass','Clear glass','#d6f2f7',{...vitreous,opacity:.075,scattering:.004,absorption:.07}],
 ['silver-mirror','Polished mirror','#f1f4f5',{...vitreous,metallic:1,opacity:1,roughness:.016}],
 ['lamp-ceramic','Luminous ceramic','#ffe6b2',ceramic]
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
// Each lamp is an ordinary editable sculpt. Its material supplies all of its light.
const coloredLamps=[
 ['Cyan','Portal','#00efff',mid=>[
  stamp('sphere','add',[0,.55,0],[.48,.54,.18],mid,0),
  stamp('sphere','subtract',[0,.57,0],[.29,.34,.5],mid,0)]],
 ['Magenta','Figure','#ff18db',mid=>[
  stamp('sphere','add',[0,.95,0],[.135,.15,.13],mid,.03),
  stamp('sphere','add',[0,.62,0],[.15,.24,.10],mid,.055),
  ...[-1,1].flatMap(k=>[stamp('capsule','add',[k*.09,.25,0],[.076,.174,.076],mid,.035),
   stamp('capsule','add',[k*.17,.60,0],[.058,.12,.058],mid,.06)])]],
 ['Yellow','Lantern','#ffe600',mid=>[
  stamp('sphere','add',[0,.41,0],[.36,.41,.36],mid,.015),
  stamp('box','add',[0,.08,0],[.24,.08,.24],mid,.025),
  stamp('box','add',[0,.76,0],[.19,.055,.19],mid,.03)]],
 ['Red','Cube','#ff291f',mid=>[stamp('box','add',[0,.37,0],[.37,.37,.37],mid,0)]],
 ['Green','Crescent','#33ff59',mid=>[
  stamp('sphere','add',[0,.45,0],[.43,.45,.18],mid,0),
  stamp('sphere','subtract',[.17,.53,0],[.35,.35,.43],mid,.015)]],
 ['Blue','Beacon','#3861ff',mid=>[
  stamp('capsule','add',[0,.5,0],[.11,.39,.11],mid,.02),
  stamp('sphere','add',[0,.08,0],[.29,.08,.29],mid,.035),
  stamp('sphere','add',[0,.96,0],[.19,.12,.19],mid,.03)]]
];
export function installEquipment(lib){
 if(lib.studioEquipmentVersion>=2)return lib;
 if(!lib.studioEquipmentVersion){
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
 }
 for(const [color,name,tint,sculpt] of coloredLamps){
  const mid='lamp-'+color.toLowerCase(),id='luminaire-'+color.toLowerCase();
  if(!lib.materials.some(m=>m.id===mid)&&lib.materials.length<LIMITS.materials)
   lib.materials.push(material(mid,color+' luminous ceramic',tint,ceramic));
  if(!lib.materials.some(m=>m.id===mid)||lib.assets.some(a=>a.id===id)||lib.assets.length>=LIMITS.assets)continue;
  const a=asset(color+' '+name.toLowerCase()+' light');
  a.id=id;a.spacing=.05;a.parts=[part(name,sculpt(mid))];a.parts[0].id=id+'-body';lib.assets.push(a);
 }
 lib.studioEquipmentVersion=2;return lib;
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

export function lightPathBench(){
 const lib=installEquipment(newStudioLibrary()),ground=lib.materials.find(m=>m.id==='stone');
 ground.color='#565d63';lib.world.groundMaterialId=ground.id;lib.world.instances=[];
 const mirror=asset('Plane mirror');mirror.id='bench-plane-mirror';
 mirror.parts=[part(mirror.name,[stamp('box','add',[0,0,0],[.51,.51,.035],'silver-mirror',0)])];
 lib.assets.push(mirror);
 // Specify the optical centre, independent of the modelling origin at the foot.
 function mount(assetId,center,angle,originY=0,scale=1){
  const a=lib.assets.find(a=>a.id===assetId);a.parts[0].physics={fixed:true};
  const pitch=angle*Math.PI/180;
  lib.world.instances.push({id:'mount-'+assetId,assetId,transform:{rotation:[angle,0,0],scale:[scale,scale,scale],
   position:[center[0],center[1]-originY*scale*Math.cos(pitch),center[2]-originY*scale*Math.sin(pitch)]}});
 }
 lib.materials.find(m=>m.id==='lamp-cyan').beamAngle=13;
 lib.materials.find(m=>m.id==='lamp-red').beamAngle=10;
 mount('luminaire-cyan',[-1.35,4.85,0],-90,.55,.72);
 mount('equipment-optical-glass-convex',[-1.35,2.3,0],-90,.54);
 mount('luminaire-red',[1.35,1.55,-2.35],180,.37,.8);
 mount(mirror.id,[1.35,1.55,0],-60);
 return lib;
}
