import {validateVariation} from './family.js';
import {materialPresets} from './material-presets.js';
import {validateMarks} from './gaussian-marks.js';
import {validatePhysics} from './physics-data.js';
import {validateClimate} from './coastal-climate.js';
// Versioned authoring data. Derived Gaussian samples are disposable caches.
export const MAX_WIND_SPEED=100;
export const MAX_LIBRARY_BYTES=8*1024*1024;
export const VERSION=1, STORAGE_KEY='bardo.asset-studio.v1';
export const LIMITS={assets:128,parts:24,stamps:512,instances:256,materials:128,keys:120,grid:140000,splats:24000,previewParts:32};
export const clone=x=>structuredClone(x);
export const uid=()=>globalThis.crypto.randomUUID();
export const transform=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export const MATERIAL_FIELDS=[
 ['roughness','Roughness','Appearance',0,1,.01,.65,'preview'],['metallic','Metalness','Appearance',0,1,.01,0,'preview'],['opacity','Opacity','Appearance',.05,1,.01,1,'preview'],['emission','Emission','Appearance',0,8,.05,0,'preview'],
 ['grainDepth','Grain relief (mm)','Appearance',0,12,.1,1.1,'preview'],['grainLength','Grain elongation','Appearance',0,1,.01,.08,'preview'],['grainScale','Grain spacing (cm)','Appearance',.4,12,.1,2.8,'preview'],['organicLoad','Organic load','Optics',0,1,.01,0,'preview'],
 ['fiberLength','Surface fibre length (m)','Appearance',0,.6,.005,0,'preview'],
 ['ior','Refractive index','Optics',1,3,.01,1.5,'active'],['absorption','Absorption (1/m)','Optics',0,100,.1,0,'preview'],['scattering','Volume scattering (1/m)','Optics',0,8,.001,.05,'preview'],
 ['liquidity','Liquidity (0 = bound, 1 = freely flowing)','Mechanical',0,1,.01,0,'preview'],['density','Density (kg/m³)','Mechanical',.01,30000,1,1800,'active'],['friction','Friction coefficient','Mechanical',0,2,.01,.6,'active'],['restitution','Restitution','Mechanical',0,1,.01,.1,'active'],['youngModulus','Elastic modulus (Pa)','Mechanical',0,1e12,1000,1e7,'active'],['poissonRatio','Poisson ratio','Mechanical',0,.499,.001,.3,'active'],['yieldStress','Yield stress (Pa)','Mechanical',0,1e10,100,10000,'active'],['tensileStrength','Tensile strength (Pa)','Mechanical',0,1e10,100,10000,'active'],['cohesion','Cohesion (Pa)','Mechanical',0,1e8,100,1000,'active'],['adhesion','Adhesion (Pa)','Mechanical',0,1e8,100,1000,'active'],['viscosity','Dynamic viscosity (Pa·s)','Mechanical',0,1e7,.001,0,'active'],
 ['fractureGrain','Fracture grain (−1 layers, 0 even, +1 fibres)','Mechanical',-1,1,.05,0,'active'],
 ['fractureDelay','Overload time at twice strength (s)','Mechanical',.03,1.5,.01,.24,'active'],
 ['initialTemperature','Initial temperature (K)','Thermal',50,5000,.1,293.15,'active'],['waterContent','Bulk water mass fraction','Moisture',0,1,.01,0,'active'],
 ['heatCapacity','Specific heat (J/kg·K)','Thermal',1,100000,1,800,'active'],['thermalConductivity','Thermal conductivity (W/m·K)','Thermal',0,10000,.01,.3,'active'],['emissivity','Thermal emissivity','Thermal',0,1,.01,.9,'active'],['expansion','Thermal expansion (1/K)','Thermal',0,.1,.00001,.00001,'active'],['meltingPoint','Melting temperature (K)','Thermal',0,10000,1,1500,'active'],['boilingPoint','Boiling temperature (K)','Thermal',0,10000,1,3000,'active'],['latentHeat','Latent heat of fusion (J/kg)','Thermal',0,1e8,1000,100000,'active'],
 ['ignitionTemperature','Ignition temperature (K)','Combustion',0,5000,1,600,'active'],['fuelEnergy','Fuel energy (J/kg; 0 = inert)','Combustion',0,1e8,100000,0,'active'],['burnRate','Burn rate (1/s)','Combustion',0,100,.001,0,'active'],['smokeYield','Smoke mass / burned mass','Combustion',0,1,.01,0,'active'],
 ['electricalConductivity','Electrical conductivity (S/m)','Electrical',0,1e8,.01,0,'active'],['porosity','Porosity','Moisture',0,1,.01,.1,'active'],['permeability','Permeability (m²)','Moisture',0,.01,1e-12,1e-12,'active'],['waterAffinity','Water affinity','Moisture',0,1,.01,.5,'active'],['moisture','Initial water fraction','Moisture',0,1,.01,0,'active']
];
// Inference supplies equivalent starting values to libraries saved before surface relief.
function surfaceDefaults(m){
 if(m.phase==='liquid')return {grainDepth:0,grainLength:0,grainScale:1,organicLoad:0};
 if(m.phase==='granular')return {grainDepth:1.7,grainLength:.04,grainScale:1.8,organicLoad:0};
 if(m.metallic>.65)return {grainDepth:.38,grainLength:.74,grainScale:1.3,organicLoad:0};
 if(m.fuelEnergy>0&&m.porosity>.25)return {grainDepth:2.4,grainLength:.97,grainScale:3.8,organicLoad:0};
 return {grainDepth:1.1,grainLength:.08,grainScale:2.8,organicLoad:0};
}
// Migrate the original colour- and opacity-derived scattering at the peak channel.
export function defaultScattering(m){
 const channels=/^#[0-9a-f]{6}$/i.test(m.color)?m.color.slice(1).match(/../g):['ff'];
 const srgb=Math.max(...channels.map(c=>parseInt(c,16)))/255;
 const linear=srgb<=.04045?srgb/12.92:((srgb+.055)/1.055)**2.4;
 return (.009+.14*linear)*(.3+1.6*m.opacity);
}
export function material(id,name,color,overrides={}){const m={id,name,color,phase:'solid',...Object.fromEntries(MATERIAL_FIELDS.map(f=>[f[0],f[6]])),...overrides};return {...m,scattering:defaultScattering(m),...surfaceDefaults(m),...overrides};}
export function stamp(shape='sphere',mode='add',position=[0,1,0],size=[.6,.6,.6],materialId='clay',blend=.12){return {shape,mode,position:[...position],size:[...size],blend,materialId};}
export function part(name='Body',stamps=[]){return {id:uid(),name,pivot:[0,0,0],transform:transform(),stamps,keys:[]};}
export function asset(name='New sculpt'){return {id:uid(),name,spacing:.08,duration:3,parts:[part()]};}
export function addStudioPresets(materials){
 const ids=new Set(materials.map(m=>m.id));
 for(const args of materialPresets)if(!ids.has(args[0])&&materials.length<LIMITS.materials)materials.push(material(...args));
 return materials;
}
function starterMaterials(){
 const materials=[material('clay','Clay','#b17d62',{tensileStrength:150000,fractureDelay:.42}),material('stone','Stone','#8e969a',{density:2700,roughness:.85,youngModulus:5e10,tensileStrength:3e6}),material('bronze','Bronze','#bc8b48',{fractureDelay:.65,metallic:.92,roughness:.23,density:8800,tensileStrength:1.5e8,electricalConductivity:7e6,thermalConductivity:60}),material('wood','Wood','#98603b',{fractureGrain:.14,density:650,fuelEnergy:1.6e7,burnRate:.02,smokeYield:.06,porosity:.4}),material('rubber','Rubber','#65767a',{fractureDelay:1.1,density:1100,youngModulus:1e6,restitution:.7,friction:.95}),material('water','Water','#4099bd',{waterContent:1,latentHeat:334000,electricalConductivity:.02,phase:'liquid',liquidity:1,youngModulus:0,tensileStrength:0,cohesion:0,density:1000,opacity:.45,roughness:.07,ior:1.333,viscosity:.001,heatCapacity:4184,thermalConductivity:.6,meltingPoint:273.15,boilingPoint:373.15}),material('sand','Sand','#c7b28a',{phase:'granular',youngModulus:0,tensileStrength:0,density:1600,roughness:.95,cohesion:0,adhesion:0,porosity:.38})];
 return addStudioPresets(materials);
}
export function newStudioLibrary(){
 const initial=asset('Untitled sculpt');
 initial.parts[0].stamps=[stamp('sphere','add',[0,.6,0],[.6,.6,.6])];
 return {version:VERSION,materials:starterMaterials(),assets:[initial],world:{groundMaterialId:'stone',
  instances:[{id:uid(),assetId:initial.id,transform:transform()}]}};
}
export function seedLibrary(){
 const materials=starterMaterials();
 const orb=asset('Sculpt starter');orb.id='starter';orb.parts=[part('Body',[stamp('sphere','add',[0,1,0],[.85,.9,.85])])];
 const arch=asset('Stone arch');arch.id='arch';arch.parts=[part('Arch',[stamp('box','add',[0,1.3,0],[1.45,1.3,.42],'stone',0),stamp('capsule','subtract',[0,.5,0],[.85,.45,.85],'stone',.08)])];
 const flower=asset('Animated stem');flower.id='stem';flower.parts=[part('Base',[stamp('sphere','add',[0,.2,0],[.65,.2,.65],'bronze')]),part('Stem',[stamp('capsule','add',[0,1,0],[.13,.8,.13],'wood'),stamp('sphere','add',[0,2,0],[.65,.25,.65],'bronze')])];flower.parts[1].pivot=[0,.2,0];flower.parts[1].keys=[{time:0,...transform()},{time:1.5,...transform(),rotation:[0,0,22]},{time:3,...transform()}];
 return {version:VERSION,materials,assets:[orb,arch,flower],world:{groundMaterialId:'sand',instances:[{id:uid(),assetId:'arch',transform:{...transform(),position:[-3,0,-1]}},{id:uid(),assetId:'starter',transform:transform()},{id:uid(),assetId:'stem',transform:{...transform(),position:[3,0,0]}}]}};
}
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
function vector(v,min=-1e5,max=1e5){return Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));}
function checkTransform(t){return t&&vector(t.position)&&vector(t.rotation,-36000,36000)&&vector(t.scale,.01,100);}
export function worldPartCount(library){return library.world.instances.reduce((n,i)=>n+(library.assets.find(a=>a.id===i.assetId)?.parts.length||0),0);}
export function validateLibrary(value){
 const fail=s=>{throw Error('Library: '+s);};
 if(!value||value.version!==VERSION)fail('unsupported version');
 const list=(a,max,label)=>{if(!Array.isArray(a)||!a.length||a.length>max)fail(label+' count');};
 list(value.materials,LIMITS.materials,'material');list(value.assets,LIMITS.assets,'asset');
 const ids=(a,label)=>{const set=new Set();for(const o of a){if(typeof o.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(o.id)||set.has(o.id)||typeof o.name!=='string'||!o.name.trim()||o.name.length>100)fail(label+' id/name');set.add(o.id);}return set;};
 const mids=ids(value.materials,'material'),aids=ids(value.assets,'asset');
 if(value.families!==undefined){
  if(!Array.isArray(value.families)||value.families.length>LIMITS.assets)fail('asset family count');
  ids(value.families,'family');
  for(const f of value.families){
   list(f.members,LIMITS.assets,'family member');
   const seen=new Set();
   for(const member of f.members){
    if(!member||!aids.has(member.assetId)||seen.has(member.assetId)||!Number.isInteger(member.weight)||!finite(member.weight,1,100))fail('invalid family member or weight');
    seen.add(member.assetId);
   }
  }
 }
 for(const m of value.materials){
  // Old sculpts retain their original isotropic fracture and overload response.
  if(m.fractureGrain===undefined)m.fractureGrain=0;
  if(m.fractureDelay===undefined)m.fractureDelay=.24;
  m.initialTemperature??=293.15;m.waterContent??=m.phase==='liquid'&&Math.abs(m.boilingPoint-373.15)<.01&&Math.abs(m.meltingPoint-273.15)<.01?1:0;m.scattering??=defaultScattering(m);Object.assign(m,Object.fromEntries(Object.entries(surfaceDefaults(m)).filter(([k])=>m[k]===undefined)));m.fiberLength??=0;if(m.surfaceMode!==undefined&&!['auto','gaussian'].includes(m.surfaceMode))fail('invalid surface rendering');m.liquidity??=['liquid','gas'].includes(m.phase)?1:0;if(!/^#[0-9a-f]{6}$/i.test(m.color)||!['solid','granular','liquid','gas'].includes(m.phase))fail('material appearance/phase');for(const [k,,,min,max] of MATERIAL_FIELDS)if(!finite(m[k],min,max))fail('invalid '+k);if(m.boilingPoint<m.meltingPoint)fail('boiling temperature must be at least melting temperature');}
 for(const a of value.assets){validateVariation(a.variation);list(a.parts,LIMITS.parts,'part');ids(a.parts,'part');if(!finite(a.spacing,.05,.5)||!finite(a.duration,.1,120))fail('asset spacing/duration');for(const p of a.parts){validateMarks(p,mids);if(!checkTransform(p.transform)||!vector(p.pivot))fail('part transform');if(!Array.isArray(p.stamps)||p.stamps.length>LIMITS.stamps)fail('stamp budget');for(const s of p.stamps)if(!['sphere','box','capsule'].includes(s.shape)||!['add','subtract','paint'].includes(s.mode)||!vector(s.position,-500,500)||!vector(s.size,.025,50)||!finite(s.blend,0,2)||!mids.has(s.materialId))fail('invalid sculpt stamp');if(!Array.isArray(p.keys)||p.keys.length>LIMITS.keys)fail('keyframe count');const times=new Set();for(const k of p.keys){if(!finite(k.time,0,a.duration)||!checkTransform(k)||times.has(k.time))fail('invalid keyframe');times.add(k.time);}}}
 for(const a of value.assets)validatePhysics(a);
 if(!value.world||!mids.has(value.world.groundMaterialId)||!Array.isArray(value.world.instances)||value.world.instances.length>LIMITS.instances)fail('world');
 const terrainSeed=value.world.wetlandSeed;
 if(terrainSeed!==undefined&&(!Number.isInteger(terrainSeed)||terrainSeed<0||terrainSeed>0xffffffff))fail('invalid garden seed');
 validateClimate(value.world.climate);
 const wind=value.world.wind;if(wind&&(!finite(wind.speed,0,MAX_WIND_SPEED)||!finite(wind.heading,-180,180)||(wind.turbulence!==undefined&&!finite(wind.turbulence,0,1))))fail('invalid wind');
 const instanceIds=new Set();for(const i of value.world.instances){if(typeof i.id!=='string'||instanceIds.has(i.id)||!aids.has(i.assetId)||!checkTransform(i.transform))fail('instance');instanceIds.add(i.id);}
 if(worldPartCount(value)>LIMITS.previewParts)fail('world preview part budget (32); keep additional assets in the library');
 return value;
}
export function sampleTrack(p,time){
 if(!p.keys.length)return clone(p.transform);
 const keys=[...p.keys].sort((a,b)=>a.time-b.time);if(time<=keys[0].time)return clone(keys[0]);if(time>=keys.at(-1).time)return clone(keys.at(-1));
 const b=keys.findIndex(k=>k.time>=time),a=keys[b-1],c=keys[b],t=(time-a.time)/(c.time-a.time),u=t*t*(3-2*t),out={};
 for(const field of ['position','rotation','scale'])out[field]=a[field].map((v,i)=>{let d=c[field][i]-v;if(field==='rotation')d=((d+180)%360+360)%360-180;return v+d*u;});return out;
}
export function recordKey(p,time,duration){time=Math.max(0,Math.min(duration,Math.round(time*100)/100));const k={...clone(p.transform),time},old=p.keys.findIndex(x=>Math.abs(x.time-time)<.005);if(old>=0)p.keys[old]=k;else{if(p.keys.length>=LIMITS.keys)throw Error('Keyframe limit reached');p.keys.push(k);}p.keys.sort((a,b)=>a.time-b.time);}
export class History{constructor(limit=30){this.limit=limit;this.past=[];this.future=[];}push(library){this.past.push(clone(library));if(this.past.length>this.limit)this.past.shift();this.future=[];}undo(current){if(!this.past.length)return current;this.future.push(clone(current));return this.past.pop();}redo(current){if(!this.future.length)return current;this.past.push(clone(current));return this.future.pop();}}
