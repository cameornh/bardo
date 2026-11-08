import * as THREE from 'three';
import {shBasis} from '../sh.js';

// Rendering only: no marker deletion, simulation changes, history or readback.
// Inspect the complete footprint in current opaque depth. Larger kernels use
// per-pixel clipping instead of paying for a full-screen depth pyramid.
export function footprintOccluded(depth,width,height,low,high,nearDepth){
 const a=low.map((v,k)=>Math.max(0,Math.min((k?height:width)-1,Math.floor(v*(k?height:width))-1)));
 const b=high.map((v,k)=>Math.max(0,Math.min((k?height:width)-1,Math.floor(v*(k?height:width))+1)));
 if(b.some((v,k)=>v-a[k]>3)||!Number.isFinite(nearDepth))return false;
 let far=0;for(let y=a[1];y<=b[1];y++)for(let x=a[0];x<=b[0];x++){
  const d=depth[y*width+x];if(!Number.isFinite(d)||d<=0)return false;far=Math.max(far,d);
 }
 return nearDepth>far+Math.max(.0001,nearDepth*.00001);
}
export const PARTICLE_VISIBILITY_GLSL=`
uniform bool uParticleFrustum,uParticleOcclusion,uParticleSparse;uniform vec3 uParticleUpSky,uParticleGrainSky;
float particleSquare(float x){return x*x;}
bool particleOutside(vec2 center,vec2 halfExtent){return uParticleFrustum&&(any(lessThan(center+halfExtent,vec2(-1.)))||any(greaterThan(center-halfExtent,vec2(1.))));}
bool particleHidden(vec2 center,vec2 halfExtent,float nearDepth){
 #ifndef PARTICLE_OCCLUSION
 return false;
 #else
 if(!uParticleOcclusion)return false;
 ivec2 size=textureSize(uOpaqueRead,0),lo=clamp(ivec2(floor(((center-halfExtent)*.5+.5)*vec2(size)))-1,ivec2(0),size-1),hi=clamp(ivec2(floor(((center+halfExtent)*.5+.5)*vec2(size)))+1,ivec2(0),size-1);
 if(any(greaterThan(hi-lo,ivec2(3))))return false;
 float farDepth=0.;for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 q=lo+ivec2(x,y);if(all(lessThanEqual(q,hi))){float d=texelFetch(uOpaqueRead,q,0).a;if(isnan(d)||isinf(d)||d<=0.)return false;farDepth=max(farDepth,d);}}
 return nearDepth>farDepth+max(.0001,nearDepth*.00001);
 #endif
}
float particleRank(uint id){id^=id>>16;id*=0x7feb352du;id^=id>>15;id*=0x846ca68bu;id^=id>>16;return float(id>>8)*(1./16777216.);}
`;
function pass(material,geometry=new THREE.PlaneGeometry(2,2)){const scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);return scene;}
function cloneMaterial(m){const uniforms=m.uniforms;let copy;try{m.uniforms={};copy=m.clone();}finally{m.uniforms=uniforms;}copy.uniforms=uniforms;delete copy.userData.liveLoopBounds;delete copy.userData.liveReachability;return copy;}
function safeCovariance(source){return source.replaceAll('pow(dot(jx,direction),2.)','particleSquare(dot(jx,direction))').replaceAll('pow(dot(jy,direction),2.)','particleSquare(dot(jy,direction))').replaceAll('pow((xx-yy)*.5,2.)','particleSquare((xx-yy)*.5)');}
function replace(source,from,to){if(!source.includes(from))throw Error('Particle shader contract changed: '+from.slice(0,65));return source.replace(from,to);}

