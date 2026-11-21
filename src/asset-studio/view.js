import {ImplicitSurfaces,implicitStamp,intersectImplicit} from './implicit-surface.js';
import {OceanView} from './ocean-view.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {projectSH} from '../sh.js';
import {sampleTrack} from './model.js';
const VERTEX=`
attribute vec3 center;attribute vec3 surfaceNormal;attribute vec3 tint;attribute vec4 properties;attribute float radius;
uniform vec2 viewport;uniform mat4 cameraWorld;
varying vec2 footprint;varying vec3 vNormal;varying vec3 vColor;varying vec3 vWorld;varying vec4 vProps;varying float vRadius;
void main(){
 vec4 c=modelViewMatrix*vec4(center,1.);vec3 n=normalize(surfaceNormal);float r2=radius*radius;

 mat3 covariance=r2*(mat3(1.)-.965*mat3(n*n.x,n*n.y,n*n.z));mat3 rotation=mat3(modelViewMatrix);covariance=rotation*covariance*transpose(rotation);
 float z=max(.03,-c.z);vec3 jx=vec3(projectionMatrix[0][0]*viewport.x*.5/z,0.,projectionMatrix[0][0]*viewport.x*.5*c.x/(z*z));vec3 jy=vec3(0.,projectionMatrix[1][1]*viewport.y*.5/z,projectionMatrix[1][1]*viewport.y*.5*c.y/(z*z));
 float a=dot(jx,covariance*jx)+.18,b=dot(jx,covariance*jy),d=dot(jy,covariance*jy)+.18;float halfTrace=(a+d)*.5,delta=sqrt(max(0.,(a-d)*(a-d)*.25+b*b));float angle=.5*atan(2.*b,a-d);vec2 u=vec2(cos(angle),sin(angle)),v=vec2(-u.y,u.x);
 vec2 offset=2.6*(u*sqrt(max(.1,halfTrace+delta))*position.x+v*sqrt(max(.1,halfTrace-delta))*position.y);vec4 clip=projectionMatrix*c;clip.xy+=offset*2./viewport*clip.w;if(c.z>-.03)clip=vec4(2.,2.,2.,1.);gl_Position=clip;
 footprint=position.xy*2.6;vNormal=normalize(mat3(cameraWorld)*normalMatrix*n);vColor=tint;vProps=properties;vRadius=radius;vWorld=(modelMatrix*vec4(center,1.)).xyz;
}`;
const LIGHTING=`
uniform vec3 environment[9];
vec3 env(vec3 n,float diffuse){float b[9];b[0]=.282094792;b[1]=-.488602512*n.y;b[2]=.488602512*n.z;b[3]=-.488602512*n.x;b[4]=1.092548431*n.x*n.y;b[5]=-1.092548431*n.y*n.z;b[6]=.315391565*(2.*n.z*n.z-n.x*n.x-n.y*n.y);b[7]=-1.092548431*n.x*n.z;b[8]=.546274215*(n.x*n.x-n.y*n.y);vec3 s=vec3(0);for(int i=0;i<9;i++){float factor=i==0?1.:(i<4?.6666667:.25);s+=environment[i]*b[i]*mix(1.,factor,diffuse);}return max(vec3(.03),s);}
vec3 shade(vec3 base,vec3 n,vec3 p,vec4 prop){vec3 v=normalize(cameraPosition-p),l=normalize(vec3(-.6,1.,.5));n=faceforward(n,-v,n);float rough=prop.x,metal=prop.y;vec3 diffuse=env(n,1.)+vec3(1.1,1.02,.88)*max(0.,dot(n,l));vec3 r=reflect(-v,n);float f=pow(1.-max(0.,dot(n,v)),5.);vec3 f0=mix(vec3(.04),base,metal),fresnel=f0+(1.-f0)*f*(1.-rough*.85);float spec=pow(max(0.,dot(n,normalize(l+v))),mix(160.,3.,rough*rough));return base*diffuse*(1.-metal)+mix(env(r,0.),env(n,1.),rough)*fresnel*mix(.45,1.,metal)+spec*mix(.7,.15,rough)*f0+base*prop.w;}
`;
const FRAGMENT=`varying vec2 footprint;varying vec3 vNormal;varying vec3 vColor;varying vec3 vWorld;varying vec4 vProps;varying float vRadius;${LIGHTING}
uniform vec2 viewport;uniform mat4 projectionMatrix;
void main(){vec3 v=normalize(cameraPosition-vWorld);if(vWorld.y<0.||dot(vNormal,v)<.015)discard;float weight=exp(-.5*dot(footprint,footprint));if(weight<.06)discard;float coverage=smoothstep(.06,.3,weight);vec3 centerView=(viewMatrix*vec4(vWorld,1.)).xyz;vec3 ray=normalize(vec3((gl_FragCoord.xy/viewport*2.-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.));vec3 nv=mat3(viewMatrix)*vNormal;float t=dot(nv,centerView)/dot(nv,ray);t=clamp(t,length(centerView)-vRadius,length(centerView)+vRadius);t-=vRadius*4.;vec4 clip=projectionMatrix*vec4(ray*t,1.);gl_FragDepth=clip.z/clip.w*.5+.5;
 gl_FragColor=vec4(shade(vColor,normalize(vNormal),vWorld,vProps),coverage*vProps.z);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const DEPTH_FRAGMENT=`varying vec2 footprint;varying vec3 vNormal;varying vec3 vWorld;varying float vRadius;uniform vec2 viewport;uniform mat4 projectionMatrix;
