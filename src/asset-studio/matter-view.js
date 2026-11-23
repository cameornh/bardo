import {reflectedSurfaceClip} from './wave-surface.js';
import {waterSurfaceHeight} from './wetland.js';
import * as THREE from 'three';
import {MarchingCubes} from 'three/examples/jsm/objects/MarchingCubes.js';
import {SandDriftView} from './sand-drift-view.js';
import {DepositSurface} from './deposit-view.js';
import {grainParams,surfaceRelief} from './surface-grain.js';
import {medium,interfaceOptics} from './water-optics.js';

// Opaque fused materials keep their own surface shading. Transmissive melts
// and authored liquids use the shared reflection, refraction and volume pass.
export const usesLiquidOptics=(material,liquid)=>liquid&&!(material.fromSolid&&material.opacity===1);
const SPRAY_CAP=4096;
function mulberry32(seed){
 let s=(seed>>>0)||1;
 return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
}
function gaussianRng(rng){
 return Math.sqrt(-2*Math.log(Math.max(1e-6,rng())))*Math.cos(6.28318530718*rng());
}
export function createImpactSandSpray({origin={x:0,y:0,z:0},packets=[],baseSpeed=3.2,count=220,seed=1,mode='impulse'}={}){
 const rng=mulberry32(seed),TAU=6.28318530718,out=[];
 if(mode==='drop'){
  const src=packets.length?packets:[{position:origin,velocity:{x:0,y:0,z:0},radius:0.08}];
  const perPacket=Math.max(12,Math.round(count/src.length));
  for(const p of src){
   const lv=p.body?.linvel?.()||p.velocity||{x:0,y:0,z:0};
   const pr=Math.max(0.035,p.radius||0.08);
   const px=p.position?.x??origin.x,py=p.position?.y??origin.y,pz=p.position?.z??origin.z;
   const vx0=lv.x??0,vy0=lv.y??0,vz0=lv.z??0;
   for(let k=0;k<perPacket&&out.length<count;k++){
    const cls=rng(),isDust=cls>=0.93,isCoarse=!isDust&&cls>=0.66;
    const r=isDust?-(0.028+0.040*rng()):isCoarse?(0.0068+0.0052*(rng()**1.2)):(0.0028+0.0040*(rng()**1.3));
    const grainSeed=rng();
    const scalePos=isDust?pr*1.1:pr*0.75;
    out.push({
     x:px+gaussianRng(rng)*scalePos,
     y:py+Math.abs(gaussianRng(rng))*pr*0.55-pr*0.2,
     z:pz+gaussianRng(rng)*scalePos,
     vx:vx0*(0.75+0.4*rng())+gaussianRng(rng)*0.42,
     vy:vy0*(0.75+0.4*rng())+gaussianRng(rng)*0.30,
     vz:vz0*(0.75+0.4*rng())+gaussianRng(rng)*0.42,
     r,seed:grainSeed,alpha:1,
     drag:isDust?(2.8+1.6*rng()):isCoarse?(0.25+0.30*rng()):(0.9+1.3*rng()),
     age:0,maxAge:isDust?(0.65+0.55*rng()):(1.8+0.8*rng()),
     settleFade:0.18,settledAge:-1,bounces:isCoarse?1:0,dust:isDust
    });
   }
  }
  return out;
 }
 const p1=rng()*TAU,p2=rng()*TAU,p3=rng()*TAU;
 const jetCount=4+Math.floor(rng()*3);
 const jets=Array.from({length:jetCount},()=>({ang:rng()*TAU,spread:0.14+0.22*rng(),boost:1.05+0.38*rng()}));
 const spdScale=Math.max(1.8,baseSpeed);
 for(let i=0;i<count;i++){
  let th=rng()*TAU,jetBoost=1.0;
  if(rng()<0.55){
   const j=jets[Math.floor(rng()*jets.length)];
   th=j.ang+gaussianRng(rng)*j.spread;
   jetBoost=j.boost;
  }
  const uGauss=Math.sqrt(-2*Math.log(Math.max(1e-4,rng())))*0.145;
  const harm=1+0.42*Math.sin(2*th+p1)+0.28*Math.cos(3*th+p2)+0.18*Math.sin(5*th+p3);
  const radDist=Math.min(0.46,uGauss*Math.max(0.35,harm));
  const fR=Math.min(1,radDist/0.36);
  const cls=rng(),isDust=cls>=0.94,isCoarse=!isDust&&cls>=0.66;
  const r=isDust?-(0.032+0.046*rng()):isCoarse?(0.0070+0.0055*(rng()**1.2)):(0.0028+0.0042*(rng()**1.3));
  const grainSeed=rng();
  const elevBase=(1.26-0.55*fR)+gaussianRng(rng)*0.16;
  const elev=Math.max(0.38,Math.min(1.42,elevBase));
  const speedMag=spdScale*(0.38+0.92*(rng()**0.85))*jetBoost*(isDust?0.35:isCoarse?0.78:1.08);
  const hSpd=speedMag*Math.cos(elev),vSpd=speedMag*Math.sin(elev);
  const az=th+gaussianRng(rng)*0.14;
  out.push({
   x:origin.x+Math.cos(th)*radDist,
   y:origin.y+Math.max(-0.02,0.015+0.07*rng()*(1-fR)),
   z:origin.z+Math.sin(th)*radDist,
   vx:Math.cos(az)*hSpd,
   vy:isDust?Math.max(0.45,vSpd*0.55):vSpd,
   vz:Math.sin(az)*hSpd,
   r,seed:grainSeed,alpha:1,
   drag:isDust?(2.8+1.7*rng()):isCoarse?(0.25+0.30*rng()):(0.9+1.3*rng()),
   age:0,maxAge:isDust?(0.65+0.60*rng()):(1.8+0.9*rng()),
   settleFade:0.18,settledAge:-1,bounces:isCoarse?1:0,dust:isDust
  });
 }
 return out;
}
export function liquidUniforms(shared,m){
 return {...shared,color:{value:new THREE.Color(m.color)},absorption:{value:m.absorption},scattering:{value:m.scattering},ior:{value:m.ior},opacity:{value:m.opacity},
  properties:{value:new THREE.Vector4(m.roughness,m.metallic,m.opacity,m.emission)}};
}
const vertex=`varying vec3 p,n;
#ifdef DEPOSIT
 attribute float layerDepth,trappedFraction;varying float depthMetres,clouded;
#endif
void main(){
 #ifdef DEPOSIT
 depthMetres=layerDepth;clouded=trappedFraction;
 #endif
 p=(modelMatrix*vec4(position,1.)).xyz;n=transpose(inverse(mat3(modelMatrix)))*normal;
 gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`;
