import * as THREE from 'three';
import {SH_GLSL} from '../shaders.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
// Covariance-projected, surface-aligned water beads. Kept out of the coarse
// liquid field so tiny drops cannot become voxel-sized mounds on a receiver.
export const SURFACE_DROP_VERTEX=`precision highp float;
in vec4 aDrop;in vec3 aNormal;uniform vec2 uResolution;out vec2 vQ;out float vDepth,vRadius;flat out vec3 vNormal,vWorld;
void main(){vec4 p=viewMatrix*vec4(aDrop.xyz,1);float z=max(.001,-p.z),s=aDrop.w;vec3 n=mat3(viewMatrix)*aNormal;
 vec3 jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z))*uResolution.x*.5,jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z))*uResolution.y*.5;
 float xx=s*s*(dot(jx,jx)-.64*pow(dot(jx,n),2.))+.12,xy=s*s*(dot(jx,jy)-.64*dot(jx,n)*dot(jy,n)),yy=s*s*(dot(jy,jy)-.64*pow(dot(jy,n),2.))+.12;
 float d=sqrt(pow((xx-yy)*.5,2.)+xy*xy),l1=max(1e-8,(xx+yy)*.5+d),l2=max(1e-8,(xx+yy)*.5-d);vec2 axis=abs(xy)>1e-8?normalize(vec2(l1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
 vQ=position.xy*2.5;vec4 clip=projectionMatrix*p;clip.xy+=2.*(axis*sqrt(l1)*vQ.x+vec2(-axis.y,axis.x)*sqrt(l2)*vQ.y)/uResolution*clip.w;
 gl_Position=p.z>-.01||s<=0.?vec4(2,2,2,1):clip;vDepth=length(p.xyz);vRadius=s;vNormal=aNormal;vWorld=aDrop.xyz;
}`;
const fragment=`precision highp float;in vec2 vQ;in float vDepth,vRadius;flat in vec3 vNormal,vWorld;out vec4 outColor;
uniform sampler2D uOpaqueRead,uWaterSurface,uImage;uniform vec2 uResolution;uniform vec3 uEye,uSH[16];uniform float uAmbient,uSunlight;uniform int uSHDegree;
${SH_GLSL}${LAB_LIGHTING_GLSL}
vec3 beadEnvironment(vec3 n){float b[16];basisSH(n,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=b[i]*uSH[i]*diffuseSHBand(i);}return max(c,vec3(0))*uAmbient;}
void main(){vec2 uv=gl_FragCoord.xy/uResolution;float solid=texture(uOpaqueRead,uv).a,water=texture(uWaterSurface,uv).a;if(vDepth>min(solid,water)+vRadius*1.5)discard;
 float q=dot(vQ,vQ),a=exp(-q*.5)*.7;if(a<.01)discard;vec3 view=normalize(uEye-vWorld);if(dot(view,vNormal)<=0.)discard;vec3 t=normalize(cross(vNormal,abs(vNormal.y)<.9?vec3(0,1,0):vec3(1,0,0))),b=cross(vNormal,t),n=normalize(vNormal+t*vQ.x*.6+b*vQ.y*.6);
 vec3 behind=texture(uImage,clamp(uv+vQ*.0006,.001,.999)).rgb;float f=.02+.98*pow(1.-max(0.,dot(n,view)),5.);vec3 reflected=labSky(reflect(-view,n))*uAmbient;
 vec3 light=mix(behind*.98,reflected,f)+LAB_SUN*uSunlight*labSpecular(n,view,labSunDirection(),.09,.02)+beadEnvironment(n)*.015;outColor=vec4(light*a,a);
}`;
export class SurfaceDropRenderer {
 constructor(u){this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:u,vertexShader:SURFACE_DROP_VERTEX,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);this.geometry.instanceCount=0;}
 update(drops){if(this.revision===drops.revision&&this.drops===drops)return;this.drops=drops;this.revision=drops.revision;const beads=drops.beads(),n=beads.length;if(!this.data||this.data.length<n*4){const size=Math.max(256,n*2);this.data=new Float32Array(size*4);this.normals=new Float32Array(size*3);this.geometry.setAttribute('aDrop',new THREE.InstancedBufferAttribute(this.data,4));this.geometry.setAttribute('aNormal',new THREE.InstancedBufferAttribute(this.normals,3));}beads.forEach((p,i)=>{this.data.set([...p.position,p.radius],i*4);this.normals.set(p.normal,i*3);});this.geometry.attributes.aDrop.needsUpdate=true;this.geometry.attributes.aNormal.needsUpdate=true;this.geometry.instanceCount=n;}
 render(renderer,camera,drops){this.update(drops);if(this.geometry.instanceCount)renderer.render(this.scene,camera);}
}
