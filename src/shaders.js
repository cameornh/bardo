import { FIELD_GLSL } from './world.js';
import { LIGHT_FUNCTIONS, REFERENCE_FRAGMENT } from './reference-shader.js';
export { REFERENCE_FRAGMENT };
export const QUAD_VERTEX = `out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}`;
const uniforms = `
uniform vec3 uEye,uLight;
uniform vec3 uColors[7];
uniform vec4 uMaterials[7];
uniform bool uReflections,uShowChunks;
${FIELD_GLSL}
`;
const sh = `
void basisSH(vec3 d,out float b[16]){
 float x=d.x,y=d.y,z=d.z;
 b[0]=.2820947918;
 b[1]=-.4886025119*y;b[2]=.4886025119*z;b[3]=-.4886025119*x;
 b[4]=1.0925484306*x*y;b[5]=-1.0925484306*y*z;b[6]=.3153915653*(2.*z*z-x*x-y*y);b[7]=-1.0925484306*x*z;b[8]=.5462742153*(x*x-y*y);
 b[9]=-.5900435899*y*(3.*x*x-y*y);b[10]=2.8906114426*x*y*z;b[11]=-.4570457995*y*(4.*z*z-x*x-y*y);b[12]=.3731763326*z*(2.*z*z-3.*x*x-3.*y*y);b[13]=-.4570457995*x*(4.*z*z-x*x-y*y);b[14]=1.4453057213*z*(x*x-y*y);b[15]=-.5900435899*x*(x*x-3.*y*y);
}
`;
export const SH_GLSL = sh;
export const GAUSSIAN_VERTEX = `
precision highp float;
in float aSlot,aWeight;
uniform sampler2D uSplatData;
uniform int uDataWidth,uSHDegree,uLayer;
uniform vec2 uResolution;
uniform mat3 uProbeRotation;
${uniforms}
${sh}
out vec2 vGaussian;
out vec3 vCenter,vNormal,vRadiance;
out float vTau,vRadius,vSeed;
flat out int vId,vFlags;
flat out vec4 vBounds;
vec4 dataAt(int offset){int address=int(aSlot)*21+offset;return texelFetch(uSplatData,ivec2(address%uDataWidth,address/uDataWidth),0);}
float shadowAt(vec3 p,vec3 n,vec3 light){
 float t=.09,res=1.;p+=n*.065;
 for(int i=0;i<16;i++){float h=mapScene(p+light*t,-1).x;if(h<.002)return .18;res=min(res,10.*h/t);t+=clamp(h,.08,1.);if(t>8.)break;}
 return clamp(res,.18,1.);
}
void main(){
 vec4 center=dataAt(0),normal=dataAt(1),c0=dataAt(2),c1=dataAt(3);
 int id=int(center.w+.5);vec3 p=center.xyz,n=normal.xyz;
 if((uLayer==0&&id!=6)||(uLayer==1&&id==6)){gl_Position=vec4(2,2,2,1);return;}
 mat3 covariance=mat3(c0.x,c0.y,c0.z,c0.y,c1.x,c1.y,c0.z,c1.y,c1.z);
 vec3 viewDirection;
 if(id==5){p=uProbeRotation*p;covariance=uProbeRotation*covariance*transpose(uProbeRotation);n=uProbeRotation*n;}
 if(id<6)p+=uCenters[id];
 viewDirection=normalize(uEye-p);
 vec3 shDirection=id==5?transpose(uProbeRotation)*viewDirection:viewDirection;
 float basis[16];basisSH(shDirection,basis);vec3 radiance=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;radiance+=dataAt(5+i).rgb*basis[i];}
 vec3 base=uColors[id];vec4 material=uMaterials[id];float rough=material.x,metal=material.y;
 if(!uReflections)radiance=base*(1.-metal)*(.23+.12*max(n.y,0.));
 radiance=max(radiance,vec3(0));
 vec3 l=normalize(uLight),h=normalize(l+viewDirection);
 float nv=max(dot(n,viewDirection),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),vh=max(dot(viewDirection,h),0.);
 vec3 f0=mix(vec3(.04),base,metal),f=f0+(1.-f0)*pow(1.-vh,5.);
 float a=max(rough*rough,.025),a2=a*a,denom=nh*nh*(a2-1.)+1.,k=(rough+1.)*(rough+1.)/8.;
 float g=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
 vec3 spec=a2/(3.14159265*denom*denom)*g*f/max(4.*nv*nl,.001);
 if(id!=6&&nl>.001)radiance+=((1.-f)*(1.-metal)*base/3.14159265+spec)*vec3(3.5,3.1,2.6)*nl*shadowAt(p,n,l);
 radiance+=base*material.w*max((dot(n,l)+.55)/1.55,0.)*.25;
 if(id==4)radiance+=vec3(.66,.51,.30)*pow(1.-nv,2.)*.35;
 if(id==5)radiance*=mix(.38,1.,smoothstep(.05,.12,abs(center.y)));
 vec4 viewP=viewMatrix*vec4(p,1.);
 mat3 rotation=mat3(viewMatrix),c=rotation*covariance*transpose(rotation);
 float z=max(-viewP.z,.1),fx=projectionMatrix[0][0]*uResolution.x*.5,fy=projectionMatrix[1][1]*uResolution.y*.5;
 // The local perspective approximation is unreliable for centers far outside
 // the frustum. Bound its slope so nearby offscreen kernels cannot span the sky.
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));
 vec3 jx=vec3(fx/z,0.,fx*slope.x/z),jy=vec3(0.,fy/z,fy*slope.y/z);
 float A=dot(jx,c*jx),B=dot(jx,c*jy),C=dot(jy,c*jy);
 float determinant=max(A*C-B*B,1e-8);
 // Pixel reconstruction filter with determinant compensation: widening a tiny
 // splat does not create extra integrated opacity (unlike simple dilation).
 A+=.3;C+=.3;
 float compensation=sqrt(determinant/max(A*C-B*B,1e-8));
 float mid=(A+C)*.5,delta=sqrt(max((A-C)*(A-C)*.25+B*B,0.));
 float e1=mid+delta,e2=max(mid-delta,.001);
 vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));
 float tau=normal.w*compensation*aWeight;
 float support=clamp(sqrt(2.*log(max(tau/.0001,1.01))),1.,8.);
 vec2 offset=support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=offset*2./uResolution*clip.w;
 if(viewP.z>-.1)clip=vec4(2,2,2,1);
 gl_Position=clip;
 vGaussian=position.xy*support;vCenter=p;vNormal=n;vRadiance=radiance;
 vTau=tau;vRadius=sqrt(max(max(covariance[0][0],covariance[1][1]),covariance[2][2]));
 vId=id;vFlags=int(c0.w+.5);vBounds=dataAt(4);vSeed=fract(sin(dot(center.xyz,vec3(127.1,311.7,74.7)))*43758.5453);
}
`;
export const GAUSSIAN_FRAGMENT = `
precision highp float;
${uniforms}
${LIGHT_FUNCTIONS}
uniform vec2 uResolution;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
uniform int uView;
uniform sampler2D uGlassTexture,uTerrainDepthTexture;
uniform vec2 uTerrainFade;
in vec2 vGaussian;
in vec3 vCenter,vNormal,vRadiance;
in float vTau,vRadius,vSeed;
flat in int vId,vFlags;
flat in vec4 vBounds;
out vec4 outColor;
void main(){
 float q=dot(vGaussian,vGaussian);
 float density=exp(-.5*q);
 // Gaussian optical depth, integrated to opacity; continuous tails and
 // linear density blending during parent/child LOD transitions.
 float alpha=1.-exp(-vTau*density);if(alpha<.0001)discard;
 vec4 farP=uInverseProjection*vec4(gl_FragCoord.xy/uResolution*2.-1.,1,1);
 vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 vec3 surfaceNormal=vNormal,p;
 bool terrainPatch=(vFlags&1)!=0,edited=(vFlags&2)!=0||(vId==0&&uEditCount>0);
 if(terrainPatch){
  vec4 surface=texture(uTerrainDepthTexture,gl_FragCoord.xy/uResolution);if(surface.r>=1.)discard;
  vec4 viewHit=uInverseProjection*vec4(gl_FragCoord.xy/uResolution*2.-1.,surface.r*2.-1.,1.);
  p=(uCameraMatrix*vec4(viewHit.xyz/viewHit.w,1.)).xyz;surfaceNormal=normalize(surface.gba);
  // Every kernel uses the same first surface hit. Cavity-wall kernels cannot
  // borrow a different Newton root and project their lighting onto the rim.
  float agreement=dot(surfaceNormal,vNormal);
  alpha*=smoothstep(.35,.8,agreement);
  float offset=abs(dot(p-vCenter,vNormal));
  if((vFlags&4)==0)alpha*=1.-smoothstep(max(.06,vRadius*.3),max(.12,vRadius*.9),offset);
  float fade=smoothstep(uTerrainFade.x,uTerrainFade.y,length(p.xz-uEye.xz));alpha*=1.-fade;
  if(alpha<.0001)discard;edited=false;
 }else{
  float denom=dot(ray,vNormal);if(abs(denom)<.00001)discard;
  float t=dot(vCenter-uEye,vNormal)/denom;if(t<=0.)discard;p=uEye+ray*t;
 }
 if(edited&&vId==6&&!terrainPatch){
  bool nearEdit=false;
  for(int i=0;i<64;i++){if(i>=uTerrainEditCount)break;if(length(p-uTerrainEdits[i].xyz)<uTerrainEdits[i].w+vRadius*4.){nearEdit=true;break;}}
  edited=nearEdit;
 }
 if(edited){
  vec3 start=p;
  for(int i=0;i<4;i++){
   float d=vId==6?terrainField(p):objectDistance(vId,p);
   float next=vId==6?terrainField(p+ray*.004):objectDistance(vId,p+ray*.004);
   float slope=(next-d)/.004;if(abs(slope)<.02)discard;
   p-=ray*clamp(d/slope,-vRadius,vRadius);
  }
  float residual=vId==6?terrainField(p):objectDistance(vId,p);
  if(abs(residual)>.008||length(p-start)>vRadius*3.)discard;
  // A kernel from the cavity wall must not color the outer rim after Newton
  // projection lands on that other face. Fade the incompatible normal support.
  alpha*=smoothstep(.1,.55,dot(fieldNormal(p,vId),vNormal));if(alpha<.0001)discard;
 }
 if(terrainPatch&&(p.x<vBounds.x||p.z<vBounds.y||p.x>=vBounds.z||p.z>=vBounds.w))discard;
 vec4 clip=uProjection*uViewMatrix*vec4(p,1.);
 if(clip.w<=0.||abs(clip.z)>clip.w)discard;
 gl_FragDepth=clip.z/clip.w*.5+.5;
 vec3 color=vRadiance;
 if(vId==6){
  if(terrainPatch)color=groundColor(p)*(vRadiance/max(uColors[6],vec3(.01))+max(dot(surfaceNormal,normalize(uLight)),0.)*vec3(1.05,.93,.78));
  else color*=groundColor(p)/max(uColors[6],vec3(.01));
 }
 if(vId==3&&uView==0){vec4 glass=texture(uGlassTexture,gl_FragCoord.xy/uResolution);if(glass.a>.5)color=glass.rgb;}
 if(uView==1)color=surfaceNormal*.5+.5;
 if(uView==2)color=mix(vec3(.12,.35,.7),vec3(1.,.4,.08),vSeed)*density;
 float fog=1.-exp(-max(length(vCenter-uEye)-(uTerrainMode?25.:18.),0.)*(uTerrainMode?.027:.012));
 color=mix(color,sky(ray),fog);
 outColor=vec4(color*alpha,alpha);
}
`;
export const GAUSSIAN_DEPTH_FRAGMENT=GAUSSIAN_FRAGMENT.slice(0,GAUSSIAN_FRAGMENT.indexOf(' vec3 color=vRadiance;'))+' outColor=vec4(0.); }';
// Grass needs the actual terrain depth: the nearest tangent plane in a broad
// ground kernel is not accurate enough for thin blades rooted on that surface.
export const TERRAIN_DEPTH_FRAGMENT=`precision highp float;in vec2 vUv;out vec4 outColor;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
${uniforms}
void main(){
 vec4 farP=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 float t=.1;bool hit=false;vec3 p;
 for(int i=0;i<512;i++){p=uEye+ray*t;float d=terrainField(p);if(d<.002){hit=true;break;}t+=max(d*.95,.003);if(t>210.)break;}
 if(!hit)discard;
 vec4 clip=uProjection*uViewMatrix*vec4(p,1.);if(clip.w<=0.||abs(clip.z)>clip.w)discard;
 outColor=vec4(clip.z/clip.w*.5+.5,fieldNormal(p,6));
}`;
export const COPY_TERRAIN_DEPTH_FRAGMENT=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uTerrainDepthTexture;
void main(){float d=texture(uTerrainDepthTexture,vUv).r;if(d>=1.)discard;gl_FragDepth=d;outColor=vec4(0);}`;
export const BACKGROUND_FRAGMENT = `precision highp float;in vec2 vUv;out vec4 outColor;uniform mat4 uInverseProjection,uCameraMatrix;${uniforms}${LIGHT_FUNCTIONS}
void main(){vec4 p=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(p.xyz/p.w));outColor=vec4(sky(ray),1.);}`;
// Refraction is evaluated once per covered pixel, not once per overlapping
// Gaussian. Visibility and opacity are still composited by the Gaussian pass.
export const GLASS_FRAGMENT = `precision highp float;in vec2 vUv;out vec4 outColor;uniform mat4 uInverseProjection,uCameraMatrix;${uniforms}${LIGHT_FUNCTIONS}
void main(){
 vec4 farP=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 vec3 relative=uEye-uCenters[3];float b=dot(relative,ray),c=dot(relative,relative)-.76*.76,disc=b*b-c;
 if(disc<=0.||b>=0.)discard;
 vec3 hit=uEye+ray*(-b-sqrt(disc)),n=normalize(hit-uCenters[3]);vec4 m=uMaterials[3];
 outColor=vec4(shade(hit,n,uColors[3],m.x,m.y,m.z,m.w,3),1.);
}`;
export const TONEMAP_FRAGMENT = `precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage;void main(){vec3 c=texture(uImage,vUv).rgb;c=c/(c+vec3(.7));outColor=vec4(pow(max(c,vec3(0)),vec3(1./2.2)),1.);}`;