export class MatterView{
 constructor(view,lighting){this.view=view;this.lighting=lighting;this.meshes=new Map();this.beds=new Map();this.saltation=new Map();this.puffs=new Map();this.sprayGrains=[];this.seenGroundGroups=new Set();this.lastSprayTime=null;this.spraySerial=0;this.last=-1;}
 reset(){
  for(const mesh of [...this.meshes.values(),...this.beds.values()]){mesh.removeFromParent();mesh.material.dispose();mesh.geometry.dispose();}
  for(const renderer of this.saltation.values())renderer.dispose();this.saltation.clear();
  for(const puff of this.puffs.values())puff.dispose();this.puffs.clear();
  this.thrownSand?.dispose();this.thrownSand=null;this.sprayGrains=[];this.seenGroundGroups.clear();this.lastSprayTime=null;this.spraySerial=0;this.meshes.clear();this.beds.clear();this.last=-1;this.state=null;
 }
 material(m,water,radius,deposit=false){
  const uniforms=liquidUniforms(this.view.oceanView.uniforms,m);
  uniforms.clipFloor=this.view.uniforms.clipFloor;uniforms.grainMap=this.view.uniforms.grainMap;uniforms.grain={value:new THREE.Vector3(...grainParams(m))};uniforms.thickness={value:2*radius};uniforms.parcelClouded={value:0};
  const shader=new THREE.ShaderMaterial({uniforms,transparent:deposit,side:deposit?THREE.FrontSide:THREE.DoubleSide,defines:{...(water?{PARCEL_OPTICS:1}:{}),...(deposit?{DEPOSIT:1}:{})},
   vertexShader:vertex,fragmentShader:this.lighting+(water?medium+interfaceOptics:reflectedSurfaceClip+surfaceRelief)+`
    varying vec3 p,n;uniform float thickness,parcelClouded;uniform vec3 grain;
    ${water?'':'uniform mat4 projectionMatrix;uniform vec3 color;uniform vec4 properties;'}
    #ifdef DEPOSIT
     varying float depthMetres,clouded;
    #endif
    void main(){
     ${water?'':'if(belowReflector(p))discard;'}
     vec3 norm=normalize(n),base=color;float travel=thickness,inclusions=parcelClouded;
     #ifdef DEPOSIT
      if(depthMetres<.0006)discard;
      travel=depthMetres/max(.18,abs(dot(norm,normalize(cameraPosition-p))));
      inclusions=clouded;
     #endif
     ${water?'vec3 result=opticalSurface(p,norm,travel,.92*(1.-exp(-32.*inclusions*travel)));':'vec3 prior=norm;float lift=grainSurface(p,prior,grain,norm,base,cameraPosition-p);gl_FragDepth=reliefDepth(gl_FragCoord.z,p,prior,lift,projectionMatrix);vec3 result=shade(base,norm,p,properties);'}
     float coverage=1.;
     #ifdef DEPOSIT
      coverage=smoothstep(.0006,${water?'.0035':'.012'},depthMetres);
     #endif
     gl_FragColor=vec4(result,coverage);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`});
  return shader;
 }
 surface(key,g){
  let mesh=this.meshes.get(key);if(mesh)return mesh;
  const water=usesLiquidOptics(g.material,g.kind===2);
  const resolution=Math.min(26,8+Math.ceil(4.5*Math.cbrt(g.packets.length)));
  mesh=new MarchingCubes(resolution,this.material(g.material,water,g.radius),false,false,Math.min(14000,5*(resolution-3)**3));mesh.isolation=.23;mesh.frustumCulled=false;
  if(water)mesh.layers.set(1);
  this.view.scene.add(mesh);this.meshes.set(key,mesh);return mesh;
 }
 stepSandSpray(sim){
  if(!sim){return;}
  if(this.lastSprayTime!==null&&sim.time<this.lastSprayTime-1e-4){
   this.sprayGrains.length=0;this.seenGroundGroups.clear();this.last=-1;this.lastSprayTime=sim.time;
  }
  const dt=this.lastSprayTime===null?0:Math.min(0.05,Math.max(0,sim.time-this.lastSprayTime));
  this.lastSprayTime=sim.time;
  const land=this.view.garden?.land||sim.sand?.landscape||null;
  const seaLevel=this.view.sea?.seaLevel??land?.climate?.seaLevelOffset??null;
  const wSpd=sim.wind?.speed||0;
  const waterYAt=(qx,qz)=>land?waterSurfaceHeight(land,qx,qz,wSpd):(seaLevel!==null?seaLevel+0.03:-1e6);
  for(const k of this.seenGroundGroups)if(!sim.matter.parts.has(k))this.seenGroundGroups.delete(k);
  for(const [key,g] of sim.matter.parts){
   if(!g.groundTool||g.kind!==1||this.seenGroundGroups.has(key))continue;
   this.seenGroundGroups.add(key);
   const mode=key.startsWith('ground-')?'drop':'impulse';
   const nP=g.packets.length||1;
   let cx=0,cy=0,cz=0,spdSum=0;
   for(const p of g.packets){
    cx+=p.position.x;cy+=p.position.y;cz+=p.position.z;
    const lv=p.body?.linvel?.();
    if(lv)spdSum+=Math.hypot(lv.x,lv.y,lv.z);
   }
   cx/=nP;cy/=nP;cz/=nP;
   const bedY=sim.sandTerrain?sim.sandTerrain.height(cx,cz):sim.matter.groundHeight(sim,cx,cz);
   const wY=waterYAt(cx,cz);
   if(bedY<=wY+0.02&&cy<=wY+0.04)continue;
   const seed=((++this.spraySerial)*2654435761)^Math.imul(Math.round(cx*97+cz*193),1597334677)^Math.round((sim.time||0)*1000);
   const burst=createImpactSandSpray({
    origin:{x:cx,y:Math.max(bedY+0.025,cy),z:cz},
    packets:g.packets,
    baseSpeed:spdSum/nP||3.2,
    count:mode==='drop'?Math.max(40,Math.min(180,nP*20)):220,
    seed,
    mode
   });
   if(this.sprayGrains.length+burst.length>SPRAY_CAP)this.sprayGrains.splice(0,this.sprayGrains.length+burst.length-SPRAY_CAP);
   for(let i=0;i<burst.length;i++)this.sprayGrains.push(burst[i]);
  }
  if(dt>0&&this.sprayGrains.length){
   const wRad=(sim.wind?.heading||0)*Math.PI/180;
   const wx=wSpd*Math.cos(wRad),wz=wSpd*Math.sin(wRad);
   let write=0;
   for(let i=0;i<this.sprayGrains.length;i++){
    const gr=this.sprayGrains[i];
    gr.age+=dt;
    if(gr.age>=gr.maxAge)continue;
    if(gr.settledAge<0){
     gr.vy-=(gr.dust?1.8:9.81)*dt;
     const kDrag=Math.exp(-gr.drag*dt);
     gr.vx=wx+(gr.vx-wx)*kDrag;
     gr.vz=wz+(gr.vz-wz)*kDrag;
     gr.vy*=gr.dust?kDrag:Math.exp(-gr.drag*0.25*dt);
     gr.x+=gr.vx*dt;gr.y+=gr.vy*dt;gr.z+=gr.vz*dt;
     const wY=waterYAt(gr.x,gr.z);
     if(gr.y<=wY+0.01)continue;
     const bedY=sim.sandTerrain?sim.sandTerrain.height(gr.x,gr.z):sim.matter.groundHeight(sim,gr.x,gr.z);
     const surfY=bedY+Math.abs(gr.r)*0.45;
     if(gr.vy<=0&&gr.y<=surfY){
      if(gr.bounces>0&&gr.vy<-1.1){
       gr.bounces--;gr.y=surfY;
       const jh=((gr.seed*131+gr.age*17)%1)*6.283185;
       const rest=0.22+(gr.seed%0.18);
       gr.vy=-gr.vy*rest;
       gr.vx=gr.vx*0.52+Math.cos(jh)*0.35;
       gr.vz=gr.vz*0.52+Math.sin(jh)*0.35;
      }else{
       gr.y=surfY;gr.vx=gr.vy=gr.vz=0;gr.settledAge=0;
      }
     }
    }else{
     gr.settledAge+=dt;
     if(gr.settledAge>=gr.settleFade)continue;
    }
    if(gr.dust){
     gr.alpha=Math.min(1,gr.age/0.06)*(Math.max(0,1-gr.age/gr.maxAge)**1.6);
    }else if(gr.settledAge>=0){
     gr.alpha=Math.max(0,1-gr.settledAge/gr.settleFade);
    }else{
     gr.alpha=Math.min(1,gr.age/0.02+0.55)*(gr.age>gr.maxAge-0.25?(gr.maxAge-gr.age)/0.25:1);
    }
    this.sprayGrains[write++]=gr;
   }
   this.sprayGrains.length=write;
  }
  if(this.sprayGrains.length&&!this.thrownSand)this.thrownSand=new SandDriftView(this.view.grainScene,this.view.uniforms,this.lighting,true,null,SPRAY_CAP);
  if(this.thrownSand){
   if(this.thrownSand.landscape!==land)this.thrownSand.setLandscape(land);
   this.thrownSand.update({grains:this.sprayGrains,lastWindSpeed:wSpd},sim.groundMaterial??{color:'#e8dec8'},this.view.camera?.position);
  }
 }
 update(sim){
  if(sim!==this.state){this.reset();this.state=sim;}
  if(!sim)return;
  this.stepSandSpray(sim);
  if(sim.time-this.last<1/30)return;this.last=sim.time;
  for(const [id,bed] of sim.matter.beds){
   let mesh=this.beds.get(id);
   if(!mesh){mesh=new DepositSurface(bed,this.material(bed.material,usesLiquidOptics(bed.material,bed.liquid),0,true));if(!usesLiquidOptics(bed.material,bed.liquid))mesh.layers.set(0);this.beds.set(id,mesh);this.view.scene.add(mesh);}
   mesh.update(sim);
   if(!bed.liquid&&(bed.grains.length||this.saltation.has(id))){
    if(!this.saltation.has(id))this.saltation.set(id,new SandDriftView(this.view.grainScene,this.view.uniforms,this.lighting,true,this.view.eyeScene));
    this.saltation.get(id).update(bed,bed.material,this.view.camera.position);
   }
  }
  for(const [key,mesh] of this.meshes)if(!sim.matter.parts.has(key)){
   mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();this.meshes.delete(key);
  }
  for(const [key,puff] of this.puffs)if(!sim.matter.parts.has(key)){puff.dispose();this.puffs.delete(key);}
  for(const [key,g] of sim.matter.parts){
   if(g.groundTool&&g.kind===1)continue;
   if(g.material.phase==='gas'){
    let puff=this.puffs.get(key);if(!puff){puff=new SandDriftView(this.view.grainScene,this.view.uniforms,this.lighting,true);this.puffs.set(key,puff);}
    const grains=g.packets.map(p=>({...p.position,r:p.radius*(1+g.age),vx:0,vy:0,vz:0}));
    puff.update({grains},g.material);puff.mesh.material.uniforms.coverage.value=g.material.opacity*.4*Math.max(0,1-g.age/2.4)**2;
    continue;
   }
   if(!g.packets.length&&!this.meshes.has(key))continue;
   const mesh=this.surface(key,g),size=mesh.size,packets=g.packets;
   mesh.visible=!!packets.length;if(!packets.length)continue;
   mesh.material.uniforms.parcelClouded.value=g.thermal?.trapped||0;
   const lo=new THREE.Vector3(Infinity,Infinity,Infinity),hi=lo.clone().negate(),r=g.radius;
   for(const p of packets){lo.min(p.position);hi.max(p.position);}
   // Compact Gaussians blend to a common isosurface. Anisotropic grids retain
   // vertical resolution for shallow pools and broad piles.
   lo.addScalar(-2.3*r);hi.addScalar(2.3*r);
   const span=hi.clone().sub(lo).multiplyScalar(size/(size-4)),center=lo.clone().add(hi).multiplyScalar(.5);
   mesh.scale.copy(span).multiplyScalar(.5);mesh.position.copy(center);
   const origin=center.clone().addScaledVector(span,-.5),cell=span.clone().divideScalar(size);
   mesh.field.fill(0);mesh.normal_cache.fill(0);
   for(const p of packets){
    const {x,y,z}=p.position,settled=g.kind===2&&y-r<(sim.sand?.height(x,z)||0)+r*.18;
    const rx=r*(settled?1.65:1.24),ry=r*(settled?.64:1.24),cy=y-(settled?.38*r:0);
    const ix=(x-origin.x)/cell.x,iy=(cy-origin.y)/cell.y,iz=(z-origin.z)/cell.z;
    const sx=cell.x/rx,sy=cell.y/ry,sz=cell.z/rx;
    for(let k=Math.max(1,Math.ceil(iz-1.8/sz));k<=Math.min(size-2,iz+1.8/sz);k++)
     for(let j=Math.max(1,Math.ceil(iy-1.8/sy));j<=Math.min(size-2,iy+1.8/sy);j++){
      const yz=((j-iy)*sy)**2+((k-iz)*sz)**2;
      for(let i=Math.max(1,Math.ceil(ix-1.8/sx));i<=Math.min(size-2,ix+1.8/sx);i++){
       const d=yz+((i-ix)*sx)**2;if(d<3.24)mesh.field[i+size*(j+size*k)]+=Math.exp(-1.5*d)-.00775;
      }
     }
   }
   mesh.update();
  }
 }
}
