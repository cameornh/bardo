import {reflectedSurfaceClip} from './wave-surface.js';
import {surfaceRelief,grainParams} from './surface-grain.js';
import * as THREE from 'three';
import {LIMITS} from './model.js';
const finishColor=new THREE.Color();

export function implicitStamp(part,materials){
 if(part.stamps.length!==1)return null;
 const s=part.stamps[0],m=materials.find(m=>m.id===s.materialId);
 return s.mode==='add'&&['sphere','box'].includes(s.shape)&&m?.opacity===1&&
   !m.fiberLength&&m.surfaceMode!=='gaussian'&&m.phase==='solid'&&m.liquidity<.999?s:null;
}

// The unit sphere and box have closed-form zero-isosurface intersections.
// The box hull bounds rasterization; the shader writes the exact surface depth.
export class ImplicitSurfaces {
 constructor(scene,environment,lighting,grainMap,clipUniforms){this.grainMap=grainMap;this.clipUniforms=clipUniforms;
  this.scene=scene;this.geometry=new THREE.BoxGeometry(2,2,2);
  this.materials=new Map();this.batches=new Map();this.environment=environment;this.lighting=lighting;
 }
 clear(){
  for(const {mesh} of this.batches.values()){mesh.removeFromParent();mesh.dispose();}
  this.batches.clear();
 }
 mesh(stamp,m){
  const key=m.id+'/'+stamp.shape, sphere=stamp.shape==='sphere';
  let mat=this.materials.get(key);
  if(!mat){
   mat=new THREE.ShaderMaterial({side:sphere?THREE.BackSide:THREE.FrontSide,defines:sphere?{ELLIPSOID:1}:{},
    uniforms:{grainMap:this.grainMap,grain:{value:new THREE.Vector3()},...this.clipUniforms,environment:this.environment,color:{value:new THREE.Color()},properties:{value:new THREE.Vector4()}},
    vertexShader:`varying float finishTint;varying vec3 worldPoint,detailCoord,detailNormal;flat varying vec3 dimensions;
    #ifdef ELLIPSOID
     varying vec3 localPosition;varying vec3 eye;varying mat3 normalToWorld;
    #else
     varying vec3 faceNormal;
    #endif
    void main(){finishTint=instanceColor.r;mat4 transform=modelMatrix*instanceMatrix;vec4 world=transform*vec4(position,1.);
     mat3 normalTransform=transpose(inverse(mat3(transform)));worldPoint=world.xyz;dimensions=vec3(length(transform[0].xyz),length(transform[1].xyz),length(transform[2].xyz));detailCoord=position*dimensions;detailNormal=normal;
    #ifdef ELLIPSOID
     localPosition=position;eye=(inverse(transform)*vec4(cameraPosition,1.)).xyz;normalToWorld=normalTransform;
    #else
     faceNormal=normalize(normalTransform*normal);
    #endif
     gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:reflectedSurfaceClip+this.lighting+surfaceRelief+`varying float finishTint;varying vec3 worldPoint,detailCoord,detailNormal;flat varying vec3 dimensions;uniform mat4 projectionMatrix;uniform vec3 grain;uniform vec3 color;uniform vec4 properties;
    #ifdef ELLIPSOID
     varying vec3 localPosition;varying vec3 eye;varying mat3 normalToWorld;
    #else
     varying vec3 faceNormal;
    #endif
    void main(){float depth=gl_FragCoord.z;vec3 p=worldPoint,n,coord=detailCoord,ln=detailNormal;
    #ifdef ELLIPSOID
     vec3 delta=localPosition-eye,d=normalize(delta),perp=cross(eye,d);
     float b=dot(eye,d),h=1.-dot(perp,perp);if(h<0.)discard;
     float t=-b-sqrt(h);if(t<=0.)t=-b+sqrt(h);if(t<=0.)discard;
     ln=normalize(eye+d*t);coord=(eye+d*t)*dimensions;n=normalize(normalToWorld*ln);
     p=mix(cameraPosition,worldPoint,t/length(delta));
     vec4 clip=projectionMatrix*viewMatrix*vec4(p,1.);depth=.5+.5*clip.z/clip.w;
    #else
     n=normalize(faceNormal);
    #endif
     if(belowReflector(p))discard;
     vec3 base=color*finishTint,prior=n;float lift=grainSurface(coord,ln,grain,n,base,cameraPosition-p);gl_FragDepth=reliefDepth(depth,p,prior,lift,projectionMatrix);gl_FragColor=vec4(shade(base,n,p,properties),1.);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`});
   mat.name='Studio implicit '+stamp.shape;this.materials.set(key,mat);
  }
  mat.uniforms.grain.value.set(...grainParams(m));mat.uniforms.color.value.set(m.color);mat.uniforms.properties.value.set(m.roughness,m.metallic,m.opacity,m.emission);
  const proxy=new THREE.Object3D();proxy.position.fromArray(stamp.position);proxy.scale.fromArray(stamp.size);proxy.userData.implicit=stamp.shape;
  let batch=this.batches.get(key);
  if(!batch){
   const mesh=new THREE.InstancedMesh(this.geometry,mat,LIMITS.previewParts);mesh.frustumCulled=false;mesh.count=0;mesh.setColorAt(0,finishColor.setScalar(1));
   batch={mesh,parts:[]};this.batches.set(key,batch);this.scene.add(mesh);
  }
  batch.parts.push(proxy);batch.mesh.count=batch.parts.length;
  return proxy;
 }
 update(sim){
  for(const {mesh,parts} of this.batches.values()){
   let count=0;for(const part of parts)if(part.parent.visible){
    const parent=part.parent,body=sim?.get(parent.parent.userData.instanceId,parent.userData.partId);
    let finish=0,area=0;for(const s of body?.field?.sites??[])if(!s.mark){finish+=s.finish*s.area;area+=s.area;}
    mesh.setColorAt(count,finishColor.setScalar(1-(area?finish/area:0)));mesh.setMatrixAt(count++,part.matrixWorld);
   }mesh.count=count;mesh.instanceColor.needsUpdate=true;
   mesh.instanceMatrix.needsUpdate=true;
  }
 }
 dispose(){this.clear();this.geometry.dispose();for(const mat of this.materials.values())mat.dispose();}
}
export function intersectImplicit(ray,mesh){
 const local=ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert()),point=new THREE.Vector3();
 const ball=mesh.userData.implicit==='sphere';
 const hit=ball?local.intersectSphere(new THREE.Sphere(new THREE.Vector3(),1),point):
  local.intersectBox(new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1)),point);
 if(!hit)return null;
 const normal=point.clone();
 if(!ball){const values=point.toArray().map(Math.abs),axis=values.indexOf(Math.max(...values));normal.set(0,0,0).setComponent(axis,Math.sign(point.getComponent(axis)));}
 normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
 return {localPoint:point.clone().applyMatrix4(mesh.matrix),point:point.applyMatrix4(mesh.matrixWorld),normal};
}
