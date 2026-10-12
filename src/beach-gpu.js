import * as THREE from 'three';
import { QUAD_VERTEX } from './shaders.js';
import { BEACH_WORLD_GLSL,BEACH_N,BEACH_DX,BEACH_DT,beachBed,initialCell,sandBrush,stepBeachReference } from './beach-model.js';

export const BEACH_STEP_FRAGMENT=`precision highp float;
uniform sampler2D uFlow,uAux,uBed;uniform int uN,uBallCount;uniform float uDx,uDt,uClock,uWind,uWindAngle;uniform bool uOpen;
uniform vec2 uOrigin;uniform vec4 uBrush,uBalls[12],uBallVelocity[12];
layout(location=0) out vec4 outFlow;layout(location=1) out vec4 outAux;
${BEACH_WORLD_GLSL}
vec4 cell(ivec2 p,int axis){bool outside=any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(uN)));vec4 a=texelFetch(uFlow,clamp(p,ivec2(0),ivec2(uN-1)),0);if(outside)a[axis]*=-1.;return a;}
float bedAt(ivec2 p){p=clamp(p,ivec2(0),ivec2(uN-1));return texelFetch(uBed,p,0).r+texelFetch(uAux,p,0).w;}
vec3 flux(vec4 a,vec4 b,float ba,float bb,int axis){float top=max(ba,bb),ha=max(0.,a.x+ba-top),hb=max(0.,b.x+bb-top),ua=a.x>.0001?a[axis]/a.x:0.,ub=b.x>.0001?b[axis]/b.x:0.;
 vec3 A=vec3(ha,a.yz*ha/max(a.x,.0001)),B=vec3(hb,b.yz*hb/max(b.x,.0001));float c=max(abs(ua)+sqrt(9.81*ha),abs(ub)+sqrt(9.81*hb));vec3 f=(A*ua+B*ub)*.5-.5*c*(B-A);f[axis]+=2.4525*(ha*ha+hb*hb);return f;}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 a=cell(p,1),aux=texelFetch(uAux,p,0);float b=bedAt(p);vec3 result=a.xyz;
 for(int j=0;j<4;j++){ivec2 offset=j==0?ivec2(1,0):j==1?ivec2(-1,0):j==2?ivec2(0,1):ivec2(0,-1);int axis=j<2?1:2;float sign=j%2==0?1.:-1.;vec4 nb=cell(p+offset,axis);float bn=bedAt(p+offset);vec3 f=sign>0.?flux(a,nb,b,bn,axis):flux(nb,a,bn,b,axis);float face=max(0.,a.x+b-max(b,bn));f[axis]+=.5*9.81*(a.x*a.x-face*face);result-=sign*uDt/uDx*f;}
 result.x=max(0.,result.x);vec2 world=uOrigin+(vec2(p)+.5)*uDx,wind=beachWind(world,uClock,uWind,uWindAngle);
 result.yz=(result.yz+uDt*.0009*wind*length(wind))/(1.+uDt*(.035+.15/max(result.x,.08)));
 if(uOpen&&b<-.5){float border=float(min(min(p.x,p.y),min(uN-1-p.x,uN-1-p.y))),relax=clamp((6.-border)/6.,0.,1.)*uDt*2.,wave=incomingWave(world,uClock,uWind,uWindAngle),h=max(0.,wave-b),q=wave*sqrt(9.81*h);result=mix(result,vec3(h,q*sin(uWindAngle),q*cos(uWindAngle)),relax);}
 vec2 relative=world-uBrush.xy;float weight=exp(-dot(relative,relative)/max(uBrush.z*uBrush.z,.001));result.yz+=relative*weight*uBrush.w*result.x*uDt*5.;
 vec2 target=wind*(.008*length(wind));float wake=0.;
 for(int j=0;j<12;j++){if(j>=uBallCount)break;vec4 ball=uBalls[j];vec2 d=world-ball.xz;float r=ball.w+.65,w=exp(-dot(d,d)/(r*r));float reach=clamp((b+1.4-ball.y+ball.w)*2.,0.,1.);
  target+=normalize(d+vec2(.001))*w*reach*1.4;
  float submerged=clamp((b+result.x-ball.y+ball.w)/(2.*ball.w),0.,1.);vec2 dv=uBallVelocity[j].xz-result.yz/max(result.x,.02);result.yz+=dv*w*submerged*uDt*.7;wake+=w*submerged*length(dv)*.15;
 }
 if(result.x<.002)result.yz=vec2(0);
 vec4 r=cell(p+ivec2(1,0),1),l=cell(p-ivec2(1,0),1),u=cell(p+ivec2(0,1),2),d=cell(p-ivec2(0,1),2);
 float slope=length(vec2(r.x+bedAt(p+ivec2(1,0))-l.x-bedAt(p-ivec2(1,0)),u.x+bedAt(p+ivec2(0,1))-d.x-bedAt(p-ivec2(0,1))))/(2.*uDx);
 float compression=max(0.,-((r.y/max(r.x,.02)-l.y/max(l.x,.02))+(u.z/max(u.x,.02)-d.z/max(d.x,.02)))/(2.*uDx));
 float speed=length(result.yz)/max(result.x,.02),breaking=max(0.,slope-.055)*speed*2.+max(0.,compression-.12)*.5;
 vec2 back=vec2(p)-a.yz/max(a.x,.02)*uDt/uDx;ivec2 ip=ivec2(floor(back));vec2 f=fract(back);float advected=mix(mix(cell(ip,1).w,cell(ip+ivec2(1,0),1).w,f.x),mix(cell(ip+ivec2(0,1),1).w,cell(ip+ivec2(1,1),1).w,f.x),f.y);
 float foam=clamp(advected*exp(-uDt*.32)+uDt*(breaking+wake)*min(1.,result.x*8.),0.,1.);
 float soil=aux.w;for(int j=0;j<4;j++){ivec2 offset=j==0?ivec2(1,0):j==1?ivec2(-1,0):j==2?ivec2(0,1):ivec2(0,-1);ivec2 neighbor=clamp(p+offset,ivec2(0),ivec2(uN-1));float diff=bedAt(neighbor)-b,repose=.6+.25*(aux.x+texelFetch(uAux,neighbor,0).x)*.5;soil+=uDt*.08*sign(diff)*max(0.,abs(diff)-repose*uDx);}
 outFlow=vec4(result,foam);outAux=vec4(clamp(aux.x+uDt*(result.x>.018?1.6:-.018),0.,1.),mix(aux.yz,target,1.-exp(-uDt*3.)),soil);
}`;

