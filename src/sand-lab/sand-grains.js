import * as THREE from 'three';
import {QUAD_VERTEX,SH_GLSL} from '../shaders.js';
import {floatTexture} from './uniforms.js';
import {SAND_AIR_GLSL,createSandWind} from './sand-air.js';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';
import {grainStep,GRAIN_MOTION_GLSL} from './sand-grain-motion.js';
import {grainBirth,sandParticleMaterial} from './particulate-material.js';
import {DETAIL_FLOW_GLSL} from './water-lab-detail-environment.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
const WIDTH=64,CAPACITY=8192,HEIGHT=CAPACITY/WIDTH;
const kernel=`precision highp float;precision highp int;
layout(location=0)out vec4 outP;layout(location=1)out vec4 outV;
uniform sampler2D uGrainP,uGrainV,uSpawnP,uSpawnV,uGrainInfo;uniform bool uDetailFlow;uniform float uGrainDt,uGrainScale;
${LAB_GEOMETRY_GLSL}${SAND_AIR_GLSL}${GRAIN_MOTION_GLSL}${DETAIL_FLOW_GLSL}
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 spawn=texelFetch(uSpawnP,uv,0);outP=texelFetch(uGrainP,uv,0);outV=texelFetch(uGrainV,uv,0);
if(spawn.w>0.){outP=spawn;outV=texelFetch(uSpawnV,uv,0);}if(outP.w<=0.)return;
float dt=min(uGrainDt,max(0.,outV.w-outP.w+uGrainDt));outP.w-=uGrainDt;if(dt<=0.)return;
vec4 info=texelFetch(uGrainInfo,uv,0),flow=uDetailFlow?detailFlowSample(outP.xyz):vec4(0);float wet=smoothstep(.08,.3,flow.x);
vec3 air=mix(sandAir(outP.xyz),flow.yzw/max(.001,flow.x),wet);
moveGrain(outP.xyz,outV.xyz,dt,air,uGrainScale,info.y*(1.+7.*wet),1.-wet*1000./info.w);
if(labPhysicalSolid(outP.xyz)<0.||abs(outP.x)>5.5||abs(outP.z)>4.9)outP.w=0.;}`;
const vertex=`precision highp float;precision highp int;
uniform sampler2D uGrainP,uGrainV,uGrainInfo;uniform vec2 uResolution;uniform vec3 uSH[16];uniform int uSHDegree;
uniform float uAmbient,uSunlight,uGrainScale,uTannins,uTurbidity;uniform vec3 uDaySun,uDayTint,uGrainAlbedo,uEye;
out vec2 vQ;out float vAlpha,vDepth;flat out vec3 vColor;
${SH_GLSL}
${LAB_FIELD_GLSL}
${SOLUTE_GLSL}
void main(){ivec2 uv=ivec2(gl_InstanceID%64,gl_InstanceID/64);vec4 source=texelFetch(uGrainP,uv,0),velocity=texelFetch(uGrainV,uv,0),p=viewMatrix*vec4(source.xyz,1);
vQ=position.xy*3.;vAlpha=0.;vDepth=length(p.xyz);vColor=vec3(0);if(source.w<=0.||source.w>=velocity.w||p.z>-.025){gl_Position=vec4(2,2,2,1);return;}
float seed=fract(sin(float(gl_InstanceID)*12.9898)*43758.5453),s=texelFetch(uGrainInfo,uv,0).x/uGrainScale,z=-p.z;
vec3 direction=normalize(mat3(viewMatrix)*velocity.xyz+vec3(0,1e-8,0)),jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z)),jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z));
float stretch=min(3.,length(velocity.xyz)*uGrainScale*.08),xx=s*s*(dot(jx,jx)+stretch*pow(dot(jx,direction),2.)),xy=s*s*(dot(jx,jy)+stretch*dot(jx,direction)*dot(jy,direction)),yy=s*s*(dot(jy,jy)+stretch*pow(dot(jy,direction),2.));
float area=sqrt(max(0.,xx*yy-xy*xy));xx+=.65/(uResolution.x*uResolution.x);yy+=.65/(uResolution.y*uResolution.y);
float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-12,(xx+yy)*.5+l),e2=max(1e-12,(xx+yy)*.5-l);vec2 axis=abs(xy)>1e-12?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
vec4 clip=projectionMatrix*p;clip.xy+=3.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)*clip.w;gl_Position=clip;
float age=velocity.w-source.w;vAlpha=.48*smoothstep(0.,.08,age)*smoothstep(0.,.7,source.w)*min(1.,area/sqrt(max(1e-20,xx*yy-xy*xy)))*smoothstep(.04,.18,z);
float b[16];basisSH(vec3(0,1,0),b);vec3 sky=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;sky+=uSH[i]*b[i]*(i==0?1.:i<4?2./3.:i<9?.25:0.);}
// A grain receives light over all faces, rather than acting like an upward
// leaf. Include a modest sandy-ground bounce; never add unlit blue emission.
vec3 ambient=max(vec3(0),mix(sky,uSH[0]*.282095,.65))*uAmbient;
vec3 direct=uDayTint*uSunlight*(.34+.48*max(0.,uDaySun.y));
vec3 bounce=uGrainAlbedo*uDayTint*uSunlight*max(0.,uDaySun.y)*.25;
vColor=uGrainAlbedo*(.8+.4*seed)*texelFetch(uGrainInfo,uv,0).z*(ambient+direct+bounce);
// Submerged grains attenuate along occupied water only. A few samples are
// enough for these tiny tracers; the bulk water still owns refraction.
vec3 ray=source.xyz-uEye,tau=vec3(0),scatter=vec3(0);
for(int i=0;i<4;i++){vec4 a=parcelSample(uEye+ray*(float(i)+.5)/4.);float ds=smoothstep(.12,.24,a.x)*length(ray)*uGrainScale/4.;vec3 c=a.yzw/max(.001,a.x),ext=soluteExtinction(c,uTannins,uTurbidity),trans=exp(-ext*ds);scatter+=exp(-tau)*soluteScatter(c,uTannins,uTurbidity)/max(ext,vec3(.00001))*(1.-trans)*(ambient+direct);tau+=ext*ds;}
vColor=vColor*exp(-tau)+scatter;
}`;
const fragment=`precision highp float;in vec2 vQ;in float vAlpha,vDepth;flat in vec3 vColor;out vec4 outColor;
uniform sampler2D uOpaqueRead;uniform vec2 uResolution;
void main(){vec2 uv=gl_FragCoord.xy/uResolution;if(vDepth>texture(uOpaqueRead,uv).a)discard;
float a=vAlpha*exp(-.5*dot(vQ,vQ));if(a<.0003)discard;outColor=vec4(vColor*a,a);}`;
export class SandGrains{
 constructor(renderer,lab,uniforms){
  this.renderer=renderer;this.lab=lab;this.enabled=true;this.capacity=CAPACITY;this.cursor=0;this.clock=0;this.emitted=0;
  this.info=new Float32Array(CAPACITY*4);this.infoTexture=floatTexture(this.info,WIDTH,HEIGHT);
  this.p=new Float32Array(CAPACITY*4);this.v=this.p.slice();this.spawnP=this.p.slice();this.spawnV=this.p.slice();
  this.inputP=floatTexture(this.p,WIDTH,HEIGHT);this.inputV=floatTexture(this.v,WIDTH,HEIGHT);this.birthP=floatTexture(this.spawnP,WIDTH,HEIGHT);this.birthV=floatTexture(this.spawnV,WIDTH,HEIGHT);
  this.u={...uniforms,...lab.air.uniforms,...lab.detail.flow.u,uDetailFlow:lab.detail.u.uDetailFlow,uGrainInfo:{value:this.infoTexture},uGrainAlbedo:{value:new THREE.Vector3(...sandParticleMaterial().albedo)},uAirTime:{value:0},uSandBrushPoint:{value:new THREE.Vector3()},uSandBrushNormal:{value:new THREE.Vector3(0,1,0)},uSandBrushDistance:{value:-1},uGrainP:{value:this.inputP},uGrainV:{value:this.inputV},uSpawnP:{value:this.birthP},uSpawnV:{value:this.birthV},uGrainDt:{value:0},uGrainScale:{value:lab.spec.scale}};
  this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(WIDTH,HEIGHT,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));this.index=0;
  this.quad=new THREE.PlaneGeometry(2,2);this.compute=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:kernel,uniforms:this.u,depthTest:false,depthWrite:false});this.computeScene=new THREE.Scene();this.computeScene.add(new THREE.Mesh(this.quad,this.compute));this.camera=new THREE.Camera();
  this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);this.geometry.instanceCount=CAPACITY;
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 }
 reset(){this.p.fill(0);this.v.fill(0);this.info.fill(0);this.infoTexture.needsUpdate=true;this.inputP.needsUpdate=this.inputV.needsUpdate=true;this.u.uGrainP.value=this.inputP;this.u.uGrainV.value=this.inputV;this.clock=0;this.emitted=0;this.until=0;}
 get active(){return this.emitted>0&&this.clock<=(this.until||0);}
 advance(dt){const lab=this.lab,cpu=lab.gpu.cpu||!this.renderer.extensions.has('EXT_color_buffer_float');if(this.bed!==lab.sand||cpu!==this.cpu){this.reset();this.bed=lab.sand;this.cpu=cpu;}if(dt<=0)return;
  this.clock+=dt;this.spawnP.fill(0);this.spawnV.fill(0);const events=lab.sand.windEvents?.splice(0)||[];
  if(this.enabled)for(const e of events){const count=Math.min(192,Math.max(24,Math.round(Math.cbrt(e.amount)*lab.spec.scale*1100)));
   for(let j=0;j<count;j++){const i=this.cursor++%CAPACITY,o=i*4,b=grainBirth(e,j,lab.spec.scale);
    this.spawnP.set([...b.position,b.life+b.delay],o);this.spawnV.set([...b.velocity,b.life],o);
    this.info.set([b.radius,b.drag,b.albedo[0]/sandParticleMaterial().albedo[0],b.density],o);this.until=this.clock+3;this.emitted++;}}
  this.infoTexture.needsUpdate=events.length>0;
  if(this.clock>(this.until||0))return;
  this.u.uGrainScale.value=lab.spec.scale;this.u.uGrainDt.value=dt;const wind=lab.sandWind||createSandWind(lab),brush=wind.brush;this.u.uAirTime.value=wind.forcing?.time??lab.time;this.u.uSandBrushDistance.value=brush?.distance??-1;if(brush){this.u.uSandBrushPoint.value.fromArray(brush.point);this.u.uSandBrushNormal.value.fromArray(brush.normal);}
  if(cpu){for(let o=0;o<this.p.length;o+=4){if(this.spawnP[o+3]>0){this.p.set(this.spawnP.subarray(o,o+4),o);this.v.set(this.spawnV.subarray(o,o+4),o);}if(this.p[o+3]<=0)continue;
    const h=Math.min(dt,Math.max(0,this.v[o+3]-this.p[o+3]+dt));this.p[o+3]-=dt;if(h<=0)continue;
    const p=Array.from(this.p.subarray(o,o+3)),f=this.u.uDetailFlow.value?lab.detail.flow.sample(p):[0,0,0,0],t=Math.max(0,Math.min(1,(f[0]-.08)/.22)),wet=t*t*(3-2*t),air=wind(p).map((v,k)=>v*(1-wet)+f[k+1]/Math.max(.001,f[0])*wet),next=grainStep(p,Array.from(this.v.subarray(o,o+3)),h,air,lab.spec.scale,this.info[o+1]*(1+7*wet),1-wet*1000/this.info[o+3]);this.p.set(next.position,o);this.v.set(next.velocity,o);if(lab.solid(next.position,false,false)<0||Math.abs(next.position[0])>5.5||Math.abs(next.position[2])>4.9)this.p[o+3]=0;}
   this.inputP.needsUpdate=this.inputV.needsUpdate=true;return;}
  this.birthP.needsUpdate=this.birthV.needsUpdate=true;const old=this.renderer.getRenderTarget(),target=this.targets[this.index];this.renderer.setRenderTarget(target);this.renderer.render(this.computeScene,this.camera);this.renderer.setRenderTarget(old);this.u.uGrainP.value=target.textures[0];this.u.uGrainV.value=target.textures[1];this.index=1-this.index;
 }
 inspect(camera){
  const a=this.cpu?this.p:new Float32Array(CAPACITY*4);if(!this.cpu&&this.emitted)this.renderer.readRenderTargetPixels(this.targets[1-this.index],0,0,WIDTH,HEIGHT,a);
  let alive=0,nonFinite=0,onScreen=0;for(let o=0;o<a.length;o+=4){if(a[o+3]>0){alive++;if(camera){const p=new THREE.Vector3(...a.subarray(o,o+3)).project(camera);if(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1)onScreen++;}}for(let k=0;k<4;k++)if(!Number.isFinite(a[o+k]))nonFinite++;}
  let visiblePixels=0,maxAlpha=0;const radiance=[0,0,0];
  if(camera&&this.emitted){const r=this.renderer,size=this.u.uResolution.value,target=new THREE.WebGLRenderTarget(size.x,size.y,{type:THREE.FloatType,depthBuffer:false}),old=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha(),pixels=new Float32Array(size.x*size.y*4);
   try{r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(this.scene,camera);r.readRenderTargetPixels(target,0,0,size.x,size.y,pixels);for(let i=3;i<pixels.length;i+=4){if(pixels[i]>.01){visiblePixels++;for(let k=0;k<3;k++)radiance[k]+=pixels[i-3+k];}maxAlpha=Math.max(maxAlpha,pixels[i]);}}
   finally{r.setRenderTarget(old);r.setClearColor(color,alpha);target.dispose();}
  }
  return {alive,onScreen,visiblePixels,meanVisibleRadiance:radiance.map(v=>v/Math.max(1,visiblePixels)),maxAlpha,emitted:this.emitted,nonFinite,capacity:CAPACITY};
 }
 render(renderer,camera){if(this.enabled&&this.clock<=(this.until||0)&&this.emitted)renderer.render(this.scene,camera);}
 dispose(){for(const x of [this.inputP,this.inputV,this.birthP,this.birthV,this.infoTexture,...this.targets,this.quad,this.compute,this.geometry,this.material])x.dispose();}
}
export function verifySandGrains(renderer){
 const data=new Float32Array(32*4);for(let i=0;i<32;i++)data.set([i*.071-1,.2+i*.13,Math.sin(i)*.4,1],i*4);
 const texture=floatTexture(data,32,1),target=new THREE.WebGLRenderTarget(32,1,{count:2,type:THREE.FloatType,depthBuffer:false});
 const uniforms={probe:{value:texture}},geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;uniform sampler2D probe;layout(location=0)out vec4 a;layout(location=1)out vec4 b;${GRAIN_MOTION_GLSL}void main(){vec3 p=texelFetch(probe,ivec2(gl_FragCoord.xy),0).xyz,v=vec3(.8,-.3,.2);float drag=.6+gl_FragCoord.x*.3,gravity=1.-mod(floor(gl_FragCoord.x),2.)*1000./2650.;moveGrain(p,v,.067,vec3(4,.2,-1),10.,drag,gravity);a=vec4(p,1);b=vec4(v,1);}`,uniforms,depthTest:false,depthWrite:false}),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const old=renderer.getRenderTarget(),a=data.slice(),b=data.slice();
 try{renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,32,1,a);renderer.readRenderTargetPixels(target,0,0,32,1,b,undefined,1);let maxError=0;
  for(let i=0;i<32;i++){const next=grainStep(Array.from(data.subarray(i*4,i*4+3)),[.8,-.3,.2],.067,[4,.2,-1],10,.6+(i+.5)*.3,1-(i%2)*1000/2650);for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(next.position[k]-a[i*4+k]),Math.abs(next.velocity[k]-b[i*4+k]));}
  return {samples:32,maxError,pass:maxError<2e-6};
 }finally{renderer.setRenderTarget(old);for(const x of [texture,target,geometry,material])x.dispose();}
}
