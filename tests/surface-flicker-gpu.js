import {verifySandShadows} from './surface-shadow-verify.js';
import {verifyJoinedWaterOptics} from './surface-optics-verify.js';
import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer as SandRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {MotionDetail} from '../src/lod.js';
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
const $=id=>document.getElementById(id),result=$('result');
window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(480,330);document.body.append(r.domElement);r.domElement.style.cssText="width:100%;max-width:480px;height:auto";
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(JSON.stringify({fragment:gl.getShaderInfoLog(f),vertex:gl.getShaderInfoLog(v),program:gl.getProgramInfoLog(p),compiled:gl.getShaderParameter(f,gl.COMPILE_STATUS),linked:gl.getProgramParameter(p,gl.LINK_STATUS),lost:gl.isContextLost()}));};
const lab=new SandLab(r);installProgramSpecialization(r,()=>true);
lab.wind=0;lab.ambient=1;lab.sunlight=1;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;lab.paused=true;lab.enabled=true;
const camera=new THREE.PerspectiveCamera(44,480/330,.01,300),target=new THREE.WebGLRenderTarget(480,330,{type:THREE.FloatType}),output=new THREE.Scene();
output.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TONEMAP_FRAGMENT,uniforms:{uImage:{value:target.texture}},depthTest:false,depthWrite:false})));
const field={renderer:r,camera,target,output,quadCamera:new THREE.Camera(),resolution:new THREE.Vector2(480,330),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:.02}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};
const view=new SandRenderer(field,lab);view.adaptiveResolution=false;


function pixels(t){const a=new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,a);return a;}
function draw(){camera.updateMatrixWorld();view.render({dt:1/30,adaptive:false});r.getContext().finish();}
const next=()=>new Promise(requestAnimationFrame);lab.neighborCounts.fill(25);for(let i=0;i<lab.count;i+=31)lab.neighborCounts[i]=2;for(let i=0;i<8;i++){lab.time+=.05;view.blobRenderer.update(lab);}
const origin=[0,lab.sand.height(0,3),3];const group=lab.sand.extract(origin,.45,[0,0,0],true);for(const p of group)p.offset=p.position.map((v,k)=>v-origin[k]);lab.sand.update();lab.syncUniforms();
camera.position.set(0,2.7,4);camera.lookAt(0,1.05,0);
const debug=new THREE.Scene(),source=view.backgroundScene.children[0].material.fragmentShader;
debug.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:source.slice(0,source.lastIndexOf('void main()'))+`void main(){vec3 ray=rayAt(vUv);float t=traceOpaque(uEye,ray);vec3 p=uEye+ray*t;outColor=vec4(opaqueNormal(p),labOpaque(p));}`,uniforms:view.u,depthTest:false,depthWrite:false})));
const debugTarget=new THREE.WebGLRenderTarget(480,330,{type:THREE.FloatType,depthBuffer:false});
$('audit').onclick=async()=>{try{lab.sand.parcels=group;camera.position.set(0,2.7,4);camera.lookAt(0,1.05,0);const frames=[];for(let i=0;i<36;i++){
 const center=[-.35+i*.02,2.05,2+Math.sin(i*.3)*.1];for(const p of group)p.position=center.map((v,k)=>v+p.offset[k]);lab.sand.update();lab.syncUniforms();lab.revision++;draw();
 const bg=pixels(view.background),water=pixels(view.resolvedWater),o=(165*480+240)*4;
 r.setRenderTarget(debugTarget);r.render(debug,new THREE.Camera());const d=pixels(debugTarget);
 let visible=0,mismatches=0,invalid=0,minResidual=0,maxResidual=0;for(let j=0;j<bg.length;j+=4){if(bg[j+3]<2.8&&bg[j+3]>0){visible++;maxResidual=Math.max(maxResidual,Math.abs(d[j+3]));if(water[j+3]<bg[j+3]&&water[j+3]<2.8)mismatches++;if(d[j+3]<-.01)invalid++;minResidual=Math.min(minResidual,d[j+3]);}}frames.push({i,visible,mismatches,invalid,minResidual,maxResidual,z:center[2],bg:Array.from(bg.slice(o,o+4)),water:Array.from(water.slice(o,o+4)),normal:Array.from(d.slice(o,o+4))});
 result.textContent=JSON.stringify(frames,null,2);await next();
}draw();result.textContent=JSON.stringify({pass:frames.every(f=>f.visible>500&&f.invalid===0&&f.maxResidual<.00004),frames},null,2);}catch(e){result.textContent=e.stack;}};
const waterDebug=new THREE.Scene();waterDebug.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,uniforms:view.u,depthTest:false,depthWrite:false,fragmentShader:source.slice(0,source.lastIndexOf('void main()'))+`void main(){vec3 ray=rayAt(vUv);float front=texture(uFront,vUv).r,start=max(.005,1./max(.000001,front)-uSpacing),t=traceWater(uEye,ray,start,75.);vec3 p=uEye+ray*t,n=fluidNormal(p);if(dot(n,-ray)<0.)n=-n;vec3 refracted=refract(ray,n,1./WATER_IOR);float path=0.,pathStep=uSpacing*mix(.35,.9,smoothstep(3.,14.,t));for(int i=0;i<100;i++){if(rho(p+refracted*(path+pathStep*.5))<PARCEL_ISO)break;path+=pathStep;}outColor=vec4(rho(uEye+ray*start),path,dot(n,-ray),t);}`})));
$('water').onclick=async()=>{try{lab.sand.parcels=[];lab.sand.update();lab.revision++;camera.up.set(0,1,0);const frames=[];for(let i=0;i<30;i++){
 camera.position.set(-1+i*.024,2,-3.5);camera.lookAt(0,.7,3);draw();const a=pixels(view.water),merged=pixels(view.resolvedWater);r.setRenderTarget(debugTarget);r.render(waterDebug,new THREE.Camera());const diagnostic=pixels(debugTarget);let sum=0,mergedSum=0,n=0,missing=0;for(let j=0;j<a.length;j+=4){if(a[j+3]<100){sum+=a[j]+a[j+1]+a[j+2];mergedSum+=merged[j]+merged[j+1]+merged[j+2];n++;}else missing++;}let startsInside=0,zeroPath=0;for(let j=0;j<diagnostic.length;j+=4){if(diagnostic[j]>.18)startsInside++;if(diagnostic[j+1]===0&&diagnostic[j+3]<100)zeroPath++;}let mismatchedOptics=0,maxOpticalJump=0;for(let j=0;j<a.length;j+=4){if(a[j+3]<100&&Math.abs(a[j+3]-merged[j+3])<lab.spacing*.05){const delta=Math.abs(a[j]-merged[j])+Math.abs(a[j+1]-merged[j+1])+Math.abs(a[j+2]-merged[j+2]);if(delta>.2)mismatchedOptics++;maxOpticalJump=Math.max(maxOpticalJump,delta);}}frames.push({i,mean:sum/n,mergedMean:mergedSum/n,n,missing,startsInside,zeroPath,mismatchedOptics,maxOpticalJump});result.textContent=JSON.stringify(frames,null,2);await next();
}}catch(e){result.textContent=e.stack;}};
$('shadows').onclick=()=>{view.mediumShadows.enabled=!view.mediumShadows.enabled;draw();};
$('depth').onclick=()=>{view.u.uView.value=view.u.uView.value?0:1;draw();};
draw();