void main(){if(vWorld.y<0.||dot(vNormal,normalize(cameraPosition-vWorld))<.015||dot(footprint,footprint)>5.)discard;vec3 centerView=(viewMatrix*vec4(vWorld,1.)).xyz;vec3 ray=normalize(vec3((gl_FragCoord.xy/viewport*2.-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.));vec3 nv=mat3(viewMatrix)*vNormal;float t=dot(nv,centerView)/dot(nv,ray);t=clamp(t,length(centerView)-vRadius,length(centerView)+vRadius);vec4 clip=projectionMatrix*vec4(ray*t,1.);gl_FragDepth=clip.z/clip.w*.5+.5;gl_FragColor=vec4(0.);}`;
const GROUND_VERTEX=`varying vec3 worldPosition;void main(){worldPosition=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const GROUND_FRAGMENT=`varying vec3 worldPosition;uniform vec3 color;uniform vec4 properties;${LIGHTING}
void main(){vec3 p=worldPosition;float grid=min(abs(fract(p.x+.5)-.5),abs(fract(p.z+.5)-.5));float line=1.-smoothstep(.015,.035,grid);float fade=exp(-length(cameraPosition-p)*.035);vec3 base=color*(1.-line*.12*fade);vec3 lit=shade(base,vec3(0,1,0),p,properties);float fog=1.-exp(-length(cameraPosition-p)*.003);gl_FragColor=vec4(mix(lit,vec3(.38,.45,.48),fog),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export function partMatrix(pose,pivot){const m=new THREE.Matrix4().compose(new THREE.Vector3(...pose.position).add(new THREE.Vector3(...pivot)),new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation.map(x=>x*Math.PI/180),'XYZ')),new THREE.Vector3(...pose.scale));return m.multiply(new THREE.Matrix4().makeTranslation(...pivot.map(x=>-x)));}
function poseObject(object,t){object.position.fromArray(t.position);object.rotation.set(...t.rotation.map(x=>x*Math.PI/180));object.scale.fromArray(t.scale);object.updateMatrix();}
export class StudioView{
 constructor(canvas,onChange,onDragStart,{preserveDrawingBuffer=false,liveStudio=false}={}){
 this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));this.renderer.setClearColor('#8eaaaf');this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
 this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(48,1,.03,10000);this.camera.position.set(7,5,9);this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,1,0);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.maxDistance=4000;this.controls.minDistance=.25;this.controls.update();
 const sh=projectSH(n=>[.44+.24*n[1],.49+.26*n[1],.53+.3*n[1]]),environment=Array.from({length:9},(_,i)=>new THREE.Vector3(...sh.slice(i*3,i*3+3)));
 this.uniforms={environment:{value:environment},viewport:{value:new THREE.Vector2(1,1)},cameraWorld:{value:this.camera.matrixWorld}};
 this.material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,depthWrite:false,side:THREE.DoubleSide});this.material.name='studio covariance Gaussian';this.depthMaterial=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:DEPTH_FRAGMENT,colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
 this.liveStudio=liveStudio;
 if(liveStudio){
  this.controls.enableDamping=false;
  this.controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE};
  this.implicit=new ImplicitSurfaces(this.scene,this.uniforms.environment,LIGHTING);
  this.oceanView=new OceanView(this.scene,this.uniforms.environment,LIGHTING);
  // Stretch each fibre along its surface normal, retaining the projected covariance.
  for(const mat of [this.material,this.depthMaterial]){
   mat.uniforms.clipFloor={value:0};
   mat.fragmentShader='uniform float clipFloor;\n'+mat.fragmentShader.replace('vWorld.y<0.','vWorld.y<clipFloor');
   mat.vertexShader='attribute float fiberLength;\n'+mat.vertexShader
    .replace('vec4 c=modelViewMatrix*vec4(center,1.);','vec3 fiberCenter=center+surfaceNormal*fiberLength*.46;vec4 c=modelViewMatrix*vec4(fiberCenter,1.);')
    .replace('mat3 rotation=', 'if(fiberLength>0.)covariance=mat3(1.)*r2*.10+mat3(n*n.x,n*n.y,n*n.z)*fiberLength*fiberLength*.2;mat3 rotation=')
    .replace('modelMatrix*vec4(center,1.)','modelMatrix*vec4(fiberCenter,1.)');
  }
 }
 this.groundMaterial=new THREE.ShaderMaterial({uniforms:{environment:this.uniforms.environment,color:{value:new THREE.Color()},properties:{value:new THREE.Vector4()}},vertexShader:GROUND_VERTEX,fragmentShader:GROUND_FRAGMENT});
 this.ground=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),this.groundMaterial);this.ground.rotation.x=-Math.PI/2;this.scene.add(this.ground);
 this.root=new THREE.Group();this.assetScene=new THREE.Scene();this.assetScene.add(this.root);this.cache=new Map();this.groups=new Map();this.surfaces=new Map();
 this.gizmo=new TransformControls(this.camera,canvas);this.scene.add(this.gizmo.getHelper());this.gizmo.addEventListener('dragging-changed',e=>{this.controls.enabled=!e.value;this.dragging=e.value;if(e.value)onDragStart();else onChange(this.gizmo.object);});this.gizmo.addEventListener('objectChange',()=>onChange(this.gizmo.object,true));
 this.brush=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshBasicMaterial({color:0xe9ede7,wireframe:true,transparent:true,opacity:.55,depthWrite:false}));this.scene.add(this.brush);this.brush.visible=false;
 this.forceLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffd18a,depthTest:false}));this.forceLine.frustumCulled=false;this.forceLine.visible=false;this.scene.add(this.forceLine);
 this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.failed=true;});
 }
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.renderer.getDrawingBufferSize(this.uniforms.viewport.value);}
 setGround(m){this.groundMaterial.uniforms.color.value.set(m.color);this.groundMaterial.uniforms.properties.value.set(m.roughness,m.metallic,m.opacity,m.emission);}
 geometry(surface,materials){const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);const count=surface.positions.length/3,colors=new Float32Array(count*3),props=new Float32Array(count*4),radii=new Float32Array(count),fiber=new Float32Array(count);let maxFiber=0;for(let i=0;i<count;i++){const m=materials.find(m=>m.id===surface.materials[i])||materials[0],c=new THREE.Color(m.color);colors.set([c.r,c.g,c.b],i*3);props.set([m.roughness,m.metallic,m.opacity,m.emission],i*4);radii[i]=surface.spacing*.61;fiber[i]=m.fiberLength||0;maxFiber=Math.max(maxFiber,fiber[i]);}for(const [name,array,itemSize]of [['center',new Float32Array(surface.positions),3],['surfaceNormal',new Float32Array(surface.normals),3],['tint',colors,3],['properties',props,4],['radius',radii,1]])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,itemSize));if(this.liveStudio)geometry.setAttribute('fiberLength',new THREE.InstancedBufferAttribute(fiber,1));geometry.instanceCount=count;const box=new THREE.Box3().setFromArray(surface.positions);box.expandByScalar(surface.spacing*2+maxFiber*2);geometry.boundingBox=box;geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());return geometry;}
 setSurface(key,surface,materials){this.surfaces.set(key,surface);const old=this.cache.get(key),geometry=this.geometry(surface,materials);this.cache.set(key,geometry);for(const group of this.groups.values())group.traverse(o=>{if(o.userData.surfaceKey===key)o.geometry=geometry;});old?.dispose();}
 recolor(materials){for(const [key,s]of this.surfaces)this.setSurface(key,s,materials);}
 rebuild(library,mode,assetId){this.gizmo.detach();this.root.clear();this.groups.clear();this.library=library;this.mode=mode;this.implicitCount=0;this.implicit?.clear();const instances=mode==='asset'?[{id:'editor',assetId,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]:library.world.instances;
 for(const instance of instances){const a=library.assets.find(a=>a.id===instance.assetId);if(!a)continue;const group=new THREE.Group();group.userData={instanceId:instance.id,assetId:a.id};poseObject(group,instance.transform);this.root.add(group);this.groups.set(instance.id,group);for(const p of a.parts){const object=new THREE.Group();object.userData={partId:p.id,assetId:a.id};object.matrixAutoUpdate=false;object.matrix.copy(partMatrix(p.transform,p.pivot));group.add(object);const direct=this.liveStudio&&implicitStamp(p,library.materials);
 if(direct){object.add(this.implicit.mesh(direct,library.materials.find(m=>m.id===direct.materialId)));this.implicitCount++;continue;}
 const key=a.id+':'+p.id,geometry=this.cache.get(key);if(geometry){const mesh=new THREE.Mesh(geometry,this.material);mesh.userData.surfaceKey=key;object.add(mesh);}}}this.setGround(library.materials.find(m=>m.id===library.world.groundMaterialId));}
 applyPhysics(physics){for(const [id,group]of this.groups){group.updateMatrix();const inverse=group.matrix.clone().invert();for(const object of group.children){const body=physics.get(id,object.userData.partId);if(body)object.matrix.copy(inverse).multiply(body.matrix);}}}
 animate(time,playing){for(const group of this.groups.values()){const a=this.library.assets.find(a=>a.id===group.userData.assetId);for(const obj of group.children){const p=a.parts.find(p=>p.id===obj.userData.partId);if(this.gizmo.dragging&&this.gizmo.object===obj)continue;obj.matrix.copy(partMatrix(playing?sampleTrack(p,time%a.duration):p.transform,p.pivot));}}}
 attach(instanceId,partId,tool){this.gizmo.detach();if(!['translate','rotate','scale'].includes(tool))return;const group=this.groups.get(this.mode==='asset'?'editor':instanceId);if(!group)return;const obj=this.mode==='asset'?group.children.find(p=>p.userData.partId===partId):group;if(!obj)return;
 if(this.mode==='asset'){obj.matrix.decompose(obj.position,obj.quaternion,obj.scale);}this.gizmo.setMode(tool);this.gizmo.setSpace(this.mode==='asset'?'local':'world');this.gizmo.attach(obj);}
 ray(event){const rect=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);this.scene.updateMatrixWorld(true);this.assetScene.updateMatrixWorld(true);this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster.ray;}
 pick(event,{optimized=this.fastPicking===true}={}){const ray=this.ray(event);let nearest=null;const local=new THREE.Ray(),inverse=new THREE.Matrix4(),p=new THREE.Vector3(),normal=new THREE.Vector3(),delta=new THREE.Vector3(),worldScratch=new THREE.Vector3(),bounds=new THREE.Sphere();for(const group of this.groups.values())for(const part of group.children){const mesh=part.children[0];
 if(mesh?.userData.implicit){const hit=intersectImplicit(ray,mesh);if(hit){const distance=ray.origin.distanceTo(hit.point);
  if(!nearest||distance<nearest.distance)nearest={...hit,distance,partId:part.userData.partId,instanceId:group.userData.instanceId,assetId:group.userData.assetId};}continue;}
 const key=group.userData.assetId+':'+part.userData.partId,s=this.surfaces.get(key);if(!s)continue;inverse.copy(part.matrixWorld).invert();local.copy(ray).applyMatrix4(inverse);const tolerance=s.spacing*1.25;if(optimized){const geometry=this.cache.get(key);if(geometry?.boundingSphere){bounds.copy(geometry.boundingSphere);bounds.radius+=tolerance;if(!local.intersectsSphere(bounds))continue;}}
 for(let i=0;i<s.positions.length;i+=3){p.fromArray(s.positions,i);const t=(optimized?delta.copy(p):p.clone()).sub(local.origin).dot(local.direction);if(t<0||local.distanceSqToPoint(p)>tolerance*tolerance)continue;const world=(optimized?worldScratch.copy(p):p.clone()).applyMatrix4(part.matrixWorld),distance=world.distanceTo(ray.origin);if(nearest&&distance>=nearest.distance)continue;normal.fromArray(s.normals,i).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(part.matrixWorld));nearest={point:world.clone(),normal:normal.clone(),distance,partId:part.userData.partId,instanceId:group.userData.instanceId,localPoint:p.clone(),assetId:group.userData.assetId};}}
 const ground=this.sea?this.waterHit(ray):ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());if(ground&&(!nearest||ground.distanceTo(ray.origin)<nearest.distance))nearest={point:ground,normal:new THREE.Vector3(0,1,0),distance:ground.distanceTo(ray.origin),ground:true};return nearest;}
 waterHit(ray){
  if(Math.abs(ray.direction.y)<1e-6)return null;
  const t=-ray.origin.y/ray.direction.y,span=5/Math.abs(ray.direction.y);
  let lo=Math.max(0,t-span),hi=Math.min(this.camera.far,t+span);
  if(hi<lo)return null;
  const delta=t=>{const p=ray.at(t,new THREE.Vector3());return p.y-this.sea.height(p.x,p.z);};
  const sign=Math.sign(delta(lo));if(Math.sign(delta(hi))===sign)return null;
  for(let i=0;i<15;i++){const mid=(lo+hi)/2;if(Math.sign(delta(mid))===sign)lo=mid;else hi=mid;}
  return ray.at((lo+hi)/2,new THREE.Vector3());
 }
 localPoint(point,partId){const obj=this.groups.get('editor')?.children.find(p=>p.userData.partId===partId);return obj?obj.worldToLocal(point.clone()).toArray():point.toArray();}
 showForce(from,to){this.forceLine.visible=!!from;if(from){const p=this.forceLine.geometry.attributes.position;p.setXYZ(0,...from.toArray());p.setXYZ(1,...to.toArray());p.needsUpdate=true;}}
 showBrush(hit,size){this.brush.visible=!!hit;if(hit){this.brush.position.copy(hit.point);this.brush.scale.setScalar(size);}}
 focus(mode='world'){this.controls.target.set(0,1,0);this.camera.position.set(...(mode==='asset'?[4,3,5]:[8,5,10]));this.controls.update();}
 draw(){if(this.failed)throw Error('Studio graphics context lost; stopped.');this.controls.update();if(this.liveStudio){
 this.ground.visible=!this.sea;this.uniforms.clipFloor.value=this.sea?-1e10:0;
 if(this.sea)this.oceanView.update(this.sea,this.camera,this.library.materials.find(m=>m.id===this.library.world.groundMaterialId));else this.oceanView.show(false);
 }if(this.implicitCount){this.assetScene.updateMatrixWorld(true);this.implicit.update();}this.ground.position.set(this.camera.position.x,0,this.camera.position.z);this.scene.updateMatrixWorld(true);this.renderer.autoClear=true;this.renderer.render(this.scene,this.camera);this.renderer.autoClear=false;
 this.assetScene.overrideMaterial=this.depthMaterial;this.renderer.render(this.assetScene,this.camera);this.assetScene.overrideMaterial=null;this.renderer.render(this.assetScene,this.camera);}
 dispose(){this.oceanView?.dispose();this.implicit?.dispose();this.forceLine.geometry.dispose();this.forceLine.material.dispose();this.resizeObserver.disconnect();this.controls.dispose();this.gizmo.dispose();for(const g of this.cache.values())g.dispose();this.material.dispose();this.depthMaterial.dispose();this.ground.geometry.dispose();this.groundMaterial.dispose();this.brush.geometry.dispose();this.brush.material.dispose();this.renderer.dispose();}
}