// Reject projected footprints before SH and water-column integration. Keep
// the original covariance, lighting and primitive order; no extra grain pass.
export function optimizeGrainShader(vertex){
 let s=replace(vertex,'void main(){','uniform highp sampler2D uOpaqueRead;\n'+PARTICLE_VISIBILITY_GLSL+'\nvoid main(){');
 s=replace(s,'vec3 direction=normalize',`float pixelRadius=max(projectionMatrix[0][0]*uResolution.x,projectionMatrix[1][1]*uResolution.y)*s/z*.5;float keep=uParticleSparse?mix(.5,1.,smoothstep(.65,1.3,pixelRadius)):1.;if(particleRank(uint(gl_InstanceID))>=keep){gl_Position=vec4(2,2,2,1);return;}vec3 direction=normalize`);
 s=replace(s,'float age=velocity.w-source.w;',`vec2 extent=3.*(abs(axis*sqrt(e1))+abs(vec2(-axis.y,axis.x)*sqrt(e2)));vec4 center=projectionMatrix*p;
 if(particleOutside(center.xy/center.w,extent)||particleHidden(center.xy/center.w,extent,vDepth)){gl_Position=vec4(2,2,2,1);return;}
 float age=velocity.w-source.w;`);
 s=replace(s,s.slice(s.indexOf('float b[16];basisSH'),s.indexOf('// Match the solid sand')),`vAlpha/=keep;if(vAlpha<.0003){gl_Position=vec4(2,2,2,1);return;}vec3 ambient=uParticleGrainSky;
`);
 return safeCovariance(s);
}

export function optimizeFoamShaders(detail,visibility){
 const light=cloneMaterial(detail.opticalMaterial),draw=cloneMaterial(detail.material),paths=new THREE.WebGLRenderTarget(detail.paths.width,detail.paths.height,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});light.uniforms=draw.uniforms={...detail.material.uniforms,...visibility.u,uDetailPaths:{value:paths.texture}};
 light.name='fine-water-visible-lighting';draw.name='fine-water-visible-Gaussians';
 light.fragmentShader=light.fragmentShader.replace('layout(location=1)out vec4 outTau;layout(location=2)out vec4 outScatter;','vec4 outTau;vec4 outScatter;');
 light.fragmentShader=replace(light.fragmentShader,'void main(){',PARTICLE_VISIBILITY_GLSL+'\nvoid main(){');
 light.fragmentShader=replace(light.fragmentShader,'float surface=texture(uWaterSurface',`float pixelRadius=max(uProjection[0][0]*uResolution.x,uProjection[1][1]*uResolution.y)*info.x/(-p.z)*.5;
 float keep=uParticleSparse?(info.y>2.5?.35:mix(.35,1.,smoothstep(.65,1.3,pixelRadius))):1.;
 // Include the filtered pixel footprint, even for subpixel droplets.
 if(particleRank(uint(uv.y*256+uv.x))>=keep||particleHidden(clip.xy/clip.w,support*2.+vec2(10.)/uResolution,depth))return;
 float surface=texture(uWaterSurface`);
 light.fragmentShader=replace(light.fragmentShader,'outColor=vec4(white*uDetailLightScale,path);outScatter.rgb*=uDetailLightScale;',`vec3 radiance=white*uDetailLightScale;float extinction=1.;
 if(path>0.){radiance=radiance*exp(-outTau.rgb)+outScatter.rgb*uDetailLightScale;extinction=exp(-dot(outTau.rgb,vec3(.1)));}
 if(any(isnan(radiance))||any(isinf(radiance)))return;
 outColor=vec4(max(vec3(0),radiance)*extinction,extinction);outScatter.a=1./keep;`);
 draw.vertexShader=replace(draw.vertexShader,'void main(){','uniform bool uParticleSparse;\nfloat particleSquare(float x){return x*x;}\nvoid main(){');
 // Reject before fetching/projection work. Keep the exact original covariance
 // and support, including tiny kernels' antialias energy compensation.
 draw.vertexShader=replace(draw.vertexShader,'vec4 source=texelFetch',`vec4 visible=texelFetch(uDetailPaths,uv,0);if(visible.a<0.){vQ=vec2(0);vAlpha=0.;vDepth=0.;vOptical=vec4(0);vViewTau=vec3(0);vScatter=vec3(0);vCenter=vec4(0);vKindRadiusClearance=vec3(0);gl_Position=vec4(2,2,2,1);return;}vec4 source=texelFetch`);
 draw.vertexShader=replace(draw.vertexShader,'float support=gaussianSupport',`float pixelRadius=max(projectionMatrix[0][0]*uResolution.x,projectionMatrix[1][1]*uResolution.y)*info.x/(-p.z)*.5;float keep=uParticleSparse?(info.y>2.5?.35:mix(.35,1.,smoothstep(.65,1.3,pixelRadius))):1.;vAlpha/=keep;float support=gaussianSupport`);
 draw.vertexShader=safeCovariance(draw.vertexShader).replace('vViewTau=texelFetch(uDetailViewTau,uv,0).rgb;vScatter=texelFetch(uDetailScatter,uv,0).rgb;','vViewTau=vec3(0);vScatter=vec3(0);');
 draw.fragmentShader=`precision highp float;in vec2 vQ;in float vAlpha,vDepth;flat in vec4 vOptical;flat in vec3 vKindRadiusClearance;
 uniform bool uHideMist;uniform highp sampler2D uOpaqueRead;uniform vec2 uResolution;out vec4 outColor;
 void main(){if(vOptical.a<0.||(uHideMist&&vKindRadiusClearance.x>2.5))discard;float a=exp(-.5*dot(vQ,vQ))*vAlpha;if(a<.0001)discard;
 if(vDepth>texture(uOpaqueRead,gl_FragCoord.xy/uResolution).a)discard;
 outColor=vec4(vOptical.rgb*a,a*vOptical.a);}`;
 light.fragmentShader=light.fragmentShader.replaceAll('detailEnvironment(vec3(0,1,0))','uParticleUpSky');
 return {light,draw,paths};
}

