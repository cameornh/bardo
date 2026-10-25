// Test 12 only: a larger exposure range for radiometrically faint night skies.
// Isolated from the historical water lab exposure. Meter the visible HDR image: occlusion, glass and water
// therefore affect adaptation without a separate sun-visibility heuristic.
import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function exposureStatistics(pixels){
 const s=[0,0,0,0];
 for(let i=0;i<pixels.length;i+=4){const y=Math.max(0,pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722);if(!Number.isFinite(y))continue;s[0]+=Math.log(Math.max(1e-12,y));s[1]+=Math.max(0,y-32);s[2]=Math.max(s[2],y);s[3]++;}return s;
}
export function exposureTarget(s,{nightBrightness=1}={}){
 const average=Math.exp(s[0]/Math.max(1,s[3])),excess=s[1]/Math.max(1,s[3]);
 let night=1+(clamp((.003*nightBrightness+.022*smooth(1e-5,.001,average))/Math.max(average,1e-12),1,4e7)-1)*(1-smooth(.012,.04,average));
 // A thin lit horizon must not be blown out because black sky dominates
 // the logarithmic average. This only limits the dark-adaptation boost.
 night=Math.min(night,Math.max(1,.8/Math.max(1e-12,s[2])));
 const glare=smooth(.002,.06,excess)*smooth(32,100,s[2]);
 return night*(1-glare)+clamp(Math.sqrt(20/Math.max(20,s[2])),.08,1)*glare;
}
export function adaptExposure(value,target,dt){
 const tau=target<value?.72:target>1?6.4:2.6;
 return Math.exp(Math.log(value)+(Math.log(target)-Math.log(value))*(1-Math.exp(-Math.max(0,dt)/tau)));
}
export const EXPOSURE_REDUCE_GLSL=`precision highp float;precision highp int;
uniform sampler2D uInput;uniform bool uFirst;out vec4 outColor;
void main(){ivec2 base=ivec2(gl_FragCoord.xy)*4,size=textureSize(uInput,0);vec4 s=vec4(0);
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=base+ivec2(x,y);if(any(greaterThanEqual(p,size)))continue;vec4 v=texelFetch(uInput,p,0);
 if(uFirst){float l=max(0.,dot(v.rgb,vec3(.2126,.7152,.0722)));if(isnan(l)||isinf(l))continue;v=vec4(log(max(1e-12,l)),max(0.,l-32.),l,1.);}
 s.xy+=v.xy;s.z=max(s.z,v.z);s.w+=v.w;}outColor=s;}`;
export const EXPOSURE_ADAPT_GLSL=`precision highp float;
uniform sampler2D uStats,uPrevious;uniform float uDt,uNightBrightness;out vec4 outColor;
void main(){vec4 s=texelFetch(uStats,ivec2(0),0);float average=exp(s.x/max(1.,s.w)),excess=s.y/max(1.,s.w);
 float night=mix(1.,clamp((.003*max(1.,uNightBrightness)+.022*smoothstep(1e-5,.001,average))/max(average,1e-12),1.,4e7),1.-smoothstep(.012,.04,average));
 night=min(night,max(1.,.8/max(1e-12,s.z)));
 float glare=smoothstep(.002,.06,excess)*smoothstep(32.,100.,s.z);
 float target=mix(night,clamp(sqrt(20./max(20.,s.z)),.08,1.),glare);
 float previous=max(.001,texelFetch(uPrevious,ivec2(0),0).r),tau=target<previous?.72:target>1.?6.4:2.6;
 float value=exp(mix(log(previous),log(target),1.-exp(-max(0.,uDt)/tau)));
 outColor=vec4(value,target,average,excess);}`;
