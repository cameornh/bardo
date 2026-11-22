import * as THREE from 'three';
import {medium} from './water-optics.js';

export class WaterCapture{
 constructor(uniforms,lighting){
  this.source=new THREE.WebGLRenderTarget(1,1);
  this.source.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.mirror=new THREE.WebGLRenderTarget(1,1);
  this.bulk=new THREE.WebGLRenderTarget(1,1);this.bulk.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.camera=new THREE.PerspectiveCamera();
  this.lastCamera=new THREE.Matrix4();this.lastProjection=new THREE.Matrix4();this.nextReflection=-Infinity;this.frame=0;this.mirrorFrame=-2;this.direction=new THREE.Vector3();this.clearColor=new THREE.Color();
  this.u=uniforms;this.bounds=new THREE.Box3();this.partBounds=new THREE.Box3();
  Object.assign(uniforms,{
   boundsMin:{value:new THREE.Vector3()},boundsMax:{value:new THREE.Vector3()},skyColor:{value:new THREE.Color()},bulkDepth:{value:this.bulk.depthTexture},bulkColor:{value:this.bulk.texture},
   sceneColor:{value:this.source.texture},sceneDepth:{value:this.source.depthTexture},
   mirrorColor:{value:this.mirror.texture},mirrorVP:{value:new THREE.Matrix4()},
   viewport:{value:new THREE.Vector2()},inverseProjection:{value:new THREE.Matrix4()},
   submerged:{value:0},absorption:{value:0},scattering:{value:.05},ior:{value:1.333},opacity:{value:.45}
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  this.copy=new THREE.Mesh(geometry,new THREE.ShaderMaterial({uniforms,depthFunc:THREE.AlwaysDepth,
   vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:lighting+medium+`uniform float submerged;uniform sampler2D bulkDepth,bulkColor;
   void main(){vec2 uv=gl_FragCoord.xy/viewport;float d=texture2D(sceneDepth,uv).r;
    vec3 c=texture2D(sceneColor,uv).rgb;
    if(submerged>.5)c=inWater(c,length(viewPoint(uv,d)));
    float wd=texture2D(bulkDepth,uv).r;if(wd<d){c=texture2D(bulkColor,uv).rgb;d=wd;}
    gl_FragDepth=d;gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`}));
  this.copy.frustumCulled=false;this.copyScene=new THREE.Scene();this.copyScene.add(this.copy);
 }
 render(view,mirrorOnly=false){
  const {renderer:r,camera,sea}=view,u=this.u;
  camera.updateMatrixWorld();r.getDrawingBufferSize(u.viewport.value);
  const {x:w,y:h}=u.viewport.value;
  const resized=this.mirror.width!==Math.ceil(w*.5)||this.mirror.height!==Math.ceil(h*.5);
  if(!mirrorOnly){this.source.setSize(w,h);this.bulk.setSize(sea?w:1,sea?h:1);}
  this.mirror.setSize(Math.max(1,Math.ceil(w*.5)),Math.max(1,Math.ceil(h*.5)));
  u.inverseProjection.value.copy(camera.projectionMatrixInverse);
  u.submerged.value=Number(!!sea&&camera.position.y<sea.height(camera.position.x,camera.position.z));
  // Only trace transmission where the refracted ray can reach authored geometry.
  // Sparse infinite ocean otherwise has a constant-cost deep-water solution.
  this.bounds.makeEmpty();view.assetScene.updateMatrixWorld(true);
  if(sea)for(const group of view.groups.values())for(const part of group.children)for(const surface of part.children){
   if(!part.visible||!surface.visible)continue;
   if(surface.userData.implicit){this.partBounds.min.setScalar(-1);this.partBounds.max.setScalar(1);}
   else if(surface.geometry?.boundingBox)this.partBounds.copy(surface.geometry.boundingBox);
   else continue;
   this.bounds.union(this.partBounds.applyMatrix4(surface.matrixWorld));
  }
  if(sea)for(const {pieces} of view.sectionView?.meshes.values()||[])for(const mesh of pieces.values()){
   if(mesh.visible&&mesh.geometry.boundingBox)this.bounds.union(this.partBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
  }
  if(sea)for(const batch of view.paintView?.batches||[]){
   this.bounds.union(this.partBounds.copy(batch.mesh.geometry.boundingBox).applyMatrix4(batch.mesh.matrix));
  }
  // Authored proxies stay in place when loose material is released. Include its
  // moving world bounds so the transmission path still sees the sinking sand.
  if(sea&&view.activePhysics)for(const mesh of view.matterView.meshes.values()){
   if(mesh.visible&&mesh.layers.isEnabled(0)){
    this.partBounds.min.setScalar(-1);this.partBounds.max.setScalar(1);
    this.bounds.union(this.partBounds.applyMatrix4(mesh.matrixWorld));
   }
  }
  if(this.bounds.isEmpty()){u.boundsMin.value.setScalar(1);u.boundsMax.value.setScalar(-1);}
  else{this.bounds.expandByScalar(.08);u.boundsMin.value.copy(this.bounds.min);u.boundsMax.value.copy(this.bounds.max);}
  const output=r.getRenderTarget(),alpha=r.getClearAlpha();r.getClearColor(this.clearColor);u.skyColor.value.copy(this.clearColor);
  // Wave slopes distort the reflection every presentation. The underlying view
  // of the objects only needs refreshing on camera motion or at 24 Hz.
  const changed=resized||this.lastSea!==sea||!camera.matrixWorld.equals(this.lastCamera)||!camera.projectionMatrix.equals(this.lastProjection);
  this.frame++;
  if(!u.submerged.value&&(changed||this.nextReflection===-Infinity||
   (this.frame-this.mirrorFrame>=2&&performance.now()>=this.nextReflection))){
   this.mirrorFrame=this.frame;
   this.lastSea=sea;this.lastCamera.copy(camera.matrixWorld);this.lastProjection.copy(camera.projectionMatrix);
   this.nextReflection=performance.now()+1000/24;
   const c=this.camera;c.projectionMatrix.copy(camera.projectionMatrix);c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
   c.position.copy(camera.position);c.position.y*=-1;
   camera.getWorldDirection(this.direction);this.direction.y*=-1;
   c.up.set(0,1,0).applyQuaternion(camera.quaternion);c.up.y*=-1;
   c.lookAt(this.direction.add(c.position));c.updateMatrixWorld();
   u.mirrorVP.value.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
   r.setRenderTarget(this.mirror);r.setClearColor(0,0);
   view.uniforms.viewport.value.set(this.mirror.width,this.mirror.height);
   view.uniforms.cameraWorld.value=c.matrixWorld;
   view.uniforms.clipFloor.value=-.012;u.clipWaves.value=!!sea;
   const patch=view.groundEdits?.patch,hadPatch=patch?.visible;if(patch)patch.visible=false;
   const floor=view.ground.visible;view.ground.visible=false;view.drawObjects(c);view.ground.visible=floor;if(patch)patch.visible=hadPatch;
  }
  r.setClearColor(this.clearColor,alpha);r.setRenderTarget(mirrorOnly?output:this.source);
  view.uniforms.viewport.value.copy(u.viewport.value);
  view.uniforms.cameraWorld.value=camera.matrixWorld;
  view.uniforms.clipFloor.value=-1e10;u.clipWaves.value=false;
  if(mirrorOnly)return;
  view.drawObjects(camera);
  const ocean=view.oceanView;
  r.setRenderTarget(this.bulk);ocean.parcels.mesh.visible=false;
  r.autoClear=true;if(sea)r.render(view.waterScene,camera);else r.clear();ocean.parcels.mesh.visible=!!sea;
  r.setRenderTarget(output);r.autoClear=true;r.render(this.copyScene,camera);r.autoClear=false;
  if(sea&&ocean.parcels.mesh.count){
   ocean.mesh.visible=false;r.render(view.waterScene,camera);ocean.mesh.visible=true;
  }
  if(sea)r.render(ocean.effectsScene,camera);
  if(view.visibleLiquid){
   const mask=camera.layers.mask;camera.layers.set(1);
   r.render(view.scene,camera);r.render(view.assetScene,camera);camera.layers.mask=mask;
  }
 }
 dispose(){this.source.dispose();this.mirror.dispose();this.bulk.dispose();this.copy.geometry.dispose();this.copy.material.dispose();}
}
