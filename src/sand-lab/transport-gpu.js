import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {NEIGHBORS} from './water-lab-model.js';
import {physicalCoefficients,transportFluid,WATER_DENSITY,WATER_SURFACE_TENSION} from './water-lab-transport.js';
const fragment=`precision highp float;precision highp int;
uniform sampler2D uOld,uNext,uPredicted,uChem,uNeighbors;
uniform int uCount;uniform float uSpacing,uScale,uDt,uViscosity,uCapillary;
layout(location=0) out vec4 velocity;
layout(location=1) out vec4 chemistry;
layout(location=2) out vec4 metric;
layout(location=3) out vec4 activity;
ivec2 cell(int i){return ivec2(i%64,i/64);}
vec3 rawVelocity(int i){vec4 old=texelFetch(uOld,cell(i),0);return old.w>.5?vec3(0):(texelFetch(uNext,cell(i),0).xyz-old.xyz)/uDt;}
void main(){int i=int(gl_FragCoord.y)*64+int(gl_FragCoord.x);velocity=chemistry=metric=activity=vec4(0);if(i>=uCount)return;
 vec4 old=texelFetch(uOld,cell(i),0),chem=texelFetch(uChem,cell(i),0);vec3 p=texelFetch(uNext,cell(i),0).xyz,raw=rawVelocity(i),average=vec3(0),normal=vec3(0),diffusion=vec3(0);
 float s=uSpacing,h=2.*s,weight=0.,strain=0.,count=0.,diff=min(.006,uDt*.12),threshold=max(.08,.3*sqrt(9.81*s*uScale));
 for(int a=0;a<${NEIGHBORS};a++){int j=int(texelFetch(uNeighbors,ivec2(a+(i%4)*128,i/4),0).r);if(j<0)break;vec3 delta=p-texelFetch(uNext,cell(j),0).xyz;float r2=dot(delta,delta);if(r2>=h*h)continue;float v=1.-r2/(h*h),w=315./(512.*3.14159265359)*v*v*v,r=sqrt(r2);vec3 dv=rawVelocity(j)-raw;weight+=w;average+=dv*w;float radial=dot(dv,delta)/max(r,1e-8);strain+=radial*radial*w;normal+=delta*w;if(r<s*1.9)count+=1.;diffusion+=(texelFetch(uChem,cell(j),0).rgb-chem.rgb)*(1.-r/h)*diff;}
 vec3 incoming=(texelFetch(uPredicted,cell(i),0).xyz-old.xyz)/uDt;
 float lost=sqrt(max(0.,dot(incoming,incoming)-dot(raw,raw)))*uScale,impactSpeed=max(lost,length(incoming-raw)*uScale),normalLength=length(normal),inv=1./max(normalLength,1e-8),surface=min(1.,normalLength/s*12.),deformation=sqrt(strain/max(.2,weight))*uScale;
 float breaking=max(0.,deformation-threshold*.9)/(threshold+.35),impact=max(0.,impactSpeed-threshold*1.2)/(threshold+.35),energy=surface*min(1.,weight/.18)*min(5.,breaking*.8+impact*.7),smoothFactor=.012+uViscosity/max(.1,weight),cap=uCapillary*uDt*surface;
 velocity=vec4(old.w>.5?vec3(0):raw+average*smoothFactor-normal*inv*cap,0);
 float outward=-dot(average,normal)*inv/max(.02,weight)*uScale,capillarySpeed=sqrt(${WATER_SURFACE_TENSION}/(${WATER_DENSITY.toFixed(1)}*s*uScale)),breakup=old.w>.5?0.:surface*min(1.,weight/.12)*min(3.,max(0.,outward-max(4.*capillarySpeed,threshold*.5))/max(.15,threshold));
 chemistry=vec4(chem.rgb+diffusion,min(1.,chem.a*exp(-uDt*.65)+energy*uDt*.3));metric=vec4(normal*inv,old.w>.5?0.:energy);activity=vec4(count,max(deformation,max(0.,outward)),impactSpeed,breakup);
}`;
export class LabTransportGPU {
 constructor(renderer){this.renderer=renderer;this.u={};for(const key of ['uOld','uNext','uPredicted','uChem','uNeighbors'])this.u[key]={value:null};for(const key of ['uCount','uSpacing','uScale','uDt','uViscosity','uCapillary'])this.u[key]={value:0};this.geometry=new THREE.PlaneGeometry(2,2);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();}
 allocate(n){const height=Math.ceil(n/64);if(this.height===height)return;this.disposeBuffers();this.height=height;this.target=new THREE.WebGLRenderTarget(64,height,{count:4,type:THREE.FloatType,depthBuffer:false});this.textures={};for(const key of ['uOld','uNext','uPredicted','uChem']){const t=new THREE.DataTexture(new Float32Array(64*height*4),64,height,THREE.RGBAFormat,THREE.FloatType);this.textures[key]=t;this.u[key].value=t;}this.buffers=Array.from({length:4},()=>new Float32Array(64*height*4));}
 solve(old,next,previousVelocity,chem,neighbors,s,scale,dt,predicted,gpu){if(gpu.cpu)return transportFluid(old,next,previousVelocity,chem,neighbors,s,scale,dt,predicted);const n=next.length/4;if(!n)return transportFluid(old,next,previousVelocity,chem,neighbors,s,scale,dt,predicted);this.allocate(n);const u=this.u;for(const [key,data] of [['uOld',old],['uNext',next],['uPredicted',predicted],['uChem',chem]]){const t=this.textures[key];t.image.data.set(data);t.needsUpdate=true;u[key].value=t;}if(gpu.resultTexture)u.uNext.value=gpu.resultTexture;u.uNeighbors.value=gpu.neighborTexture;u.uCount.value=n;u.uSpacing.value=s;u.uScale.value=scale;u.uDt.value=dt;const coefficients=physicalCoefficients(s,scale,dt);u.uViscosity.value=coefficients.viscosity;u.uCapillary.value=coefficients.capillary;
 const r=this.renderer,prior=r.getRenderTarget();r.setRenderTarget(this.target);r.render(this.scene,this.camera);for(let i=0;i<4;i++)r.readRenderTargetPixels(this.target,0,0,64,this.height,this.buffers[i],0,i);r.setRenderTarget(prior);
 const counts=new Uint16Array(n),activity=new Float32Array(n*2),breakup=new Float32Array(n),a=this.buffers[3];for(let i=0;i<n;i++){counts[i]=a[i*4];activity[i*2]=a[i*4+1];activity[i*2+1]=a[i*4+2];breakup[i]=a[i*4+3];}return {velocities:this.buffers[0].slice(0,n*4),chem:this.buffers[1].slice(0,n*4),metrics:this.buffers[2].slice(0,n*4),counts,activity,breakup};
 }
 disposeBuffers(){this.target?.dispose();for(const t of Object.values(this.textures||{}))t.dispose();}
 dispose(){this.disposeBuffers();this.geometry.dispose();this.material.dispose();}
}
