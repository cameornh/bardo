import * as THREE from 'three';
import {LabBlobRenderer} from '../src/sand-lab/water-lab-blob-renderer.js';

// Render the production fine-water shader against an analytic, three-unit
// deep slab. Its path length has a closed-form reference and must not be
// truncated to the old 100 tiny steps (0.9 units at this spacing).
export function verifyJoinedWaterOptics(renderer){
 const texture=depth=>{const t=new THREE.DataTexture(new Float32Array([0,0,0,depth]),1,1,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;};
 const background=texture(1e4),bulk=texture(2),camera=new THREE.PerspectiveCamera(45,1,.01,100);
 camera.position.set(0,2,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const u={uEye:{value:camera.position},uResolution:{value:new THREE.Vector2(4,4)},uSpacing:{value:.2},uImage:{value:background},uBulkWater:{value:bulk},uBlobDepth:{value:true},uProjection:{value:camera.projectionMatrix},uViewMatrix:{value:camera.matrixWorldInverse}};
 const common=`
 uniform vec3 uEye;uniform vec2 uResolution;uniform float uSpacing;
 uniform sampler2D uImage;uniform mat4 uProjection,uViewMatrix;
 const float PARCEL_ISO=.18,WATER_IOR=1.333;
 vec3 rayAt(vec2 uv){return vec3(0,-1,0);}
 float rho(vec3 p){return p.y<=0.&&p.y>=-3.?.25:0.;}
 vec4 parcelSample(vec3 p){float d=rho(p);return vec4(d,d*.4,0,0);}
 vec3 fluidGradient(vec3 p){return vec3(0);}
 vec3 shadeWater(vec3 p,vec3 n,vec3 ray,float path,vec3 c){return vec3(path,c.x,n.y);}
 `;
 const view=new LabBlobRenderer(u,common),data=view.texture.image.data;
 for(let i=0;i<5;i++)data.set([0,.12,0,.12],i*4);
 data[20]=.3;data[28]=.4;view.texture.needsUpdate=true;
 view.geometry.getAttribute('aParcel').array.set([0,0,0,4]);view.geometry.getAttribute('aParcel').needsUpdate=true;view.geometry.instanceCount=1;
 const target=new THREE.WebGLRenderTarget(4,4,{type:THREE.FloatType}),old=renderer.getRenderTarget(),clear=new THREE.Color(),alpha=renderer.getClearAlpha();renderer.getClearColor(clear);
 try{
  renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(view.scene,camera);
  const pixels=new Float32Array(64);renderer.readRenderTargetPixels(target,0,0,4,4,pixels);
  const expected=3+.12+.12*Math.sqrt(2*Math.log(.3/.18)),path=pixels[0],concentration=pixels[1],normal=pixels[2];
  return {pass:Math.abs(path-expected)<.04&&Math.abs(concentration-.4)<1e-5&&normal>.999,path,expected,concentration,normal};
 }finally{
  renderer.setRenderTarget(old);renderer.setClearColor(clear,alpha);
  for(const x of [background,bulk,target,view.texture,view.geometry,view.material])x.dispose();
 }
}
