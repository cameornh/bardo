import {validatePhysics} from './physics-data.js';
// Versioned authoring data. Derived Gaussian samples are disposable caches.
export const VERSION=1, STORAGE_KEY='bardo.asset-studio.v1';
export const LIMITS={assets:128,parts:24,stamps:512,instances:256,materials:128,keys:120,grid:140000,splats:24000,previewParts:32};
export const clone=x=>structuredClone(x);
export const uid=()=>globalThis.crypto.randomUUID();
export const transform=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export const MATERIAL_FIELDS=[
 ['roughness','Roughness','Appearance',0,1,.01,.65,'preview'],['metallic','Metalness','Appearance',0,1,.01,0,'preview'],['opacity','Opacity','Appearance',.05,1,.01,1,'preview'],['emission','Emission','Appearance',0,8,.05,0,'preview'],
 ['fiberLength','Surface fibre length (m)','Appearance',0,.6,.005,0,'preview'],
 ['ior','Refractive index','Optics',1,3,.01,1.5,'stored'],['absorption','Absorption (1/m)','Optics',0,100,.1,0,'stored'],
 ['liquidity','Liquidity (0 = bound, 1 = freely flowing)','Mechanical',0,1,.01,0,'preview'],['density','Density (kg/m³)','Mechanical',.01,30000,1,1800,'stored'],['friction','Friction coefficient','Mechanical',0,2,.01,.6,'stored'],['restitution','Restitution','Mechanical',0,1,.01,.1,'stored'],['youngModulus','Elastic modulus (Pa)','Mechanical',0,1e12,1000,1e7,'stored'],['poissonRatio','Poisson ratio','Mechanical',0,.499,.001,.3,'stored'],['yieldStress','Yield stress (Pa)','Mechanical',0,1e10,100,10000,'stored'],['tensileStrength','Tensile strength (Pa)','Mechanical',0,1e10,100,10000,'stored'],['cohesion','Cohesion (Pa)','Mechanical',0,1e8,100,1000,'stored'],['adhesion','Adhesion (Pa)','Mechanical',0,1e8,100,1000,'stored'],['viscosity','Dynamic viscosity (Pa·s)','Mechanical',0,1e7,.001,0,'stored'],
 ['heatCapacity','Specific heat (J/kg·K)','Thermal',1,100000,1,800,'stored'],['thermalConductivity','Thermal conductivity (W/m·K)','Thermal',0,10000,.01,.3,'stored'],['emissivity','Thermal emissivity','Thermal',0,1,.01,.9,'stored'],['expansion','Thermal expansion (1/K)','Thermal',0,.1,.00001,.00001,'stored'],['meltingPoint','Melting temperature (K)','Thermal',0,10000,1,1500,'stored'],['boilingPoint','Boiling temperature (K)','Thermal',0,10000,1,3000,'stored'],['latentHeat','Latent heat of fusion (J/kg)','Thermal',0,1e8,1000,100000,'stored'],
 ['ignitionTemperature','Ignition temperature (K)','Combustion',0,5000,1,600,'stored'],['fuelEnergy','Fuel energy (J/kg; 0 = inert)','Combustion',0,1e8,100000,0,'stored'],['burnRate','Burn rate (1/s)','Combustion',0,100,.001,0,'stored'],['smokeYield','Smoke mass / burned mass','Combustion',0,1,.01,0,'stored'],
 ['electricalConductivity','Electrical conductivity (S/m)','Electrical',0,1e8,.01,0,'stored'],['porosity','Porosity','Moisture',0,1,.01,.1,'stored'],['permeability','Permeability (m²)','Moisture',0,.01,1e-12,1e-12,'stored'],['waterAffinity','Water affinity','Moisture',0,1,.01,.5,'stored'],['moisture','Initial water fraction','Moisture',0,1,.01,0,'stored']
];
export function material(id,name,color,overrides={}){return {id,name,color,phase:'solid',...Object.fromEntries(MATERIAL_FIELDS.map(f=>[f[0],f[6]])),...overrides};}
export function stamp(shape='sphere',mode='add',position=[0,1,0],size=[.6,.6,.6],materialId='clay',blend=.12){return {shape,mode,position:[...position],size:[...size],blend,materialId};}
export function part(name='Body',stamps=[]){return {id:uid(),name,pivot:[0,0,0],transform:transform(),stamps,keys:[]};}
export function asset(name='New sculpt'){return {id:uid(),name,spacing:.08,duration:3,parts:[part()]};}
export function seedLibrary(){
 const materials=[material('clay','Clay','#b17d62'),material('stone','Stone','#8e969a',{density:2700,roughness:.85,youngModulus:5e10}),material('bronze','Bronze','#bc8b48',{metallic:.92,roughness:.23,density:8800,electricalConductivity:7e6,thermalConductivity:60}),material('wood','Wood','#98603b',{density:650,fuelEnergy:1.6e7,burnRate:.02,smokeYield:.06,porosity:.4}),material('rubber','Rubber','#65767a',{density:1100,youngModulus:1e6,restitution:.7,friction:.95}),material('water','Water','#4099bd',{phase:'liquid',liquidity:1,youngModulus:0,tensileStrength:0,cohesion:0,density:1000,opacity:.45,roughness:.07,ior:1.333,viscosity:.001,heatCapacity:4184,thermalConductivity:.6,meltingPoint:273.15,boilingPoint:373.15}),material('sand','Sand','#c7b28a',{phase:'granular',youngModulus:0,tensileStrength:0,density:1600,roughness:.95,cohesion:0,adhesion:0,porosity:.38})];
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
 for(const m of value.materials){m.fiberLength??=0;if(m.surfaceMode!==undefined&&!['auto','gaussian'].includes(m.surfaceMode))fail('invalid surface rendering');m.liquidity??=['liquid','gas'].includes(m.phase)?1:0;if(!/^#[0-9a-f]{6}$/i.test(m.color)||!['solid','granular','liquid','gas'].includes(m.phase))fail('material appearance/phase');for(const [k,,,min,max] of MATERIAL_FIELDS)if(!finite(m[k],min,max))fail('invalid '+k);if(m.boilingPoint<m.meltingPoint)fail('boiling temperature must be at least melting temperature');}
 for(const a of value.assets){list(a.parts,LIMITS.parts,'part');ids(a.parts,'part');if(!finite(a.spacing,.05,.5)||!finite(a.duration,.1,120))fail('asset spacing/duration');for(const p of a.parts){if(!checkTransform(p.transform)||!vector(p.pivot))fail('part transform');if(!Array.isArray(p.stamps)||p.stamps.length>LIMITS.stamps)fail('stamp budget');for(const s of p.stamps)if(!['sphere','box','capsule'].includes(s.shape)||!['add','subtract','paint'].includes(s.mode)||!vector(s.position,-500,500)||!vector(s.size,.025,50)||!finite(s.blend,0,2)||!mids.has(s.materialId))fail('invalid sculpt stamp');if(!Array.isArray(p.keys)||p.keys.length>LIMITS.keys)fail('keyframe count');const times=new Set();for(const k of p.keys){if(!finite(k.time,0,a.duration)||!checkTransform(k)||times.has(k.time))fail('invalid keyframe');times.add(k.time);}}}
 for(const a of value.assets)validatePhysics(a);
 if(!value.world||!mids.has(value.world.groundMaterialId)||!Array.isArray(value.world.instances)||value.world.instances.length>LIMITS.instances)fail('world');
 const wind=value.world.wind;if(wind&&(!finite(wind.speed,0,40)||!finite(wind.heading,-180,180)))fail('invalid wind');
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
