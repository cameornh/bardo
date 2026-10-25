import * as THREE from 'three';
import {StarGaussians} from '../src/sand-lab/star-gaussians.js';
import {celestialMatrix,nightBackground,NIGHT_MODEL_GLSL} from '../src/sand-lab/night-sky-model.js';
import {NIGHT_LOOK_GLSL,starVisibility} from '../src/sand-lab/night-look.js';
import {GALACTIC_AXIS,GALACTIC_SIDE,GALACTIC_POLE,straightGalacticBand} from '../src/sand-lab/galactic-band.js';
import {QUAD_VERTEX} from '../src/shaders.js';
import {ATMOSPHERE_GLSL,atmosphereSky} from '../src/sand-lab/atmosphere-model.js';
const $=id=>document.getElementById(id);let r,u,camera,target,stars,base,display;
function setup(){
 if(r)return;r=new THREE.WebGLRenderer({canvas:$('view'),antialias:false,preserveDrawingBuffer:true});r.autoClear=false;r.setSize(720,450);
 r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getProgramInfoLog(p)||gl.getShaderInfoLog(f));};
 camera=new THREE.PerspectiveCamera(65,720/450,.01,20);camera.lookAt(new THREE.Vector3(-.87,.49,-.06).applyMatrix3(new THREE.Matrix3().fromArray(celestialMatrix(0)).transpose()));camera.updateMatrixWorld();
 const tex=(data,w=1,h=1)=>{const t=new THREE.DataTexture(new Float32Array(data),w,h,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;},atmo=new Float32Array(256*128*4);for(let i=0;i<atmo.length;i+=4)atmo.set([1,1,1,1],i);
 u={uOpaqueRead:{value:tex([0,0,0,1e6])},uWaterSurface:{value:tex([0,0,0,1e6])},uAtmosphere:{value:tex(atmo,256,128)},uResolution:{value:new THREE.Vector2(720,450)},uMoonDirection:{value:new THREE.Vector3(0,-1,0)},uMoonSize:{value:1.7},uSolarDirection:{value:new THREE.Vector3(0,-1,0)},uCelestialRotation:{value:new THREE.Matrix3().fromArray(celestialMatrix(0))},uViewMatrix:{value:camera.matrixWorldInverse},uProjection:{value:camera.projectionMatrix},uInverseProjection:{value:camera.projectionMatrixInverse},uCameraMatrix:{value:camera.matrixWorld}};
 stars=new StarGaussians(u,{enhanced:true});target=new THREE.WebGLRenderTarget(720,450,{type:THREE.FloatType,depthBuffer:false});
 const quad=(source,uniforms)=>{const s=new THREE.Scene();s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:source,uniforms,depthTest:false,depthWrite:false})));return s;};
 base=quad(`precision highp float;in vec2 vUv;out vec4 outColor;uniform mat4 uInverseProjection,uCameraMatrix;uniform mat3 uCelestialRotation;uniform vec3 uSolarDirection;${NIGHT_MODEL_GLSL}void main(){vec4 p=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 d=normalize(mat3(uCameraMatrix)*p.xyz/p.w);outColor=vec4(straightNightBackground(d,uSolarDirection,uCelestialRotation),1);}`,u);
 display=quad('precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage;uniform float uExposure;void main(){vec3 c=texture(uImage,vUv).rgb*uExposure;c=c/(c+vec3(.7));outColor=vec4(pow(max(c,vec3(0)),vec3(1./2.2)),1);}',{uImage:{value:target.texture},uExposure:{value:1}});
}
function render(mode){setup();const exposure=mode==='moonless'?2e6:mode==='partial'?2e5:mode==='moonlit'?12:10,average=['moonless','partial'].includes(mode)?1e-9:mode==='moonlit'?1e-6:.02;
 const t=new THREE.DataTexture(new Float32Array([exposure,exposure,average,0]),1,1,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;
 const e={output:{uniforms:{uExposure:{value:t}}}};r.setRenderTarget(target);r.render(base,new THREE.Camera());stars.time=1;stars.render(r,camera,e,0);
 const pixels=new Float32Array(720*450*4);r.readRenderTargetPixels(target,0,0,720,450,pixels);
 let nonFinite=0,lit=0,total=0,min=Infinity,max=0;for(let i=0;i<pixels.length;i+=4){const y=(pixels[i]+pixels[i+1]+pixels[i+2])/3*exposure;if(!Number.isFinite(y))nonFinite++;min=Math.min(min,y);max=Math.max(max,y);total+=y;if(y>.08)lit++;}
 display.children[0].material.uniforms.uExposure.value=exposure;r.setRenderTarget(null);r.render(display,new THREE.Camera());t.dispose();
 const report={mode,catalogueStars:stars.geometry.instanceCount,imageType:'32-bit float (preserves sub-half-float night radiance)',actualExposure:exposure,faintStarVisibility:starVisibility(exposure,6),brightPixels:lit,meanRadiance:total/(720*450),minimumRadiance:min,maximumRadiance:max,nonFinite};$('result').textContent=JSON.stringify(report,null,2);return report;
}
for(const id of ['moonless','partial','moonlit','polluted'])$(id).onclick=()=>{try{render(id);}catch(e){$('result').textContent=e.stack;}};
$('verify').onclick=()=>{try{setup();
 const rotation=new THREE.Matrix3().fromArray(celestialMatrix(0)),inverseRotation=rotation.clone().transpose();
 const testRays=[-.07,0,.07].map(lat=>new THREE.Vector3(...GALACTIC_AXIS.map((v,i)=>(v*Math.cos(.8)+GALACTIC_SIDE[i]*Math.sin(.8))*Math.cos(lat)+GALACTIC_POLE[i]*Math.sin(lat))).applyMatrix3(inverseRotation));
 const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 outColor;uniform vec3 uTestRays[3];uniform mat3 uTestRotation;${NIGHT_LOOK_GLSL}${NIGHT_MODEL_GLSL}void main(){int i=int(gl_FragCoord.x);float exposure=i==0?12.:i==1?2e5:2e6;vec3 d=uTestRays[i];outColor=vec4(starVisibility(exposure,6.),straightNightBackground(d,vec3(0,-1,0),uTestRotation).r,straightGalacticBand(uTestRotation*d),1);}`,uniforms:{uTestRays:{value:testRays},uTestRotation:{value:rotation}},depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(geometry,material));
 const check=new THREE.WebGLRenderTarget(3,1,{type:THREE.FloatType,depthBuffer:false}),p=new Float32Array(12);r.setRenderTarget(check);r.render(scene,new THREE.Camera());r.readRenderTargetPixels(check,0,0,3,1,p);
 let maxVisibilityError=0,maxBackgroundError=0,maxBandError=0;for(let i=0;i<3;i++){maxVisibilityError=Math.max(maxVisibilityError,Math.abs(p[i*4]-starVisibility([12,2e5,2e6][i],6)));maxBackgroundError=Math.max(maxBackgroundError,Math.abs(p[i*4+1]-nightBackground(testRays[i].toArray(),[0,-1,0],0,{straightBand:true})[0]));maxBandError=Math.max(maxBandError,Math.abs(p[i*4+2]-straightGalacticBand(testRays[i].clone().applyMatrix3(rotation).toArray())));}
 const bandMirrorError=Math.abs(p[2]-p[10]);
 const rays=[[0,1,0],[.8,.6,0],[.99,.14,0]].map(d=>new THREE.Vector3(...d).normalize()),atmosphereMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 outColor;uniform vec3 uRays[3];${ATMOSPHERE_GLSL}void main(){outColor=vec4(atmosphereSky(uRays[int(gl_FragCoord.x)],vec3(0,-1,0)),1);}`,uniforms:{uRays:{value:rays},uAtmosphereMoonDirection:{value:new THREE.Vector3(0,1,0)},uAtmosphereMoon:{value:1},uAtmosphereRotation:{value:new THREE.Matrix3()},uEnhancedNightSky:{value:true}},depthTest:false,depthWrite:false});
 const atmosphereScene=new THREE.Scene();atmosphereScene.add(new THREE.Mesh(geometry,atmosphereMaterial));r.setRenderTarget(check);r.render(atmosphereScene,new THREE.Camera());r.readRenderTargetPixels(check,0,0,3,1,p);
 let moonScatterError=0,moonScatterRelativeError=0;for(let i=0;i<3;i++){const cpu=atmosphereSky(rays[i].toArray(),[0,-1,0],{moonPhase:1,moonPosition:[0,1,0],enhancedNightSky:true});for(let k=0;k<3;k++){const error=Math.abs(p[i*4+k]-cpu[k]);moonScatterError=Math.max(moonScatterError,error);moonScatterRelativeError=Math.max(moonScatterRelativeError,error/Math.max(1e-12,cpu[k]));}}
 const moonless=render('moonless'),partial=render('partial'),moonlit=render('moonlit'),polluted=render('polluted');render('moonless');
 const exposureResponse=moonless.maximumRadiance/partial.maximumRadiance;
 $('result').textContent=JSON.stringify({pass:maxVisibilityError<1e-6&&maxBackgroundError<1e-14&&maxBandError<1e-5&&bandMirrorError<1e-5&&moonScatterRelativeError<.05&&exposureResponse>9.5&&exposureResponse<12&&moonless.brightPixels>100&&moonlit.meanRadiance<moonless.meanRadiance/1e4,maxVisibilityError,maxBackgroundError,maxBandError,bandMirrorError,exposureResponse,moonScatterError,moonScatterRelativeError,moonless,partial,moonlit,polluted},null,2);
 atmosphereMaterial.dispose();
 check.dispose();material.dispose();geometry.dispose();
 }catch(e){$('result').textContent=e.stack;}};
