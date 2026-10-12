import * as THREE from 'three';
import { terrainCSG } from './terrain.js';
import { beachFeatures } from './beach-terrain.js';
import { sampleBeach } from './beach-sampling.js';
import { QUAD_VERTEX } from './shaders.js';
import { BEACH_WORLD_GLSL,BEACH_N,BEACH_DX,BEACH_DT,beachBed,rockHeight,solidHeight,initialCell,sandBrush,stepBeachReference } from './beach-model.js';
import { BodyTexture,BODY_GLSL } from './beach-bodies.js';

export const BEACH_STEP_FRAGMENT=`precision highp float;precision highp int;
uniform sampler2D uFlow,uAux,uBed,uOcean,uImpulses;uniform int uN;uniform float uDx,uDt,uClock,uWind,uWindAngle,uTurbulence;uniform bool uOpen,uPeriodic,uCoarse,uHasOcean;
uniform vec2 uOrigin;uniform vec4 uBrush,uJetOrigin,uJetDirection;uniform float uJetLength;
layout(location=0) out vec4 outFlow;layout(location=1) out vec4 outAux;
${BEACH_WORLD_GLSL}
${BODY_GLSL}
ivec2 indexAt(ivec2 p){return uPeriodic?ivec2(mod(vec2(p),float(uN))):clamp(p,ivec2(0),ivec2(uN-1));}
vec4 cell(ivec2 p,int axis){bool outside=any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(uN)));vec4 a=texelFetch(uFlow,indexAt(p),0);if(outside&&!uOpen&&!uPeriodic){if(axis==1)a.y=-a.y;else a.z=-a.z;}return a;}
float bedAt(ivec2 p){p=indexAt(p);return texelFetch(uBed,p,0).r+texelFetch(uAux,p,0).w;}
vec3 flux(vec4 a,vec4 b,float ba,float bb,int axis){float top=max(ba,bb),ha=max(0.,a.x+ba-top),hb=max(0.,b.x+bb-top),ua=a.x>.0001?(axis==1?a.y:a.z)/a.x:0.,ub=b.x>.0001?(axis==1?b.y:b.z)/b.x:0.;
 vec3 A=vec3(ha,a.yz*ha/max(a.x,.0001)),B=vec3(hb,b.yz*hb/max(b.x,.0001));float c=max(abs(ua)+sqrt(9.81*ha),abs(ub)+sqrt(9.81*hb));vec3 f=(A*ua+B*ub)*.5-.5*c*(B-A);f+=(axis==1?vec3(0,1,0):vec3(0,0,1))*2.4525*(ha*ha+hb*hb);return f;}
vec3 air(vec2 p,float y){return vec3(beachWind(p,uClock,uWind,uWindAngle,uTurbulence).x,0,beachWind(p,uClock,uWind,uWindAngle,uTurbulence).y)+windJet(vec3(p.x,y,p.y),uJetOrigin,uJetDirection,uJetLength);}
float pressure(vec2 p,float y){vec3 jet=windJet(vec3(p.x,y,p.y),uJetOrigin,uJetDirection,uJetLength);return windPressure(p,uClock,uWind,uWindAngle,uTurbulence)+.001225*jet.y*jet.y+.0003*dot(jet,jet)*uTurbulence*(windNoise(p*.5-vec2(uClock*1.7,uClock*.9))-.5);}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 a=cell(p,1),aux=texelFetch(uAux,p,0);float b=bedAt(p);vec3 result=a.xyz;
 for(int j=0;j<4;j++){ivec2 offset=j==0?ivec2(1,0):j==1?ivec2(-1,0):j==2?ivec2(0,1):ivec2(0,-1);int axis=j<2?1:2;float sign=j%2==0?1.:-1.;vec4 A=cell(p,axis),B=cell(p+offset,axis);float bn=bedAt(p+offset);vec3 f=sign>0.?flux(A,B,b,bn,axis):flux(B,A,bn,b,axis);float height=max(0.,A.x+b-max(b,bn));f+=(axis==1?vec3(0,1,0):vec3(0,0,1))*(.5*9.81*(a.x*a.x-height*height));result-=sign*uDt/uDx*f;}
 result.x=max(0.,result.x);vec2 world=uOrigin+(vec2(p)+.5)*uDx;vec3 wind3=air(world,b+result.x);vec2 wind=wind3.xz;
 vec2 dp=vec2(pressure(world+vec2(uDx,0),b+result.x)-pressure(world-vec2(uDx,0),b+result.x),pressure(world+vec2(0,uDx),b+result.x)-pressure(world-vec2(0,uDx),b+result.x))/(2.*uDx);
 vec3 jetAir=windJet(vec3(world.x,b+result.x,world.y),uJetOrigin,uJetDirection,uJetLength);float jetSpeed=length(jetAir.xz);result.yz=(result.yz+uDt*(.000003*wind*length(wind)+.0008*jetAir.xz*jetSpeed*min(1.,result.x/.12)-result.x*dp))/(1.+uDt*(.012+.04/max(result.x,.08)+.008*jetSpeed));
 if(uOpen&&uHasOcean&&b<0.){float border=float(min(min(p.x,p.y),min(uN-1-p.x,uN-1-p.y))),relax=clamp((10.-border)/10.,0.,1.)*uDt*4.;vec4 far=texture(uOcean,fract((world+256.)/512.));float h=max(0.,far.x-8.-b);result=mix(result,vec3(h,far.yz/max(far.x,.02)*h),relax);}
 vec4 impulse=texelFetch(uImpulses,p,0);result.x=max(0.,result.x+impulse.x);result.yz+=impulse.yz;
 vec2 relative=world-uBrush.xy;float weight=exp(-dot(relative,relative)/max(uBrush.z*uBrush.z,.001));result.yz+=relative*weight*uBrush.w*result.x*uDt*5.;
 vec2 target=wind*(.008*length(wind));float wake=0.;
 for(int j=0;j<uBallCount;j++){vec4 ball=body(j);vec2 d=world-ball.xz;float r=ball.w+.65,w=exp(-dot(d,d)/(r*r));float reach=clamp((b+1.4-ball.y+ball.w)*2.,0.,1.);target+=normalize(d+vec2(.001))*w*reach*1.4;
  float submerged=clamp((b+result.x-ball.y+ball.w)/(2.*ball.w),0.,1.);vec2 dv=bodyVelocity(j).xz-result.yz/max(result.x,.02);result.yz+=dv*w*submerged*uDt*.7;wake+=w*submerged*length(dv)*.15;}
 if(result.x<.002)result.yz=vec2(0);
 vec4 r=cell(p+ivec2(1,0),1),l=cell(p-ivec2(1,0),1),u=cell(p+ivec2(0,1),2),d=cell(p-ivec2(0,1),2);
 float slope=length(vec2(r.x+bedAt(p+ivec2(1,0))-l.x-bedAt(p-ivec2(1,0)),u.x+bedAt(p+ivec2(0,1))-d.x-bedAt(p-ivec2(0,1))))/(2.*uDx);
 float compression=max(0.,-((r.y/max(r.x,.02)-l.y/max(l.x,.02))+(u.z/max(u.x,.02)-d.z/max(d.x,.02)))/(2.*uDx));
 float speed=length(result.yz)/max(result.x,.02),breaking=max(0.,slope-.09)*speed*2.+max(0.,compression-.18)*.5;
 vec2 back=vec2(p)-a.yz/max(a.x,.02)*uDt/uDx;ivec2 ip=ivec2(floor(back));vec2 f=fract(back);float advected=mix(mix(cell(ip,1).w,cell(ip+ivec2(1,0),1).w,f.x),mix(cell(ip+ivec2(0,1),1).w,cell(ip+ivec2(1,1),1).w,f.x),f.y);
 float foam=clamp(advected*exp(-uDt*.32)+uDt*(breaking+wake)*min(1.,result.x*8.),0.,1.);
 float soil=aux.w;if(!uCoarse)for(int j=0;j<4;j++){ivec2 offset=j==0?ivec2(1,0):j==1?ivec2(-1,0):j==2?ivec2(0,1):ivec2(0,-1),neighbor=indexAt(p+offset);if(texelFetch(uBed,p,0).b>.5||texelFetch(uBed,neighbor,0).b>.5)continue;float diff=bedAt(neighbor)-b,wet=(aux.x+texelFetch(uAux,neighbor,0).x)*.5,repose=.55+.45*wet;float transfer=uDt*(1.8*(1.-wet)+.35*wet)*sign(diff)*max(0.,abs(diff)-repose*uDx);soil+=transfer;result.x+=transfer>0.?-min(a.x*.1,transfer):min(cell(neighbor,1).x*.1,-transfer);}
 result.x=max(0.,result.x);outFlow=vec4(result,foam);outAux=vec4(clamp(aux.x+uDt*(result.x>.018?1.6:-.018),0.,1.),mix(aux.yz,target,1.-exp(-uDt*3.)),soil+impulse.w);
}`;

