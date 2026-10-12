import { LIGHT_BOUNDARIES_GLSL, LIGHT_MEDIA_GLSL } from './light-transport-shaders.js';

// One fragment follows one packet. State, receiver deposits, and reductions stay
// on the graphics device. The same boundary code drives the camera-ray cache.
export const PHOTON_TRACE_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D uOrigins,uDirections;
uniform int uPacketWidth,uPacketCount,uMapSize;
uniform bool uDispersion,uWhite,uRecordPaths;
layout(location=0) out vec4 endpoint;
layout(location=1) out vec4 losses;
layout(location=2) out vec4 received;
${LIGHT_BOUNDARIES_GLSL}
${LIGHT_MEDIA_GLSL}
float randomPhoton(int index,int dimension){uint x=uint(index+1)*747796405u+uint(dimension+1)*2891336453u;x=(x^(x>>16u))*2246822519u;return float(x^(x>>13u))/4294967296.;}
void main(){
 ivec2 pixel=ivec2(gl_FragCoord.xy);int index=pixel.x+pixel.y*uPacketWidth;
 if(uRecordPaths)index=pixel.x*max(1,uPacketCount/36);
 endpoint=vec4(0);losses=vec4(0);received=vec4(0);if(index>=uPacketCount)return;
 ivec2 address=ivec2(index%uPacketWidth,index/uPacketWidth);
 vec4 emitter=texelFetch(uOrigins,address,0),ray=texelFetch(uDirections,address,0);
 vec3 o=emitter.xyz,d=normalize(ray.xyz);int channel=int(emitter.w);float power=ray.w;bool changed=false;
 for(int depth=0;depth<28;depth++){
  HitLT h=nearestLT(o,d);
  if(h.id<0){if(uRecordPaths&&pixel.y==depth){endpoint=vec4(o,float(channel));losses=vec4(o+d*7.,power/ray.w);return;}losses.y+=power;power=0.;break;}
  float transmission=exp(-absorptionLT(mediumLT(o))[channel]*h.t);losses.x+=power*(1.-transmission);power*=transmission;
  if(uRecordPaths&&pixel.y==depth){endpoint=vec4(o,float(channel));losses=vec4(h.p,power/ray.w);return;}
  if(h.id>=100){
   vec2 uv=h.id==100?(h.p.xz+6.)/12.:vec2((h.p.x+6.)/12.,h.p.y/6.);
   // Encode the receiver separately: rounding UV to 1 must not change surfaces.
   endpoint=vec4(uv,power,float(channel+(changed?3:0)+6*(h.id-100)));
   received.y=power;if(changed)received.w=power;else received.z=power;power=0.;break;
  }
  bool mirror=int(uShapesLT[h.id].x)==5;
  if(!mirror&&h.before==h.after){o=h.p+d*EPS*3.;continue;}
  losses.w+=1.;
  if(mirror){losses.x+=power*.05;power*=.95;d=reflect(d,h.n);}
  else{
   float ni=iorLT(h.before,channel),nt=iorLT(h.after,channel),F=fresnelLT(max(0.,-dot(d,h.n)),ni,nt);
   vec3 transmitted=refract(d,h.n,ni/nt);
   if(dot(transmitted,transmitted)<.1){d=reflect(d,h.n);received.x+=1.;}
   else if(randomPhoton(uWhite?index/3:index,depth)<F)d=reflect(d,h.n);
   else d=normalize(transmitted);
  }
  changed=true;o=h.p+d*EPS*3.;
 }
 if(uRecordPaths){endpoint=vec4(0);losses=vec4(0);received=vec4(0);return;}
 losses.z=power;
}`;

export const PHOTON_DEPOSIT_VERTEX=`precision highp float;
precision highp int;
uniform sampler2D uEndpoints;uniform int uPacketWidth,uMapSize;
flat out vec3 vPower;flat out int vCaustic;
void main(){
 int packet=gl_VertexID/4,tap=gl_VertexID%4;
 vec4 e=texelFetch(uEndpoints,ivec2(packet%uPacketWidth,packet/uPacketWidth),0);
 int receiver=int(e.w)/6,channel=int(e.w)%3;vCaustic=(int(e.w)/3)%2;vPower=vec3(0);
 vec2 p=e.xy*float(uMapSize)-.5,base=floor(p),f=fract(p);
 vec2 offset=vec2(tap%2,tap/2),target=base+offset;float total=0.;
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){vec2 q=base+vec2(i,j);if(all(greaterThanEqual(q,vec2(0)))&&all(lessThan(q,vec2(uMapSize))))total+=(i==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y);}
 gl_PointSize=1.;gl_Position=vec4(2,2,0,1);
 if(e.z<=0.||total<=0.||any(lessThan(target,vec2(0)))||any(greaterThanEqual(target,vec2(uMapSize))))return;
 float weight=(offset.x==0.?1.-f.x:f.x)*(offset.y==0.?1.-f.y:f.y)/total;
 float area=12.*(receiver==0?12.:6.)/float(uMapSize*uMapSize);vPower[channel]=e.z*weight/area;
 vec2 uv=(target+vec2(.5,float(receiver*uMapSize)+.5))/vec2(uMapSize,uMapSize*2);
 gl_Position=vec4(uv*2.-1.,0,1);
}`;
export const PHOTON_DEPOSIT_FRAGMENT=`precision highp float;
flat in vec3 vPower;flat in int vCaustic;
layout(location=0) out vec4 direct;layout(location=1) out vec4 caustic;
void main(){direct=vec4(vCaustic==0?vPower:vec3(0),0);caustic=vec4(vCaustic==1?vPower:vec3(0),0);}`;

// Gather the scatter-form kernel: normalization belongs to the SOURCE texel.
// This conserves flux at borders and keeps floor/wall texels separate.
export const PHOTON_FILTER_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D uMapA,uMapB,uKernel;
uniform int uAxis,uMapSize;
layout(location=0) out vec4 direct;layout(location=1) out vec4 caustic;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);int receiver=p.y/uMapSize,coordinate=uAxis==0?p.x:p.y%uMapSize;
 int row=uAxis==0?0:receiver+1;direct=vec4(0);caustic=vec4(0);
 for(int offset=-20;offset<=20;offset++){
  int source=coordinate+offset;if(source<0||source>=uMapSize)continue;
  vec2 kernel=texelFetch(uKernel,ivec2(source,row),0).xy;
  if(abs(float(offset))>ceil(3.*kernel.y))continue;
  float w=exp(-.5*pow(float(offset)/kernel.y,2.))/kernel.x;
  ivec2 q=p+(uAxis==0?ivec2(offset,0):ivec2(0,offset));
  direct+=texelFetch(uMapA,q,0)*w;caustic+=texelFetch(uMapB,q,0)*w;
 }
}`;

export const PHOTON_REDUCE_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D uMapA,uMapB;
layout(location=0) out vec4 a;layout(location=1) out vec4 b;
void main(){ivec2 p=ivec2(gl_FragCoord.xy)*2,size=textureSize(uMapA,0);a=vec4(0);b=vec4(0);
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 q=p+ivec2(x,y);if(all(lessThan(q,size))){a+=texelFetch(uMapA,q,0);b+=texelFetch(uMapB,q,0);}}
}`;
