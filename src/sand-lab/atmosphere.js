import {lunarState,moonPhaseState,LUNAR_MONTH} from './tides.js';
import {celestialMatrix,lunarDirection} from './night-sky-model.js';
import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {projectSH} from '../sh.js';
import {ATMOSPHERE_GLSL,atmosphereSky,atmosphereTransmission,DEFAULT_SUN} from './atmosphere-model.js';

function directionAt(x,y,w,h){const az=((x+.5)/w-.5)*2*Math.PI,v=(y+.5)/h*2-1,elevation=Math.sign(v)*v*v*Math.PI*.5;return [Math.cos(elevation)*Math.sin(az),Math.sin(elevation),Math.cos(elevation)*Math.cos(az)];}
const fragment=`precision highp float;in vec2 vUv;out vec4 outColor;uniform vec3 uAtmosphereSun;${ATMOSPHERE_GLSL}
void main(){float az=(vUv.x-.5)*6.283185307,v=vUv.y*2.-1.,el=sign(v)*v*v*1.570796327;vec3 d=vec3(cos(el)*sin(az),sin(el),cos(el)*cos(az));outColor=vec4(atmosphereSky(d,uAtmosphereSun),1);}`;
export class BeachAtmosphere{
 constructor(renderer){
  this.renderer=renderer;this.supported=renderer.extensions.has('EXT_color_buffer_float');this.cpu=!this.supported;
  const filter=renderer.extensions.has('OES_texture_float_linear')?THREE.LinearFilter:THREE.NearestFilter;
  this.fallback=new THREE.DataTexture(new Float32Array(48*24*4),48,24,THREE.RGBAFormat,THREE.FloatType);this.fallback.minFilter=this.fallback.magFilter=filter;this.fallback.wrapS=THREE.RepeatWrapping;
  const extinction=new Float32Array(128*4);for(let i=0;i<128;i++){const a=((i+.5)/128)**2*Math.PI/2;extinction.set([...atmosphereTransmission([0,.02,0],[Math.cos(a),Math.sin(a),0]),1],i*4);}
  // Tiny lighting lookup, independent of the star geometry. Render directly
  // into it: copyTextureToTexture queries GL state and stalled the frame queue.
  this.lookup=new THREE.WebGLRenderTarget(256,128,{type:THREE.FloatType,depthBuffer:false,minFilter:filter,magFilter:filter});
  this.lookup.viewport.set(0,0,192,96);renderer.initRenderTarget(this.lookup);
  this.atlas=this.lookup.texture;
  const data=new Float32Array(256*128*4);data.set(extinction,112*256*4);
  this.cpuLookup=new THREE.DataTexture(data,256,128,THREE.RGBAFormat,THREE.FloatType);this.cpuLookup.minFilter=this.cpuLookup.magFilter=filter;this.cpuLookup.needsUpdate=true;
  // One initialization upload. No texture copies or GL queries during updates.
  const ext=new THREE.DataTexture(extinction,128,1,THREE.RGBAFormat,THREE.FloatType);ext.needsUpdate=true;renderer.copyTextureToTexture(ext,this.atlas,null,new THREE.Vector2(0,112));ext.dispose();
  this.u={uAtmosphere:{value:this.atlas},uAtmosphereSize:{value:new THREE.Vector2(192,96)},uMoonPhase:{value:1},uMoonElongation:{value:Math.PI},uMoonSize:{value:1.7},uMoonDirection:{value:new THREE.Vector3()},uCelestialRotation:{value:new THREE.Matrix3()},uSolarRadiance:{value:new THREE.Vector3()}};
  this.uniforms={uEnhancedNightSky:{value:false},uAtmosphereSun:{value:new THREE.Vector3(...DEFAULT_SUN)},uAtmosphereMoon:{value:1},uAtmosphereMoonDirection:{value:new THREE.Vector3()},uAtmosphereRotation:{value:new THREE.Matrix3().fromArray(celestialMatrix())}};
  this.geometry=new THREE.PlaneGeometry(2,2);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.revision=0;
 }
 update(lab,sh){
  this.cpu=lab.gpu.cpu||!this.supported;const sun=lab.u.uSolarDirection.value.toArray(),lunar=lunarState(lab.lunarDay??LUNAR_MONTH/2),phase=moonPhaseState(lab),options={enhancedNightSky:!!lab.enhancedNightSky,moonPhase:phase.illuminated,day:lab.day,elongation:phase.elongation,moonPosition:lunarDirection(lunar.elongation)},key=`${Math.round(lab.day*50)}:${Math.round(lunar.age*200)}:${Math.round(phase.age*200)}:${lab.sunIntensity}:${this.cpu}:${options.enhancedNightSky}`;const changed=key!==this.key;this.uniforms.uEnhancedNightSky??={value:false};this.uniforms.uEnhancedNightSky.value=options.enhancedNightSky;this.uniforms.uAtmosphereSun.value.fromArray(sun);this.uniforms.uAtmosphereMoon.value=options.moonPhase;this.uniforms.uAtmosphereMoonDirection.value.fromArray(options.moonPosition);this.u.uMoonDirection.value.copy(this.uniforms.uAtmosphereMoonDirection.value);this.uniforms.uAtmosphereRotation.value.fromArray(celestialMatrix(options.day));this.u.uMoonPhase.value=options.moonPhase;this.u.uMoonElongation.value=phase.elongation;this.u.uMoonSize.value=lab.moonSize??1.7;this.u.uCelestialRotation.value.copy(this.uniforms.uAtmosphereRotation.value);
  // The visible solar disc must not inherit the active (possibly lunar) light.
  this.u.uSolarRadiance.value.fromArray(atmosphereTransmission([0,.02,0],sun).map(v=>v*22/(Math.PI*.00465**2)*(lab.sunIntensity??1)));if(!changed)return false;this.key=key;
  if(this.cpu){const {data,width,height}=this.fallback.image;for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...atmosphereSky(directionAt(x,y,width,height),sun,options),1],(y*width+x)*4);for(let y=0;y<height;y++)this.cpuLookup.image.data.set(data.subarray(y*width*4,(y+1)*width*4),y*256*4);this.cpuLookup.needsUpdate=true;this.u.uAtmosphere.value=this.cpuLookup;this.u.uAtmosphereSize.value.set(48,24);}
  else{const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.lookup);this.renderer.render(this.scene,this.camera);this.u.uAtmosphere.value=this.atlas;this.renderer.setRenderTarget(old);this.u.uAtmosphereSize.value.set(192,96);}
  // Only 64 directions on the CPU, when solar angle changes. No GPU readback
  // or atmosphere march in the main water / foam / reflection passes.
  const coeff=projectSH(d=>atmosphereSky(d,sun,options));sh.forEach((v,i)=>v.fromArray(coeff,i*3));this.revision++;
  const samples=new Map();lab.skyRadiance=d=>{const key=d.join(',');if(!samples.has(key))samples.set(key,atmosphereSky(d,sun,options));return samples.get(key);};return true;
 }
 verify(){
  if(!this.supported)return {backend:'CPU fallback',pass:null,reason:'Float render targets unavailable'};
  const directions=[[0,1,0],[1,.001,0],[-1,.03,0],[0,.15,1],[.8,.5,.3],[0,-1,0]],suns=[[1,.7,.2],[-1,.03,.1],[1,-.14,0]].map(d=>d.map(v=>v/Math.hypot(...d)));
  const rays=directions.map(d=>new THREE.Vector3(...d).normalize()),stars=suns.map(d=>new THREE.Vector3(...d)),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 outColor;uniform vec3 uRays[6],uStars[3];${ATMOSPHERE_GLSL.replace(/uniform vec3 uAtmosphereMoonDirection;/,'vec3 uAtmosphereMoonDirection;')}void main(){uAtmosphereMoonDirection=-uStars[int(gl_FragCoord.y)];outColor=vec4(atmosphereSky(uRays[int(gl_FragCoord.x)],uStars[int(gl_FragCoord.y)]),1);}`,uniforms:{uRays:{value:rays},uStars:{value:stars},uAtmosphereMoon:{value:1},uAtmosphereMoonDirection:{value:new THREE.Vector3()},uAtmosphereRotation:{value:new THREE.Matrix3().fromArray(celestialMatrix())}},depthTest:false,depthWrite:false}),scene=new THREE.Scene(),target=new THREE.WebGLRenderTarget(6,3,{type:THREE.FloatType,depthBuffer:false});scene.add(new THREE.Mesh(this.geometry,material));const data=new Float32Array(6*3*4),old=this.renderer.getRenderTarget();
  try{this.renderer.setRenderTarget(target);this.renderer.render(scene,this.camera);this.renderer.readRenderTargetPixels(target,0,0,6,3,data);}finally{this.renderer.setRenderTarget(old);target.dispose();material.dispose();}
  let error=0;for(let y=0;y<3;y++)for(let x=0;x<6;x++){const reference=atmosphereSky(rays[x].toArray(),suns[y]);for(let k=0;k<3;k++)error=Math.max(error,Math.abs(data[(y*6+x)*4+k]-reference[k]));}
  return {backend:'GPU',samples:18,maxRadianceError:error,tolerance:.0001,pass:Number.isFinite(error)&&error<.0001};
 }
 dispose(){for(const resource of [this.fallback,this.lookup,this.cpuLookup,this.geometry,this.material])resource.dispose();}
}
