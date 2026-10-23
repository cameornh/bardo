import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {RAIN_SAMPLE_GLSL,rainVisualPoint,rainVisualCount} from '../src/sand-lab/rain-appearance.js';
import {QUAD_VERTEX} from '../src/shaders.js';
const result=document.querySelector('#result'),r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(800,500);document.body.insertBefore(r.domElement,result);
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getShaderInfoLog(f)||gl.getProgramInfoLog(p));};window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const lab=new SandLab(r);lab.paused=true;lab.wind=0;lab.lunarCycle=false;lab.wetting.cameraEnabled=false;lab.neighborCounts=new Float32Array(lab.count).fill(26);
const camera=new THREE.PerspectiveCamera(55,1.6,.01,300),target=new THREE.WebGLRenderTarget(800,500,{type:THREE.FloatType}),field={renderer:r,camera,target,resolution:new THREE.Vector2(800,500),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};installProgramSpecialization(r,()=>true);
const view=new WaterLabRenderer(field,lab);view.adaptiveResolution=false;view.mediumShadows.u.uMediumSize.value.set(16,12,16);
function pixels(t){const p=new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,p);return p;}
function draw(){camera.updateMatrixWorld();view.render({dt:1/30,adaptive:false});}
function stats(){const data=pixels(target);let max=0,invalid=0;for(let i=0;i<data.length;i+=4){max=Math.max(max,data[i],data[i+1],data[i+2]);if(!Number.isFinite(data[i]+data[i+1]+data[i+2]))invalid++;}return {max,invalid,programs:r.info.programs.length};}
function seedFoam(){
 const d=lab.detail;d.reset();d.enabled=true;d.activeSpan=d.count=d.emitted=16;
 for(let i=0;i<16;i++){d.fallback[0].image.data.set([-.8+(i%4)*.45,.65+Math.floor(i/4)*.15,-.2-Math.floor(i/4)*.5,.4],i*4);d.fallback[1].image.data.set([0,0,0,20],i*4);d.fallback[2].image.data.set([.022,2,.8,100],i*4);}for(const t of d.fallback)t.needsUpdate=true;
}
function lights(above=false){lab.rain.enabled=false;view.rainLastRate=0;lab.day=0;lab.sunIntensity=0;lab.skyIntensity=.1;lab.lunarDay=0;lab.wind=0;lab.time=1;lab.balls=[];
 for(const [x,z,c] of [[-.4,-1,[.02,1,.65]],[1,-2,[1,.32,.08]]]){const b=makeBody('light','sphere',.16,[x,.8,z]);b.color=c;lab.balls.push(b);}
 seedFoam();
 camera.up.set(0,1,0);camera.position.set(...(above?[4,4,6]:[0,.85,2.5]));camera.lookAt(0,above?1:.85,-1);lab.revision++;lab.lightEditRevision++;lab.syncUniforms();draw();view.exposure.present(target,180,{dirty:true});result.textContent=JSON.stringify({fixture:above?'above water / horizon':'underwater foam / lights',...stats()},null,2);
}
let animate=false,last=0;
function rain(){lab.detail.enabled=false;lab.balls=[];lab.day=14;lab.sunIntensity=1;lab.skyIntensity=1;lab.rain.rate=12000;lab.rain.enabled=true;lab.wind=18;lab.time=2;camera.position.set(3,2.6,4.2);camera.lookAt(0,1.5,-2);lab.syncUniforms();lab.revision++;draw();view.exposure.present(target,180,{dirty:true});lab.time=4;animate=true;result.textContent=JSON.stringify({fixture:'high rain',visualDrops:rainVisualCount(lab.rain.rate,lab.spec.scale,lab.resolution)},null,2);}
function tick(t){requestAnimationFrame(tick);if(!animate||t-last<1000/15)return;lab.time+=Math.min(.1,(t-last)/1000);last=t;lab.revision++;draw();}requestAnimationFrame(tick);
document.querySelector('#rain').onclick=rain;document.querySelector('#under').onclick=()=>{animate=false;lights();};document.querySelector('#above').onclick=()=>{animate=false;lights(true);};
document.querySelector('#numeric').onclick=async()=>{animate=false;try{await view.objectProgramsReady;
 const scene=new THREE.Scene(),g=new THREE.PlaneGeometry(2,2),m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;out vec4 color;${RAIN_SAMPLE_GLSL}void main(){uint id=uint(gl_FragCoord.x);color=vec4(rainVisualPoint(id,17.3,vec3(1.8,-.9,.24),vec2(5.5,4.9),8.5,-.8),1);}`,depthTest:false,depthWrite:false}),t=new THREE.WebGLRenderTarget(1024,1,{type:THREE.FloatType,depthBuffer:false});scene.add(new THREE.Mesh(g,m));r.setRenderTarget(t);r.render(scene,new THREE.Camera());const gpu=pixels(t);let error=0;for(let i=0;i<1024;i++)rainVisualPoint(i,17.3,[1.8,-.9,.24]).forEach((v,k)=>error=Math.max(error,Math.abs(gpu[i*4+k]-v)));t.dispose();g.dispose();m.dispose();
 seedFoam();lab.balls=[];lab.revision++;draw();await r.warmObjectPrograms([],camera);const before=r.info.programs.length,spawnStart=performance.now();lights(true);const firstSpawnMs=performance.now()-spawnStart,first=r.info.programs.length;lab.balls.push(makeBody('light','sphere',.15,[2,.8,-1]));lab.revision++;draw();const second=r.info.programs.length;
 result.textContent=JSON.stringify({backend:'GPU',rainSamples:1024,error,firstSpawnMs,programsBeforeObject:before,programsFirstObject:first,programsSecondObject:second,...stats(),pass:error<1e-4&&first===before&&second===first},null,2);
 }catch(e){result.textContent=e.stack;}};
camera.position.set(4,3,6);camera.lookAt(0,1,0);draw();result.textContent='Ready';

// Closed-form GPU transport comparison: the water occupies [-1,1], while
// receivers move out to 50 units in air. The water path must remain .9 units.
async function lightingChecks(){
 const {LOCAL_LIGHT_GLSL,LIGHT_BALL_RADIANCE}=await import('../src/sand-lab/local-light.js');
 const distances=[.5,1,2,10,50],bodyData=new THREE.DataTexture(new Float32Array([0,0,0,.1,0,0,0,3]),2,1,THREE.RGBAFormat,THREE.FloatType);bodyData.needsUpdate=true;
 const uniforms={uBodies:{value:bodyData},uOccluded:{value:false}},scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),probe=new THREE.WebGLRenderTarget(5,1,{type:THREE.FloatType,depthBuffer:false});
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,uniforms,fragmentShader:`precision highp float;precision highp int;out vec4 color;uniform sampler2D uBodies;uniform bool uOccluded;
 const int uBodyCount=1;const float uScale=1.,uTannins=0.,uTurbidity=0.,uLights=1.,uFieldDx=1.;const vec3 uFieldOrigin=vec3(-1),uFieldSize=vec3(3);
 vec4 labBody(int i){return vec4(0,0,0,.1);}vec4 bodyExtra(int i,int j){return vec4(1);}
 vec4 parcelSample(vec3 p){return vec4(1,0,0,0);}vec3 soluteExtinction(vec3 c,float t,float b){return vec3(.3,.2,.1);}
 vec3 bodyTransmissionExcept(vec3 p,vec3 d,float t,float s,float r,float a,int i){return vec3(1);}
 float labOpaque(vec3 p){return uOccluded?-1.:100.;}float phaseHG(float c,float g){return (1.-g*g)/(12.5663706*pow(1.+g*g-2.*g*c,1.5));}
 ${LOCAL_LIGHT_GLSL}
 void main(){float d[5]=float[5](.5,1.,2.,10.,50.);color=vec4(objectLight(vec3(d[int(gl_FragCoord.x)],0,0),0),1);}`,depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(geometry,material));r.setRenderTarget(probe);r.render(scene,new THREE.Camera());const got=pixels(probe);let relative=0;
 for(let i=0;i<5;i++)for(let k=0;k<3;k++){const d=distances[i],expected=LIGHT_BALL_RADIANCE*.01/(d*d+.01)*Math.exp(-[.3,.2,.1][k]*Math.min(.9,d-.1));relative=Math.max(relative,Math.abs(got[i*4+k]-expected)/expected);}
 uniforms.uOccluded.value=true;r.setRenderTarget(probe);r.render(scene,new THREE.Camera());const buried=pixels(probe),blocked=distances.every((_,i)=>buried[i*4]+buried[i*4+1]+buried[i*4+2]===0);for(const v of [material,geometry,probe,bodyData])v.dispose();
 lights(false);const foam=pixels(target),coverage=pixels(view.detailRenderer.target);lab.detail.enabled=false;lab.revision++;draw();const clear=pixels(target);let ratio=1,mean=0,n=0;
 for(let i=0;i<foam.length;i+=4)if(coverage[i+3]>.02){const a=foam[i]+foam[i+1]+foam[i+2],b=clear[i]+clear[i+1]+clear[i+2];ratio=Math.min(ratio,a/Math.max(1e-20,b));mean+=a/Math.max(1e-20,b);n++;}
 const cores=lab.balls.map(b=>{const q=new THREE.Vector3(...b.position).project(camera),x=Math.round((q.x*.5+.5)*target.width),y=Math.round((q.y*.5+.5)*target.height),o=(y*target.width+x)*4;const core=clear[o]+clear[o+1]+clear[o+2],neighbor=(y*target.width+x+35)*4,halo=clear[neighbor]+clear[neighbor+1]+clear[neighbor+2];return {core,halo,pass:core>halo};});
 lights(true);const bg=pixels(view.background);let farMax=0,nearMax=0;for(let i=0;i<bg.length;i+=4){const L=bg[i]+bg[i+1]+bg[i+2];if(bg[i+3]>15&&bg[i+3]<9999)farMax=Math.max(farMax,L);if(bg[i+3]<10)nearMax=Math.max(nearMax,L);}
 result.textContent=JSON.stringify({waterAttenuationRelativeError:relative,buriedLightBlocked:blocked,foamPixels:n,minimumFoamToWaterRatio:ratio,meanFoamToWaterRatio:mean/n,cores,groundFarMax:farMax,groundNearMax:nearMax,pass:relative<1e-4&&blocked&&n>0&&ratio>.85&&cores.every(x=>x.pass)&&farMax<nearMax},null,2);
}
const lightingButton=document.createElement('button');lightingButton.textContent='Light transport checks';lightingButton.onclick=()=>{animate=false;lightingChecks().catch(e=>result.textContent=e.stack);};document.body.insertBefore(lightingButton,r.domElement);
const benchButton=document.createElement('button');benchButton.textContent='Render cost checks';document.body.insertBefore(benchButton,r.domElement);
benchButton.onclick=async()=>{animate=false;try{await view.objectProgramsReady;
 lab.detail.enabled=false;lab.balls=[];lab.rain.enabled=false;lab.day=14;lab.sunIntensity=lab.skyIntensity=1;lab.wind=18;lab.time=1;camera.position.set(3,2.6,4.2);camera.lookAt(0,1.5,-2);lab.revision++;lab.syncUniforms();draw();
 const fence=new Float32Array(4),frame=()=>{const t=performance.now();lab.time+=1/30;draw();r.readRenderTargetPixels(target,0,0,1,1,fence);return performance.now()-t;},measure=async()=>{for(let i=0;i<3;i++)frame();const samples=[];for(let i=0;i<12;i++){samples.push(frame());await new Promise(resolve=>setTimeout(resolve,0));}return {meanMs:samples.reduce((s,v)=>s+v,0)/samples.length,minMs:Math.min(...samples),maxMs:Math.max(...samples)};};
 const clear=await measure();lab.rain.enabled=true;lab.rain.rate=12000;frame();lab.time+=1;const rain=await measure();lab.rain.enabled=false;frame();lab.time+=1;frame();
 const programs=r.info.programs.length;lab.balls=[makeBody('light','sphere',.16,[0,.8,-1])];const firstLightMs=frame(),lit=await measure();const stable=programs===r.info.programs.length;lab.balls=[];lab.revision++;draw();
 result.textContent=JSON.stringify({resolution:[target.width,target.height],simulation:'paused; rendering and display-only rain measured',clear,heavyRain:rain,additionalHeavyRainMs:rain.meanMs-clear.meanMs,firstLightMs,subsequentLight:lit,noNewPrograms:stable,pass:stable&&rain.meanMs<clear.meanMs+30&&firstLightMs<1000},null,2);
 }catch(e){result.textContent=e.stack;}};
const horizonButton=document.createElement('button');horizonButton.textContent='Dark-adapted horizon';document.body.insertBefore(horizonButton,r.domElement);
horizonButton.onclick=()=>{animate=false;lights(true);camera.position.set(0,2.4,2.5);camera.lookAt(0,2,20);draw();view.exposure.present(target,180,{dirty:true});const p=pixels(target),s=view.exposure.read();result.textContent=JSON.stringify({fixture:'dark horizon with submerged lamps',exposure:s[0],maxRadiance:stats().max,nonFinite:p.filter(v=>!Number.isFinite(v)).length,stages:Object.fromEntries(['background','water','resolvedWater','composite','shellTarget'].map(k=>[k,pixels(view[k]).filter(v=>!Number.isFinite(v)).length]))},null,2);};
const initialBed=lab.sand.base.slice();
const objectCheck=document.createElement('button');objectCheck.textContent='Object ground comparison';document.body.insertBefore(objectCheck,r.domElement);
async function objectComparison(night=false){animate=false;await view.objectProgramsReady;lab.rain.enabled=false;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;lab.day=night?23.25:6.5;lab.sunIntensity=night?0:.2;lab.skyIntensity=night?.1:1;lab.lunarCycle=false;lab.time=2;lab.balls=[];for(let i=0;i<lab.sand.mass.length;i++){const x=i%lab.sand.n*lab.sand.dx-5.5,z=Math.floor(i/lab.sand.n)*lab.sand.dz-4.9;lab.sand.base[i]=initialBed[i]+.65*Math.exp(-((x+2)**2+(z-3)**2));lab.sand.wet[i]=.6;}lab.sand.parcels=[{id:1,position:[-1,1.8,3.5],velocity:[0,0,0],mass:.08,packing:.6,wet:1,memory:1,anchored:true,held:false}];lab.sand.update();camera.position.set(0,2.4,-4);camera.lookAt(0,1.8,4);lab.syncUniforms();lab.revision++;draw();const before=pixels(view.background),finalBefore=pixels(view.shellTarget),pixelsDepth=pixels(view.resolvedWater);
 const compare=()=>{const after=pixels(view.background);let count=0,sum=0,max=0,depth=0,finalChanged=0,finalMax=0,relativeMax=0;const final=pixels(view.shellTarget);for(let i=0;i<before.length;i+=4)if(before[i+3]>2&&before[i+3]<9999){const d=Math.max(...[0,1,2].map(k=>Math.abs(after[i+k]-before[i+k])));if(d>.001)count++;sum+=d;max=Math.max(max,d);depth=Math.max(depth,Math.abs(after[i+3]-before[i+3]));if(before[i+3]<pixelsDepth[i+3]){const d2=Math.max(...[0,1,2].map(k=>Math.abs(final[i+k]-finalBefore[i+k])));if(d2>.002)finalChanged++;finalMax=Math.max(finalMax,d2);relativeMax=Math.max(relativeMax,d2/Math.max(1e-20,finalBefore[i],finalBefore[i+1],finalBefore[i+2]));}}return {count,sum,max,depth,finalChanged,finalMax,relativeMax};};
 const records={};for(const material of ['glass','mirror','rock','light']){lab.balls=[makeBody(material,'sphere',.3,[0,1,-1])];lab.revision++;draw();records[material]=compare();view.u.uBodyShadows.value=false;draw();records[material+'WithoutShadows']=compare();view.u.uBodyShadows.value=true;}
 result.textContent=JSON.stringify({records,pass:['glass','mirror','rock'].every(k=>records[k].relativeMax<.01)&&Object.values(records).every(v=>Number.isFinite(v.finalMax))},null,2);view.exposure.present(target,180,{dirty:true});}
objectCheck.onclick=()=>objectComparison().catch(e=>result.textContent=e.stack);
const nightObjects=document.createElement('button');nightObjects.textContent='Night object comparison';nightObjects.onclick=()=>objectComparison(true).catch(e=>result.textContent=e.stack);document.body.insertBefore(nightObjects,r.domElement);

const settleButton=document.createElement('button');settleButton.textContent='Settle water 5 seconds';document.body.insertBefore(settleButton,r.domElement);
settleButton.onclick=async()=>{animate=false;try{lab.wind=13;lab.detail.enabled=false;for(let i=0;i<60;i++){lab.step(1/12);if(i%10===0){result.textContent='Settling '+i+'/60';draw();await new Promise(resolve=>setTimeout(resolve,0));}}result.textContent='Settled';draw();}catch(e){result.textContent=e.stack;}};
const rainResponseButton=document.createElement('button');rainResponseButton.textContent='Rain response / mist checks';document.body.insertBefore(rainResponseButton,r.domElement);
rainResponseButton.onclick=async()=>{animate=false;try{
 const {LabDetail}=await import('../src/sand-lab/water-lab-detail.js');const {CAUSTIC_RECEIVER_GLSL,causticReceiver,causticMoment}=await import('../src/sand-lab/caustic-receiver.js');
 const parity=await LabDetail.verify(r,{rain:true});
 const scene=new THREE.Scene(),g=new THREE.PlaneGeometry(2,2),t=new THREE.WebGLRenderTarget(64,1,{type:THREE.FloatType,depthBuffer:false}),flux=[2,.7,.2],moment=causticMoment(flux,.4),m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 color;${CAUSTIC_RECEIVER_GLSL}void main(){float h=.3+gl_FragCoord.x/64.*.2;color=vec4(causticReceiver(vec4(2.,.7,.2,${moment.toFixed(12)}),h),1);}`,depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(g,m));r.setRenderTarget(t);r.render(scene,new THREE.Camera());const data=pixels(t);let error=0;for(let i=0;i<64;i++)causticReceiver([...flux,moment],.3+(i+.5)/64*.2).forEach((v,k)=>error=Math.max(error,Math.abs(v-data[i*4+k])));t.dispose();g.dispose();m.dispose();
 lab.detail.reset();lab.detail.enabled=true;lab.wind=8;lab.rain.enabled=true;lab.rain.rate=12000;lab.day=14;lab.sunIntensity=lab.skyIntensity=1;lab.balls=[];lab.time=0;camera.position.set(3,2.4,-3.8);camera.lookAt(0,1,3.7);let first=0;
 for(let i=0;i<36;i++){lab.time+=1/12;lab.rain.step(1/12);if(!first&&lab.rain.hits)first=lab.time;lab.detail.advance(1/12,lab);if(i%6===0){result.textContent='Rain impacts '+i+'/36';await new Promise(resolve=>setTimeout(resolve,0));}}
 lab.revision++;draw();const withMist=pixels(target),impactCount=lab.rain.hits,markers=lab.detail.count;lab.rain.enabled=false;for(let i=0;i<12;i++){lab.time+=1/12;lab.rain.step(1/12);}const afterStop=lab.rain.hits-impactCount;
 result.textContent=JSON.stringify({backend:lab.detail.cpu?'CPU':'GPU',detailParity:parity,causticReceiverError:error,firstImpactSeconds:first,hitsAfterStop:afterStop,liveMarkers:markers,rainMassError:lab.rain.emitted-lab.rain.transferred-lab.rain.unresolvedVolume,nonFinite:withMist.filter(v=>!Number.isFinite(v)).length,pass:parity.pass&&error<.0003&&first<.1&&afterStop===0},null,2);
 }catch(e){result.textContent=e.stack;}};

