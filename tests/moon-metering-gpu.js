import * as THREE from 'three';
import {CELESTIAL_GLSL} from '../src/sand-lab/celestial-sky.js';
import {NIGHT_LOOK} from '../src/sand-lab/night-look.js';
import {lunarPhase} from '../src/sand-lab/night-sky-model.js';
import {atmosphereSky,ATMOSPHERE_GLSL} from '../src/sand-lab/atmosphere-model.js';
import {LabExposure,exposureStatistics,exposureTarget} from '../src/sand-lab/sky-exposure.js';
import {QUAD_VERTEX} from '../src/shaders.js';
const $=id=>document.getElementById(id);
$('run').onclick=()=>{try{
 $('run').disabled=true;
 const r=new THREE.WebGLRenderer({canvas:$('view'),antialias:false,preserveDrawingBuffer:true});r.autoClear=false;r.setSize(256,128);
 r.debug.onShaderError=(gl,p,v,f)=>{throw Error([gl.getShaderInfoLog(f),gl.getShaderInfoLog(v),gl.getProgramInfoLog(p)].filter(Boolean).join('\n'));};
 const atlas=new THREE.DataTexture(new Float32Array(256*128*4).fill(1),256,128,THREE.RGBAFormat,THREE.FloatType);atlas.needsUpdate=true;
 const target=new THREE.WebGLRenderTarget(256,128,{type:THREE.FloatType,depthBuffer:false}),geometry=new THREE.PlaneGeometry(2,2),camera=new THREE.Camera();
 const u={uAtmosphere:{value:atlas},uMoonPhase:{value:1},uMoonSize:{value:1.7},uMoonElongation:{value:Math.PI},uMoonDirection:{value:new THREE.Vector3(0,1,0)},uSolarDirection:{value:new THREE.Vector3(0,-1,0)},uSolarRadiance:{value:new THREE.Vector3()},uCelestialRotation:{value:new THREE.Matrix3()},uDirectLightIntensity:{value:1},uDimMoon:{value:true},uMoonMeteringSafe:{value:true},uBackground:{value:new THREE.Vector3()},uZoom:{value:.008}};
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;in vec2 vUv;out vec4 outColor;uniform vec3 uSolarDirection,uBackground;uniform float uZoom;uniform sampler2D uAtmosphere;${CELESTIAL_GLSL}void main(){vec2 q=(vUv-.5)*vec2(4.,2.);vec3 d=normalize(vec3(q.x*uZoom,1,q.y*uZoom));outColor=vec4(celestialSky(d)+uBackground,1);}`,uniforms:u,depthTest:false,depthWrite:false});
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const pixels=new Float32Array(256*128*4),exposure=new LabExposure(r,{nightBrightness:2});
 const render=()=>{r.setRenderTarget(target);r.setViewport(0,0,256,128);r.render(scene,camera);r.readRenderTargetPixels(target,0,0,256,128,pixels);let peak=0;for(let i=0;i<pixels.length;i+=4)peak=Math.max(peak,pixels[i],pixels[i+1],pixels[i+2]);return peak;};
 const legacy=(()=>{u.uDimMoon.value=false;u.uMoonMeteringSafe.value=false;return render();})();u.uDimMoon.value=true;u.uMoonMeteringSafe.value=true;const live=render();
 u.uMoonMeteringSafe.value=false;const snapshotHalf=render()/legacy;u.uMoonMeteringSafe.value=true;
 u.uDirectLightIntensity.value=0;const off=render();u.uDirectLightIntensity.value=3;const triple=render();u.uDirectLightIntensity.value=1;
 u.uMoonPhase.value=.02;u.uMoonElongation.value=Math.acos(.96);const crescent=render();
 const phasePeakRatio=crescent/live,rows=[];u.uZoom.value=.2;
 for(const phase of [.005,.02,.1,.5,1]){
  u.uMoonPhase.value=phase;u.uMoonElongation.value=Math.acos(1-2*phase);
  u.uBackground.value.fromArray(atmosphereSky([0,1,0],[0,-1,0],{moonPhase:phase,moonPosition:[0,1,0],enhancedNightSky:true}));
  u.uDirectLightIntensity.value=0;render();const away=exposureTarget(exposureStatistics(pixels),{nightBrightness:2});
  u.uDirectLightIntensity.value=1;render();const looking=exposureTarget(exposureStatistics(pixels),{nightBrightness:2});
  exposure.update(target,1,{dirty:true});const gpu=exposure.read()[1];
  rows.push({phase,away,looking,ratio:looking/away,gpuTargetRelativeError:Math.abs(gpu-looking)/looking});
 }
 // Display a magnified crescent with the production output and real adaptation.
 u.uMoonPhase.value=.1;u.uMoonElongation.value=Math.acos(.8);u.uZoom.value=.008;render();exposure.present(target,60,{dirty:true});
 const small=new THREE.WebGLRenderTarget(3,1,{type:THREE.FloatType,depthBuffer:false}),p=new Float32Array(12);
 const skyMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 outColor;${ATMOSPHERE_GLSL}void main(){outColor=vec4(atmosphereSky(vec3(0,1,0),vec3(0,-1,0)),1);}`,uniforms:{uAtmosphereMoonDirection:{value:new THREE.Vector3(0,1,0)},uAtmosphereMoon:{value:1},uAtmosphereDirectLightDelta:{value:0},uEnhancedNightSky:{value:true},uAtmosphereRotation:{value:new THREE.Matrix3()}},depthTest:false,depthWrite:false});
 const skyScene=new THREE.Scene();skyScene.add(new THREE.Mesh(geometry,skyMaterial));let skyRelativeError=0;
 for(const gain of [0,1,3]){skyMaterial.uniforms.uAtmosphereDirectLightDelta.value=gain-1;r.setRenderTarget(small);r.render(skyScene,camera);r.readRenderTargetPixels(small,0,0,3,1,p);const cpu=atmosphereSky([0,1,0],[0,-1,0],{moonPhase:1,moonPosition:[0,1,0],enhancedNightSky:true,directLightIntensity:gain});for(let k=0;k<3;k++)skyRelativeError=Math.max(skyRelativeError,Math.abs(p[k]-cpu[k])/Math.max(1e-12,cpu[k]));}
 const report={pass:Math.abs(live/legacy-NIGHT_LOOK.moonDiscGain)<1e-9&&Math.abs(snapshotHalf-.5)<1e-6&&off===0&&Math.abs(triple/live-3)<1e-5&&phasePeakRatio<lunarPhase(.02)*2&&skyRelativeError<.03&&rows.every(q=>q.ratio>.9&&q.gpuTargetRelativeError<1e-4),discGain:live/legacy,snapshotHalf,offPeak:off,tripleGain:triple/live,crescentPeakRatio:phasePeakRatio,skyRelativeError,phaseMetering:rows};
 $('result').textContent=JSON.stringify(report,null,2);
 small.dispose();skyMaterial.dispose();exposure.dispose();target.dispose();atlas.dispose();geometry.dispose();material.dispose();r.dispose();
}catch(e){$('result').textContent=e.stack;}};
