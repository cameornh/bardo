import {GAUSSIAN_BOUNDS_GLSL} from './gaussian-bounds.js';
import {DETAIL_OPACITY_GLSL} from './water-lab-detail-opacity.js';
import {LAB_LIGHT_VISIBILITY_GLSL} from './water-lab-light-visibility.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
import * as THREE from 'three';
import {SH_GLSL,QUAD_VERTEX} from '../shaders.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';
import {DETAIL_LIGHT_GLSL} from './water-lab-detail-optics.js';
const vertex=`precision highp float;precision highp int;
${DETAIL_OPACITY_GLSL}${GAUSSIAN_BOUNDS_GLSL}
in float aDetailId;uniform highp sampler2D uDetailP,uDetailV,uDetailI;uniform vec2 uResolution;uniform vec3 uEye;
out vec2 vQ;out float vAlpha,vDepth;
flat out vec4 vOptical;flat out vec3 vViewTau,vScatter;flat out vec4 vCenter;flat out vec3 vKindRadiusClearance;
uniform highp sampler2D uDetailPaths,uDetailViewTau,uDetailScatter;
void main(){int id=int(aDetailId);ivec2 uv=ivec2(id%256,id/256);vec4 source=texelFetch(uDetailP,uv,0),velocity=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);vec4 p=viewMatrix*vec4(source.xyz,1);float life=velocity.w,age=source.w;
vQ=position.xy*3.;vDepth=length(p.xyz);vAlpha=0.;vOptical=vec4(0,0,0,1);vViewTau=vec3(0);vScatter=vec3(0);vCenter=vec4(source.xyz,-p.z);vKindRadiusClearance=vec3(info.y,info.x,info.w);
if(age>=life||life<=0.||p.z>-max(.025,info.x*1.5)){gl_Position=vec4(2,2,2,1);return;}
// Include the longest covariance axis (spray stretches along velocity).
float supportRadius=3.*info.x*(info.y<.5?sqrt(2.2):1.);
if(!gaussianIntersectsView(p.xyz,supportRadius,vec2(projectionMatrix[0][0],projectionMatrix[1][1]),uResolution)){gl_Position=vec4(2,2,2,1);return;}
float s=info.x*(.75+.25*sin(min(1.,age/life)*3.14159)),z=-p.z;vec3 direction=normalize(mat3(viewMatrix)*velocity.xyz+vec3(0,1e-8,0)),jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z)),jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z));
float stretch=info.y<.5?1.2:0.,xx=s*s*(dot(jx,jx)+stretch*pow(dot(jx,direction),2.)),xy=s*s*(dot(jx,jy)+stretch*dot(jx,direction)*dot(jy,direction)),yy=s*s*(dot(jy,jy)+stretch*pow(dot(jy,direction),2.));
float area=sqrt(max(0.,xx*yy-xy*xy));xx+=1.4/(uResolution.x*uResolution.x);yy+=1.4/(uResolution.y*uResolution.y);float filtered=sqrt(max(1e-15,xx*yy-xy*xy));
float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-12,(xx+yy)*.5+l),e2=max(1e-12,(xx+yy)*.5-l);vec2 axis=abs(xy)>1e-12?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);vec4 clip=projectionMatrix*p;
vOptical=texelFetch(uDetailPaths,uv,0);vViewTau=texelFetch(uDetailViewTau,uv,0).rgb;vScatter=texelFetch(uDetailScatter,uv,0).rgb;
vAlpha=detailOpacity(info.y,age,life,info.z)*min(1.,area/filtered)*smoothstep(1.5,5.,z/max(info.x,.00001));
float support=gaussianSupport(vAlpha,.0001);vQ=position.xy*support;
clip.xy+=support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)*clip.w;gl_Position=support<=0.?vec4(2,2,2,1):clip;
}`;
// Lighting and occupied-water view transport are evaluated once per marker.
// Keeping the shadow maps here also keeps both programs below 16 samplers.
const opticalPaths=`precision highp float;precision highp int;
layout(location=0)out vec4 outColor;layout(location=1)out vec4 outTau;layout(location=2)out vec4 outScatter;
uniform highp sampler2D uDetailP,uDetailV,uDetailI,uWaterSurface,uOpaqueRead;
uniform vec3 uEye,uSH[16];uniform int uSHDegree;uniform mat4 uViewMatrix,uProjection;uniform vec2 uResolution;
uniform float uScale,uSpacing,uTurbidity,uTannins,uAmbient,uSunlight,uLights,uDetailLightScale;
${DETAIL_OPACITY_GLSL}${GAUSSIAN_BOUNDS_GLSL}
${LAB_FIELD_GLSL}
${LAB_GEOMETRY_GLSL}
${SH_GLSL}
${SOLUTE_GLSL}
${DETAIL_LIGHT_GLSL}
${LAB_LIGHT_VISIBILITY_GLSL}
vec3 detailEnvironment(vec3 normal){float b[16];basisSH(normal,b);vec3 light=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;light+=uSH[i]*b[i]*diffuseSHBand(i);}return max(vec3(0),light)*uAmbient;}
vec3 detailObjectLight(vec3 p,vec3 ray,float kind,vec3 normal){vec3 light=vec3(0);for(int i=0;i<uBodyCount;i++){float material=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(material<2.5)continue;vec4 b=labBody(i);vec3 delta=b.xyz-p;float r=length(delta),path=0.;vec3 tau=vec3(0);for(int k=0;k<4;k++){vec4 a=parcelSample(mix(p,b.xyz,(float(k)+.5)/4.));tau+=soluteExtinction(a.yzw/max(.001,a.x),uTannins,uTurbidity)*smoothstep(.12,.24,a.x)*r*uScale/4.;}light+=bodyExtra(i,0).rgb*uLights*7.*b.w*b.w/(b.w*b.w+r*r)*exp(-tau)*detailAlbedo(kind)*detailResponse(kind,-ray,normal,delta/max(r,.001))*bodyTransmissionExcept(p,delta/max(r,.001),max(r,.001),uScale,b.w*.4,0.,i);}return light;}
vec3 detailIncident(vec3 q,vec3 ray){
 vec3 light=detailEnvironment(vec3(0,1,0))*mediumSky(q)+LAB_SUN*uSunlight*sunTransmission(q,uScale)*3.14159265*phaseHG(dot(ray,labSunDirection()),.55);
 if(uStation==2)for(int i=0;i<3;i++){vec3 lamp=poolLamp(i);light+=poolColor(i)*3.*uLights*poolFalloff(q,lamp)*poolTransmission(q,i,uScale)*3.14159265*phaseHG(dot(ray,normalize(lamp-q)),.55);}return light;
}
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 source=texelFetch(uDetailP,uv,0),velocity=texelFetch(uDetailV,uv,0);outColor=vec4(0,0,0,-1);outTau=vec4(0);outScatter=vec4(0);
if(source.w>=velocity.w||velocity.w<=0.)return;vec4 p=uViewMatrix*vec4(source.xyz,1);vec4 info=texelFetch(uDetailI,uv,0);if(uTightGaussians&&detailOpacity(info.y,source.w,velocity.w,info.z)<=.0001)return;if(p.z>-max(.025,info.x*1.5))return;float depth=length(p.xyz);vec4 clip=uProjection*p;
if(!gaussianIntersectsView(p.xyz,3.*info.x*(info.y<.5?sqrt(2.2):1.),vec2(uProjection[0][0],uProjection[1][1]),uResolution))return;
vec2 centerUv=clip.xy/clip.w*.5+.5;
// Cull only when the entire Gaussian support misses the image. A fixed
// center-only margin left visible off-screen kernels with black lighting.
vec2 support=vec2(uProjection[0][0],uProjection[1][1])*info.x*6.*(1.+abs(p.xy)/max(.01,-p.z))/max(.01,-p.z-info.x*1.5);
if(any(lessThan(centerUv+support,vec2(0)))||any(greaterThan(centerUv-support,vec2(1))))return;
if(depth>texture(uOpaqueRead,clamp(centerUv,0.,1.)).a+info.x*6.)return;
float surface=texture(uWaterSurface,clamp(centerUv,0.,1.)).a,begin=parcelSample(uEye).x>.18?0.:min(depth,surface);
vec3 ray=normalize(source.xyz-uEye),normal=vec3(0,1,0);float kind=texelFetch(uDetailI,uv,0).y;
if(kind>.5&&kind<1.5){float e=max(uFieldDx*.9,uSpacing*.12);vec3 q=source.xyz,gradient=vec3(parcelSample(q+vec3(e,0,0)).x-parcelSample(q-vec3(e,0,0)).x,parcelSample(q+vec3(0,e,0)).x-parcelSample(q-vec3(0,e,0)).x,parcelSample(q+vec3(0,0,e)).x-parcelSample(q-vec3(0,0,e)).x);if(length(gradient)>1e-6)normal=-normalize(gradient);}
float response=detailClusterResponse(detailResponse(kind,-ray,normal,labSunDirection()),spraySun(source.xyz));
vec3 white=detailLight(kind,detailEnvironment(kind>.5&&kind<1.5?normal:vec3(0,1,0))*mediumSky(source.xyz),1.,bodySun(source.xyz,uScale)*mediumSun(source.xyz),uSunlight,response);
white+=detailObjectLight(source.xyz,ray,kind,normal);
if(uStation==2)for(int i=0;i<3;i++){vec3 lamp=poolLamp(i),delta=lamp-source.xyz;float r=length(delta),response=detailClusterResponse(detailResponse(kind,-ray,normal,delta/max(r,.0001)),sprayPool(source.xyz,i));white+=poolColor(i)*3.*uLights*poolFalloff(source.xyz,lamp)*detailAlbedo(kind)*response*bodyTransmission(source.xyz,delta/max(r,.0001),r,uScale,.06,0.)*mediumPool(source.xyz,i);}
// Retain the water's foreground scattering when a translucent marker covers
// it. Extinction alone incorrectly paints a dark decal over this radiance.
float lengthStep=(depth-begin)/8.,path=0.;vec3 incident=lengthStep>.00001?detailIncident(uEye+ray*mix(begin,depth,.35),ray):vec3(0);
for(int i=0;i<8;i++){if(lengthStep<=.00001)break;vec3 q=uEye+ray*(begin+(float(i)+.5)*lengthStep);vec4 a=parcelSample(q);float wet=smoothstep(.12,.24,a.x)*lengthStep*uScale;if(wet<=0.)continue;vec3 c=a.yzw/max(a.x,.0001),ext=soluteExtinction(c,uTannins,uTurbidity);detailTransportStep(outTau.rgb,outScatter.rgb,ext,soluteScatter(c,uTannins,uTurbidity),incident,wet);path+=wet;}
outColor=vec4(white*uDetailLightScale,path);outScatter.rgb*=uDetailLightScale;
}`;
const fragment=`precision highp float;precision highp int;in vec2 vQ;in float vAlpha,vDepth;
flat in vec4 vOptical;flat in vec3 vViewTau,vScatter;flat in vec4 vCenter;flat in vec3 vKindRadiusClearance;out vec4 outColor;
uniform bool uHideMist;uniform highp sampler2D uOpaqueRead,uWaterSurface;uniform vec2 uResolution;uniform vec3 uEye;uniform mat4 uInverseProjection,uCameraMatrix;
${LAB_GEOMETRY_GLSL}
void main(){
 if(vOptical.a<0.||vAlpha<.0001||(uHideMist&&vKindRadiusClearance.x>2.5))discard;vec2 uv=gl_FragCoord.xy/uResolution;float opaque=texture(uOpaqueRead,uv).a;if(vDepth>opaque)discard;
 float gaussian=exp(-.5*dot(vQ,vQ)),a=gaussian*vAlpha;if(a<.0001)discard;
 if(vKindRadiusClearance.z<vKindRadiusClearance.y*3.){vec4 viewRay=uInverseProjection*vec4(uv*2.-1.,1,1);vec3 viewPoint=viewRay.xyz*(-vCenter.w/viewRay.z),point=uEye+mat3(uCameraMatrix)*viewPoint;if(labPhysicalSolid(point)<0.)discard;}
 float surface=texture(uWaterSurface,uv).a;bool wet=vOptical.a>0.;
 vec3 radiance=wet?vOptical.rgb*exp(-vViewTau)+vScatter:vOptical.rgb;
 if(any(isnan(radiance))||any(isinf(radiance)))discard;outColor=vec4(max(vec3(0),radiance)*a,a);
}`;
// Accumulate optical density with only a short reconstruction footprint.
// Coherent emission creates the shape; no broad halo is added around it.
// This is not a distance field or a camera-motion blur, and does not move water.
const reconstruct=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uMist,uOpaqueRead;uniform vec2 uResolution;uniform float uDetailLightScale;
void main(){float center=texture(uOpaqueRead,vUv).a,total=0.;vec4 field=vec4(0);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 uv=vUv+vec2(x,y)*1.25/uResolution;float depth=texture(uOpaqueRead,uv).a,edge=exp(-abs(depth-center)*18.),w=(x==0?.6:.2)*(y==0?.6:.2)*edge;field+=texture(uMist,uv)*w;total+=w;}field/=max(total,.0001);float density=field.a;if(density<.00001)discard;float alpha=1.-exp(-density);vec3 light=field.rgb/max(density,.00001)/uDetailLightScale;outColor=vec4(light*alpha,alpha);}`;
// Encode faint HDR radiance before half-float storage/blending, decode once
// on composition. Optical depth and opacity stay unscaled. This keeps night
// foam from quantizing to opaque black without making the water emissive.
export function detailLightScale(sunlight,ambient,sh,lights){const peak=Math.max(Math.abs(sunlight)*22,Math.abs(ambient)*Math.max(0,...sh.flatMap(v=>v.toArray())),lights*7,1e-10);return Math.max(1,Math.min(1e10,1/peak));}
export class LabDetailRenderer {
 constructor(lab,uniforms){this.lab=lab;this.uniforms=uniforms;const g=this.geometry=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);g.setAttribute('aDetailId',new THREE.InstancedBufferAttribute(Float32Array.from({length:lab.detail.capacity},(_,i)=>i),1));g.instanceCount=lab.detail.capacity;this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{...uniforms,uHideMist:{value:false},uDetailLightScale:{value:1},uDetailP:lab.detail.u.uDetailP,uDetailV:lab.detail.u.uDetailV,uDetailI:lab.detail.u.uDetailI},transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(g,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 this.paths=new THREE.WebGLRenderTarget(256,lab.detail.capacity/256,{count:3,type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});this.material.uniforms.uDetailPaths={value:this.paths.textures[0]};this.material.uniforms.uDetailViewTau={value:this.paths.textures[1]};this.material.uniforms.uDetailScatter={value:this.paths.textures[2]};
 this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});this.quadGeometry=new THREE.PlaneGeometry(2,2);this.reconstruct=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:reconstruct,uniforms:{...uniforms,uDetailLightScale:this.material.uniforms.uDetailLightScale,uMist:{value:this.target.texture}},transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.opticalMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:opticalPaths,uniforms:this.material.uniforms,depthTest:false,depthWrite:false});this.opticalScene=new THREE.Scene();this.opticalScene.add(new THREE.Mesh(this.quadGeometry,this.opticalMaterial));this.composite=new THREE.Scene();this.composite.add(new THREE.Mesh(this.quadGeometry,this.reconstruct));this.camera=new THREE.Camera();
 }
 render(renderer,camera,timers){if(!this.lab.detail.enabled||!this.lab.detail.count)return;this.material.uniforms.uDetailLightScale.value=detailLightScale(this.lab.sunlight,this.lab.ambient,this.uniforms.uSH.value,(this.lab.kind==='pool'||this.lab.balls.some(b=>b.kind==='light'))?this.lab.lights:0);this.geometry.instanceCount=this.lab.detail.activeSpan;const size=this.uniforms.uResolution.value;if(this.target.width!==size.x||this.target.height!==size.y)this.target.setSize(size.x,size.y);const old=renderer.getRenderTarget(),color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();const key=[this.lab.kind,this.lab.revision,this.lab.lightDay,this.lab.lightEditRevision,this.material.uniforms.uDetailLightScale.value,this.lab.detail.time,this.lab.detail.emitted,this.lab.ambient,this.lab.sunlight,this.lab.lights,this.lab.tannins,size.x,size.y,...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join(',');if(key!==this.pathsKey){this.pathsKey=key;timers?.begin('foam lighting');renderer.setRenderTarget(this.paths);renderer.setScissor(0,0,256,Math.ceil(this.lab.detail.activeSpan/256));renderer.setScissorTest(true);renderer.render(this.opticalScene,this.camera);renderer.setScissorTest(false);timers?.end();}timers?.begin('foam splats');renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear();renderer.render(this.scene,camera);renderer.setRenderTarget(old);renderer.setClearColor(color,alpha);renderer.render(this.composite,this.camera);timers?.end();}
 dispose(){for(const resource of [this.geometry,this.material,this.target,this.paths,this.opticalMaterial,this.quadGeometry,this.reconstruct])resource.dispose();}
}
