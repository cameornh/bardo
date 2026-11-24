import {GroundCaustics} from './ground-caustics.js';
import {PolishedView,supportedOptic} from './polished-view.js';
import {polishedShape,transformedOptic,opticalHit} from './polished-shapes.js';
import {LampShadows,MAX_LAMPS,lampShadowGLSL} from './lamp-shadows.js';
import {solidOptics} from './material-reactions.js';
import {firstSurfaceHit} from './ground-tools.js';
import {planarSurface,surfaceFragment} from './surface-support.js';
import {MaterialFieldView} from './material-field-view.js';
import {PaintedView} from './painted-view.js';
import {studioGeometry,updateMaterialAttribute} from './surface-attributes.js';
import {SectionView} from './section-view.js';
import {GroundEditView} from './ground-edit-view.js';
import {reflectedSurfaceClip} from './wave-surface.js';
import {grainTexture,grainParams,surfaceRelief} from './surface-grain.js';
import {groundSurface} from './ground-surface.js';
import {looseKind} from './loose-matter.js';
import {MatterView,liquidUniforms,usesLiquidOptics} from './matter-view.js';
import {medium,interfaceOptics} from './water-optics.js';
import {ImplicitSurfaces,implicitStamp,intersectImplicit} from './implicit-surface.js';
import {WetlandView} from './wetland-view.js';
import {SandDriftView} from './sand-drift-view.js';
import {OceanView} from './ocean-view.js';
import {climateAtmosphere} from './coastal-climate.js';
import {SHADOW_GLSL,CoastalShadowSystem,createDefaultShadowUniforms} from './coastal-shadows.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {projectSH} from '../sh.js';
import {sampleTrack,material as studioMaterial} from './model.js';
import {gridSpec} from './sculpt.js';
const VERTEX=`
attribute vec3 center;attribute vec3 surfaceNormal;attribute vec3 tint;attribute vec4 properties;attribute float radius;
uniform vec2 viewport;uniform mat4 cameraWorld;
varying vec2 footprint;varying vec3 vNormal;varying vec3 vColor;varying vec3 vWorld;varying vec4 vProps;varying float vRadius;
void main(){
 vec4 c=modelViewMatrix*vec4(center,1.);vec3 n=normalize(surfaceNormal);float r2=radius*radius;

 mat3 covariance=r2*(mat3(1.)-.965*mat3(n*n.x,n*n.y,n*n.z));mat3 rotation=mat3(modelViewMatrix);covariance=rotation*covariance*transpose(rotation);
 float z=max(.03,-c.z);vec3 jx=vec3(projectionMatrix[0][0]*viewport.x*.5/z,0.,projectionMatrix[0][0]*viewport.x*.5*c.x/(z*z));vec3 jy=vec3(0.,projectionMatrix[1][1]*viewport.y*.5/z,projectionMatrix[1][1]*viewport.y*.5*c.y/(z*z));
 float a=dot(jx,covariance*jx)+.18,b=dot(jx,covariance*jy),d=dot(jy,covariance*jy)+.18;float halfTrace=(a+d)*.5,delta=sqrt(max(0.,(a-d)*(a-d)*.25+b*b));float angle=.5*atan(2.*b,a-d);vec2 u=vec2(cos(angle),sin(angle)),v=vec2(-u.y,u.x);
 vec2 offset=2.6*(u*sqrt(max(.1,halfTrace+delta))*position.x+v*sqrt(max(.1,halfTrace-delta))*position.y);vec4 clip=projectionMatrix*c;clip.xy+=offset*2./viewport*clip.w;if(c.z>-.03)clip=vec4(2.,2.,2.,1.);gl_Position=clip;
 footprint=position.xy*2.6;vNormal=normalize(mat3(cameraWorld)*normalMatrix*n);vColor=tint;vProps=properties;vRadius=radius;vWorld=(modelMatrix*vec4(center,1.)).xyz;
}`;
const LIGHTING=`
uniform vec3 environment[9],sunDirection,sunColor;
${SHADOW_GLSL}
vec3 env(vec3 n,float diffuse){float b[9];b[0]=.282094792;b[1]=-.488602512*n.y;b[2]=.488602512*n.z;b[3]=-.488602512*n.x;b[4]=1.092548431*n.x*n.y;b[5]=-1.092548431*n.y*n.z;b[6]=.315391565*(2.*n.z*n.z-n.x*n.x-n.y*n.y);b[7]=-1.092548431*n.x*n.z;b[8]=.546274215*(n.x*n.x-n.y*n.y);vec3 s=vec3(0);for(int i=0;i<9;i++){float factor=i==0?1.:(i<4?.6666667:.25);s+=environment[i]*b[i]*mix(1.,factor,diffuse);}return max(vec3(.03),s);}
#ifdef STUDIO_DAYLIGHT_ONLY
vec3 studioIrradiance(vec3 p,vec3 n,vec3 v,float rough,out vec3 highlight){
 highlight=vec3(0.);
 return vec3(0.);
}
#else
${lampShadowGLSL}
uniform int studioLampCount;
uniform vec4 studioLampAim[${MAX_LAMPS}];uniform vec4 studioLampPosition[${MAX_LAMPS}];uniform vec3 studioLampColor[${MAX_LAMPS}];
vec3 studioIrradiance(vec3 p,vec3 n,vec3 v,float rough,out vec3 highlight){
 highlight=vec3(0.);
 vec3 sum=vec3(0.);
 for(int i=0;i<${MAX_LAMPS};i++){
  if(i>=studioLampCount)break;
  vec3 delta=studioLampPosition[i].xyz-p;float d2=max(.0001,dot(delta,delta));
  float cosine=dot(n,delta*inversesqrt(d2));
  if(cosine>0.){
   vec4 aim=studioLampAim[i];
   float cone=dot(-delta*inversesqrt(d2),aim.xyz),gain=1.;
   if(aim.w> -1.){
    if(cone<=aim.w)continue;
    gain=smoothstep(aim.w,aim.w+.22*(1.-aim.w),cone)*min(32.,2./(1.-aim.w));
   }
   vec3 flux=studioLampColor[i]*(gain*lampShadow(i,p,n)/(1.+d2/studioLampPosition[i].w));
   sum+=flux*cosine;
   vec3 halfVector=v+delta*inversesqrt(d2);
   highlight+=flux*cosine*pow(max(0.,dot(n,halfVector)/max(.0001,length(halfVector))),mix(160.,3.,rough*rough));
  }
 }
 return sum;
}
#endif
vec3 shadeLit(vec3 base,vec3 n,vec3 p,vec4 prop,float sunVis){vec3 v=normalize(cameraPosition-p),l=normalize(sunDirection);n=faceforward(n,-v,n);float rough=prop.x,metal=prop.y;vec3 highlight;vec3 diffuse=studioIrradiance(p,n,v,rough,highlight)+env(n,1.)+sunColor*max(0.,dot(n,l))*sunVis;vec3 r=reflect(-v,n);float f=pow(1.-max(0.,dot(n,v)),5.);vec3 f0=mix(vec3(.04),base,metal),fresnel=f0+(1.-f0)*f*(1.-rough*.85);float spec=pow(max(0.,dot(n,normalize(l+v))),mix(160.,3.,rough*rough))*sunVis;return base*diffuse*(1.-metal)+mix(env(r,0.),env(n,1.),rough)*fresnel*mix(.45,1.,metal)+(vec3(spec)+highlight)*mix(.7,.15,rough)*f0+base*prop.w;}
// Chromatic emitters can exceed display white by several stops. Preserve
// their material hue as highlights roll off, leaving neutral emitters alone.
vec3 emissionHue(vec3 mapped,vec3 tint,float emission){
 float peak=max(tint.r,max(tint.g,tint.b));
 float chroma=1.-min(tint.r,min(tint.g,tint.b))/max(.001,peak);
 return mix(mapped,tint/max(.001,peak)*max(mapped.r,max(mapped.g,mapped.b)),chroma*smoothstep(.5,3.,emission)*.88);
}
vec3 shade(vec3 base,vec3 n,vec3 p,vec4 prop){return shadeLit(base,n,p,prop,sampleSunShadow(p,n));}
`;
const FRAGMENT=`varying vec2 footprint;varying vec3 vNormal;varying vec3 vColor;varying vec3 vWorld;varying vec4 vProps;varying float vRadius;${LIGHTING}
uniform vec2 viewport;uniform mat4 projectionMatrix;
void main(){vec3 v=normalize(cameraPosition-vWorld);if(vWorld.y<0.||dot(vNormal,v)<.015)discard;float weight=exp(-.5*dot(footprint,footprint));if(weight<.06)discard;float coverage=smoothstep(.06,.3,weight);vec3 centerView=(viewMatrix*vec4(vWorld,1.)).xyz;vec3 ray=normalize(vec3((gl_FragCoord.xy/viewport*2.-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.));vec3 nv=mat3(viewMatrix)*vNormal;float t=dot(nv,centerView)/dot(nv,ray);t=clamp(t,length(centerView)-vRadius,length(centerView)+vRadius);t-=vRadius*4.;vec4 clip=projectionMatrix*vec4(ray*t,1.);gl_FragDepth=clip.z/clip.w*.5+.5;
 gl_FragColor=vec4(shade(vColor,normalize(vNormal),vWorld,vProps),coverage*vProps.z);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const DEPTH_FRAGMENT=`varying vec2 footprint;varying vec3 vNormal;varying vec3 vWorld;varying float vRadius;uniform vec2 viewport;uniform mat4 projectionMatrix;
