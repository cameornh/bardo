// Built-in examples use the same stamps, painted details, material properties
// and family weights as a library created in the editor.
import {Vector3} from 'three';
import {material, part, stamp, LIMITS} from './model.js';
import {jointDefaults} from './physics-data.js';
import {brushFrame} from './gaussian-marks.js';

const ellipsoid=(p,r,m,mode='add',blend=.035)=>stamp('sphere',mode,p,r,m,blend);
const box=(p,r,m,mode='add',blend=0)=>stamp('box',mode,p,r,m,blend);
const rod=(p,r,h,m)=>stamp('capsule','add',p,[r,h,r],m,.025);
function sculpt(id,name,stamps,variation){
 const body=part(name,stamps);body.id='body';
 return {id:'example-'+id,name,spacing:.055,duration:3,parts:[body],...(variation?{variation}:{})};
}
const variation=(size,twist,width=0,curl=0)=>({distribution:'centered',size,twist,width,curl});

function rush(id,name,height,count,fan){
 const r=.073,base=.23,top=base+height;
 const a=sculpt(id,name,[
  ellipsoid([0,.12,0],[.31,.15,.27],'reed'),
  rod([0,(top+base)/2,0],r,height/2,'reed'),
  ellipsoid([0,top+.08,0],[.105,.23,.105],'reed')
 ],variation(.26,180,.28,.24));
 const body=a.parts[0];body.physics={fixed:true};body.marks=[];
 for(let i=0;i<count;i++){
  const angle=i*2.39996+fan,along=(i+.5)/count;
  const x=Math.cos(angle),z=Math.sin(angle);
  body.marks.push({id:'frond-'+i,kind:'ribbon',materialId:'reed',root:[x*r,base+.15+along*(height-.25),z*r],
   ...brushFrame(new Vector3(x,.35+along*.7,z),new Vector3(0,1,0)),
   length:(1.05-.48*along)*fan,width:.12+.055*Math.sin(i+fan),curl:-.46+.35*along,
   flex:.86,bias:.85,taper:.66});
 }
 return a;
}
function vessel(id,name,r,h,material){
 return sculpt(id,name,[
  ellipsoid([0,h*.49,0],[r,h*.51,r],material),
  ellipsoid([0,h*.13,0],[r*.54,h*.15,r*.54],material),
  ellipsoid([0,h*.76,0],[r*.84,h*.49,r*.84],material,'subtract',.014)
 ],variation(.14,18));
}
function float(id,name,r,h,m){
 return sculpt(id,name,[ellipsoid([0,0,0],[r,h,r],'cork'),
  ellipsoid([0,h*.86,0],[r*.47,h*.25,r*.47],m),
  stamp('sphere','paint',[0,-h*.56,0],[r*1.06,h*.36,r*1.06],m,.01)],variation(.14,35));
}
function pendulum(){
 const a=sculpt('pendulum','Driven pendulum',[box([0,1.48,0],[.46,.11,.15],'ash-stock')]);
 const mount=a.parts[0];mount.name='Crosshead';mount.physics={fixed:true};
 const swing=part('Weighted arm',[rod([0,.96,0],.10,.44,'ash-stock'),ellipsoid([0,.44,0],[.21,.21,.16],'ash-stock')]);
 swing.id='arm';mount.pivot=[0,1.48,0];swing.joint={...jointDefaults(),parentId:'body',type:'hinge',anchor:[0,1.42,0],stiffness:18,damping:2};
 swing.forceKeys=[0,.75,1.5,2.25,3].map((time,i)=>({time,force:[0,0,0],torque:[0,0,[0,36,0,-36,0][i]]}));
 a.parts.push(swing);return a;
}
function suspended(){
 const a=sculpt('chime','Spring-hung chime',[box([0,1.82,0],[.42,.09,.13],'ash-stock')]);
 a.parts[0].physics={fixed:true};a.parts[0].name='Mount';a.parts[0].pivot=[0,1.82,0];
 const neck=part('Swivel',[rod([0,1.43,0],.075,.29,'ash-stock')]);
 neck.id='swivel';neck.joint={...jointDefaults(),parentId:'body',type:'ball',anchor:[0,1.76,0],damping:1.4};
 const bell=part('Bell',[ellipsoid([0,.9,0],[.21,.19,.21],'bronze'),ellipsoid([0,.78,0],[.16,.16,.16],'bronze','subtract')]);
 bell.id='bell';bell.joint={...jointDefaults(),parentId:'swivel',type:'spring',anchor:[0,1.10,0],extensionStiffness:4000,damping:2};
 const finial=part('Clapper',[ellipsoid([0,.69,0],[.067,.09,.067],'aluminium')]);
 finial.id='clapper';finial.joint={...jointDefaults(),type:'fixed',parentId:'bell',anchor:[0,.77,0]};
 a.parts.push(neck,bell,finial);return a;
}
function anchored(a,pivot){
 a.parts[0].pivot=pivot;a.parts[0].physics={fixed:true};return a;
}
export function catalogAssets(){
 return [
  rush('reed','Common rush',1.23,7,.95),rush('sedge','Fan sedge',.91,9,1.28),rush('reed-tall','Tall rush',1.58,6,.86),
  vessel('stoneware','Stoneware cup',.52,.78,'clay'),vessel('bowl','Porcelain bowl',.66,.53,'porcelain'),
  float('bobber','Pear float',.24,.43,'clay'),float('buoy','Marker buoy',.39,.27,'reed'),
  sculpt('billet','Split timber',[
   ellipsoid([0,.17,0],[.72,.19,.26],'ash-stock'),
   box([0,.26,0],[.75,.065,.12],'ash-stock','subtract',.025)],variation(.20,22)),
  sculpt('tinder','Folded tinder',[
   ellipsoid([-.11,.095,0],[.32,.094,.21],'cotton'),ellipsoid([.12,.14,.03],[.28,.12,.15],'cotton'),
   ellipsoid([-.04,.18,.01],[.13,.092,.19],'cotton','subtract',.022)],variation(.19,60)),
  sculpt('wick','Braided wick',[rod([0,.23,0],.115,.13,'cotton'),ellipsoid([.05,.1,0],[.16,.1,.15],'cotton')],variation(.12,35)),
  sculpt('contact','Copper contact shoe',[box([0,.09,0],[.30,.09,.17],'copper'),box([-.19,.15,0],[.10,.07,.17],'copper')]),
  sculpt('bridge','Graphite bridge',[box([0,.09,0],[.39,.09,.15],'graphite')]),
  sculpt('sponge','Wicking pad',[ellipsoid([0,.12,0],[.42,.14,.29],'sponge'),ellipsoid([.19,.23,.02],[.071,.07,.09],'sponge','subtract')]),
  sculpt('wax','Fluted wax seal',[ellipsoid([0,.14,0],[.31,.16,.29],'wax'),ellipsoid([0,.29,0],[.17,.17,.17],'wax')]),
  sculpt('ice','Ice lens',[ellipsoid([0,.13,0],[.32,.14,.29],'ice')]),
  sculpt('brine','Brine drop',[ellipsoid([0,0,0],[.22,.25,.21],'brine')]),
  sculpt('sand','Sand measure',[ellipsoid([0,0,0],[.33,.26,.31],'sand')]),
  sculpt('pumice','Pumice float',[ellipsoid([0,0,0],[.36,.23,.30],'pumice'),
   ellipsoid([.18,.16,.02],[.12,.11,.13],'pumice','subtract')]),
  sculpt('vapour','Water vapour pocket',[ellipsoid([0,0,0],[.48,.29,.38],'water-vapour')]),
  sculpt('oil','Oil drop',[ellipsoid([0,0,0],[.22,.25,.21],'oil')]),
  sculpt('rubber-ball','Rubber ball',[ellipsoid([0,0,0],[.22,.22,.22],'rubber')]),
  sculpt('china-ball','Porcelain ball',[ellipsoid([0,0,0],[.22,.22,.22],'porcelain')]),
  pendulum(),suspended(),
  anchored(sculpt('pier','Stone pier',[box([0,.29,0],[.105,.29,.17],'stone'),
   box([0,.055,0],[.17,.055,.22],'stone')]),[0,.025,0]),
  anchored(sculpt('lath','Pressed fibre lath',[box([.72,.7,0],[.78,.11,.19],'fibreboard')]),[-.02,.70,0]),
  anchored(sculpt('cantilever','Notched cantilever',[box([.65,1.05,0],[.72,.115,.14],'wood'),
   ellipsoid([.36,1.18,0],[.11,.13,.15],'wood','subtract'),ellipsoid([1.32,1.02,0],[.17,.19,.16],'bronze')]),[-.03,1.05,0])
 ];
}
const family=(id,name,pairs)=>({id:'example-'+id,name,members:pairs.map(([id,weight])=>({assetId:'example-'+id,weight}))});
const families=()=>[
 family('rushes','Wetland grasses',[['reed',4],['sedge',3],['reed-tall',2]]),
 family('vessels','Hand-built vessels',[['stoneware',2],['bowl',3]]),
 family('floats','Shore floats',[['bobber',3],['buoy',2],['pumice',1]]),
 family('kindling','Dry kindling',[['billet',3],['tinder',2],['wick',1]])
];