export class BeachSimulation {
 constructor(renderer,{n=BEACH_N,dx=BEACH_DX,origin=[-48,-48],open=true}={}){
  this.renderer=renderer;this.n=n;this.dx=dx;this.origin=origin.slice();this.time=0;this.accumulator=0;this.open=open;this.wind=7;this.windAngle=0;this.backend='GPU · WebGL 2';this.cpu=false;this.savedBed=new Map();this.waterCache=new Map();this.pending=false;this.steps=0;this.readGeneration=0;
  this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(n,n,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  this.bed=new Float32Array(n*n);this.bedTex=new THREE.DataTexture(this.bed,n,n,THREE.RedFormat,THREE.FloatType);this.bedTex.needsUpdate=true;
  this.flow=new Float32Array(n*n*4);this.aux=new Float32Array(n*n*4);this.flowTex=new THREE.DataTexture(this.flow,n,n,THREE.RGBAFormat,THREE.FloatType);this.auxTex=new THREE.DataTexture(this.aux,n,n,THREE.RGBAFormat,THREE.FloatType);
  this.linear=renderer.extensions.has('OES_texture_float_linear');if(this.linear)for(const texture of [this.bedTex,this.flowTex,this.auxTex,...this.targets.flatMap(t=>t.textures)])texture.minFilter=texture.magFilter=THREE.LinearFilter;
  this.uniforms={uFlow:{value:this.flowTex},uAux:{value:this.auxTex},uBed:{value:this.bedTex},uN:{value:n},uDx:{value:dx},uDt:{value:BEACH_DT},uOrigin:{value:new THREE.Vector2(...origin)},uClock:{value:0},uWind:{value:7},uWindAngle:{value:0},uOpen:{value:open},uBrush:{value:new THREE.Vector4(0,0,1,0)},uBallCount:{value:0},uBalls:{value:Array.from({length:12},()=>new THREE.Vector4())},uBallVelocity:{value:Array.from({length:12},()=>new THREE.Vector4())}};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:BEACH_STEP_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.geometry=new THREE.PlaneGeometry(2,2);this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.current=-1;this.initialize();
 }
 key(x,z){return `${Math.round(this.origin[0]/this.dx)+x},${Math.round(this.origin[1]/this.dx)+z}`;}
 initialize(){const n=this.n;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,p=[this.origin[0]+(x+.5)*this.dx,this.origin[1]+(z+.5)*this.dx],k=this.key(x,z);this.bed[i]=this.savedBed.get(k)??beachBed(...p);const cached=this.waterCache.get(k);this.flow.set(cached?.slice(0,4)||initialCell(...p,this.time,this.wind,this.windAngle),i*4);this.aux.set(cached?.slice(4)||[this.flow[i*4]>.02?1:0,0,0,0],i*4);}
  this.readGeneration++;this.upload();this.current=-1;this.uniforms.uOrigin.value.fromArray(this.origin);
 }
 upload(){this.flowTex.image.data=this.flow;this.auxTex.image.data=this.aux;this.flowTex.needsUpdate=this.auxTex.needsUpdate=this.bedTex.needsUpdate=true;}
 get textures(){return this.current<0||this.cpu?[this.flowTex,this.auxTex]:this.targets[this.current].textures;}
 setCPU(enabled){if(enabled===this.cpu)return;this.readNow();this.readGeneration++;this.cpu=enabled;this.current=-1;this.upload();this.backend=enabled?'CPU reference':'GPU · WebGL 2';}
 step(dt=BEACH_DT,balls=[]){
  const u=this.uniforms;u.uDt.value=dt;u.uClock.value=this.time;u.uWind.value=this.wind;u.uWindAngle.value=this.windAngle;u.uBallCount.value=balls.length;balls.forEach((b,i)=>{u.uBalls.value[i].set(...b.position,b.radius);u.uBallVelocity.value[i].set(...b.velocity,0);});
  if(this.cpu){const next=stepBeachReference(this.flow,this.aux,this.bed,this.n,this.dx,dt,{wind:this.wind,angle:this.windAngle,time:this.time,origin:this.origin,open:this.open,brush:u.uBrush.value.toArray(),balls});this.flow=next.flow;this.aux=next.aux;this.upload();}
  else{[u.uFlow.value,u.uAux.value]=this.textures;const next=this.current===0?1:0,old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.targets[next]);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);this.current=next;}
  this.time+=dt;this.steps++;u.uBrush.value.w*=Math.exp(-dt*8);
 }
 readNow(){if(this.current<0||this.cpu)return;this.renderer.readRenderTargetPixels(this.targets[this.current],0,0,this.n,this.n,this.flow,undefined,0);this.renderer.readRenderTargetPixels(this.targets[this.current],0,0,this.n,this.n,this.aux,undefined,1);}
 requestRead(){if(this.pending||this.cpu||this.current<0)return;this.pending=true;const version=this.readGeneration,target=this.targets[this.current];Promise.all([0,1].map(k=>this.renderer.readRenderTargetPixelsAsync(target,0,0,this.n,this.n,new Float32Array(this.flow.length),undefined,k))).then(([f,a])=>{if(this.readGeneration===version){this.flow=f;this.aux=a;}}).catch(e=>{this.readError=e.message;}).finally(()=>this.pending=false);}
 recenter(x,z){const size=this.n*this.dx,cx=this.origin[0]+size/2,cz=this.origin[1]+size/2;if(Math.abs(x-cx)<size*.28&&Math.abs(z-cz)<size*.28)return false;
  this.readNow();for(let j=0;j<this.n;j++)for(let i=0;i<this.n;i++){const o=(j*this.n+i)*4;if(Math.abs(this.aux[o+3])>1e-6){this.bed[o/4]+=this.aux[o+3];this.savedBed.set(this.key(i,j),this.bed[o/4]);this.aux[o+3]=0;}this.waterCache.set(this.key(i,j),[...this.flow.subarray(o,o+4),...this.aux.subarray(o,o+4)]);}
  while(this.waterCache.size>131072)this.waterCache.delete(this.waterCache.keys().next().value);
  const snap=this.dx*32;this.origin=[Math.floor(x/snap)*snap-size/2,Math.floor(z/snap)*snap-size/2];this.initialize();return true;
 }
 sample(x,z){const px=(x-this.origin[0])/this.dx-.5,pz=(z-this.origin[1])/this.dx-.5,inside=px>=0&&pz>=0&&px<this.n-1&&pz<this.n-1;
  if(!inside){const bed=beachBed(x,z),surface=Math.max(bed,incomingFallback(x,z,this));return {bed,surface,h:Math.max(0,surface-bed),u:0,v:0,wet:surface>bed?1:0,dx:(beachBed(x+.1,z)-beachBed(x-.1,z))/.2,dz:(beachBed(x,z+.1)-beachBed(x,z-.1))/.2};}
  const i=Math.floor(px),j=Math.floor(pz),fx=px-i,fz=pz-j,ids=[j*this.n+i,j*this.n+i+1,(j+1)*this.n+i,(j+1)*this.n+i+1],w=[(1-fx)*(1-fz),fx*(1-fz),(1-fx)*fz,fx*fz],mix=(a,c,stride)=>ids.reduce((s,k,n)=>s+a[k*stride+c]*w[n],0),heightAt=k=>this.bed[k]+this.aux[k*4+3],bed=ids.reduce((v,k,i)=>v+heightAt(k)*w[i],0),h=mix(this.flow,0,4);
  return {bed,h,surface:bed+h,u:mix(this.flow,1,4)/Math.max(h,.02),v:mix(this.flow,2,4)/Math.max(h,.02),wet:mix(this.aux,0,4),dx:((heightAt(ids[1])-heightAt(ids[0]))*(1-fz)+(heightAt(ids[3])-heightAt(ids[2]))*fz)/this.dx,dz:((heightAt(ids[2])-heightAt(ids[0]))*(1-fx)+(heightAt(ids[3])-heightAt(ids[1]))*fx)/this.dx};
 }
 nudgeWater(x,z,radius=2,strength=2){this.uniforms.uBrush.value.set(x,z,radius,strength);}

 nudgeSand(x,z,radius=2,amount=.6){const changed=sandBrush(this.bed,this.n,this.dx,this.origin,[x,z],radius,amount);for(const i of changed)this.savedBed.set(this.key(i%this.n,Math.floor(i/this.n)),this.bed[i]);this.bedTex.needsUpdate=true;return changed.length;}
 async verify(){const test=new BeachSimulation(this.renderer,{n:16,dx:.75,origin:[-6,-12],open:false});test.wind=4;test.windAngle=.35;test.bed[8*16+8]+=1.2;test.uniforms.uBrush.value.set(0,-7,1,2);const balls=[{position:[0,-.2,-7],velocity:[.5,0,.2],radius:.45}];for(let i=0;i<test.flow.length;i+=4){test.flow[i]=Math.max(0,.4-test.bed[i/4]+.06*Math.sin(i*.15));test.flow[i+1]=.01*Math.cos(i);test.flow[i+2]=.02*Math.sin(i);}test.upload();let f=test.flow.slice(),a=test.aux.slice();for(let k=0;k<8;k++){const next=stepBeachReference(f,a,test.bed,16,.75,BEACH_DT,{wind:test.wind,angle:test.windAngle,time:test.time,origin:test.origin,brush:test.uniforms.uBrush.value.toArray(),balls});f=next.flow;a=next.aux;test.step(BEACH_DT,balls);}test.readNow();let error=0;for(let i=0;i<f.length;i++)error=Math.max(error,Math.abs(f[i]-test.flow[i]),Math.abs(a[i]-test.aux[i]));test.dispose();return {error,pass:Number.isFinite(error)&&error<.0005};}
 dispose(){for(const t of this.targets)t.dispose();this.bedTex.dispose();this.flowTex.dispose();this.auxTex.dispose();this.material.dispose();this.geometry.dispose();}
}
// Far field shares the same optical material. It is a boundary wave estimate.
import { incomingWave } from './beach-model.js';
function incomingFallback(x,z,s){return incomingWave(x,z,s.time,s.wind,s.windAngle);}
