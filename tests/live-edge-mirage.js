import * as THREE from 'three';
import {EDGE_TRACE_GLSL,edgeRayBudget,traceBudgeted} from '../src/rtx-sand-lab/edge-mirage.js';
import {QUAD_VERTEX} from '../src/shaders.js';
const width=192,height=128,output=document.querySelector('#result'),button=document.querySelector('#run'),slider=document.querySelector('#strength'),angle=document.querySelector('#angle');
const segments=[[[0,-.9,-.3],[0,.9,-.3],.45],[[-1.2,-.35,.4],[1.2,.25,.4],.105],[[.1,.35,.35],[1.1,.65,.35],.08]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function distance(p){return Math.min(...segments.map(([a,b,r])=>{const q=p.map((v,k)=>v-a[k]),ba=b.map((v,k)=>v-a[k]),h=Math.max(0,Math.min(1,dot(q,ba)/dot(ba,ba)));return Math.hypot(...q.map((v,k)=>v-ba[k]*h))-r;}));}
const sdf=`float capsule(vec3 p,vec3 a,vec3 b,float r){vec3 q=p-a,ba=b-a;return length(q-ba*clamp(dot(q,ba)/dot(ba,ba),0.,1.))-r;}
float sceneDistance(vec3 p){return min(capsule(p,vec3(0,-.9,-.3),vec3(0,.9,-.3),.45),min(capsule(p,vec3(-1.2,-.35,.4),vec3(1.2,.25,.4),.105),capsule(p,vec3(.1,.35,.35),vec3(1.1,.65,.35),.08)));}`;
const rays=`uniform float uAngle;vec3 turn(vec3 p){float c=cos(uAngle),s=sin(uAngle);return vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);}vec3 origin(vec2 uv){return turn(vec3((uv.x-.5)*3.,(uv.y-.5)*2.,3.));}vec3 direction(){return turn(vec3(0,0,-1));}`;
// Use the live marcher itself. Instrument counts without changing its steps,
// hit tolerance, or budget. This fixture has no terrain bins to traverse.
const traced=EDGE_TRACE_GLSL.replace('float traceEdgeOpaque(', 'int raySamples;bool rayExhausted;\nfloat traceEdgeOpaque(')
 .replace('float t=.00001,last=t;', 'float t=.00001,last=t;raySamples=0;rayExhausted=false;')
 .replace('if(i>=uEdgeRayBudget)break;', 'if(i>=uEdgeRayBudget)break;raySamples=i+1;')
 .replace('if(t>75.)break;', 'if(t>75.)return 1e4;')
 .replace('return 1e4;\n}', 'rayExhausted=true;return 1e4;\n}');
const fragment=`precision highp float;precision highp int;in vec2 vUv;out vec4 result;${sdf}${rays}
const int uSandCount=0;vec2 sandRayInterval(vec3 o,vec3 d){return vec2(1e4,-1.);}float sandCellExit(vec3 p,vec3 d){return 1e4;}float opaque(vec3 p){return sceneDistance(p);}
${traced}
void main(){float t=traceEdgeOpaque(origin(vUv),direction());result=vec4(t,float(raySamples),rayExhausted?1.:0.,t<9999.?1.:0.);}`;
let r,u,scene,camera,present,targets,report;
function drawTarget(strength,target){u.uEdgeRayBudget.value=edgeRayBudget(strength);r.setRenderTarget(target);r.render(scene,camera);}
function draw(){
 document.querySelector('#strength-value').value=slider.value;document.querySelector('#budget').textContent=edgeRayBudget(Number(slider.value))+' actual steps per ray';document.querySelector('#angle-value').value=angle.value+'°';
 u.uAngle.value=Number(angle.value)*Math.PI/180;drawTarget(0,targets[0]);drawTarget(Number(slider.value),targets[1]);r.setRenderTarget(null);r.render(present,camera);
}
button.onclick=async()=>{
 button.disabled=true;document.querySelector('#status').textContent='Checking bounded GPU rays against the CPU…';
 try{
  r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false});r.setSize(width*2,height,false);r.setPixelRatio(1);r.autoClear=false;
  if(!r.extensions.has('EXT_color_buffer_float'))throw Error('Floating render targets unavailable');
  r.debug.onShaderError=()=>{throw Error('Small SDF shader failed; stopped.');};
  u={uEdgeRayBudget:{value:256},uAngle:{value:Number(angle.value)*Math.PI/180}};const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:u,depthTest:false,depthWrite:false});scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));camera=new THREE.Camera();
  targets=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  present=new THREE.Scene();present.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;in vec2 vUv;uniform sampler2D uClean,uEffect;out vec4 result;${sdf}${rays}
