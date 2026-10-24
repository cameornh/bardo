import * as THREE from 'three';
import {SurfaceDropRenderer,surfaceDropTint} from '../src/sand-lab/surface-drop-renderer.js';
import {beadTransport,beadGlassTransmission} from '../src/sand-lab/surface-drop-optics.js';
import {GLASS_WATER_FRAGMENT,transportGlassLayer} from '../src/sand-lab/glass-water-transport.js';
import {soluteCoefficients} from '../src/sand-lab/water-lab-solutes.js';
import {BLOB_VERTEX,UNDERWATER_BUBBLE_DIAMETER} from '../src/sand-lab/water-lab-blob-renderer.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {QUAD_VERTEX} from '../src/shaders.js';
import {createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
const result=document.querySelector('#result');
document.querySelector('#run').onclick=()=>{document.querySelector('#run').disabled=true;try{run();}catch(e){result.textContent=e.stack;}};
function run(){
 const canvas=document.createElement('canvas');document.body.insertBefore(canvas,result);const report=e=>result.textContent=e.stack||String(e),r=createLabRenderer(THREE.WebGLRenderer,{canvas,preserveDrawingBuffer:true},report),guard=installGraphicsGuard(r,report);r.autoClear=false;r.setSize(516,108);
 const texture=(values,w=1,h=1)=>{const t=new THREE.DataTexture(new Float32Array(values),w,h,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;},far=texture([0,0,0,100]),data=new Float32Array(4*8*4),water=texture(data,4,8);
 const camera=new THREE.PerspectiveCamera(50,129/81,.01,100);camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const sh=Array.from({length:16},()=>new THREE.Vector3());sh[0].setScalar(1/.28209479177387814);
 const b=makeBody('glass','sphere',.4,[0,0,2]);b.color=[.05,.5,1];
 const u={uFieldLinear:{value:false},uFieldSkipping:{value:false},uLabField:{value:water},uFieldSize:{value:new THREE.Vector3(2,2,2)},uFieldOrigin:{value:new THREE.Vector3(-50,-50,-50)},uFieldAtlas:{value:new THREE.Vector2(4,8)},uFieldDx:{value:100},uFieldColumns:{value:1},uResolution:{value:new THREE.Vector2(129,81)},uEye:{value:camera.position},uCameraMatrix:{value:camera.matrixWorld},uViewMatrix:{value:camera.matrixWorldInverse},uInverseProjection:{value:camera.projectionMatrixInverse},uOpaqueRead:{value:far},uWaterSurface:{value:far},uSH:{value:sh},uSHDegree:{value:3},uAmbient:{value:1},uSunlight:{value:0},uTannins:{value:0},uTurbidity:{value:0},uScale:{value:1},uDaySun:{value:new THREE.Vector3(0,1,0)},uDayTint:{value:new THREE.Vector3(1,1,1)}};
 const drops={revision:1,lab:{sand:{revision:0},balls:[]},beads:()=>[{position:[0,0,0],normal:[0,0,1],radius:.3}]},beads=new SurfaceDropRenderer(u),target=new THREE.WebGLRenderTarget(129,81,{type:THREE.FloatType,depthBuffer:false});
 const screen=new THREE.Scene(),screenCamera=new THREE.Camera(),image={value:target.texture};screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{image},vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;in vec2 vUv;uniform sampler2D image;out vec4 color;void main(){vec4 p=texture(image,vUv);color=vec4(p.rgb+vec3(.18)*(1.-p.a),1);}',depthTest:false,depthWrite:false})));
 const rows=[];
 for(let mode=0;mode<3;mode++){drops.lab.balls=mode?[b]:[];for(let i=0;i<data.length;i+=4)data[i]=mode===2?1:0;water.image.data.set(data);water.needsUpdate=true;
 r.setRenderTarget(target);r.setClearColor(0,0);r.clear();beads.render(r,camera,drops);const pixel=new Float32Array(4);r.readRenderTargetPixels(target,64,40,1,1,pixel);
 const glass=beadGlassTransmission([0,0,4],[0,0,0],.3,drops.lab.balls),segments=mode===2?Array.from({length:12},(_,i)=>({length:4/12,depth:(i+.5)*4/12,incident:[1,1,1]})):[],expected=beadTransport(surfaceDropTint().map(v=>v*.65),segments,0,0,glass).map(v=>v*.38),error=Math.max(...expected.map((v,k)=>Math.abs(v-pixel[k])));rows.push({mode:['Air','Behind blue glass','Glass and water'][mode],error,pixel:[...pixel],pass:error<.0001});
 r.setRenderTarget(null);r.setViewport(mode*172,0,172,108);r.render(screen,screenCamera);
 }
 // The actual isolated glass-water shader runs on ONE pixel and is checked
 // against the independently ordered CPU transport equation.
 const cb=makeBody('glass','sphere',1,[0,0,0]);cb.color=[.05,.5,1];const bd=new Float32Array(256*4),extra=new Float32Array(256*4);bd.set([0,0,0,1]);extra.set([...cb.color,0]);
 const coeff=soluteCoefficients([0,0,0]),T=coeff.extinction.map(v=>Math.exp(-v*3)),S=T.map((v,k)=>(1-v)*coeff.scatter[k]/coeff.extinction[k]),f0=((1.5-1.333)/(1.5+1.333))**2,K=cb.color.map(v=>v**.4*(1-f0)),back=[.7,.4,.3],B=back.map((v,k)=>v*T[k]+S[k]),R=[.08,.05,.03],shell=B.map((v,k)=>v*K[k]+R[k]);
 const gu={...u,uBodies:{value:texture(bd,256,1)},uBodyExtra:{value:texture(extra,256,1)},uBodyCount:{value:1},uGlassImage:{value:texture([...shell,1])},uImage:{value:texture([...B,1])}},scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:gu,vertexShader:QUAD_VERTEX,fragmentShader:GLASS_WATER_FRAGMENT,depthTest:false,depthWrite:false})));
 const tiny=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});r.setRenderTarget(tiny);r.render(scene,screenCamera);const pixel=new Float32Array(4);r.readRenderTargetPixels(tiny,0,0,1,1,pixel);const expected=transportGlassLayer(shell,B,K,T,S),error=Math.max(...expected.map((v,k)=>Math.abs(v-pixel[k])));rows.push({mode:'Submerged black/tinted glass',error,pixel:[...pixel],pass:error<.0001});
 // Compile only the actual bubble vertex stage with a trivial 1-pixel
 // readback fragment; never pull in the expensive water lighting fragment.
 const kernels=new Float32Array(8*4);for(let i=0;i<5;i++)kernels[i*4+3]=.2;
 const bg=new THREE.InstancedBufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));bg.setIndex([0,1,2,0,2,3]);bg.setAttribute('aParcel',new THREE.InstancedBufferAttribute(new Float32Array([0,0,0,.7]),4));bg.instanceCount=1;
 const bm=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...u,uBlobKernels:{value:texture(kernels,8,1)},uBubbleSize:{value:UNDERWATER_BUBBLE_DIAMETER}},vertexShader:BLOB_VERTEX,fragmentShader:'precision highp float;flat in vec4 vK[5],vBound;out vec4 color;void main(){color=vec4(vBound.w,vK[0].w,0,1);}',depthTest:false,depthWrite:false}),bs=new THREE.Scene(),mesh=new THREE.Mesh(bg,bm);mesh.frustumCulled=false;bs.add(mesh);
 for(const immersed of [false,true]){for(let i=0;i<data.length;i+=4)data[i]=immersed?1:0;water.image.data.set(data);water.needsUpdate=true;r.setRenderTarget(tiny);r.clear();r.render(bs,camera);r.readRenderTargetPixels(tiny,0,0,1,1,pixel);const scale=immersed?.5:1,error=Math.max(Math.abs(pixel[0]-.7*scale),Math.abs(pixel[1]-.2*scale));rows.push({mode:immersed?'Immersed bubble: half diameter':'Airborne droplet: original diameter',error,pixel:[...pixel],pass:error<.0001});}
 result.textContent=JSON.stringify({rows,pass:rows.every(v=>v.pass)&&!guard.failed,contextLost:r.getContext().isContextLost(),programs:r.info.programs.length,physics:'none; 3 bead draws and 3 single-pixel optical checks'},null,2);
}
