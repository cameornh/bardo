import * as THREE from 'three';
import {SH_GLSL} from '../shaders.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
// Tangent-plane Gaussian covariance, projected through the perspective
// Jacobian. No camera-facing disks, textures, or extra liquid reconstruction.
const vertex=`precision highp float;precision highp int;
uniform sampler2D uSeaState,uSeaSurface;uniform int uSeaSize;uniform float uScale,uSpacing,uAmbient,uSunlight,uTannins,uTurbidity;uniform vec2 uResolution;uniform vec3 uEye,uSH[16];uniform int uSHDegree;
flat out vec3 vWorld,vNormal,vTangent,vBitangent,vSigma,vLight;flat out float vAmount;out vec2 vQ;
${SH_GLSL}${LAB_LIGHTING_GLSL}${LAB_FIELD_GLSL}${SOLUTE_GLSL}
float rnd(float x){return fract(sin(x*12.9898)*43758.5453);}
vec3 environment(vec3 n){float b[16];basisSH(n,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=uSH[i]*b[i]*diffuseSHBand(i);}return max(c,vec3(0))*uAmbient;}
float elevation(ivec2 p,bool land){vec4 s=texelFetch(uSeaSurface,clamp(p,ivec2(0),ivec2(uSeaSize-1)),0);return land?s.y:max(s.x,s.y);}
void main(){int index=gl_InstanceID/2;bool land=gl_InstanceID%2==1;ivec2 cell=ivec2(index%uSeaSize,index/uSeaSize);vec4 foam=texelFetch(uSeaState,cell,0);vAmount=land?foam.g:foam.r;vAmount*=smoothstep(.02,.12,vAmount);
 if(vAmount<.002){gl_Position=vec4(2,2,2,1);return;}
 vec2 stepSize=vec2(11.,9.8)/float(uSeaSize),xz=(vec2(cell)+.5+vec2(rnd(float(index)+3.)-.5,rnd(float(index)+71.)-.5)*.65)*stepSize-vec2(5.5,4.9);
 float height=elevation(cell,land);vec3 point=vec3(xz.x,height,xz.y);
 if(!land){float lo=height-uSpacing*1.4,hi=height+uSpacing*1.4;if(parcelSample(vec3(xz.x,lo,xz.y)).r>.18&&parcelSample(vec3(xz.x,hi,xz.y)).r<.18){for(int j=0;j<7;j++){float mid=(lo+hi)*.5;if(parcelSample(vec3(xz.x,mid,xz.y)).r>.18)lo=mid;else hi=mid;}point.y=(lo+hi)*.5;}}
 float gx=(elevation(cell+ivec2(1,0),land)-elevation(cell-ivec2(1,0),land))/(2.*stepSize.x),gz=(elevation(cell+ivec2(0,1),land)-elevation(cell-ivec2(0,1),land))/(2.*stepSize.y);
 // Jitter in the tangent plane must follow the sand height too; keeping the
 // old cell-centre height would bury half of a stranded patch on a slope.
 if(land){vec2 offset=xz-((vec2(cell)+.5)*stepSize-vec2(5.5,4.9));point.y+=dot(vec2(gx,gz),offset);}
 vec3 normal=normalize(vec3(-clamp(gx,-1.,1.),1.,-clamp(gz,-1.,1.)));point+=normal*(land?(.04+.2*vAmount):.025)/uScale;
 vec3 tangent=normalize(cross(vec3(0,0,1),normal)),bitangent=cross(normal,tangent);
 float sx=stepSize.x*.38,sy=(land?.055:.012)/uScale,sz=stepSize.y*.38;vSigma=vec3(sx,sy,sz);vWorld=point;vNormal=normal;vTangent=tangent;vBitangent=bitangent;
 vec4 view=viewMatrix*vec4(point,1);if(view.z>-.025){gl_Position=vec4(2,2,2,1);return;}float depth=-view.z;
 vec3 jx=vec3(projectionMatrix[0][0]/depth,0,projectionMatrix[0][0]*view.x/(depth*depth))*uResolution.x*.5,jy=vec3(0,projectionMatrix[1][1]/depth,projectionMatrix[1][1]*view.y/(depth*depth))*uResolution.y*.5;
 vec3 a=mat3(viewMatrix)*tangent*sx,b=mat3(viewMatrix)*normal*sy,c=mat3(viewMatrix)*bitangent*sz;
 vec3 px=vec3(dot(jx,a),dot(jx,b),dot(jx,c)),py=vec3(dot(jy,a),dot(jy,b),dot(jy,c));float xx=dot(px,px)+.25,xy=dot(px,py),yy=dot(py,py)+.25;
 float d=sqrt(pow((xx-yy)*.5,2.)+xy*xy),l1=max(1e-8,(xx+yy)*.5+d),l2=max(1e-8,(xx+yy)*.5-d);vec2 axis=abs(xy)>1e-8?normalize(vec2(l1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
 vQ=position.xy*2.7;vec4 clip=projectionMatrix*view;clip.xy+=2.*(axis*sqrt(l1)*vQ.x+vec2(-axis.y,axis.x)*sqrt(l2)*vQ.y)/uResolution*clip.w;gl_Position=clip;
 float organic=max(1.-exp(-uTannins*.65),texelFetch(uSeaSurface,cell,0).z*.8);vec3 tint=mix(vec3(.94,.97,.96),vec3(.98,.78,.37),organic);vLight=tint*(environment(normal)+LAB_SUN*uSunlight*max(.08,dot(normal,labSunDirection())));
 // Underwater viewing includes in-scattering, so distant foam cannot become
 // a black decal. The foreground glass pass subsequently tints this layer.
 vec3 ray=normalize(point-uEye),trans=vec3(1),scatter=vec3(0);float lengthStep=length(point-uEye)/8.;
 if(parcelSample(uEye).r>.18)for(int j=0;j<8;j++){vec4 f=parcelSample(uEye+ray*((float(j)+.5)*lengthStep));float wet=smoothstep(.12,.24,f.x)*lengthStep*uScale;vec3 chem=f.yzw/max(.0001,f.x),ext=soluteExtinction(chem,uTannins,uTurbidity),tr=exp(-ext*wet);scatter+=trans*(1.-tr)*soluteScatter(chem,uTannins,uTurbidity)/ext*(environment(vec3(0,1,0))+LAB_SUN*uSunlight*.25);trans*=tr;}
 vLight=vLight*trans+scatter;
}`;
const fragment=`precision highp float;in vec2 vQ;flat in vec3 vWorld,vNormal,vTangent,vBitangent,vSigma,vLight;flat in float vAmount;out vec4 outColor;
uniform sampler2D uOpaqueRead;uniform vec2 uResolution;uniform vec3 uEye;uniform mat4 uInverseProjection,uCameraMatrix;
void main(){
 vec2 uv=gl_FragCoord.xy/uResolution;vec4 q=uInverseProjection*vec4(uv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*q.xyz),delta=uEye-vWorld;
 // The projected covariance bounds work for ordinary views. Near the camera
 // their linear approximation can span the screen. Test the actual ray in
 // Gaussian-local coordinates: no infinite tangent plane or fallback depth.
 vec3 origin=vec3(dot(delta,vTangent),dot(delta,vNormal),dot(delta,vBitangent))/vSigma,direction=vec3(dot(ray,vTangent),dot(ray,vNormal),dot(ray,vBitangent))/vSigma;
 float depth=-dot(origin,direction)/max(1e-9,dot(direction,direction));vec3 closest=origin+direction*depth;float distance2=dot(closest,closest);
 if(depth<.01||distance2>7.29||depth>texture(uOpaqueRead,uv).a+.012)discard;
 float g=exp(-.5*distance2),alpha=(1.-exp(-vAmount*g*2.5))*smoothstep(.01,.035,depth);if(alpha<.003)discard;
 outColor=vec4(vLight*alpha,alpha);
}`;
export class SeaFoamRenderer {
 constructor(foam,u){this.foam=foam;this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);this.geometry.instanceCount=foam.size**2*2;
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...u,...foam.u},vertexShader:vertex,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 }
 render(renderer,camera,lab){this.foam.generation(lab);if(this.foam.enabled&&this.foam.active)renderer.render(this.scene,camera);}
 dispose(){this.geometry.dispose();this.material.dispose();}
}