export function updateParticleSky(source,destination){
 const up=shBasis([0,1,0]),sky=new THREE.Vector3(),n=(source.uSHDegree.value+1)**2;
 for(let i=0;i<Math.min(9,n);i++)sky.addScaledVector(source.uSH.value[i],up[i]*(i===0?1:i<4?2/3:.25));
 destination.uParticleUpSky.value.copy(sky).max(new THREE.Vector3()).multiplyScalar(source.uAmbient.value);
 destination.uParticleGrainSky.value.copy(sky).multiplyScalar(.7).addScaledVector(source.uSH.value[0],.282095*.3).max(new THREE.Vector3()).multiplyScalar(source.uAmbient.value);
}
export function optimizeSeaFoamShader(vertex){
 let s=replace(vertex,'void main(){','uniform highp sampler2D uOpaqueRead;\n'+PARTICLE_VISIBILITY_GLSL+'\nvoid main(){');
 s=replace(s,'float organic=',`vec2 extent=5.4*(abs(axis*sqrt(l1))+abs(vec2(-axis.y,axis.x)*sqrt(l2)))/uResolution;vec4 center=projectionMatrix*view;
 if(particleOutside(center.xy/center.w,extent)||particleHidden(center.xy/center.w,extent,length(view.xyz)-2.7*max(sx,max(sy,sz))-.012)){gl_Position=vec4(2,2,2,1);return;}
 float organic=`);
 return safeCovariance(s).replaceAll('environment(vec3(0,1,0))','uParticleUpSky');
}

