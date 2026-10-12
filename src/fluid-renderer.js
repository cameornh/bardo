import * as THREE from 'three';
import { SH_GLSL, QUAD_VERTEX } from './shaders.js';
import { projectSH } from './sh.js';
import { WATER_SURFACE_FRAGMENT, WATER_MOMENTS_FRAGMENT } from './water-optics.js';
import { grainCovariance } from './grain-appearance.js';
import { TERRAIN_GLSL } from './terrain.js';
import { GRAIN_MATERIALS } from './granular.js';
import { GRAVEL_FRAGMENT, GRAIN_DEPTH_FRAGMENT, GRAIN_MOMENTS_FRAGMENT, GRAIN_SMOOTH_FRAGMENT, GRAIN_SURFACE_FRAGMENT } from './grain-optics.js';

const vertex=`precision highp float;
in vec4 aCenter,aCov0,aCov1,aNormal,aExtra;
uniform vec2 uResolution;
uniform vec3 uEye,uLight,uWaterSH[16];uniform int uSHDegree;
${SH_GLSL}
out vec2 vGaussian;out vec3 vNormal,vReflection,vCenter;out float vTau,vDensity,vTemperature,vSpeed,vLinearDepth,vSigma,vFoam,vKind,vGrainSeed,vRadius;
void main(){
 mat3 covariance=mat3(aCov0.x,aCov0.y,aCov0.z,aCov0.y,aCov1.x,aCov1.y,aCov0.z,aCov1.y,aCov1.z);
 vec4 viewP=viewMatrix*vec4(aCenter.xyz,1.);mat3 rotation=mat3(viewMatrix),c=rotation*covariance*transpose(rotation);
 float z=max(-viewP.z,.1);vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));
 vec3 jx=vec3(f.x/z,0,f.x*slope.x/z),jy=vec3(0,f.y/z,f.y*slope.y/z);
 float A=dot(jx,c*jx),B=dot(jx,c*jy),C=dot(jy,c*jy),det=max(A*C-B*B,1e-9);A+=.3;C+=.3;
 float compensation=sqrt(det/max(A*C-B*B,1e-9)),mid=(A+C)*.5,d=sqrt(max((A-C)*(A-C)*.25+B*B,0.));
 float e1=mid+d,e2=max(mid-d,.001);vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));
 vec2 offset=4.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=offset*2./uResolution*clip.w;if(viewP.z>-.1)clip=vec4(2,2,2,1);gl_Position=clip;
 vec3 n=normalize(aNormal.xyz),v=normalize(uEye-aCenter.xyz);if(dot(n,v)<0.)n=-n;
 float basis[16];basisSH(reflect(-v,n),basis);vec3 sky=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;sky+=uWaterSH[i]*basis[i];}
 vLinearDepth=-viewP.z;vSigma=sqrt(max(covariance[0][0],max(covariance[1][1],covariance[2][2])));vFoam=aExtra.x;vKind=aExtra.y;vGrainSeed=aExtra.z;vRadius=aExtra.w;
 vReflection=max(sky,vec3(0));vNormal=n;vCenter=aCenter.xyz;vGaussian=position.xy*4.;vTau=aCenter.w*compensation;vDensity=aCov0.w;vSpeed=aCov1.w;vTemperature=aNormal.w;
}`;
const contactVertex=vertex.replace('void main(){',`${TERRAIN_GLSL}
void main(){
 vec3 contact=aCenter.xyz;float gap=0.;
 for(int k=0;k<24;k++){float d=terrainField(contact);if(d<.003||gap>4.)break;float step=max(.004,d*1.8);contact.y-=step;gap+=step;}
 contact.y+=.01;`)
 .replace('vec4 viewP=viewMatrix*vec4(aCenter.xyz,1.);','covariance[0][0]*=2.;covariance[2][2]*=2.;covariance[0][1]=0.;covariance[1][0]=0.;covariance[1][2]=0.;covariance[2][1]=0.;covariance[1][1]=.00001;vec4 viewP=viewMatrix*vec4(contact,1.);')
 .replace('vCenter=aCenter.xyz;', 'vCenter=contact;')
 .replace('vTau=aCenter.w*compensation;', 'vTau=aCenter.w*compensation*(aExtra.y<.5?.018:.28)*exp(-gap*4.);');