export class BeachSimulation {
 constructor(renderer,{n=BEACH_N,dx=BEACH_DX,origin=[-BEACH_N*BEACH_DX/2,-BEACH_N*BEACH_DX/2],open=true,coarse=false,ocean=true}={}){
  Object.assign(this,{renderer,n,dx,origin:origin.slice(),open,coarse,time:0,wind:7,turbulence:1,windAngle:0,backend:'GPU · WebGL 2',cpu:false,current:-1,pending:false,steps:0,readGeneration:0});
  this.withdrawn=new Float32Array(n*n);this.queuedWithdrawn=new Float32Array(n*n);this.solidOffset=new Float32Array(n*n);this.hydraulicBed=new Float32Array(n*n);this.savedBed=new Map();this.waterCache=new Map();this.jet={origin:[0,0,0],direction:[0,0,-1],radius:2,strength:0,length:45};this.bodies=new BodyTexture();
  this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(n,n,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  this.bedrock=new Uint8Array(n*n);this.bed=new Float32Array(n*n);this.bedData=new Float32Array(n*n*4);this.bedTex=new THREE.DataTexture(this.bedData,n,n,THREE.RGBAFormat,THREE.FloatType);
  this.flow=new Float32Array(n*n*4);this.aux=this.flow.slice();this.impulses=this.flow.slice();this.flowTex=new THREE.DataTexture(this.flow,n,n,THREE.RGBAFormat,THREE.FloatType);this.auxTex=new THREE.DataTexture(this.aux,n,n,THREE.RGBAFormat,THREE.FloatType);this.impulseTex=new THREE.DataTexture(this.impulses,n,n,THREE.RGBAFormat,THREE.FloatType);this.impulseTex.needsUpdate=true;
  this.linear=renderer.extensions.has('OES_texture_float_linear');if(this.linear)for(const texture of [this.bedTex,this.flowTex,this.auxTex,...this.targets.flatMap(t=>t.textures)])texture.minFilter=texture.magFilter=THREE.LinearFilter;
  if(coarse)for(const texture of [this.flowTex,this.auxTex,...this.targets.flatMap(t=>t.textures)])texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  this.ocean=!coarse&&ocean?new BeachSimulation(renderer,{n:128,dx:4,origin:[-256,-256],open:false,coarse:true,ocean:false}):null;
  this.uniforms={uFlow:{value:this.flowTex},uAux:{value:this.auxTex},uBed:{value:this.bedTex},uImpulses:{value:this.impulseTex},uOcean:{value:this.ocean?.textures[0]||this.flowTex},uHasOcean:{value:!!this.ocean},uN:{value:n},uDx:{value:dx},uDt:{value:BEACH_DT},uOrigin:{value:new THREE.Vector2(...origin)},uClock:{value:0},uWind:{value:7},uTurbulence:{value:1},uWindAngle:{value:0},uOpen:{value:open},uPeriodic:{value:coarse},uCoarse:{value:coarse},uBrush:{value:new THREE.Vector4(0,0,1,0)},uBallCount:{value:0},uBodies:{value:this.bodies.texture},uJetOrigin:{value:new THREE.Vector4()},uJetDirection:{value:new THREE.Vector4()},uJetLength:{value:45}};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:BEACH_STEP_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.geometry=new THREE.PlaneGeometry(2,2);this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.initialize();
 }
 key(x,z){return `${Math.round(this.origin[0]/this.dx)+x},${Math.round(this.origin[1]/this.dx)+z}`;}
 initialize(){const n=this.n;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,p=[this.origin[0]+(x+.5)*this.dx,this.origin[1]+(z+.5)*this.dx],k=this.key(x,z);this.bedrock[i]=!this.coarse&&rockHeight(...p)>beachBed(...p)?1:0;this.bed[i]=this.coarse?-8:this.savedBed.get(k)??solidHeight(...p);const cached=this.waterCache.get(k);this.flow.set(cached?.slice(0,4)||(this.coarse?[8,0,0,0]:initialCell(...p)),i*4);if(!cached&&!this.coarse&&this.bed[i]<0&&this.ocean){const far=this.sampleOcean(...p),h=Math.max(0,far.eta-this.bed[i]);this.flow.set([h,far.u*h,far.v*h,0],i*4);}this.aux.set(cached?.slice(4)||[this.flow[i*4]>.02?1:0,0,0,0],i*4);}
  this.readGeneration++;this.solidOffset.fill(0);this.upload();this.current=-1;if(this.terrain)this.syncTerrain(this.terrain);this.uniforms.uOrigin.value.fromArray(this.origin);
 }
 uploadBed(){for(let z=0;z<this.n;z++)for(let x=0;x<this.n;x++){const i=z*this.n+x,p=[this.origin[0]+(x+.5)*this.dx,this.origin[1]+(z+.5)*this.dx];this.hydraulicBed[i]=this.bed[i]+this.solidOffset[i];this.bedData[i*4]=this.hydraulicBed[i];this.bedData[i*4+3]=this.solidOffset[i];this.bedData[i*4+1]=this.coarse?0:this.bed[i]-solidHeight(...p);this.bedData[i*4+2]=this.bedrock[i];}this.bedTex.needsUpdate=true;}
 upload(){this.flowTex.image.data=this.flow;this.auxTex.image.data=this.aux;this.flowTex.needsUpdate=this.auxTex.needsUpdate=true;this.uploadBed();}
 get textures(){return this.current<0||this.cpu?[this.flowTex,this.auxTex]:this.targets[this.current].textures;}
 setCPU(enabled){if(enabled===this.cpu)return;this.readNow();this.readGeneration++;this.cpu=enabled;this.current=-1;this.upload();this.ocean?.setCPU(enabled);this.backend=enabled?'CPU reference':'GPU · WebGL 2';}
 step(dt=BEACH_DT,balls=[]){
  // Sparse material exchanges commit against the authoritative field before
  // transport. Applying a debit after flux could withdraw water twice from a
  // draining cell; stale readback is suitable for sampling, not ownership.
  if(this.hasImpulses){if(this.lastReadStep!==this.steps)this.readNow();this.flushTransfers();this.current=-1;this.readGeneration++;this.upload();}
  if(this.ocean){this.ocean.wind=this.wind;this.ocean.turbulence=this.turbulence;this.ocean.windAngle=this.windAngle;this.oceanAccumulator=(this.oceanAccumulator||0)+dt;if(this.oceanAccumulator>=.04-1e-8){this.ocean.step(.04);this.oceanAccumulator-=.04;}this.uniforms.uOcean.value=this.ocean.textures[0];}
  const u=this.uniforms;u.uDt.value=dt;u.uClock.value=this.time;u.uWind.value=this.wind;u.uTurbulence.value=this.turbulence;u.uWindAngle.value=this.windAngle;const active=balls.filter(b=>Math.abs(b.position[0]-(this.origin[0]+this.n*this.dx/2))<this.n*this.dx/2+2&&Math.abs(b.position[2]-(this.origin[1]+this.n*this.dx/2))<this.n*this.dx/2+2);this.bodies.update(active);u.uBodies.value=this.bodies.texture;u.uBallCount.value=active.length;
  u.uJetOrigin.value.set(...this.jet.origin,this.jet.radius);u.uJetDirection.value.set(...this.jet.direction,this.jet.strength);u.uJetLength.value=this.jet.length;
  if(this.cpu){const next=stepBeachReference(this.flow,this.aux,this.hydraulicBed,this.n,this.dx,dt,{wind:this.wind,angle:this.windAngle,time:this.time,origin:this.origin,open:this.open,periodic:this.coarse,brush:u.uBrush.value.toArray(),balls:active,jet:this.jet,boundary:this.ocean?(x,z)=>this.ocean.sampleOcean(x,z):null,impulses:this.impulses,mobileBed:!this.coarse,bedrock:this.bedrock,turbulence:this.turbulence});this.flow=next.flow;this.aux=next.aux;this.upload();}
  else{[u.uFlow.value,u.uAux.value]=this.textures;const next=this.current===0?1:0,old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.targets[next]);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);this.current=next;}
  this.queuedWithdrawn.fill(0);if(this.cpu)this.withdrawn.fill(0);this.time+=dt;this.steps++;u.uBrush.value.w*=Math.exp(-dt*8);this.jet.strength*=Math.exp(-dt*9);if(this.hasImpulses){this.impulses.fill(0);this.impulseTex.needsUpdate=true;this.hasImpulses=false;}
 }
 readNow(){if(this.current<0||this.cpu)return;this.renderer.readRenderTargetPixels(this.targets[this.current],0,0,this.n,this.n,this.flow,undefined,0);this.renderer.readRenderTargetPixels(this.targets[this.current],0,0,this.n,this.n,this.aux,undefined,1);this.withdrawn.set(this.queuedWithdrawn);this.lastReadStep=this.steps;this.readGeneration++;}
 requestRead(){this.ocean?.requestRead();if(this.pending||this.cpu||this.current<0)return;this.pending=true;const version=this.readGeneration,target=this.targets[this.current],ack=this.withdrawn.map((v,i)=>v-this.queuedWithdrawn[i]);Promise.all([0,1].map(k=>this.renderer.readRenderTargetPixelsAsync(target,0,0,this.n,this.n,new Float32Array(this.flow.length),undefined,k))).then(([f,a])=>{if(this.readGeneration===version){this.flow=f;this.aux=a;for(let i=0;i<ack.length;i++)this.withdrawn[i]=Math.max(0,this.withdrawn[i]-ack[i]);this.ceiling=12;for(let i=0;i<this.bed.length;i++)this.ceiling=Math.max(this.ceiling,this.bed[i]+a[i*4+3]+f[i*4]+1);}}).catch(e=>{this.readError=e.message;}).finally(()=>this.pending=false);}
 recenter(x,z){if(this.coarse)return false;const size=this.n*this.dx,cx=this.origin[0]+size/2,cz=this.origin[1]+size/2;if(Math.abs(x-cx)<size*.22&&Math.abs(z-cz)<size*.22)return false;
  this.readNow();this.flushTransfers();for(let j=0;j<this.n;j++)for(let i=0;i<this.n;i++){const o=(j*this.n+i)*4;if(Math.abs(this.aux[o+3])>1e-6){this.bed[o/4]+=this.aux[o+3];this.savedBed.set(this.key(i,j),this.bed[o/4]);this.aux[o+3]=0;}this.waterCache.set(this.key(i,j),[...this.flow.subarray(o,o+4),...this.aux.subarray(o,o+4)]);}
  while(this.waterCache.size>131072)this.waterCache.delete(this.waterCache.keys().next().value);
  const snap=this.dx*16;this.origin=[Math.floor(x/snap)*snap-size/2,Math.floor(z/snap)*snap-size/2];this.initialize();return true;
 }
 sampleOcean(x,z){const s=this.coarse?this:this.ocean;if(!s)return {eta:0,u:0,v:0};const wrap=v=>((v%512)+512)%512,px=wrap(x+256)/s.dx-.5,pz=wrap(z+256)/s.dx-.5,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz,read=(a,b,k)=>s.flow[(((b+s.n)%s.n)*s.n+(a+s.n)%s.n)*4+k],component=k=>(read(ix,iz,k)*(1-fx)+read(ix+1,iz,k)*fx)*(1-fz)+(read(ix,iz+1,k)*(1-fx)+read(ix+1,iz+1,k)*fx)*fz,h=component(0);return {eta:h-8,u:component(1)/Math.max(h,.02),v:component(2)/Math.max(h,.02)};}
 sample(x,z,normal=true){return sampleBeach(this,x,z,normal);}
 contains(x,z){return x>this.origin[0]+this.dx&&z>this.origin[1]+this.dx&&x<this.origin[0]+(this.n-1)*this.dx&&z<this.origin[1]+(this.n-1)*this.dx;}
 flushTransfers(){if(!this.hasImpulses)return;this.withdrawn.fill(0);this.queuedWithdrawn.fill(0);for(let i=0;i<this.flow.length;i+=4){this.flow[i]=Math.max(0,this.flow[i]+this.impulses[i]);this.flow[i+1]+=this.impulses[i+1];this.flow[i+2]+=this.impulses[i+2];this.aux[i+3]+=this.impulses[i+3];}this.impulses.fill(0);this.impulseTex.needsUpdate=true;this.hasImpulses=false;}
 nudgeWater(x,z,radius=2,strength=2){this.uniforms.uBrush.value.set(x,z,radius,strength);}
 queueTransfer(x,z,water=0,sand=0,momentum=[0,0]){if(this.lastReadStep!==this.steps)this.readNow();const px=(x-this.origin[0])/this.dx-.5,pz=(z-this.origin[1])/this.dx-.5,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz;if(ix<0||iz<0||ix>=this.n-1||iz>=this.n-1)return false;const entries=[[0,0,(1-fx)*(1-fz)],[1,0,fx*(1-fz)],[0,1,(1-fx)*fz],[1,1,fx*fz]];for(const [ox,oz,w]of entries){const id=(iz+oz)*this.n+ix+ox,k=id*4;if(w<=0)continue;if(sand!==0&&this.bedrock[id])return false;if(water<0&&this.flow[k]-this.withdrawn[id]+water*w/(this.dx*this.dx)<0)return false;}for(const [ox,oz,w] of entries){const i=((iz+oz)*this.n+ix+ox)*4,k=w/(this.dx*this.dx);if(water<0){this.withdrawn[i/4]-=water*k;this.queuedWithdrawn[i/4]-=water*k;}this.impulses[i]+=water*k;this.impulses[i+1]+=momentum[0]*k;this.impulses[i+2]+=momentum[1]*k;this.impulses[i+3]+=sand*k;if(sand>0)this.displaceWater(i/4,sand*k);}this.hasImpulses=true;this.impulseTex.needsUpdate=true;return true;}
 // Displaced liquid keeps its volume and horizontal momentum when grains land.
 displaceWater(id,rise){const i=id*4,h=Math.max(0,this.flow[i]-this.withdrawn[id]),take=Math.min(h,rise);if(take<=0)return;const x=id%this.n,z=Math.floor(id/this.n),neighbors=[];for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+a,nz=z+b;if(nx>=0&&nz>=0&&nx<this.n&&nz<this.n)neighbors.push((nz*this.n+nx)*4);}if(!neighbors.length)return;this.withdrawn[id]+=take;this.queuedWithdrawn[id]+=take;const u=this.flow[i+1]/Math.max(this.flow[i],.002),v=this.flow[i+2]/Math.max(this.flow[i],.002);for(const k of [0,1,2]){const amount=take*(k===0?1:k===1?u:v);this.impulses[i+k]-=amount;for(const j of neighbors)this.impulses[j+k]+=amount/neighbors.length;}}
 // SDF cavities change the hydraulic floor too. Find the first air interval
 // above the sediment, so a bridge roof does not dam the open passage below it.
 syncTerrain(terrain){this.terrain=terrain;if(this.coarse)return;this.readNow();this.flushTransfers();this.uploadBed();
  for(let z=0;z<this.n;z++)for(let x=0;x<this.n;x++){const i=z*this.n+x,wx=this.origin[0]+(x+.5)*this.dx,wz=this.origin[1]+(z+.5)*this.dx,soil=beachBed(wx,wz)+this.bedData[i*4+1]+this.aux[i*4+3];
   const near=Math.abs(wx+18)<6&&Math.abs(wz+17.5)<4||Math.abs(wx+8)<5&&Math.abs(wz-2.5)<3||terrain.edits.some(e=>Math.hypot(wx-e[0],wz-e[2])<e[3]+this.dx);
   this.bedrock[i]=rockHeight(wx,wz)>beachBed(wx,wz)?1:0;if(!near){this.solidOffset[i]=0;continue;}const field=y=>terrainCSG(Math.min((y-soil)*.35,beachFeatures([wx,y,wz])),wx,y,wz,terrain.edits);let low=soil-4,high=low;for(let k=0;k<90;k++){high+=.15;if(field(high)>=0)break;low=high;}for(let k=0;k<12;k++){const mid=(low+high)*.5;if(field(mid)>0)high=mid;else low=mid;}const floor=(low+high)*.5;this.solidOffset[i]=floor-this.bed[i]-this.aux[i*4+3];this.bedrock[i]=floor>soil+.06?1:0;
  }this.current=-1;this.readGeneration++;this.upload();
 }
 // A finite-volume scoop. Every parcel carries exactly the volume subtracted
 // from its source column; no particles are made from a visual-only emitter.
 extractChunk(point,radius,kind){this.readNow();this.flushTransfers();const cells=[],area=this.dx*this.dx;for(let z=1;z<this.n-1;z++)for(let x=1;x<this.n-1;x++){const id=z*this.n+x,k=id*4,wx=this.origin[0]+(x+.5)*this.dx,wz=this.origin[1]+(z+.5)*this.dx,q=radius*radius-(wx-point[0])**2-(wz-point[2])**2;if(q<=0||kind==='sand'&&this.bedrock[id])continue;
   const reach=Math.sqrt(q),bed=this.hydraulicBed[id]+this.aux[k+3],top=kind==='water'?bed+this.flow[k]:bed,low=Math.max(point[1]-reach,kind==='water'?bed:-Infinity),high=Math.min(top,point[1]+reach),height=Math.max(0,high-low);if(height<.005)continue;
   // Sand can only be lifted from the exposed column, not from below an intact roof.
   const depth=kind==='sand'?Math.min(height,Math.max(0,top-low)):height;if(kind==='water'){const f=Math.max(0,1-depth/Math.max(this.flow[k],.0001));this.flow[k]-=depth;this.flow[k+1]*=f;this.flow[k+2]*=f;}else this.aux[k+3]-=depth;
   cells.push({position:[wx,(low+high)*.5,wz],height:depth,width:this.dx,volume:depth*area,wet:this.aux[k]});
  }this.readGeneration++;this.current=-1;this.upload();return cells;
 }
 nudgeSand(x,z,radius=2,amount=.6){this.readNow();this.flushTransfers();this.readGeneration++;const old=this.bed.slice(),changed=sandBrush(this.bed,this.n,this.dx,this.origin,[x,z],radius,amount,this.bedrock);let displaced=0;for(const i of changed){const rise=Math.max(0,this.bed[i]-old[i]),volume=Math.min(this.flow[i*4],rise);this.flow[i*4]-=volume;displaced+=volume;this.savedBed.set(this.key(i%this.n,Math.floor(i/this.n)),this.bed[i]);}
  // Raising submerged ground displaces water into surrounding wet cells. It
  // must not carry an unchanged depth field upward as a vertical water tower.
  if(displaced>0){const recipients=[];let sum=0;for(let j=0;j<this.n;j++)for(let i=0;i<this.n;i++){const k=j*this.n+i,d=Math.hypot(this.origin[0]+(i+.5)*this.dx-x,this.origin[1]+(j+.5)*this.dx-z);if(d>radius&&d<radius*4&&this.flow[k*4]>.01){const w=Math.exp(-d*d/(radius*radius*4));recipients.push([k,w]);sum+=w;}}if(sum>0)for(const [i,w]of recipients)this.flow[i*4]+=displaced*w/sum;else for(const i of changed)this.flow[i*4]+=displaced/changed.length;}
  this.ceiling=12;for(let i=0;i<this.bed.length;i++)this.ceiling=Math.max(this.ceiling,this.bed[i]+this.aux[i*4+3]+this.flow[i*4]+1);this.current=-1;this.upload();return changed.length;
 }
 async verify({periodic=false}={}){const test=new BeachSimulation(this.renderer,{n:16,dx:.75,origin:[20,-12],open:false,ocean:false,coarse:periodic});test.wind=4;test.windAngle=.35;test.bed[8*16+8]+=1.2;test.uniforms.uBrush.value.set(24,-7,1,2);const balls=[{position:[24,-.2,-7],velocity:[.5,0,.2],radius:.45}];test.jet={origin:[24,3,-4],direction:[0,-.6,-.8],radius:2,strength:12,length:30};for(let i=0;i<test.flow.length;i+=4){test.flow[i]=Math.max(0,.4-test.bed[i/4]+.06*Math.sin(i*.15));test.flow[i+1]=.01*Math.cos(i);test.flow[i+2]=.02*Math.sin(i);}test.upload();let f=test.flow.slice(),a=test.aux.slice(),history=[];for(let k=0;k<8;k++){const next=stepBeachReference(f,a,test.bed,16,.75,BEACH_DT,{wind:test.wind,angle:test.windAngle,time:test.time,origin:test.origin,brush:test.uniforms.uBrush.value.toArray(),balls,jet:test.jet,bedrock:test.bedrock,periodic,mobileBed:!periodic});f=next.flow;a=next.aux;test.step(BEACH_DT,balls);test.readNow();let e=0,kmax=0;for(let i=0;i<f.length;i++){const d=Math.abs(f[i]-test.flow[i]);if(d>e){e=d;kmax=i;}}history.push({step:k+1,error:e,index:kmax,expected:f[kmax],actual:test.flow[kmax]});}test.readNow();let error=0,worst=null;for(let i=0;i<f.length;i++)for(const [name,expected,actual] of [["flow",f,test.flow],["aux",a,test.aux]]){const e=Math.abs(expected[i]-actual[i]);if(e>error){error=e;worst={name,index:i,expected:expected[i],actual:actual[i]};}}test.dispose();return {error,worst,history,pass:Number.isFinite(error)&&error<1e-4};}
 dispose(){this.ocean?.dispose();this.bodies.dispose();for(const t of this.targets)t.dispose();for(const t of [this.bedTex,this.flowTex,this.auxTex,this.impulseTex])t.dispose();this.material.dispose();this.geometry.dispose();}
}