// A family whose conservative quad covers the bulk but contributes no density
// must not replace the bulk shading because of differing intersection precision.
$('empty').onclick=async()=>{try{
 camera.position.set(-1,2,-3.5);camera.lookAt(0,.7,3);view.drawKey=null;draw();
 const b=view.blobRenderer,saved=b.texture.image.data.slice();
 for(let i=0;i<b.geometry.instanceCount;i++)b.texture.image.data.fill(0,i*32+20,i*32+25);
 b.texture.needsUpdate=true;view.u.uImage.value=view.background.texture;
 r.setRenderTarget(view.blobs);r.setClearColor(0,0);r.clear();r.render(b.scene,camera);
 const a=pixels(view.blobs);let replacedPixels=0;for(let i=3;i<a.length;i+=4)if(a[i]>0)replacedPixels++;
 b.texture.image.data.set(saved);b.texture.needsUpdate=true;view.drawKey=null;draw();
 result.textContent=JSON.stringify({pass:replacedPixels===0,families:b.geometry.instanceCount,replacedPixels},null,2);
}catch(e){result.textContent=e.stack;}};

$('optics').onclick=()=>{try{result.textContent=JSON.stringify(verifyJoinedWaterOptics(r),null,2);}catch(e){result.textContent=e.stack;}};

// Reproduce holding-distance scrolling, rather than only sideways motion.
const holdButton=document.createElement('button');holdButton.textContent='Scroll held sand';document.body.insertBefore(holdButton,result);
const lightingDebug=new THREE.Scene();lightingDebug.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,uniforms:view.u,depthTest:false,depthWrite:false,fragmentShader:source.slice(0,source.lastIndexOf('void main()'))+`void main(){vec3 ray=rayAt(vUv);float t=traceOpaque(uEye,ray);vec3 p=uEye+ray*t,n=opaqueNormal(p);outColor=vec4(sunTransmission(p+n*.025,uScale).r,mediumSky(p+n*.025).r,dot(n,sun()),t);}`})));
holdButton.onclick=async()=>{try{lab.sand.parcels=group;camera.position.set(0,3.8,3);camera.lookAt(0,2,0);const ray=camera.getWorldDirection(new THREE.Vector3()),frames=[];for(let i=0;i<32;i++){
 const distance=2.9-i*.055,center=camera.position.clone().addScaledVector(ray,distance).toArray();for(const p of group)p.position=center.map((v,k)=>v+p.offset[k]);lab.sand.update();lab.syncUniforms();lab.revision++;lab.lightEditRevision=(lab.lightEditRevision||0)+1;draw();
 const bg=pixels(view.background);r.setRenderTarget(debugTarget);r.render(lightingDebug,new THREE.Camera());const light=pixels(debugTarget);let topCount=0,shadowed=0,minSun=1,minSky=1,mean=0;
 for(let j=0;j<light.length;j+=4)if(light[j+3]<distance+.65&&light[j+3]>distance-.9&&light[j+2]>.7){topCount++;if(light[j]<.5)shadowed++;minSun=Math.min(minSun,light[j]);minSky=Math.min(minSky,light[j+1]);mean+=(bg[j]+bg[j+1]+bg[j+2])/3;}
 frames.push({i,distance,center,topCount,shadowed,minSun,minSky,mean:mean/Math.max(1,topCount)});result.textContent=JSON.stringify(frames,null,2);await next();
 }draw();const maxRelativeBrightnessJump=Math.max(...frames.slice(1).map((f,i)=>Math.abs(f.mean-frames[i].mean)/Math.max(.01,frames[i].mean)));result.textContent=JSON.stringify({pass:maxRelativeBrightnessJump<.01,maxRelativeBrightnessJump,frames},null,2);}catch(e){result.textContent=e.stack;}};

const verifyShadows=document.createElement('button');verifyShadows.textContent='Verify sand shadow GPU / CPU';document.body.insertBefore(verifyShadows,result);verifyShadows.onclick=()=>{try{result.textContent=JSON.stringify(verifySandShadows(r),null,2);}catch(e){result.textContent=e.stack;}};