const contactFragment=`precision highp float;
uniform sampler2D uTerrainDepthTexture;uniform mat4 uInverseProjection,uCameraMatrix;uniform vec2 uResolution;uniform vec3 uEye,uBall;uniform float uBallRadius;
in vec2 vGaussian;in vec3 vCenter;in float vTau;out vec4 outColor;
void main(){vec2 uv=gl_FragCoord.xy/uResolution;float depth=texture(uTerrainDepthTexture,uv).r;if(depth>=1.)discard;vec4 h=uInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);vec3 ground=(uCameraMatrix*vec4(h.xyz/h.w,1.)).xyz;if(abs(ground.y-vCenter.y)>.12)discard;
 vec3 ray=normalize(ground-uEye),q=uEye-uBall;float b=dot(q,ray),disc=b*b-dot(q,q)+uBallRadius*uBallRadius;if(disc>0.&&b<0.&&-b-sqrt(disc)<length(ground-uEye))discard;
 float alpha=1.-exp(-vTau*exp(-.5*dot(vGaussian,vGaussian)));outColor=vec4(0,0,0,alpha);}`;
const fragment=`precision highp float;
uniform sampler2D uWaterBackground;uniform vec2 uResolution;uniform vec3 uEye,uLight,uBall;
uniform mat4 uInverseProjection,uCameraMatrix;uniform float uBallRadius;uniform int uFluidView;uniform bool uReflections,uGranular;
in vec2 vGaussian;in vec3 vNormal,vReflection,vCenter;in float vTau,vDensity,vTemperature,vSpeed,vKind,vGrainSeed;out vec4 outColor;
void main(){
 float density=exp(-.5*dot(vGaussian,vGaussian)),alpha=1.-exp(-vTau*density);if(alpha<.001)discard;
 vec2 uv=gl_FragCoord.xy/uResolution;
 vec4 farP=uInverseProjection*vec4(uv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 vec3 relative=uEye-uBall;float b=dot(relative,ray),disc=b*b-dot(relative,relative)+uBallRadius*uBallRadius;
 if(disc>0.&&b<0.&&-b-sqrt(disc)<dot(vCenter-uEye,ray))discard;
 vec3 n=normalize(vNormal),view=normalize(uEye-vCenter),light=normalize(uLight);
 float fresnel=.02+.98*pow(1.-max(dot(n,view),0.),5.);
 vec2 offset=vec2(dot(n,uCameraMatrix[0].xyz),dot(n,uCameraMatrix[1].xyz))*.014;
 vec3 transmitted=texture(uWaterBackground,clamp(uv+offset,vec2(.001),vec2(.999))).rgb;
 vec3 color=mix(transmitted*vec3(.55,.83,.88),vec3(.018,.24,.31),.38);
 if(uReflections)color=mix(color,vReflection,clamp(fresnel,.08,.9));
 color+=vec3(1.2,1.15,1.)*pow(max(dot(n,normalize(light+view)),0.),70.)*.65;

 if(uFluidView==1)color=mix(vec3(.03,.18,.65),vec3(1.,.12,.015),clamp((vDensity-.5)/.7,0.,1.));
 if(uFluidView==2)color=mix(vec3(.03,.12,.22),vec3(1.,.55,.02),clamp(vSpeed/4.,0.,1.));
 if(uFluidView==3)color=mix(vec3(.03,.15,.7),vec3(1.,.08,.01),clamp((vTemperature-20.)/35.,0.,1.));
 if(uFluidView>0)alpha=1.-exp(-vTau*density*2.);
 outColor=vec4(color*alpha,alpha);
}`;
export class FluidRenderer {
 constructor(uniforms,{granular=false}={}){
  this.granular=granular;
  this.count=0;this.cpuMs=0;this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
  this.arrays=Array.from({length:5},()=>new Float32Array(3200*4));
  ['aCenter','aCov0','aCov1','aNormal','aExtra'].forEach((name,i)=>this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(this.arrays[i],4).setUsage(THREE.DynamicDrawUsage)));
  this.background=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
  const coeffs=projectSH(d=>{const sky=.5+.5*d[1];return [.38+.35*sky,.47+.3*sky,.5+.26*sky];});
  this.moments=new THREE.WebGLRenderTarget(1,1,{count:granular?2:1,type:THREE.FloatType,depthBuffer:false});
  this.uniforms={...uniforms,uGranular:{value:granular},uNearestDepth:{value:0},uWaterRoughness:{value:.12},uTurbidity:{value:.12},uWaterMoments:{value:this.moments.texture},uWaterBackground:{value:this.background.texture},uBall:{value:new THREE.Vector3()},uBallRadius:{value:.43},uFluidView:{value:0},uWaterSH:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...coeffs.subarray(i*3,i*3+3)))}};
  if(granular){
   this.grainFront=new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.HalfFloatType,depthBuffer:false});
   this.grainBlur=Array.from({length:2},()=>new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:false}));
   Object.assign(this.uniforms,{uSandFront:{value:this.grainFront.textures[0]},uMudFront:{value:this.grainFront.textures[1]},uSand:{value:this.moments.textures[0]},uMud:{value:this.moments.textures[1]},uGrainResolution:{value:new THREE.Vector2()},uMudWetness:{value:.85},uGrainBase:{value:GRAIN_MATERIALS.map(m=>new THREE.Vector3(...m.color))},uGrainRoughness:{value:GRAIN_MATERIALS.map(m=>m.roughness)}});
   this.grainContactMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:contactVertex,fragmentShader:contactFragment,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
   this.grainDepthMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:GRAIN_DEPTH_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.MinEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
   this.grainSmooth=new THREE.Scene();this.grainSmooth.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:GRAIN_SMOOTH_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false})));
  }
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:granular?GRAVEL_FRAGMENT:fragment,uniforms:this.uniforms,depthTest:true,depthWrite:granular,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
  this.momentsMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:granular?GRAIN_MOMENTS_FRAGMENT:WATER_MOMENTS_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
  this.surfaceMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:granular?GRAIN_SURFACE_FRAGMENT:WATER_SURFACE_FRAGMENT,uniforms:this.uniforms,depthTest:granular,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
  this.surface=new THREE.Scene();this.surface.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.surfaceMaterial));
  this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
  this.copy=new THREE.Scene();this.copy.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uSource;void main(){outColor=texture(uSource,vUv);}',uniforms:{uSource:{value:null}},depthTest:false,depthWrite:false})));this.quadCamera=new THREE.Camera();
 }
 prepare(fluid,camera,probe,motion){
  const start=performance.now();this.count=0;this.cpuMs=0;if(!fluid?.enabled){this.geometry.instanceCount=0;this.grainPreparedKey=null;return;}
  this.uniforms.uBall.value.copy(probe.position);this.uniforms.uBallRadius.value=probe.radius;
  if(this.granular){
   const key=[fluid.time,fluid.count,motion.toFixed(4),this.uniforms.uResolution.value.x,this.uniforms.uResolution.value.y,...camera.matrixWorldInverse.elements.map(x=>x.toFixed(6)),...camera.projectionMatrix.elements.map(x=>x.toFixed(6))].join(':');
   if(key===this.grainPreparedKey){this.count=this.geometry.instanceCount;this.cpuMs=performance.now()-start;return;}
   this.grainPreparedKey=key;this.grainDirty=true;
  }
  const base=fluid.spacing*.65,variance=base*base,focal=this.uniforms.uResolution.value.y*camera.projectionMatrix.elements[5]*.5;
  const distance=Math.max(1,camera.position.length()),projected=base*focal/distance;
  const lod=Math.max(0,Math.min(3,Math.log2(Math.max(1,2*motion/projected)))),lower=Math.floor(lod),blend=lod-lower;
  const levels=blend>1e-5?[[lower,1-blend],[lower+1,blend]]:[[lower,1]];
  const p=fluid.positions,view=camera.matrixWorldInverse.elements,draws=[];
  // Crossfade optical density between moment-preserving levels. Physical
  // particles remain untouched, including during fast camera movements.
  for(const [level,weight] of levels){
  const cell=fluid.spacing*2**level,groups=new Map();
  for(let i=0;i<fluid.count;i++){
   const o=i*3,isStone=this.granular&&fluid.kind[i]===0;if(isStone&&level!==levels[0][0])continue;const key=level&&!isStone?`${this.granular?fluid.kind[i]:0}:${Math.floor(p[o]/cell)},${Math.floor(p[o+1]/cell)},${Math.floor(p[o+2]/cell)}`:i;
   if(!groups.has(key))groups.set(key,{count:0,p:[0,0,0],second:[0,0,0,0,0,0],n:[0,0,0],temperature:0,density:0,speed:0,foam:0,kind:this.granular?fluid.kind[i]:0,variance:0,seed:0,radius:0,localCov:[0,0,0,0,0,0]});
   const g=groups.get(key),x=p[o],y=p[o+1],z=p[o+2];g.count++;const seed=(Math.sin(i*97.31)*437.31)%1*.5+.5;g.seed+=seed;g.radius+=fluid.radius?.[i]||0;
   for(let a=0;a<3;a++){g.p[a]+=p[o+a];g.n[a]+=fluid.normals[o+a];}
   const second=[x*x,x*y,x*z,y*y,y*z,z*z];for(let a=0;a<6;a++)g.second[a]+=second[a];
   g.foam+=fluid.foam?.[i]||0;const localCov=this.granular?grainCovariance(fluid.kind[i],fluid.radius[i],seed):[variance,0,0,variance,0,variance];for(let k=0;k<6;k++)g.localCov[k]+=localCov[k];g.variance+=(localCov[0]+localCov[3]+localCov[5])/3;
   g.temperature+=fluid.temperature[i];g.density+=fluid.density[i];g.speed+=Math.hypot(fluid.velocities[o],fluid.velocities[o+1],fluid.velocities[o+2]);
  }
  for(const g of groups.values()){
   g.weight=this.granular&&g.kind===0?1:weight;
   g.p=g.p.map(x=>x/g.count);const [x,y,z]=g.p;
   const outer=[x*x,x*y,x*z,y*y,y*z,z*z];g.cov=g.second.map((s,i)=>s/g.count-outer[i]+g.localCov[i]/g.count);
   g.depth=-(view[2]*x+view[6]*y+view[10]*z+view[14]);if(g.depth>.1)draws.push(g);
  }
  }
  this.uniforms.uNearestDepth.value=(draws.length?Math.min(...draws.map(g=>g.depth)):1)-base*1.2;
  draws.sort((a,b)=>b.depth-a.depth);
  if(draws.length*4>this.arrays[0].length){
   this.arrays=Array.from({length:5},()=>new Float32Array(draws.length*4));
   ['aCenter','aCov0','aCov1','aNormal','aExtra'].forEach((name,i)=>this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(this.arrays[i],4).setUsage(THREE.DynamicDrawUsage)));
  }
  for(const g of draws){const o=this.count++*4,c=g.cov,norm=Math.hypot(...g.n)||1,tau=(this.granular?(g.kind===0?20:.32):.22)*g.weight*g.variance/Math.max(g.variance/g.count,(c[0]+c[3]+c[5])/3);
   this.arrays[0].set([...g.p,tau],o);this.arrays[1].set([c[0],c[1],c[2],g.density/g.count],o);this.arrays[2].set([c[3],c[4],c[5],g.speed/g.count],o);this.arrays[3].set([...g.n.map(x=>x/norm),g.temperature/g.count],o);this.arrays[4].set([g.foam/g.count,g.kind,g.seed/g.count,g.radius/g.count],o);
  }
  this.geometry.instanceCount=this.count;for(const a of Object.values(this.geometry.attributes))if(a.isInstancedBufferAttribute){a.clearUpdateRanges();a.addUpdateRange(0,this.count*4);a.needsUpdate=true;}
  this.cpuMs=performance.now()-start;
 }
 render(renderer,camera,target){if(!this.count)return;const start=performance.now();
  if(this.granular){
   const scale=Math.min(1,Math.sqrt(300000/(target.width*target.height))),w=Math.max(1,Math.round(target.width*scale)),h=Math.max(1,Math.round(target.height*scale));
   for(const t of [this.moments,this.grainFront,...this.grainBlur])if(t.width!==w||t.height!==h){t.setSize(w,h);this.grainDirty=true;}this.uniforms.uGrainResolution.value.set(w,h);
   const mesh=this.scene.children[0];if(this.grainDirty){renderer.setRenderTarget(this.grainFront);renderer.setClearColor(new THREE.Color(10000,10000,10000),1);renderer.clear();mesh.material=this.grainDepthMaterial;renderer.render(this.scene,camera);
   renderer.setRenderTarget(this.moments);renderer.setClearColor(0,0);renderer.clear();mesh.material=this.momentsMaterial;renderer.render(this.scene,camera);
   let source=this.moments;for(let pass=0;pass<3;pass++){this.uniforms.uSand.value=source.textures[0];this.uniforms.uMud.value=source.textures[1];const destination=this.grainBlur[pass%2];renderer.setRenderTarget(destination);renderer.render(this.grainSmooth,this.quadCamera);source=destination;}
   this.uniforms.uSand.value=source.textures[0];this.uniforms.uMud.value=source.textures[1];this.grainDirty=false;}mesh.material=this.material;
   renderer.setRenderTarget(target);if(this.uniforms.uView.value===0){mesh.material=this.grainContactMaterial;renderer.render(this.scene,camera);mesh.material=this.material;}renderer.render(this.scene,camera);renderer.render(this.surface,this.quadCamera);this.cpuMs+=performance.now()-start;return;
  }
  if(!this.granular&&(this.background.width!==target.width||this.background.height!==target.height)){this.background.setSize(target.width,target.height);this.moments.setSize(target.width,target.height);}
  if(!this.granular){
   this.copy.children[0].material.uniforms.uSource.value=target.texture;renderer.setRenderTarget(this.background);renderer.render(this.copy,this.quadCamera);
  }
  if(!this.granular&&this.uniforms.uFluidView.value===0){
   renderer.setRenderTarget(this.moments);renderer.setClearColor(0,0);renderer.clear();this.scene.children[0].material=this.momentsMaterial;renderer.render(this.scene,camera);this.scene.children[0].material=this.material;
   renderer.setRenderTarget(target);renderer.render(this.surface,this.quadCamera);
  }else {renderer.setRenderTarget(target);renderer.render(this.scene,camera);}
  this.cpuMs+=performance.now()-start;
 }
 dispose(){this.grainFront?.dispose();this.grainBlur?.forEach(t=>t.dispose());this.grainDepthMaterial?.dispose();this.grainContactMaterial?.dispose();if(this.grainSmooth){this.grainSmooth.children[0].geometry.dispose();this.grainSmooth.children[0].material.dispose();}this.moments.dispose();this.momentsMaterial.dispose();this.surfaceMaterial.dispose();this.surface.children[0].geometry.dispose();this.background.dispose();this.geometry.dispose();this.material.dispose();this.copy.children[0].geometry.dispose();this.copy.children[0].material.dispose();}
}