void main(){if(vWorld.y<0.||dot(vNormal,normalize(cameraPosition-vWorld))<.015||dot(footprint,footprint)>5.)discard;vec3 centerView=(viewMatrix*vec4(vWorld,1.)).xyz;vec3 ray=normalize(vec3((gl_FragCoord.xy/viewport*2.-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.));vec3 nv=mat3(viewMatrix)*vNormal;float t=dot(nv,centerView)/dot(nv,ray);t=clamp(t,length(centerView)-vRadius,length(centerView)+vRadius);vec4 clip=projectionMatrix*vec4(ray*t,1.);gl_FragDepth=clip.z/clip.w*.5+.5;gl_FragColor=vec4(0.);}`;
const GROUND_VERTEX=`varying vec3 worldPosition;void main(){worldPosition=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const GROUND_FRAGMENT=`varying vec3 worldPosition;uniform vec3 color;uniform vec4 properties;${LIGHTING}
void main(){vec3 p=worldPosition;float grid=min(abs(fract(p.x+.5)-.5),abs(fract(p.z+.5)-.5));float line=1.-smoothstep(.015,.035,grid);float fade=exp(-length(cameraPosition-p)*.035);vec3 base=color*(1.-line*.12*fade);vec3 lit=shade(base,vec3(0,1,0),p,properties);float fog=1.-exp(-length(cameraPosition-p)*.003);gl_FragColor=vec4(mix(lit,vec3(.38,.45,.48),fog),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export function partMatrix(pose,pivot){const m=new THREE.Matrix4().compose(new THREE.Vector3(...pose.position).add(new THREE.Vector3(...pivot)),new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation.map(x=>x*Math.PI/180),'XYZ')),new THREE.Vector3(...pose.scale));return m.multiply(new THREE.Matrix4().makeTranslation(...pivot.map(x=>-x)));}
function poseObject(object,t){object.position.fromArray(t.position);object.rotation.set(...t.rotation.map(x=>x*Math.PI/180));object.scale.fromArray(t.scale);object.updateMatrix();}
// Use authored bounds even before a Gaussian surface has finished baking.
function expandAuthoredBounds(bounds,asset,placement){
  for(const part of asset.parts){
   const matrix=partMatrix(part.transform,part.pivot);
   if(placement)matrix.premultiply(placement);
   for(const m of part.marks||[]){
    const root=new THREE.Vector3(...m.root),axis=new THREE.Vector3(...m.axis),up=new THREE.Vector3(...m.up),side=axis.clone().cross(up);
    for(const t of [0,.25,.5,.75,1])for(const sign of [-1,1]){
     const point=root.clone().addScaledVector(axis,t*m.length).addScaledVector(up,.48*m.curl*t*t*m.length)
      .addScaledVector(side,sign*m.width*m.length);
     bounds.expandByPoint(point.applyMatrix4(matrix));
    }
   }
   const grid=gridSpec(part.stamps,asset.spacing);
   if(!grid)continue;
   const min=new THREE.Vector3(...grid.origin);
   const max=new THREE.Vector3(...grid.dims.map((n,i)=>grid.origin[i]+(n-1)*grid.h));
   bounds.union(new THREE.Box3(min,max).applyMatrix4(matrix));
  }
}
function frameBounds(view,bounds,preset,emptyMode){
  if(bounds.isEmpty())return view.focus(emptyMode);
  const target=bounds.getCenter(new THREE.Vector3()), direction=view.camera.position.clone().sub(view.controls.target);
  const presets={threeQuarter:[2,2.6,3],front:[0,0,1],side:[1,0,0],top:[0,1,.0001]};
  if(Array.isArray(preset))direction.fromArray(preset);else if(presets[preset])direction.fromArray(presets[preset]);if(!direction.lengthSq())direction.set(4,2,5);direction.normalize();
  const right=new THREE.Vector3().crossVectors(view.camera.up,direction).normalize(),up=direction.clone().cross(right);
  const tanV=Math.tan(view.camera.fov*Math.PI/360),tanH=tanV*view.camera.aspect;
  let distance=view.controls.minDistance;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
   const offset=new THREE.Vector3(x,y,z).sub(target);
   distance=Math.max(distance,offset.dot(direction)+1.16*Math.max(Math.abs(offset.dot(right))/tanH,Math.abs(offset.dot(up))/tanV)+view.camera.near);
  }
  view.controls.target.copy(target);
  view.camera.position.copy(target).addScaledVector(direction,Math.min(distance,view.controls.maxDistance));
  view.controls.update();
 }

/**
 * Translate camera and orbit target along horizontal look directions (WASD),
 * vertical lift (Q/E), with Shift fast boost and terrain floor non-penetration in World mode.
 */
export function stepWASDCamera(cameraPos,targetPos,keys,dt,{mode='world',land=null}={}){
 if(!keys?.size||!(dt>0))return false;
 const fwdN=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0);
 const rightN=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
 const upN=(keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0);
 if(!fwdN&&!rightN&&!upN)return false;
 let fx=targetPos.x-cameraPos.x,fz=targetPos.z-cameraPos.z;
 const fLen=Math.hypot(fx,fz);
 if(fLen<1e-4){fx=0;fz=-1;}else{fx/=fLen;fz/=fLen;}
 const rx=-fz,rz=fx;
 const horizLen=Math.hypot(fwdN,rightN);
 const hScale=horizLen>1?1/horizLen:1;
 const dx=(fx*fwdN+rx*rightN)*hScale,dz=(fz*fwdN+rz*rightN)*hScale;
 const dist=Math.hypot(targetPos.x-cameraPos.x,targetPos.y-cameraPos.y,targetPos.z-cameraPos.z);
 const baseSpd=mode==='asset'?Math.max(.8,Math.min(10,dist*.9)):Math.max(1.8,Math.min(36,dist*.85));
 const fast=(keys.has('ShiftLeft')||keys.has('ShiftRight'))?2.8:1;
 const step=baseSpd*fast*Math.min(.1,dt);
 const mx=dx*step,my=upN*step,mz=dz*step;
 cameraPos.x+=mx;cameraPos.y+=my;cameraPos.z+=mz;
 targetPos.x+=mx;targetPos.y+=my;targetPos.z+=mz;
 if(mode==='world'&&land){
  const minY=land.height(cameraPos.x,cameraPos.z)+.16;
  if(cameraPos.y<minY){const lift=minY-cameraPos.y;cameraPos.y+=lift;targetPos.y+=lift;}
 }
 return true;
}

export class StudioView{
 constructor(canvas,onChange,onDragStart,{preserveDrawingBuffer=false,liveStudio=false}={}){
 this.canvas=canvas;this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));this.renderer.setClearColor('#8eaaaf');this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
 this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(48,1,.03,10000);this.camera.position.set(7,5,9);this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,1,0);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.maxDistance=4000;this.controls.minDistance=.25;this.controls.update();
 const sh=projectSH(n=>[.44+.24*n[1],.49+.26*n[1],.53+.3*n[1]]),environment=Array.from({length:9},(_,i)=>new THREE.Vector3(...sh.slice(i*3,i*3+3)));
 this.defaultEnvironment=environment.map(v=>v.clone());
 this.shadowUniforms=createDefaultShadowUniforms();
 // A comparison sampler requires allocated depth storage even when no lights are active.
 this.emptyLampShadow=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
 this.emptyLampShadow.compareFunction=THREE.LessEqualCompare;
 this.emptyLampShadow.needsUpdate=true;
 Object.assign(this.shadowUniforms,{studioLampAtlas:{value:this.emptyLampShadow},studioLampRange:{value:new Float32Array(MAX_LAMPS)},studioLampShadowOrigin:{value:Array.from({length:MAX_LAMPS},()=>new THREE.Vector3())},studioLampCount:{value:0},studioLampAim:{value:Array.from({length:MAX_LAMPS},()=>new THREE.Vector4(0,0,-1,-1))},studioLampPosition:{value:Array.from({length:MAX_LAMPS},()=>new THREE.Vector4())},studioLampColor:{value:Array.from({length:MAX_LAMPS},()=>new THREE.Color())}});
 this.uniforms={environment:{value:environment},sunDirection:{value:new THREE.Vector3(-.6,1,.5).normalize()},sunColor:{value:new THREE.Color(1.1,1.02,.88)},hazeColor:{value:new THREE.Color(.38,.45,.48)},viewport:{value:new THREE.Vector2(1,1)},cameraWorld:{value:this.camera.matrixWorld},...this.shadowUniforms};
 this.material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,forceSinglePass:liveStudio,depthWrite:false,side:THREE.DoubleSide});this.material.name='studio covariance Gaussian';this.depthMaterial=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:DEPTH_FRAGMENT,colorWrite:false,depthWrite:true,side:THREE.DoubleSide});
 this.liveStudio=liveStudio;
 if(liveStudio){
  this.workPlane=studioMaterial('studio-workplane','Work plane','#818a8d',{roughness:.96,grainDepth:0});
  this.controls.enableDamping=false;
  this.controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE};
  this.uniforms.grainMap={value:grainTexture()};this.uniforms.matterPlaying={value:0};

  this.waterScene=new THREE.Scene();
  this.oceanView=new OceanView(this.waterScene,this.uniforms.environment,LIGHTING,this.uniforms.sunDirection,this.uniforms.sunColor,this.shadowUniforms);
  const ocean=this.oceanView.uniforms;this.uniforms.clipFloor={value:0};
  const clipUniforms={clipFloor:this.uniforms.clipFloor};
  for(const key of ['height0','height1','height2','bandMix','rings','ringCount','ringAttenuation','clipWaves','clipHeights','seaLevel','coastalWater'])clipUniforms[key]=ocean[key];
  Object.assign(this.uniforms,clipUniforms);
  this.implicit=new ImplicitSurfaces(this.scene,this.uniforms.environment,LIGHTING,this.uniforms.grainMap,clipUniforms,{sunDirection:this.uniforms.sunDirection,sunColor:this.uniforms.sunColor,...this.shadowUniforms});
  // Stretch each fibre along its surface normal, retaining the projected covariance.
  for(const mat of [this.material,this.depthMaterial]){
   mat.vertexShader='attribute float fiberLength;\n'+mat.vertexShader
    .replace('vec4 c=modelViewMatrix*vec4(center,1.);','vec3 fiberCenter=center+surfaceNormal*fiberLength*.46;vec4 c=modelViewMatrix*vec4(fiberCenter,1.);')
    .replace('mat3 rotation=', 'if(fiberLength>0.)covariance=mat3(1.)*r2*.10+mat3(n*n.x,n*n.y,n*n.z)*fiberLength*fiberLength*.2;mat3 rotation=')
    .replace('modelMatrix*vec4(center,1.)','modelMatrix*vec4(fiberCenter,1.)');
  }
  const grainV='attribute vec4 seamPlane;flat varying vec4 seam;attribute vec3 grainSettings,supportMin,supportMax;attribute vec2 phaseId;varying vec2 phase;varying vec3 grain,localCoord,localN;flat varying mat3 worldToLocal;flat varying vec4 boundsLo;flat varying vec3 boundsHi;';
  for(const mat of [this.material,this.depthMaterial]){
   mat.defaultAttributeValues.seamPlane=[0,0,0,0];
   mat.vertexShader=grainV+mat.vertexShader.replace('vec4 c=modelViewMatrix',`
    seam=seamPlane;grain=grainSettings;phase=phaseId;localCoord=center;localN=surfaceNormal;
    worldToLocal=inverse(mat3(modelMatrix));boundsLo=vec4(supportMin,float(phaseId.x<.5&&fiberLength<=0.&&properties.z>=.999));boundsHi=supportMax;
    vec4 c=modelViewMatrix`);
   mat.fragmentShader=surfaceFragment(mat===this.depthMaterial,LIGHTING,surfaceRelief,reflectedSurfaceClip);
  }
  // The finish is evaluated on the existing surface, including its silhouettes.
  // The shared geometry stays immutable across instances and resets.
  this.uniforms.finishCount={value:0};this.uniforms.finishSites={value:Array.from({length:8},()=>new THREE.Vector4())};
  this.uniforms.finishState={value:Array.from({length:8},()=>new THREE.Vector2())};
  this.material.vertexShader='uniform int finishCount;uniform vec4 finishSites[8];uniform vec2 finishState[8];\n'+this.material.vertexShader.replace('vColor=tint;',`
   float finish=0.;
   for(int i=0;i<8;i++){if(i>=finishCount)break;if(abs(finishState[i].x-phaseId.y)>.1)continue;
    vec3 delta=mat3(modelMatrix)*(center-finishSites[i].xyz);
    finish=max(finish,exp(-dot(delta,delta)*finishSites[i].w)*finishState[i].y);}
   vColor=tint*(1.-finish);`);
  this.fieldView=new MaterialFieldView(this.uniforms,LIGHTING);this.paintView=new PaintedView(this.uniforms,LIGHTING);this.sectionView=new SectionView(this);this.matterView=new MatterView(this,LIGHTING);this.liquidMats=new Map();this.polished=new PolishedView(this,LIGHTING);this.caustics=new GroundCaustics();
 }
 this.groundMaterial=new THREE.ShaderMaterial({uniforms:{environment:this.uniforms.environment,sunDirection:this.uniforms.sunDirection,sunColor:this.uniforms.sunColor,...this.shadowUniforms,color:{value:new THREE.Color()},properties:{value:new THREE.Vector4()}},vertexShader:GROUND_VERTEX,fragmentShader:GROUND_FRAGMENT});
 if(liveStudio){
  this.grainScene=new THREE.Scene();this.eyeScene=new THREE.Scene();this.sandView=new SandDriftView(this.grainScene,this.uniforms,LIGHTING,false,this.eyeScene);
  this.shadows=new CoastalShadowSystem(this);this.lampShadows=new LampShadows();this.activeLamps=[];
 }
 this.ground=new THREE.Mesh(liveStudio?groundSurface(this,LIGHTING):new THREE.PlaneGeometry(20000,20000),this.groundMaterial);this.ground.rotation.x=-Math.PI/2;this.scene.add(this.ground);if(liveStudio){this.reliefFloor=this.ground.geometry;this.flatFloor=new THREE.PlaneGeometry(19970,19970);this.groundEdits=new GroundEditView(this);}
 this.root=new THREE.Group();this.assetScene=new THREE.Scene();this.assetScene.add(this.root);this.cache=new Map();this.groups=new Map();this.surfaces=new Map();
 this.gizmo=new TransformControls(this.camera,canvas);this.scene.add(this.gizmo.getHelper());this.gizmo.addEventListener('dragging-changed',e=>{this.controls.enabled=!e.value;this.dragging=e.value;if(e.value)onDragStart();else onChange(this.gizmo.object);});this.gizmo.addEventListener('objectChange',()=>onChange(this.gizmo.object,true));
 this.brush=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshBasicMaterial({color:0xe9ede7,wireframe:true,transparent:true,opacity:.55,depthWrite:false}));this.scene.add(this.brush);this.brush.visible=false;
 this.forceLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffd18a,depthTest:false}));this.forceLine.frustumCulled=false;this.forceLine.visible=false;this.scene.add(this.forceLine);
 this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.failed=true;});
 }
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.renderer.getDrawingBufferSize(this.uniforms.viewport.value);}
 setLandscape(land,library){
  if(land){this.wetland??=new WetlandView(this,LIGHTING);this.wetland.configure(land,library);}
  this.garden=land?this.wetland:null;
  if(!land&&this.camera.near!==.03){this.camera.near=.03;this.camera.updateProjectionMatrix();}
  if(this.wetland){this.wetland.reeds.group.visible=!!land;this.wetland.sky.visible=!!land;this.wetland.props.mesh.visible=!!land;if(this.wetland.props.softMesh)this.wetland.props.softMesh.visible=!!land&&this.wetland.props.softMesh.geometry.instanceCount>0;this.wetland.fauna.mesh.visible=!!land;if(this.wetland.fauna.softMesh)this.wetland.fauna.softMesh.visible=!!land&&this.wetland.fauna.softMesh.geometry.instanceCount>0;if(!land&&this.wetland.sandPatch)this.wetland.sandPatch.visible=false;}
  this.ground.material=this.garden?.terrain??this.groundMaterial;
  this.ground.frustumCulled=!land;
  this.sandView.setLandscape(land);
 }
 applyClimate(climate,sandMaterial=null){
  if(!climate){
   this.defaultEnvironment.forEach((v,i)=>this.uniforms.environment.value[i].copy(v));
   this.uniforms.sunDirection.value.set(-.6,1,.5).normalize();
   this.uniforms.sunColor.value.setRGB(1.1,1.02,.88);
   this.uniforms.hazeColor.value.setRGB(.38,.45,.48);
   this.renderer.setClearColor('#8eaaaf');
   return null;
  }
  const atm=climateAtmosphere(climate,sandMaterial);
  atm.environment.forEach((v,i)=>this.uniforms.environment.value[i].copy(v));
  this.uniforms.sunDirection.value.set(...atm.sunDirection);
  this.uniforms.sunColor.value.setRGB(...atm.sunColor);
  this.uniforms.hazeColor.value.setRGB(...atm.hazeColor);
  this.renderer.setClearColor(new THREE.Color(...atm.skyHorizon));
  this.wetland?.setClimate(climate,atm);
  return atm;
 }
 setGround(m){this.groundSurface=m;if(this.liveStudio)this.groundMaterial.uniforms.grain.value.set(...grainParams(m));this.groundMaterial.uniforms.color.value.set(m.color);this.groundMaterial.uniforms.properties.value.set(m.roughness,m.metallic,m.opacity,m.emission);}
 geometry(surface,materials){return this.liveStudio?studioGeometry(surface,materials):this.referenceGeometry(surface,materials);}
 referenceGeometry(surface,materials){const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);const count=surface.positions.length/3,colors=new Float32Array(count*3),props=new Float32Array(count*4),radii=new Float32Array(count),fiber=new Float32Array(count);const grains=new Float32Array(count*3),phases=new Float32Array(count*2);let maxFiber=0;for(let i=0;i<count;i++){const m=materials.find(m=>m.id===surface.materials[i])||materials[0],c=new THREE.Color(m.color);colors.set([c.r,c.g,c.b],i*3);if(this.liveStudio){grains.set(grainParams(m),i*3);phases.set([solidOptics(m)?3:m.phase==='gas'?1:looseKind(m),materials.indexOf(m)],i*2);}props.set([m.roughness,m.metallic,m.opacity,m.emission],i*4);radii[i]=surface.spacing*.61;fiber[i]=m.fiberLength||0;maxFiber=Math.max(maxFiber,fiber[i]);}for(const [name,array,itemSize]of [['center',new Float32Array(surface.positions),3],['surfaceNormal',new Float32Array(surface.normals),3],['tint',colors,3],['properties',props,4],['radius',radii,1]])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,itemSize));if(this.liveStudio){geometry.setAttribute('grainSettings',new THREE.InstancedBufferAttribute(grains,3));geometry.setAttribute('phaseId',new THREE.InstancedBufferAttribute(phases,2));}if(this.liveStudio)geometry.setAttribute('fiberLength',new THREE.InstancedBufferAttribute(fiber,1));geometry.instanceCount=count;const box=new THREE.Box3().setFromArray(surface.positions);box.expandByScalar(surface.spacing*2+maxFiber*2);geometry.boundingBox=box;geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());return geometry;}
 setSurface(key,surface,materials,stamps){this.shadowRevision=(this.shadowRevision??0)+1;if(this.liveStudio&&stamps)surface=planarSurface(stamps,surface.spacing)??surface;this.surfaces.set(key,surface);const old=this.cache.get(key),geometry=this.geometry(surface,materials);this.cache.set(key,geometry);for(const group of this.groups.values())group.traverse(o=>{if(o.userData.surfaceKey===key)o.geometry=geometry;});old?.dispose();}
 recolor(materials, material, field){
  for(const [key,surface] of this.surfaces){
   if(this.liveStudio && material)updateMaterialAttribute(this.cache.get(key),surface,materials,material,field);
   else this.setSurface(key,surface,materials);
  }
 }
 liquidMaterial(m,index){
  const key=m.id;
  if(!this.liquidMats.has(key)){
   const uniforms={...this.uniforms,...liquidUniforms(this.oceanView.uniforms,m),selected:{value:index},iceHaze:{value:0},iceDepth:{value:0}};
   // The optical pass shades only samples owned by this material. Their authored
   // covariance and depth are identical to the sculpted surface used for picking.
   const fragment=FRAGMENT.slice(FRAGMENT.indexOf('uniform vec2 viewport;uniform mat4 projectionMatrix;'))
    .replace('uniform vec2 viewport;uniform mat4 projectionMatrix;','')
    .replace('if(vWorld.y<0.||','if((matterPlaying>.5&&phase.x<2.5)||abs(phase.y-selected)>.1||')
    .replace('shade(vColor,normalize(vNormal),vWorld,vProps)','opticalSurface(vWorld,normalize(vNormal),max(max(.05,vRadius*4.),iceDepth),.92*(1.-exp(-iceHaze*iceDepth*12.)))')
    .replace('t-=vRadius*4.;','')
    .replace('coverage*vProps.z','coverage');
   const mat=new THREE.ShaderMaterial({uniforms,defines:{PARCEL_OPTICS:1},vertexShader:this.material.vertexShader,
    fragmentShader:LIGHTING+medium+interfaceOptics+'varying vec2 footprint,phase;varying vec3 vNormal,vWorld,vColor;varying vec4 vProps;varying float vRadius;uniform float selected,matterPlaying,iceDepth,iceHaze;'+fragment,
    side:THREE.DoubleSide,transparent:true,forceSinglePass:true,depthWrite:true});
   this.liquidMats.set(key,mat);
  }
  const mat=this.liquidMats.get(key);Object.assign(mat.uniforms,liquidUniforms(this.oceanView.uniforms,m));mat.uniforms.selected.value=index;return mat;
 }
 rebuild(library,mode,assetId){this.gizmo.detach();this.root.clear();this.groups.clear();this.library=library;this.emitters=[];this.caustics?.reset();this.polished?.begin();this.opticalParts=[];this.raySolids=[];this.materialIndices=new Map(library.materials.map((m,i)=>[m.id,i]));this.mode=mode;this.hasNonPolishedOptics=false;this.frozenOptics=new Set();this.implicitCount=0;this.gaussianCount=0;this.implicit?.clear();const instances=mode==='asset'?[{id:'editor',assetId,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]:library.world.instances;
 for(const instance of instances){const a=library.assets.find(a=>a.id===instance.assetId);if(!a)continue;const group=new THREE.Group();group.userData={instanceId:instance.id,assetId:a.id};poseObject(group,instance.transform);this.root.add(group);this.groups.set(instance.id,group);for(const p of a.parts){const object=new THREE.Group();object.userData={partId:p.id,assetId:a.id};object.matrixAutoUpdate=false;object.matrix.copy(partMatrix(p.transform,p.pivot));group.add(object);
 if(this.liveStudio){const luminous=p.stamps.find(s=>s.mode==='add'&&library.materials[this.materialIndices.get(s.materialId)]?.emission>0);
 if(luminous)this.emitters.push({object,origin:new THREE.Vector3(...luminous.position),size:Math.max(...luminous.size),material:library.materials[this.materialIndices.get(luminous.materialId)]});}
 if(this.liveStudio){
  const m=library.materials[this.materialIndices.get(p.stamps[0]?.materialId)],shape=supportedOptic(p,m);
  if(shape){
   const mesh=this.polished.mesh(shape,m);object.add(mesh);this.opticalParts.push(mesh);this.frozenOptics.add(mesh);
   this.implicitCount++;this.raySolids.push({object,shape,shadowShell:true});continue;
  }
  const blocker=m&&m.opacity>=.98&&polishedShape(p.stamps);
  if(blocker)this.raySolids.push({object,shape:blocker,shadowShell:m.phase==='solid'&&!m.fiberLength&&m.surfaceMode!=='gaussian'});
 }
 const direct=this.liveStudio&&implicitStamp(p,library.materials);
 if(direct){object.userData.stampMaterial=direct.materialId;object.add(this.implicit.mesh(direct,library.materials.find(m=>m.id===direct.materialId)));this.implicitCount++;continue;}
 const key=a.id+':'+p.id,geometry=this.cache.get(key);if(geometry){this.gaussianCount+=geometry.instanceCount;const mesh=new THREE.Mesh(geometry,this.material);mesh.userData.surfaceKey=key;if(this.liveStudio)this.bindFinish(mesh,()=>this.activePhysics?.get(instance.id,p.id));object.add(mesh);
 if(this.liveStudio)object.userData.fullyLoose=[...geometry.userData.materialIds].every(id=>{
  const m=library.materials[this.materialIndices.get(id)];return looseKind(m)>0||m.phase==='gas';
 })&&!p.marks?.length;
 if(this.liveStudio)for(const mid of geometry.userData.materialIds??new Set(this.surfaces.get(key)?.materials)){
  const index=library.materials.findIndex(m=>m.id===mid),m=library.materials[index];
  if(looseKind(m)!==2&&!solidOptics(m))continue;this.hasNonPolishedOptics=true;
  this.attachOptics(object,geometry,m,index,key,()=>this.activePhysics?.get(instance.id,p.id));
 }}}}this.polished?.end();this.setGround(this.liveStudio&&mode==='asset'?this.workPlane:library.materials.find(m=>m.id===library.world.groundMaterialId));this.paintView?.rebuild(this);if(mode==='world')this.garden?.syncPlacedFauna?.(library);}
 attachOptics(parent,geometry,m,index,key,record){
  const mesh=new THREE.Mesh(geometry,this.liquidMaterial(m,index));
  mesh.layers.set(1);mesh.userData.surfaceKey=key;parent.add(mesh);
  if(!solidOptics(m))return;
  this.frozenOptics.add(mesh);
  const size=geometry.boundingBox.getSize(new THREE.Vector3());
  const span=Math.max(.02,Math.min(size.x,size.y,size.z));
  mesh.onBeforeRender=(_r,_s,_c,_g,mat)=>{
   let mass=0,inclusions=0;
   for(const site of record()?.field?.sites??[])if(site.material.id===m.id&&!site.mark){
    mass+=site.mass;inclusions+=site.mass*(site.trapped||0);
    if(site.core){mass+=site.core.mass;inclusions+=site.core.mass*(site.core.trapped||0);}
   }
   mat.uniforms.iceDepth.value=span*Math.cbrt(Math.abs(mesh.matrixWorld.determinant()));
   mat.uniforms.iceHaze.value=mass?inclusions/mass:0;mat.uniformsNeedUpdate=true;
  };
 }
 bindFinish(mesh,record){
  mesh.onBeforeRender=(_renderer,_scene,_camera,_geometry,material)=>{
   if(material!==this.material)return;
   const r=record(),u=this.uniforms;let n=0;
   for(const s of r?.field?.sites??[]){
    if(s.mark||s.finish<.01)continue;
    const data=u.finishSites.value[n];data.set(s.local.x/r.scale.x,s.local.y/r.scale.y,s.local.z/r.scale.z,.65/(s.radius*s.radius));
    u.finishState.value[n].set(this.materialIndices.get(s.material.id),s.finish);
    if(++n===8)break;
   }
   u.finishCount.value=n;material.uniformsNeedUpdate=true;
  };
 }
 applyPhysics(physics){
  if(this.liveStudio){this.activePhysics=physics;this.uniforms.matterPlaying.value=1;this.matterView.update(physics);this.sectionView.update(physics);}
  for(const [id,group] of this.groups){
   group.updateMatrix();const inverse=group.matrix.clone().invert();
   for(const object of group.children){
    const partId=object.userData.partId,body=physics.get(id,partId);
    if(this.liveStudio&&physics.matter.meltedParts.has(id+':'+partId)){object.visible=false;object.userData.meltHidden=true;}
    if(this.liveStudio&&object.userData.fullyLoose){
     object.visible=false;object.userData.meltHidden=true;
    }
    if(body)object.matrix.copy(inverse).multiply(body.matrix);
   }
  }
 }
 animate(time,playing){
  if(this.activePhysics){this.sectionView?.update(null);this.activePhysics=null;this.uniforms.matterPlaying.value=0;this.matterView.reset();}
  for(const group of this.groups.values()){
   const a=this.library.assets.find(a=>a.id===group.userData.assetId);
   for(const obj of group.children){
    if(obj.userData.meltHidden){obj.visible=true;delete obj.userData.meltHidden;}
    const p=a.parts.find(p=>p.id===obj.userData.partId);
    if(this.gizmo.dragging&&this.gizmo.object===obj)continue;
    obj.matrix.copy(partMatrix(playing?sampleTrack(p,time%a.duration):p.transform,p.pivot));
   }
  }
 }
 attach(instanceId,partId,tool){this.gizmo.detach();if(!['translate','rotate','scale'].includes(tool))return;const group=this.groups.get(this.mode==='asset'?'editor':instanceId);if(!group)return;const obj=this.mode==='asset'?group.children.find(p=>p.userData.partId===partId):group;if(!obj)return;
 if(this.mode==='asset'){obj.matrix.decompose(obj.position,obj.quaternion,obj.scale);}this.gizmo.setMode(tool);this.gizmo.setSpace(this.mode==='asset'?'local':'world');this.gizmo.attach(obj);}
 ray(event,updateScene=true){const rect=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);if(this.firstPerson)this.pointer.set(0,0);this.camera.updateMatrixWorld();if(updateScene){this.scene.updateMatrixWorld(true);this.assetScene.updateMatrixWorld(true);}this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster.ray;}
 pick(event,{optimized=this.fastPicking===true,marks=true}={}){const ray=this.ray(event);let nearest=null;const local=new THREE.Ray(),inverse=new THREE.Matrix4(),p=new THREE.Vector3(),normal=new THREE.Vector3(),delta=new THREE.Vector3(),worldScratch=new THREE.Vector3(),bounds=new THREE.Sphere();for(const group of this.groups.values())for(const part of group.children){if(!group.visible||!part.visible)continue;const mesh=part.children[0];
 if(mesh?.userData.polished){
  const {shape,material}=mesh.userData.polished,optic=transformedOptic(shape,part.matrixWorld);
  const hit=opticalHit(optic,ray.origin,ray.direction);
  if(hit&&(!nearest||hit.t<nearest.distance))nearest={...hit,distance:hit.t,localPoint:hit.point.clone().applyMatrix4(optic.inverse),materialId:material.id,partId:part.userData.partId,assetId:group.userData.assetId,instanceId:group.userData.instanceId};
  continue;
 }
 if(mesh?.userData.implicit){const hit=intersectImplicit(ray,mesh);if(hit){const distance=ray.origin.distanceTo(hit.point);
  if(!nearest||distance<nearest.distance)nearest={...hit,materialId:part.userData.stampMaterial,distance,partId:part.userData.partId,instanceId:group.userData.instanceId,assetId:group.userData.assetId};}continue;}
 const key=group.userData.assetId+':'+part.userData.partId,s=this.surfaces.get(key);if(!s)continue;inverse.copy(part.matrixWorld).invert();local.copy(ray).applyMatrix4(inverse);const tolerance=s.spacing*1.25;const moving=this.activePhysics?.matter.parts;if(optimized){const geometry=this.cache.get(key);if(geometry?.boundingSphere){bounds.copy(geometry.boundingSphere);bounds.radius+=tolerance;if(!local.intersectsSphere(bounds))continue;}}
 for(let i=0;i<s.positions.length;i+=3){if(moving?.has(group.userData.instanceId+':'+part.userData.partId+'/'+s.materials[i/3]))continue;p.fromArray(s.positions,i);const t=(optimized?delta.copy(p):p.clone()).sub(local.origin).dot(local.direction);if(t<0||local.distanceSqToPoint(p)>tolerance*tolerance)continue;const world=(optimized?worldScratch.copy(p):p.clone()).applyMatrix4(part.matrixWorld),distance=world.distanceTo(ray.origin);if(nearest&&distance>=nearest.distance)continue;normal.fromArray(s.normals,i).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(part.matrixWorld));nearest={point:world.clone(),normal:normal.clone(),distance,partId:part.userData.partId,instanceId:group.userData.instanceId,localPoint:p.clone(),materialId:s.materials[i/3],assetId:group.userData.assetId};}}
 if(this.garden){nearest=this.garden.reeds.pick(ray,nearest,this.activePhysics,marks);nearest=this.garden.props.pick(ray,nearest);nearest=this.garden.fauna.pick(ray,nearest);}
 if(marks&&this.paintView?.batches.length)nearest=this.paintView.pick(ray,nearest);
 nearest=this.sectionView?.pick(this.raycaster,nearest)??nearest;
 for(const d of this.sea?.drops??[]){
  if(d.held||d.crest)continue;
  bounds.center.set(d.x,d.y,d.z);bounds.radius=d.r;
  if(!ray.intersectSphere(bounds,p))continue;
  const distance=p.distanceTo(ray.origin);
  if(!nearest||distance<nearest.distance)nearest={point:p.clone(),normal:p.clone().sub(bounds.center).normalize(),distance,materialId:this.waterMaterial?.id};
 }
 for(const [chunk,mesh] of this.groundEdits?.meshes||[]){
  const hit=this.raycaster.intersectObject(mesh,false)[0];if(hit&&(!nearest||hit.distance<nearest.distance))nearest={...hit,chunk};
 }
 for(const [looseGroup,group] of this.activePhysics?.matter.parts||[])for(const packet of group.packets){
  const hit=ray.intersectSphere(new THREE.Sphere(packet.position,packet.radius*1.25),new THREE.Vector3());if(!hit)continue;
  const dist=hit.distanceTo(ray.origin);if(!nearest||dist<nearest.distance){const [instanceId,partId]=group.key.split(':');nearest={point:hit,distance:dist,normal:hit.clone().sub(packet.position).normalize(),instanceId,partId,assetId:this.groups.get(instanceId)?.userData.assetId,loose:true,looseGroup,looseKey:group.key};}
 }
 for(const mesh of this.matterView?.beds.values()||[]){
  const hits=[];mesh.raycast(this.raycaster,hits);
  for(const hit of hits){if(nearest&&nearest.distance<=hit.distance)continue;const owner=mesh.ownerAt(hit.point);if(!owner)continue;
   const [instanceId,partId]=owner.split(':');nearest={point:hit.point,distance:hit.distance,normal:hit.face.normal,instanceId,partId,assetId:this.groups.get(instanceId)?.userData.assetId,loose:true,looseKey:owner,bedMaterial:mesh.bed.material.id};}
 }
 const ground=this.sea||this.sand||this.activePhysics?.cuts?.nodes.size?this.waterHit(ray):ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());if(ground&&(!nearest||ground.distanceTo(ray.origin)<nearest.distance))nearest={point:ground,normal:new THREE.Vector3(0,1,0),distance:ground.distanceTo(ray.origin),ground:true};
 if(this.garden){
  const point=firstSurfaceHit(ray,(x,z)=>this.sea.height(x,z),nearest?.distance??this.camera.far,6);
  if(point&&(!nearest||point.distanceTo(ray.origin)<nearest.distance)&&(this.activePhysics?.sandTerrain??this.sand).height(point.x,point.z)<point.y)
   nearest={point,ground:true,pond:true,normal:new THREE.Vector3(0,1,0),distance:point.distanceTo(ray.origin)};
 }
 return nearest;}
 materialAtPointer(pointer){
  const hit=this.pick(pointer,{optimized:true});
  if(hit?.pond)return this.library.materials.find(m=>m.id==='water');
  if(hit?.ground)return this.groundSurface;
  if(this.sea&&this.oceanView.parcels.intersectsRay(this.raycaster.ray,hit?.distance??this.camera.far))return this.waterMaterial;
  if(hit?.chunk)return hit.chunk.material;
  if(hit?.looseGroup)return this.activePhysics.matter.parts.get(hit.looseGroup)?.material;
  const id=hit?.bedMaterial??hit?.materialId;
  return this.library.materials[this.materialIndices.get(id)];
 }
 hoverLabelAtPointer(pointer){
  if(!this.garden?.land)return this.materialAtPointer(pointer)?.name;
  const hit=this.pick(pointer,{optimized:true});
  if(!hit){
   if(this.sea&&this.oceanView.parcels.intersectsRay(this.raycaster.ray,this.camera.far))return this.waterMaterial?.name;
   return undefined;
  }
  const env=this.garden.land.environment(hit.point.x,hit.point.z);
  if(hit.pond){
   const depth=Math.max(0,(this.sea?.seaLevel||0)-this.garden.land.height(hit.point.x,hit.point.z));
   return `Water · depth ${depth.toFixed(2)} m · sal ${(env.salinity*100).toFixed(0)}%`;
  }
  if(hit.ground){
   const name=this.groundSurface?.name||'Sand';
   return `${name} · ${hit.point.y>=0?'+':''}${hit.point.y.toFixed(2)} m · moist ${(env.moisture*100).toFixed(0)}% · salt ${env.saltSpray.toFixed(2)} · wind ${env.windExposure.toFixed(2)}×`;
  }
  if(hit.propLabel)return hit.propLabel;
  const mat=hit.chunk?hit.chunk.material:hit.looseGroup?this.activePhysics.matter.parts.get(hit.looseGroup)?.material:this.library.materials[this.materialIndices.get(hit.bedMaterial??hit.materialId)];
  if(hit.reedSite&&hit.assetName&&mat)return `${hit.assetName} · ${mat.name}`;
  return mat?.name;
 }
 waterHit(ray){
  const terrain=this.activePhysics?.sandTerrain||this.sand||this.sea,cuts=this.activePhysics?.cuts;
  if(!terrain&&!cuts?.nodes.size)return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
  const height=(x,z)=>(terrain?.height(x,z)??0)+(cuts?.offset(x,z)??0);
  return firstSurfaceHit(ray,height,this.camera.far,(this.garden?12:5)+(this.activePhysics?.sandTerrain?.maxOffset||0));
 }
 localPoint(point,partId){const obj=this.groups.get('editor')?.children.find(p=>p.userData.partId===partId);return obj?obj.worldToLocal(point.clone()).toArray():point.toArray();}
 showForce(from,to){this.forceLine.visible=!!from;if(from){const p=this.forceLine.geometry.attributes.position;p.setXYZ(0,...from.toArray());p.setXYZ(1,...to.toArray());p.needsUpdate=true;}}
 showBrush(hit,size){this.brush.visible=!!hit;if(hit){this.brush.position.copy(hit.point);this.brush.scale.setScalar(size);}}
 frameAuthoredAsset(asset,preset){
  const bounds=new THREE.Box3();
  expandAuthoredBounds(bounds,asset);
  frameBounds(this,bounds,preset,'asset');
 }
 frameWorld(library,{direction,groundMargin=0}={}){
  const bounds=new THREE.Box3();
  for(const instance of library.world.instances){
   const asset=library.assets.find(a=>a.id===instance.assetId);
   expandAuthoredBounds(bounds,asset,partMatrix(instance.transform,[0,0,0]));
  }
  if(groundMargin&&!bounds.isEmpty()){
   bounds.min.y=Math.min(0,bounds.min.y);bounds.min.x-=groundMargin;bounds.max.x+=groundMargin;
   bounds.min.z-=groundMargin;bounds.max.z+=groundMargin;
  }
  frameBounds(this,bounds,direction,'world');
 }
 focus(mode='world'){this.controls.target.set(0,1,0);this.camera.position.set(...(mode==='asset'?[4,3,5]:[8,5,10]));this.controls.update();}
 stepFly(dt,keys,land=null){if(!stepWASDCamera(this.camera.position,this.controls.target,keys,dt,{mode:this.mode,land}))return false;this.controls.update();return true;}
 get visibleLiquid(){return this.polished?.visible||this.nonPolishedLiquid;}
 get nonPolishedLiquid(){
  const matter=this.activePhysics?.matter;
  if(!matter)return this.hasNonPolishedOptics;
  for(const mesh of this.frozenOptics??[])if(!mesh.userData.polished&&mesh.parent?.visible)return true;
  for(const g of matter.parts.values())if(usesLiquidOptics(g.material,g.kind===2)&&g.packets.length)return true;
  for(const bed of matter.beds.values())if(usesLiquidOptics(bed.material,bed.liquid)&&bed.nodes.size)return true;
  return false;
 }
 draw(){if(this.failed)throw Error('Studio graphics context lost; stopped.');if(!this.firstPerson)this.controls.update();if(this.liveStudio){
 const lights=this.shadowUniforms;let lampCount=0;this.activeLamps.length=0;
 for(const lamp of this.emitters??[]){
  if(!lamp.object.visible||!lamp.object.parent?.visible)continue;
  lamp.object.updateWorldMatrix(true,false);
  const pos=lights.studioLampPosition.value[lampCount],center=new THREE.Vector3().copy(lamp.origin).applyMatrix4(lamp.object.matrixWorld);
  const radius=lamp.size*lamp.object.matrixWorld.getMaxScaleOnAxis();
  const aim=new THREE.Vector3(0,0,-1).transformDirection(lamp.object.matrixWorld);
  lights.studioLampAim.value[lampCount].set(aim.x,aim.y,aim.z,Math.cos((lamp.material.beamAngle??180)*Math.PI/180));
  pos.set(center.x,center.y,center.z,Math.max(.001,radius*radius));
  lights.studioLampColor.value[lampCount].set(lamp.material.color).multiplyScalar(lamp.material.emission);
  this.activeLamps.push(lamp);if(++lampCount===MAX_LAMPS)break;
 }
 lights.studioLampCount.value=lampCount;
 // Keep the large coastal receiver shaders as small as the active scene allows.
 // An authored lamp keeps its shader ready even when temporarily hidden.
 const daylightOnly=Boolean(this.garden && !this.emitters?.length);
 if(this.coastalDaylightOnly!==daylightOnly||this.lightingGarden!==this.garden){
  const ocean=this.oceanView;
  const receivers=[ocean.mesh.material,ocean.breakingGrid.mesh.material];
  if(this.garden)receivers.push(this.garden.terrain,this.garden.sandPatchTerrain);
  for(const material of receivers){
   if(Boolean(material.defines.STUDIO_DAYLIGHT_ONLY)===daylightOnly)continue;
   if(daylightOnly)material.defines.STUDIO_DAYLIGHT_ONLY=1;
   else delete material.defines.STUDIO_DAYLIGHT_ONLY;
   material.needsUpdate=true;
  }
  this.coastalDaylightOnly=daylightOnly;
  this.lightingGarden=this.garden;
 }
 for(const drift of this.matterView.saltation.values())drift.updateEye(this.camera.position);
 this.groundEdits.update(this.activePhysics);this.sandView.update(this.sand,this.groundSurface,this.camera.position);this.finishMap.update(this.sea&&!this.garden?null:this.activePhysics?.materialWorld,this.groundSurface);this.ground.geometry=this.garden?this.garden.geometry:this.sand?this.reliefFloor:this.flatFloor;this.groundMaterial.uniforms.granular.value=!!this.sand;
 this.ground.visible=!!this.garden||!this.sea;if(this.garden)this.garden.update(this,this.library.world.wind,this.activePhysics?.time??0);
 this.polished.updateVisibility(this.camera,this.renderer.domElement.height,this.opticalParts);
 // Focused optical paths are confined to the studio floor. The coast keeps sun, lamp and water lighting.
 if(!this.garden)this.caustics.update(this);
 this.paintView.update(this,this.activePhysics??null);
 this.uniforms.clipFloor.value=this.garden||this.sea||this.activePhysics?.sandTerrain?.version||this.activePhysics?.cuts?.nodes.size?-1e10:0;
 if(this.sea)this.oceanView.update(this.sea,this.camera,this.waterMaterial??this.groundSurface);else this.oceanView.show(false);
 }if(this.implicitCount){this.assetScene.updateMatrixWorld(true);this.implicit.update(this.activePhysics);}this.ground.position.set(this.liveStudio?Math.round(this.camera.position.x*4)/4:this.camera.position.x,0,this.liveStudio?Math.round(this.camera.position.z*4)/4:this.camera.position.z);this.scene.updateMatrixWorld(true);if(this.shadows){this.shadows.update(this);this.lampShadows.update(this,this.shadows);}if(this.liveStudio&&(this.sea||this.polished.needsBackground||this.nonPolishedLiquid)){
 this.oceanView.capture.render(this);
 }else{if(this.liveStudio&&this.groundSurface.metallic>.02)this.oceanView.capture.render(this,true);this.drawObjects(this.camera);
  if(this.liveStudio&&this.polished.visible){
   this.oceanView.uniforms.submerged.value=0;
   const mask=this.camera.layers.mask;this.camera.layers.set(1);
   try{this.renderer.render(this.assetScene,this.camera);}finally{this.camera.layers.mask=mask;}
  }
 }
 this.fieldView?.draw(this.renderer,this.camera,this.activePhysics?.materialWorld,this.fieldDisplay);
 if(this.eyeScene?.children.some(o=>o.visible)){this.renderer.autoClear=false;this.renderer.render(this.eyeScene,this.camera);}}
 drawObjects(camera){this.renderer.autoClear=true;this.renderer.render(this.scene,camera);this.renderer.autoClear=false;
 this.assetScene.overrideMaterial=this.depthMaterial;this.renderer.render(this.assetScene,camera);this.assetScene.overrideMaterial=null;this.renderer.render(this.assetScene,camera);if(this.paintView?.scene.children.length)this.renderer.render(this.paintView.scene,camera);if(this.grainScene?.children.some(o=>o.visible))this.renderer.render(this.grainScene,camera);}
 dispose(){this.emptyLampShadow.dispose();this.caustics?.dispose();this.polished?.dispose();this.lampShadows?.dispose();this.shadows?.dispose();if(!this.shadows)this.shadowUniforms?.shadowMapNear?.value?.dispose?.();this.wetland?.dispose();this.fieldView?.dispose();this.paintView?.dispose();this.sectionView?.clear();this.groundEdits?.dispose();this.matterView?.reset();this.uniforms.grainMap?.value.dispose();for(const mat of this.liquidMats?.values()||[])mat.dispose();this.sandView?.dispose();this.oceanView?.dispose();this.implicit?.dispose();this.forceLine.geometry.dispose();this.forceLine.material.dispose();this.resizeObserver.disconnect();this.controls.dispose();this.gizmo.dispose();for(const g of this.cache.values())g.dispose();this.material.dispose();this.depthMaterial.dispose();if(this.liveStudio){this.reliefFloor.dispose();this.flatFloor.dispose();this.finishMap.dispose();}else this.ground.geometry.dispose();this.groundMaterial.dispose();this.brush.geometry.dispose();this.brush.material.dispose();this.renderer.dispose();}
}