const output=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage,uExposure;
void main(){vec4 state=texelFetch(uExposure,ivec2(0),0);vec3 c=texture(uImage,vUv).rgb*state.r;
// Rod-dominated dark adaptation reduces chroma. It does not brighten faint
// structure when nearby lights keep the exposure low (perceptual skyglow).
float scotopic=(1.-smoothstep(1e-8,1e-5,state.b))*smoothstep(1e3,1e6,state.r);float y=dot(c,vec3(.2126,.7152,.0722));c=mix(c,y*vec3(.82,.96,1.12),scotopic*.72);c=c/(c+vec3(.7));outColor=vec4(pow(max(c,vec3(0)),vec3(1./2.2)),1.);}`;
export class LabExposure{
 constructor(renderer,{nightBrightness=1}={}){
  this.nightOptions={nightBrightness};
  this.renderer=renderer;this.camera=new THREE.Camera();this.geometry=new THREE.PlaneGeometry(2,2);this.levels=[];this.cpu=false;this.value=1;this.stats=[0,0,0,1];this.age=Infinity;
  this.seed=new THREE.DataTexture(new Float32Array([1,1,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);this.seed.needsUpdate=true;
  this.states=[this.target(1,1),this.target(1,1)];this.state=-1;
  const pass=(shader,uniforms)=>{const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:shader,uniforms,depthTest:false,depthWrite:false});const scene=new THREE.Scene();scene.add(new THREE.Mesh(this.geometry,material));return {scene,material,uniforms};};
  this.reduce=pass(EXPOSURE_REDUCE_GLSL,{uInput:{value:null},uFirst:{value:true}});
  this.adapt=pass(EXPOSURE_ADAPT_GLSL,{uStats:{value:null},uPrevious:{value:this.seed},uDt:{value:0},uNightBrightness:{value:nightBrightness}});
  this.output=pass(output,{uImage:{value:null},uExposure:{value:this.seed}});
 }
 target(w,h){return new THREE.WebGLRenderTarget(w,h,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});}
 get backend(){return this.cpu?'CPU reference':'GPU';}
 meter(image){
  const r=this.renderer;let w=image.width,h=image.height,texture=image.texture,i=0;
  do{w=Math.ceil(w/4);h=Math.ceil(h/4);let t=this.levels[i];if(!t)t=this.levels[i]=this.target(w,h);else if(t.width!==w||t.height!==h)t.setSize(w,h);
   this.reduce.uniforms.uInput.value=texture;this.reduce.uniforms.uFirst.value=i===0;r.setRenderTarget(t);r.render(this.reduce.scene,this.camera);texture=t.texture;i++;
  }while(w>1||h>1);
  while(this.levels.length>i)this.levels.pop().dispose();
  return texture;
 }
 update(image,dt,{dirty=true,cpu=false,meterImage=image}={}){
  const r=this.renderer;this.age+=dt;const switched=cpu!==this.cpu;this.cpu=cpu;
  if(cpu){
   if(switched&&this.state>=0){const v=new Float32Array(4);r.readRenderTargetPixels(this.states[this.state],0,0,1,1,v);this.value=v[0];}
   // This intentionally slow, explicit reference avoids GPU reduction. Readback
   // is throttled; the ordinary GPU path never waits for a readback.
   if((dirty&&this.age>=.2)||switched||!this.cpuPixels){this.cpuPixels=new Float32Array(meterImage.width*meterImage.height*4);r.readRenderTargetPixels(meterImage,0,0,meterImage.width,meterImage.height,this.cpuPixels);this.stats=exposureStatistics(this.cpuPixels);this.age=0;}
   this.value=adaptExposure(this.value,exposureTarget(this.stats,this.nightOptions),dt);this.seed.image.data.set([this.value,exposureTarget(this.stats,this.nightOptions),Math.exp(this.stats[0]/this.stats[3]),this.stats[1]/this.stats[3]]);this.seed.needsUpdate=true;this.output.uniforms.uExposure.value=this.seed;this.state=-1;
  }else{
   if(dirty||switched||!this.levels.length)this.adapt.uniforms.uStats.value=this.meter(meterImage);
   this.adapt.uniforms.uPrevious.value=this.state<0?this.seed:this.states[this.state].texture;this.adapt.uniforms.uDt.value=dt;this.state=(this.state+1)%2;r.setRenderTarget(this.states[this.state]);r.render(this.adapt.scene,this.camera);this.output.uniforms.uExposure.value=this.states[this.state].texture;
  }
  this.output.uniforms.uImage.value=image.texture;
 }
 present(image,dt,options){this.update(image,dt,options);this.renderer.setRenderTarget(null);this.renderer.render(this.output.scene,this.camera);}
 read(){if(this.cpu)return Array.from(this.seed.image.data);const a=new Float32Array(4);if(this.state>=0)this.renderer.readRenderTargetPixels(this.states[this.state],0,0,1,1,a);return Array.from(a);}
 dispose(){for(const t of [...this.levels,...this.states])t.dispose();this.seed.dispose();this.geometry.dispose();for(const p of [this.reduce,this.adapt,this.output])p.material.dispose();}
}
