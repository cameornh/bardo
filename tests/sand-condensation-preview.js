import * as THREE from 'three';
import {SurfaceDrops} from '../src/sand-lab/surface-drops.js';
import {SurfaceDropRenderer} from '../src/sand-lab/surface-drop-renderer.js';
import {DETAIL_VERTEX} from '../src/sand-lab/water-lab-detail-renderer.js';
import {makeBody,bodyDistance,bodyNormal} from '../src/sand-lab/objects.js';
import {hash} from '../src/sand-lab/water-lab-model.js';
import {createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
const result=document.querySelector('#result'),report=e=>result.textContent=e.message||String(e),canvas=document.createElement('canvas');document.body.insertBefore(canvas,result);
window.addEventListener('error',e=>report(e.error));
const r=createLabRenderer(THREE.WebGLRenderer,{canvas,preserveDrawingBuffer:true,antialias:false},report),guard=installGraphicsGuard(r,report);r.setSize(760,460);r.autoClear=false;r.setClearColor(0x718999);
const texture=(data,w=1,h=1)=>{const t=new THREE.DataTexture(new Float32Array(data),w,h,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;};
const target=new THREE.WebGLRenderTarget(760,460,{type:THREE.HalfFloatType}),screen=new THREE.Scene(),screenCamera=new THREE.Camera();screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{image:{value:target.texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);\n#include <colorspace_fragment>\n}',depthTest:false,depthWrite:false})));
const far=texture([0,0,0,100]),camera=new THREE.PerspectiveCamera(48,760/460,.01,50),scene=new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdcefff,0xb19b76,2));const sun=new THREE.DirectionalLight(0xfff3db,2);sun.position.set(-2,5,3);scene.add(sun);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(7,7),new THREE.MeshStandardMaterial({color:0xbbaa86,roughness:.8}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const ball=makeBody('glass','sphere',.75,[0,.75,0]),mesh=new THREE.Mesh(new THREE.SphereGeometry(.75,40,24),new THREE.MeshPhysicalMaterial({color:0x9eb9c1,roughness:.12,transmission:.75,thickness:.5}));mesh.position.fromArray(ball.position);scene.add(mesh);
const sh=Array.from({length:16},()=>new THREE.Vector3());sh[0].setScalar(2.5);
const u={uResolution:{value:new THREE.Vector2(760,460)},uEye:{value:camera.position},uCameraMatrix:{value:camera.matrixWorld},uOpaqueRead:{value:far},uWaterSurface:{value:far},uSH:{value:sh},uSHDegree:{value:3},uAmbient:{value:1},uSunlight:{value:1},uTannins:{value:0},uDaySun:{value:new THREE.Vector3(-.4,1,.3).normalize()},uDayTint:{value:new THREE.Vector3(1,1,1)}};
const lab={spacing:.22,sand:{materialAt:()=>.85,distance:p=>p[1]},balls:[ball],count:0,particleBudget:100,solid:p=>Math.min(p[1],bodyDistance(p,ball))},drops=new SurfaceDrops({lab,appendParcels(){},addWaterDeposit(){}}),beads=new SurfaceDropRenderer(u);
let sequence=0,angle=0,showMist=false;
// Use the production covariance vertex for this bounded optical fixture.
const data=Array.from({length:6},()=>new Float32Array(256*4));
for(let i=0;i<5;i++){const o=i*4;data[0].set([-1.5+i*.75,.4,.3,1],o);data[1].set([0,.03,0,10],o);data[2].set([.42,3,-.015,100],o);data[3].set([.8,.9,1,0],o);}
for(let i=5;i<9;i++){const o=i*4;data[0].set([-1.2+(i-5)*.8,.7,1.3,.5],o);data[1].set([0,.01,0,3],o);data[2].set([.065,i%2?2:1,.7,100],o);data[3].set([.8,.9,1,0],o);}
const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);g.setAttribute('aDetailId',new THREE.InstancedBufferAttribute(Float32Array.from({length:9},(_,i)=>i),1));g.instanceCount=9;
const detailUniforms={...u};['P','V','I','Paths','ViewTau','Scatter'].forEach((name,i)=>detailUniforms['uDetail'+name]={value:texture(data[i],256,1)});
const detailMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:DETAIL_VERTEX,fragmentShader:'precision highp float;in vec2 vQ;in float vAlpha;flat in vec4 vOptical;out vec4 outColor;void main(){float a=exp(-.5*dot(vQ,vQ))*vAlpha;outColor=vec4(vOptical.rgb*a,a);}',uniforms:detailUniforms,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor}),detailScene=new THREE.Scene(),detailMesh=new THREE.Mesh(g,detailMaterial);detailMesh.frustumCulled=false;detailScene.add(detailMesh);
function draw(){if(guard.failed)return;camera.position.set(angle?2.7:1.9,angle?1.7:3.3,3.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();r.setRenderTarget(target);r.clear();r.render(scene,camera);if(showMist)r.render(detailScene,camera);else beads.render(r,camera,drops);r.setRenderTarget(null);r.render(screen,screenCamera);result.textContent=JSON.stringify({mode:showMist?'Production mist covariance, alternating bubble / foam sizes':'Rain beads on glass and wet sand',beads:drops.beads().length,volume:drops.volume,tannins:u.uTannins.value,programs:r.info.programs.length,contextLost:r.getContext().isContextLost(),physics:'CPU attachment only; no fluid solver'},null,2);}
function rain(){showMist=false;for(let i=0;i<120;i++){const id=++sequence,x=(hash(id*5)-.5)*3,z=(hash(id*5+1)-.5)*2.5,inside=x*x+z*z<ball.radius**2,point=[x,inside?ball.position[1]+Math.sqrt(ball.radius**2-x*x-z*z):0,z],normal=inside?bodyNormal(point,ball):[0,1,0];drops.impact({volume:.00004},{point,normal,particle:-1});drops.step(1/60);}draw();}
document.querySelector('#rain').onclick=rain;document.querySelector('#angle').onclick=()=>{angle=1-angle;draw();};document.querySelector('#tannin').onclick=()=>{u.uTannins.value=1-u.uTannins.value;draw();};document.querySelector('#mist').onclick=()=>{showMist=true;draw();};document.querySelector('#reset').onclick=()=>{drops.patches.clear();drops.births=[];drops.revision++;showMist=false;draw();};rain();
