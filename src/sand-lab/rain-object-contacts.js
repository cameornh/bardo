import * as THREE from 'three';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';
import {QUAD_VERTEX} from '../shaders.js';
import {bodyRayHit,BODY_RAY_GLSL} from './body-ray.js';
export const RAIN_OBJECT_HEIGHT_GLSL=`
${BODY_RAY_GLSL}
vec2 rainBodyHeight(vec2 xz){float top=-100.,index=-1.;
 for(int i=0;i<uBodyCount;i++){
  vec4 b=labBody(i);float r=b.w*1.55;if(length(xz-b.xz)>r)continue;float y=b.y+r;
  float travel=bodyRayHit(vec3(xz.x,y,xz.y),vec3(0,-1,0),i,r*2.,0.);y-=travel;if(travel<1e20&&y>top){top=y;index=float(i);}
 }return vec2(top,index);
}`;
export function rainBodyHeight(x,z,bodies){let top=-100,index=-1;
 bodies.forEach((b,i)=>{const r=b.radius*1.55;if(Math.hypot(x-b.position[0],z-b.position[2])>r)return;const y=b.position[1]+r,travel=bodyRayHit([x,y,z],[0,-1,0],b,r*2,0);if(Number.isFinite(travel)&&y-travel>top){top=y-travel;index=i;}});return [top,index];
}
// World-space first-hit map is GPU compute, shared by every visual raindrop.
// No camera-driven collision decisions. CPU reference above validates the map.
export class RainObjectContacts {
 constructor(renderer,u){this.renderer=renderer;this.target=new THREE.WebGLRenderTarget(192,192,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:u,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${LAB_GEOMETRY_GLSL}${RAIN_OBJECT_HEIGHT_GLSL}void main(){vec2 hit=rainBodyHeight((vUv-.5)*vec2(11.,9.8));outColor=vec4(hit,0,1);}`,depthTest:false,depthWrite:false});this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));this.texture=this.target.texture;this.backend="GPU";}
 update(lab){const cpu=!!lab.gpu?.cpu;const key=JSON.stringify([cpu,lab.balls.map(b=>[...b.position,b.radius,b.shape,b.tilt,b.spin,b.pitch])]);if(key===this.key)return;this.key=key;this.backend=cpu?'CPU reference':'GPU';
 if(cpu){const size=this.target.width;this.data??=new Float32Array(size*size*4);this.cpuTexture??=new THREE.DataTexture(this.data,size,size,THREE.RGBAFormat,THREE.FloatType);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const hit=rainBodyHeight(((x+.5)/size-.5)*11,((y+.5)/size-.5)*9.8,lab.balls),o=(y*size+x)*4;this.data[o]=hit[0];this.data[o+1]=hit[1];this.data[o+3]=1;}this.cpuTexture.needsUpdate=true;this.texture=this.cpuTexture;return;}
 this.texture=this.target.texture;const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);}
}