void main(){vec2 uv=vec2(fract(vUv.x*2.),vUv.y);vec4 hit=vUv.x<.5?texture(uClean,uv):texture(uEffect,uv);vec3 color=vec3(.22,.24,.31)+uv.y*.035;
 if(hit.a>.5){vec3 p=origin(uv)+direction()*hit.r;float e=.0005;vec3 n=normalize(vec3(sceneDistance(p+vec3(e,0,0))-sceneDistance(p-vec3(e,0,0)),sceneDistance(p+vec3(0,e,0))-sceneDistance(p-vec3(0,e,0)),sceneDistance(p+vec3(0,0,e))-sceneDistance(p-vec3(0,0,e))));color=vec3(.035,.25,.23)*(.55+.65*max(0.,dot(n,normalize(vec3(-1,2,3)))));}
 result=vec4(color,1);}`,uniforms:{uClean:{value:targets[0].texture},uEffect:{value:targets[1].texture},uAngle:u.uAngle},depthTest:false,depthWrite:false})));
  const rows=[],c=Math.cos(u.uAngle.value),s=Math.sin(u.uAngle.value),turn=p=>[p[0]*c+p[2]*s,p[1],-p[0]*s+p[2]*c],direction=turn([0,0,-1]);
  for(const strength of [0,.4,1,2]){
   const iterations=edgeRayBudget(strength);drawTarget(strength,targets[strength===0?0:1]);const pixels=await r.readRenderTargetPixelsAsync(targets[strength===0?0:1],0,0,width,height,new Float32Array(width*height*4));
   let hitDisagreements=0,thresholdDisagreements=0,depthError=0,samples=0,exhausted=0,cpuExhausted=0;const boundaries=[];
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,origin=turn([((x+.5)/width-.5)*3,((y+.5)/height-.5)*2,3]),ref=traceBudgeted(distance,origin,direction,{iterations,epsilon:.00003,limit:75});
    if(!pixels.subarray(i,i+4).every(Number.isFinite))throw Error('Non-finite pixel');
    if(pixels[i+1]>iterations||pixels[i+2]>.5&&pixels[i+1]!==iterations)throw Error('Ray did not consume its reported budget');
    if(ref.hit!==(pixels[i+3]>.5)){
     hitDisagreements++;const t=ref.hit?ref.t:pixels[i],h=distance(origin.map((v,k)=>v+direction[k]*t));
     // FP32 may cross the hit epsilon one sample before double precision.
     // Accept only a threshold tie on the final allowed sample, not arbitrary
     // missing geometry; report every such tie explicitly.
     const thresholdTie=ref.samples===iterations&&pixels[i+1]===iterations&&Math.abs(h-.00003)<.000002;
     thresholdDisagreements+=Number(thresholdTie);boundaries.push({x,y,distanceAtHit:h,thresholdTie});
    }
    if(ref.hit&&pixels[i+3]>.5)depthError=Math.max(depthError,Math.abs(ref.t-pixels[i]));samples+=pixels[i+1];exhausted+=pixels[i+2];cpuExhausted+=Number(ref.exhausted);
   }
   rows.push({strength,iterations,hitDisagreements,thresholdDisagreements,depthError,samples,exhausted,cpuExhausted,boundaries});
   await new Promise(requestAnimationFrame);
  }
  report={pass:rows.every(v=>v.hitDisagreements===v.thresholdDisagreements&&v.depthError<.00006&&Math.abs(v.exhausted-v.cpuExhausted)<=v.thresholdDisagreements)&&rows[3].exhausted>rows[0].exhausted&&rows[3].samples<rows[0].samples,backend:'Live WebGL 2 sphere tracer / CPU reference',size:[width,height],angle:Number(angle.value),depthTolerance:.00006,hitThresholdTolerance:.000002,rows,contextLost:r.getContext().isContextLost()};output.textContent=JSON.stringify(report,null,2);document.querySelector('#status').textContent=report.pass?'PASS · GPU / CPU agree within precision tolerance · real ray budgets':'FAIL · See numerical diagnostics';draw();slider.oninput=angle.oninput=draw;
 }catch(e){document.querySelector('#status').textContent='Stopped';output.textContent=String(e.stack||e);}
};
