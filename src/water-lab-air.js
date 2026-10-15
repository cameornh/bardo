import {readLabPixelsAsync} from './water-lab-readback.js';
import * as THREE from 'three';
import {windAt,windNoise,BEACH_WIND_GLSL} from './beach-wind.js';
import {opaqueDistance,vesselDistance,normalAt} from './water-lab-model.js';
import {QUAD_VERTEX} from './shaders.js';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';

// Bounded near-solid flow approximation: tangent slip at the wall and an
// upwind shelter query. This is not a Navier–Stokes air solver.
export function airSolid(p,lab,exclude=null){let d=Math.min(opaqueDistance(p,lab.kind,lab.bedDelta?.(p)||0,lab.riverSlope,lab.waterfallHeight),vesselDistance(p,lab.kind,lab.motion));for(const b of lab.balls||[])if(b!==exclude)d=Math.min(d,Math.hypot(...p.map((v,k)=>v-b.position[k]))-b.radius);return d;}
export function obstacleAir(p,velocity,solid){
 const distance=solid(p);if(distance<0)return [0,0,0];
 const speed=Math.hypot(...velocity);if(speed<1e-8)return velocity;
 let out=velocity.slice();const reach=1.2;
 if(distance<reach){const n=normalAt(p,solid),weight=(1-distance/reach)**2,vn=out.reduce((s,v,k)=>s+v*n[k],0);out=out.map((v,k)=>v-n[k]*vn*weight);}
 const direction=velocity.map(v=>v/speed);let t=.08,shelter=0;
 for(let i=0;i<8&&t<2.4;i++){const d=solid(p.map((v,k)=>v-direction[k]*t));if(d<.015){shelter=.8*(1-t/3);break;}t+=Math.max(.035,d*.8);}
 return out.map(v=>v*(1-shelter));
}
export function labAirVelocity(p,lab,jet=lab.jet,exclude=null){
 const scale=lab.spec.scale,t=lab.time,speed=lab.wind,turbulence=lab.windTurbulence??1;
 const w=windAt(p[0]*scale,p[2]*scale,t,speed,0,turbulence),q=[p[0]*scale*.4+p[1]*.7,p[2]*scale*.4-t*speed*.07];
 const v=[w[0]+speed*turbulence*.45*(windNoise(q[0]+9,q[1]+17)-.5),speed*turbulence*.28*(windNoise(q[0]+31,q[1]+5)-.5),w[1]];
 if(jet){const delta=p.map((v,k)=>v-jet.origin[k]),along=delta.reduce((a,v,k)=>a+v*jet.direction[k],0),r2=delta.reduce((a,v,k)=>a+(v-along*jet.direction[k])**2,0),weight=along>0?Math.exp(-r2/lab.radius**2)*Math.exp(-along/25):0;for(let k=0;k<3;k++)v[k]+=jet.direction[k]*lab.windStrength*weight;}
 return obstacleAir(p,v,q=>airSolid(q,lab,exclude)).map(v=>v/scale);
}
export const AIR_SAMPLE_GLSL=`
uniform highp sampler2D uAirField;uniform vec3 uAirMin,uAirExtent;uniform bool uAirEnabled;
vec3 airNode(ivec3 p){p=clamp(p,ivec3(0),ivec3(31,23,31));return texelFetch(uAirField,ivec2(p.x+p.z*32,p.y),0).xyz;}
vec3 sampleAir(vec3 p){vec3 q=clamp((p-uAirMin)/uAirExtent,0.,1.)*vec3(31,23,31),f=fract(q);ivec3 b=ivec3(floor(q));return mix(mix(mix(airNode(b),airNode(b+ivec3(1,0,0)),f.x),mix(airNode(b+ivec3(0,1,0)),airNode(b+ivec3(1,1,0)),f.x),f.y),mix(mix(airNode(b+ivec3(0,0,1)),airNode(b+ivec3(1,0,1)),f.x),mix(airNode(b+ivec3(0,1,1)),airNode(b+ivec3(1,1,1)),f.x),f.y),f.z);}
`;
const kernel=`precision highp float;precision highp int;out vec4 outColor;
uniform vec3 uAirMin,uAirExtent,uAirJetOrigin,uAirJetDirection;uniform float uAirTime,uAirScale,uAirSpeed,uAirTurbulence,uAirJetStrength,uAirRadius;
${LAB_GEOMETRY_GLSL}
${BEACH_WIND_GLSL}
float airSolid(vec3 p){float d=min(labOpaque(p),vessel(p));for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i);d=min(d,length(p-b.xyz)-b.w);}return d;}
void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);vec3 p=uAirMin+vec3(pixel.x%32,pixel.y,pixel.x/32)/vec3(31,23,31)*uAirExtent;
vec2 w=beachWind(p.xz*uAirScale,uAirTime,uAirSpeed,0.,uAirTurbulence),q=vec2(p.x*uAirScale*.4+p.y*.7,p.z*uAirScale*.4-uAirTime*uAirSpeed*.07);
vec3 v=vec3(w.x+uAirSpeed*uAirTurbulence*.45*(windNoise(q+vec2(9,17))-.5),uAirSpeed*uAirTurbulence*.28*(windNoise(q+vec2(31,5))-.5),w.y);
vec3 delta=p-uAirJetOrigin;float along=dot(delta,uAirJetDirection);if(along>0.)v+=uAirJetDirection*uAirJetStrength*exp(-dot(delta-along*uAirJetDirection,delta-along*uAirJetDirection)/(uAirRadius*uAirRadius))*exp(-along/25.);
float distance=airSolid(p),speed=length(v);vec3 outV=v;if(distance<0.)outV=vec3(0);else if(speed>1e-8){if(distance<1.2){float e=.003;vec3 n=vec3(airSolid(p+vec3(e,0,0))-airSolid(p-vec3(e,0,0)),airSolid(p+vec3(0,e,0))-airSolid(p-vec3(0,e,0)),airSolid(p+vec3(0,0,e))-airSolid(p-vec3(0,0,e)));n/=max(length(n),1e-12);outV-=n*dot(v,n)*pow(1.-distance/1.2,2.);}float t=.08,shelter=0.;for(int i=0;i<8;i++){if(t>=2.4)break;float d=airSolid(p-v/speed*t);if(d<.015){shelter=.8*(1.-t/3.);break;}t+=max(.035,d*.8);}outV*=1.-shelter;}outColor=vec4(outV/uAirScale,1);}
`;
export class LabAirField{
 constructor(renderer,geometry){this.renderer=renderer;this.cpu=!renderer.extensions.has('EXT_color_buffer_float');this.target=new THREE.WebGLRenderTarget(1024,24,{type:THREE.FloatType,depthBuffer:false});this.u={uAirField:{value:this.target.texture},uAirEnabled:{value:false},uAirMin:{value:new THREE.Vector3(-6,-1,-6)},uAirExtent:{value:new THREE.Vector3(12,12,12)}};this.uniforms={...geometry,...this.u,uAirTime:{value:0},uAirScale:{value:1},uAirSpeed:{value:0},uAirTurbulence:{value:1},uAirJetOrigin:{value:new THREE.Vector3()},uAirJetDirection:{value:new THREE.Vector3(0,0,1)},uAirJetStrength:{value:0},uAirRadius:{value:1}};this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:kernel,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));this.camera=new THREE.Camera();}
 update(lab,jet=lab.jet){const key=[lab.kind,lab.waterfallHeight,lab.time,lab.wind,lab.windTurbulence,lab.spec.scale,lab.gpu.cpu,lab.motion.tilt,lab.motion.spin,lab.motion.pitch,...lab.motion.position,lab.balls.length,lab.radius,lab.windStrength,...(jet?.origin||[]),...(jet?.direction||[])].join(',');if(key===this.key)return;this.key=key;if(this.gridGeneration!==lab.generation||lab.gpu.cpu)this.grid=null;this.lab=lab;this.jet=jet;this.nodes=new Map();const u=this.uniforms;u.uAirTime.value=lab.time;u.uAirScale.value=lab.spec.scale;u.uAirSpeed.value=lab.wind;u.uAirTurbulence.value=lab.windTurbulence;u.uAirJetStrength.value=jet?lab.windStrength:0;u.uAirRadius.value=lab.radius;u.uAirMin.value.set(-6,-1,lab.kind==='river'?-60:-6);u.uAirExtent.value.set(12,lab.kind==='river'?30:14,lab.kind==='river'?120:12);if(jet){u.uAirJetOrigin.value.fromArray(jet.origin);u.uAirJetDirection.value.fromArray(jet.direction);}this.u.uAirEnabled.value=!this.cpu&&(lab.wind!==0||!!jet);if(this.cpu||!this.u.uAirEnabled.value)return;const r=this.renderer,old=r.getRenderTarget();r.setRenderTarget(this.target);r.render(this.scene,this.camera);r.setRenderTarget(old);
 // Read the small GPU air lattice asynchronously. Bulk forces use exactly the
 // same trilinear field as fine spray instead of repeating solid ray queries
 // thousands of times on the CPU. Retain the direct CPU reference above.
 if(!this.reading&&r.readRenderTargetPixelsAsync){const data=new Float32Array(1024*24*4),generation=lab.generation,min=this.u.uAirMin.value.toArray(),extent=this.u.uAirExtent.value.toArray();
 const pending=readLabPixelsAsync(r,this.target,1024,24,data);r.getContext().bindBuffer(r.getContext().PIXEL_PACK_BUFFER,null);
 this.reading=pending.then(()=>{if(generation===lab.generation){this.grid=data;this.gridMin=min;this.gridExtent=extent;this.gridGeneration=generation;}}).catch(()=>{this.grid=null;}).finally(()=>this.reading=null);
 }
 }
 sampleGrid(p){
 const min=this.gridMin,extent=this.gridExtent,a=this.grid,out=[0,0,0];
 const x=Math.max(0,Math.min(31,(p[0]-min[0])/extent[0]*31)),y=Math.max(0,Math.min(23,(p[1]-min[1])/extent[1]*23)),z=Math.max(0,Math.min(31,(p[2]-min[2])/extent[2]*31)),ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
 for(let c=0;c<8;c++){const cx=c&1,cy=(c>>1)&1,cz=(c>>2)&1,w=(cx?fx:1-fx)*(cy?fy:1-fy)*(cz?fz:1-fz),o=(Math.min(23,iy+cy)*1024+Math.min(31,iz+cz)*32+Math.min(31,ix+cx))*4;out[0]+=w*a[o];out[1]+=w*a[o+1];out[2]+=w*a[o+2];}return out;
 }
 sample(p){const min=this.u.uAirMin.value.toArray(),span=this.u.uAirExtent.value.toArray(),dims=[31,23,31],q=p.map((v,k)=>Math.max(0,Math.min(1,(v-min[k])/span[k]))*dims[k]),base=q.map(Math.floor),f=q.map((v,k)=>v-base[k]),out=[0,0,0];for(let corner=0;corner<8;corner++){const c=base.map((v,k)=>Math.min(dims[k],v+((corner>>k)&1))),id=c.join(',');let value=this.nodes.get(id);if(!value){value=labAirVelocity(c.map((v,k)=>min[k]+v/dims[k]*span[k]),this.lab,this.jet);this.nodes.set(id,value);}const w=f.reduce((a,v,k)=>a*(((corner>>k)&1)?v:1-v),1);for(let k=0;k<3;k++)out[k]+=value[k]*w;}return out;}

}