// Explicit installation in the live entry point/new experiment only. Older
// test URLs instantiate the untouched renderer and retain their snapshots.
export function installParticleVisibility(draw){
 if(draw.particleVisibility)return draw.particleVisibility;
 const visibility={u:{uParticleUpSky:{value:new THREE.Vector3()},uParticleGrainSky:{value:new THREE.Vector3()},uParticleFrustum:{value:true},uParticleOcclusion:{value:true},uParticleSparse:{value:true}}},grains=draw.sandGrains,grain={original:grains.material,drawMaterial:cloneMaterial(grains.material)},detail=draw.detailRenderer,foam=optimizeFoamShaders(detail,visibility),reference={light:detail.opticalMaterial,draw:detail.material,paths:detail.paths};
 grain.drawMaterial.name='visible-sand-grains';grain.drawMaterial.vertexShader=optimizeGrainShader(grain.original.vertexShader);grain.drawMaterial.uniforms={...grain.original.uniforms,...visibility.u};
 grain.occluded=cloneMaterial(grain.drawMaterial);grain.occluded.defines={PARTICLE_OCCLUSION:1};const foamOccluded=cloneMaterial(foam.light);foamOccluded.defines={PARTICLE_OCCLUSION:1}; const state={enabled:true,visibility,grain,foam,foamOccluded,reference,updated:false,settings:null};draw.particleVisibility=state;
 Object.assign(draw.lab.optimizations,{particleFrustum:true,particleOcclusion:false,particleSparse:true,particleShaders:true});
 const camera=draw.field.camera,sea=draw.seaFoamRenderer;
 const jobs=[['visible sand grains',grain.drawMaterial,grains.geometry,camera,draw.composite],['occluded sand grains',grain.occluded,grains.geometry,camera,draw.composite],['reference sand grains',grain.original,grains.geometry,camera,draw.composite],['occluded fine lighting',foamOccluded,null,detail.camera,foam.paths],['reference fine lighting',reference.light,null,detail.camera,reference.paths],['reference fine drawing',reference.draw,detail.geometry,camera,detail.target]];
 if(sea){state.seaOriginal=sea.material;state.seaMaterial=cloneMaterial(sea.material);state.seaMaterial.name='visible-sea-foam';state.seaMaterial.uniforms={...sea.material.uniforms,...visibility.u};state.seaMaterial.vertexShader=optimizeSeaFoamShader(sea.material.vertexShader);state.seaOccluded=cloneMaterial(state.seaMaterial);state.seaOccluded.defines={PARTICLE_OCCLUSION:1};
  for(const [name,m] of [['visible sea foam',state.seaMaterial],['occluded sea foam',state.seaOccluded],['reference sea foam',state.seaOriginal]])jobs.push([name,m,sea.geometry,camera,draw.composite]);
  const oldSea=sea.render.bind(sea);sea.render=(renderer,camera,lab)=>{ensure(renderer);sea.material=state.enabled?(lab.optimizations.particleOcclusion?state.seaOccluded:state.seaMaterial):state.seaOriginal;sea.scene.children[0].material=sea.material;return oldSea(renderer,camera,lab);};
 }
 const prepared=jobs.map(([name,material,geometry,camera,target])=>({name,scene:geometry?pass(material,geometry):pass(material),camera,target}));state.jobs=()=>prepared;
 state.dispose=()=>{for(const m of [grain.drawMaterial,grain.occluded,foam.light,foam.draw,foamOccluded,state.seaMaterial,state.seaOccluded])m?.dispose();foam.paths.dispose();for(let i=0;i<jobs.length;i++)if(!jobs[i][2])prepared[i].scene.children[0].geometry.dispose();};
 const oldRender=draw.render.bind(draw),oldDetail=detail.render.bind(detail),oldGrains=draw.sandGrains.render.bind(draw.sandGrains);
 function ensure(renderer){if(state.updated||!state.enabled)return;state.updated=true;visibility.u.uParticleFrustum.value=draw.lab.optimizations.particleFrustum!==false;visibility.u.uParticleOcclusion.value=draw.lab.optimizations.particleOcclusion!==false;visibility.u.uParticleSparse.value=draw.lab.optimizations.particleSparse!==false&&draw.lab.optimizations.particleShaders!==false;updateParticleSky(draw.u,visibility.u);const key=[visibility.u.uParticleFrustum.value,visibility.u.uParticleOcclusion.value,visibility.u.uParticleSparse.value].join();if(key!==state.settings){detail.pathsKey=null;state.settings=key;}}
 draw.render=options=>{state.updated=false;return oldRender(options);};
 function selectFoam(){const optimized=state.enabled&&draw.lab.optimizations.particleShaders!==false,m=optimized?{draw:foam.draw,light:draw.lab.optimizations.particleOcclusion?foamOccluded:foam.light,paths:foam.paths}:reference;if(detail.material!==m.draw||detail.opticalMaterial!==m.light){detail.material=m.draw;detail.opticalMaterial=m.light;detail.paths=m.paths;detail.scene.children[0].material=m.draw;detail.opticalScene.children[0].material=m.light;detail.pathsKey=null;}}
 state.select=selectFoam;selectFoam();
 detail.render=(renderer,camera,timers)=>{selectFoam();if(draw.lab.detail.enabled&&draw.lab.detail.count){if(timers)timers.begin('particle visibility');ensure(renderer);if(timers)timers.end();}return oldDetail(renderer,camera,timers);};
 draw.sandGrains.render=(renderer,camera)=>{const grains=draw.sandGrains;grains.scene.children[0].material=state.enabled?(draw.lab.optimizations.particleOcclusion?grain.occluded:grain.drawMaterial):grain.original;if(state.enabled&&grains.enabled&&grains.active){ensure(renderer);}return oldGrains(renderer,camera);};
 return state;
}