// Install once per library. Keep names, edits, placements and intentional
// deletions in subsequent sessions; reserved IDs already in use stay untouched.
export function installCatalog(library){
 if(library.exampleCatalogVersion>=1)return library;
 const occupied=new Set(library.assets.map(a=>a.id));
 const materials=new Set(library.materials.map(m=>m.id));
 if(!materials.has('water-vapour')&&library.materials.length<LIMITS.materials){
  library.materials.push(material('water-vapour','Water vapour','#d1e1e7',{phase:'gas',liquidity:1,
   density:.60,waterContent:1,initialTemperature:374,heatCapacity:2010,thermalConductivity:.025,
   meltingPoint:273.15,boilingPoint:373.15,latentHeat:334000,opacity:.08,ior:1.001,
   youngModulus:0,tensileStrength:0,cohesion:0,adhesion:0}));
  materials.add('water-vapour');
 }
 const plant={porosity:.42,fuelEnergy:1.6e7,burnRate:.02,smokeYield:.06,grainLength:.94};
 const grades=[
  ['ash-stock','Ash timber','#98603b',{...plant,density:630,heatCapacity:1500,tensileStrength:2.1e7,
   youngModulus:9e9,yieldStress:3.6e7,adhesion:4.5e6}],
  ['fibreboard','Pressed fibreboard','#ab8767',{...plant,density:480,youngModulus:2e8,
   tensileStrength:300000,heatCapacity:1300,ignitionTemperature:530,burnRate:.08,meltingPoint:1700}],
  ['reed','Reed fibre','#73834b',{...plant,density:360,grainDepth:1.1,roughness:.76,youngModulus:8.4e7,
   tensileStrength:4.5e6,yieldStress:2.7e6,adhesion:2.4e5,moisture:.09}]
 ];
 for(const grade of grades)if(!materials.has(grade[0])&&library.materials.length<LIMITS.materials){
  library.materials.push(material(...grade));materials.add(grade[0]);
 }
 for(const a of catalogAssets()){
  if(occupied.has(a.id)||library.assets.length>=LIMITS.assets)continue;
  if(a.parts.every(p=>[...p.stamps,...(p.marks??[])].every(s=>materials.has(s.materialId)))){
   library.assets.push(a);
  }
 }
 const available=new Set(library.assets.map(a=>a.id)),existing=library.families??=[];
 for(const f of families())if(existing.length<LIMITS.assets&&!existing.some(other=>other.id===f.id)&&
  f.members.every(m=>available.has(m.assetId)&&!occupied.has(m.assetId)))existing.push(f);
 library.exampleCatalogVersion=1;
 return library;
}
