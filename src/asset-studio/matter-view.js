import {reflectedSurfaceClip} from './wave-surface.js';
import * as THREE from 'three';
import {MarchingCubes} from 'three/examples/jsm/objects/MarchingCubes.js';
import {SandDriftView} from './sand-drift-view.js';
import {DepositSurface} from './deposit-view.js';
import {grainParams,surfaceRelief} from './surface-grain.js';
import {medium,interfaceOptics} from './water-optics.js';

// Opaque fused materials keep their own surface shading. Transmissive melts
// and authored liquids use the shared reflection, refraction and volume pass.
export const usesLiquidOptics=(material,liquid)=>liquid&&!(material.fromSolid&&material.opacity===1);
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
 constructor(view,lighting){this.view=view;this.lighting=lighting;this.meshes=new Map();this.beds=new Map();this.saltation=new Map();this.puffs=new Map();this.last=-1;}
 reset(){
  for(const mesh of [...this.meshes.values(),...this.beds.values()]){mesh.removeFromParent();mesh.material.dispose();mesh.geometry.dispose();}
  for(const renderer of this.saltation.values())renderer.dispose();this.saltation.clear();
  for(const puff of this.puffs.values())puff.dispose();this.puffs.clear();
  this.thrownSand?.dispose();this.thrownSand=null;this.meshes.clear();this.beds.clear();this.last=-1;this.state=null;
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
 update(sim){
  if(sim!==this.state){this.reset();this.state=sim;}
  if(!sim||sim.time-this.last<1/30)return;this.last=sim.time;
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
  const grains=[];
  for(const [key,g] of sim.matter.parts){
   if(g.groundTool&&g.kind===1){
    for(const p of g.packets){
     // Four overlapping Gaussian grains per physical parcel, one draw across all strokes.
     for(let k=0;k<4;k++){const r=p.radius*.48,sign=k&1?1:-1,side=k&2?1:-1;
      grains.push({x:p.position.x+r*sign,y:p.position.y+r*side*.7,z:p.position.z+r*sign*side,
       r,vx:0,vy:0,vz:0});}
    }
    continue;
   }
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
  if(grains.length&&!this.thrownSand)this.thrownSand=new SandDriftView(this.view.grainScene,this.view.uniforms,this.lighting,true,null,768*4);
  this.thrownSand?.update({grains},sim.groundMaterial);
 }
}
