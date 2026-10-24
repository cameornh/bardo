import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {rotate} from './water-lab-model.js';

// Only the beach heightfield, <=16 analytical rigid bodies, player and bounds.
// No carved-sand CSG, neighbor loops, material rendering, or scene shader code.
// The contact-count uniform deliberately avoids scene program specialization,
// so adding/removing the first body never recompiles these compute kernels.
export const PRESSURE_GEOMETRY_SHADER=`precision highp float;precision highp int;
uniform sampler2D uPositions,uTerrain,uBodies;uniform int uCount,uN,uContactCount;
uniform vec2 uCell;uniform vec4 uPlayer;uniform float uPlayerHeight,uSpacing;
uniform bool uProject;out vec4 result;
vec4 weights(float u){float u2=u*u,u3=u2*u;return vec4(1.-3.*u+3.*u2-u3,3.*u3-6.*u2+4.,-3.*u3+3.*u2+3.*u+1.,u3)/6.;}
float terrain(vec2 p){
 vec2 at=clamp((p+vec2(5.5,4.9))/uCell,vec2(0),vec2(float(uN-1))),f=fract(at);ivec2 cell=ivec2(floor(at));vec4 wx=weights(f.x),wz=weights(f.y);float h=0.;
 for(int z=0;z<4;z++)for(int x=0;x<4;x++)h+=texelFetch(uTerrain,clamp(cell+ivec2(x-1,z-1),ivec2(0),ivec2(uN-1)),0).r*wx[x]*wz[z];return h;
}
float solid(vec3 p){
 float d=(p.y-terrain(p.xz))*.65;
 for(int i=0;i<uContactCount;i++){
  vec4 pr=texelFetch(uBodies,ivec2(0,i),0),ax=texelFetch(uBodies,ivec2(1,i),0);vec3 q=p-pr.xyz;float r=pr.w,bound=d+r*1.5;
  if(bound<=0.||dot(q,q)>=bound*bound)continue;float v;
  if(ax.w<.5)v=length(q)-r;
  else{vec3 local=vec3(dot(ax.xyz,q),dot(texelFetch(uBodies,ivec2(2,i),0).xyz,q),dot(texelFetch(uBodies,ivec2(3,i),0).xyz,q));float rad=length(local.xz),wall=r*.16;
   v=min(max(abs(rad-r*.84)-wall,abs(local.y)-r),max(rad-r,abs(local.y+r)-wall));}
  d=min(d,v);
 }
 if(uPlayer.w>0.){vec3 q=p-uPlayer.xyz;q.y-=clamp(q.y,0.,uPlayerHeight);d=min(d,length(q)-uPlayer.w);}
 return min(d,min(5.5-abs(p.x),min(4.9-abs(p.z),9.-p.y)));
}
vec4 metric(vec3 p,float reach){
 float d=solid(p);if(d>=reach)return vec4(0,0,0,d);float e=.003;
 vec3 g=vec3(solid(p+vec3(e,0,0))-solid(p-vec3(e,0,0)),solid(p+vec3(0,e,0))-solid(p-vec3(0,e,0)),solid(p+vec3(0,0,e))-solid(p-vec3(0,0,e)))/(2.*e);
 float m=max(.05,length(g));return vec4(g,d)/m;
}
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int i=uv.y*64+uv.x;if(i>=uCount){result=vec4(0);return;}vec4 p=texelFetch(uPositions,uv,0);
 if(uProject){if(p.w>.5){result=p;return;}float skin=uSpacing*.12;for(int k=0;k<3;k++){vec4 m=metric(p.xyz,skin);if(m.w>=skin)break;p.xyz+=m.xyz*(skin-m.w);}result=p;return;}
 float h=uSpacing*2.;vec4 m=metric(p.xyz,h);float q=clamp(m.w/h,0.,1.),q2=q*q,rho=.5-315./256.*q*(1.-q2*(4./3.-q2*(6./5.-q2*(4./7.-q2/9.)))),a=1.-q2,a2=a*a,f=rho>1e-6?-315./(256.*h)*a2*a2:0.;result=vec4(m.xyz*f,rho);
}`;

export function canUsePressureGeometry(lab){return !!lab?.sand&&lab.kind==='ocean'&&lab.optimizations?.terrainCache!==false&&lab.u?.uSandCount?.value===0&&lab.balls.length<=16;}

export class PressureGeometryGPU {
 constructor(){
  this.u={uPositions:{value:null},uTerrain:{value:null},uBodies:{value:null},uCount:{value:0},uN:{value:0},uContactCount:{value:0},uCell:{value:new THREE.Vector2()},uPlayer:{value:new THREE.Vector4()},uPlayerHeight:{value:0},uSpacing:{value:0},uProject:{value:false}};
  const material=(name,project)=>{const m=new THREE.ShaderMaterial({name,glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:PRESSURE_GEOMETRY_SHADER,uniforms:{...this.u,uProject:{value:project}},depthTest:false,depthWrite:false,blending:THREE.NoBlending});m.userData.skipObjectWarmup=true;return m;};
  this.boundary=material('bounded-pressure-boundary',false);this.project=material('bounded-pressure-projection',true);
  this.bodyData=new Float32Array(16*16);this.bodies=new THREE.DataTexture(this.bodyData,4,16,THREE.RGBAFormat,THREE.FloatType);this.u.uBodies.value=this.bodies;
 }
 prepare(lab,n,spacing){
  if(!canUsePressureGeometry(lab))throw Error('Complex geometry requires CPU contacts.');
  const s=lab.sand;if(this.n!==s.n){this.terrain?.dispose();this.n=s.n;this.terrainData=new Float32Array(s.n*s.n);this.terrain=new THREE.DataTexture(this.terrainData,s.n,s.n,THREE.RedFormat,THREE.FloatType);this.u.uTerrain.value=this.terrain;}
  this.terrainData.set(lab.terrainHeights);this.terrain.needsUpdate=true;this.u.uCell.value.set(s.dx,s.dz);this.u.uN.value=s.n;
  this.bodyData.fill(0);lab.balls.forEach((b,i)=>{const axes=[[1,0,0],[0,1,0],[0,0,1]].map(p=>rotate(p,b.tilt||0,b.spin||0,true,b.pitch||0)),o=i*16;this.bodyData.set([...b.position,b.radius],o);
   for(let row=0;row<3;row++)this.bodyData.set([axes[0][row],axes[1][row],axes[2][row],row===0&&b.shape==='cup'?1:0],o+4+row*4);
  });this.bodies.needsUpdate=true;this.u.uContactCount.value=lab.balls.length;
  this.u.uPlayer.value.set(...(lab.player?.base||[0,0,0]),lab.player?.radius||0);this.u.uPlayerHeight.value=lab.player?.height||0;this.u.uCount.value=n;this.u.uSpacing.value=spacing;
 }
 dispose(){this.terrain?.dispose();this.bodies.dispose();this.boundary.dispose();this.project.dispose();}
}