const slopesButton=document.createElement('button');slopesButton.textContent='Terrain slope / mist shadow checks';document.body.insertBefore(slopesButton,r.domElement);
slopesButton.onclick=async()=>{animate=false;try{
 const {terrainGradient,TERRAIN_GRADIENT_GLSL}=await import('../src/sand-lab/terrain-gradient.js');
 const n=65,data=new Float32Array(n*n*4);for(let z=0;z<n;z++)for(let x=0;x<n;x++)data[(z*n+x)*4]=1.3+.2*Math.sin(x*.3)*Math.cos(z*.17);
 const tex=new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.FloatType);tex.minFilter=tex.magFilter=THREE.LinearFilter;tex.needsUpdate=true;
 const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),probe=new THREE.WebGLRenderTarget(128,1,{type:THREE.FloatType,depthBuffer:false}),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,uniforms:{uSand:{value:tex}},fragmentShader:`precision highp float;precision highp int;uniform highp sampler2D uSand;out vec4 color;${TERRAIN_GRADIENT_GLSL}
float oldHeight(vec2 p){float size=float(textureSize(uSand,0).x),last=size-1.;vec2 q=clamp((p+vec2(5.5,4.9))/vec2(11.,9.8)*last,0.,last),base=floor(q),f=fract(q),a=1.-f;vec2 w0=a*a*a/6.,w1=(3.*f*f*f-6.*f*f+4.)/6.,w2=(-3.*f*f*f+3.*f*f+3.*f+1.)/6.,w3=f*f*f/6.,g0=w0+w1,g1=w2+w3,h0=(base-1.+w1/g0+.5)/size,h1=(base+1.+w3/g1+.5)/size;return g0.y*(g0.x*texture(uSand,h0).r+g1.x*texture(uSand,vec2(h1.x,h0.y)).r)+g1.y*(g0.x*texture(uSand,vec2(h0.x,h1.y)).r+g1.x*texture(uSand,h1).r);}
void main(){float i=floor(gl_FragCoord.x);vec2 p=vec2(-7.+i/127.*14.,-6.+mod(i*17.,127.)/127.*12.);float e=.004;vec2 old=vec2((oldHeight(p+vec2(e,0))-oldHeight(p-vec2(e,0)))/(2.*e),(oldHeight(p+vec2(0,e))-oldHeight(p-vec2(0,e)))/(2.*e));color=vec4(sandHeightGradient(p),old);}`,depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(geometry,material));r.setRenderTarget(probe);r.render(scene,new THREE.Camera());const gpu=pixels(probe);let slopeError=0,finiteDifferenceError=0;
 for(let i=0;i<128;i++)terrainGradient(data,n,-7+i/127*14,-6+(i*17%127)/127*12,4).forEach((v,k)=>{slopeError=Math.max(slopeError,Math.abs(v-gpu[i*4+k]));finiteDifferenceError=Math.max(finiteDifferenceError,Math.abs(v-gpu[i*4+k+2]));});
 const {LabSprayShadows}=await import('../src/sand-lab/water-lab-spray-shadows.js');lab.detail.reset();lab.detail.enabled=true;const markers=[[[0,1,0,.2],[.2,.1,0,4],[.3,3,-.024,1]],[[.3,1.1,.1,.4],[.2,0,0,4],[.2,3,-.02,1]]];markers.forEach((item,i)=>item.forEach((values,k)=>lab.detail.fallback[k].image.data.set(values,i*4)));for(const t of lab.detail.fallback)t.needsUpdate=true;lab.detail.count=lab.detail.activeSpan=2;lab.detail.bind(lab.detail.fallback);lab.revision++;
 const shadowGPU=new LabSprayShadows(r,lab,64),shadowCPU=new LabSprayShadows(r,lab,64);shadowCPU.cpu=true;shadowGPU.update();shadowCPU.update();let shadowError=0,peak=0;
 for(let k=0;k<4;k++){const p=new Uint16Array(64*64*4);r.readRenderTargetPixels(shadowGPU.target,0,0,64,64,p,0,k);const ref=shadowCPU.fallback[k].image.data;for(let i=0;i<p.length;i++){shadowError=Math.max(shadowError,Math.abs(THREE.DataUtils.fromHalfFloat(p[i])-ref[i]));peak=Math.max(peak,ref[i]);}}
 await r.warmObjectPrograms([],camera);for(const v of [tex,geometry,material,probe,shadowGPU,shadowCPU])v.dispose();result.textContent=JSON.stringify({backend:'GPU',slopeSamples:128,slopeError,finiteDifferenceError,shadowError,shadowPeak:peak,pass:slopeError<.001&&slopeError<finiteDifferenceError*.1&&shadowError<.0001},null,2);
 }catch(e){result.textContent=e.stack;}};
const fullRain=document.createElement('button');fullRain.textContent='Simulate rain 4 seconds';document.body.insertBefore(fullRain,r.domElement);
fullRain.onclick=async()=>{animate=false;try{lab.balls=[];lab.day=14;lab.sunIntensity=lab.skyIntensity=1;lab.wind=8;lab.detail.enabled=true;lab.rain.enabled=true;lab.rain.rate=12000;camera.position.set(3,2.4,-3.8);camera.lookAt(0,1,3.7);for(let i=0;i<48;i++){lab.step(1/12);if(i%6===0){draw();result.textContent='Simulating '+i+'/48';await new Promise(resolve=>setTimeout(resolve,0));}}draw();result.textContent=JSON.stringify({fixture:'heavy rain with live water and mist',seconds:4,backend:lab.gpu.cpu?'CPU':'GPU',...stats()},null,2);}catch(e){result.textContent=e.stack;}};
