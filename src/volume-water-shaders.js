import { PLIC_GLSL } from './volume-interface.js';
import { BEACH_WIND_GLSL } from './beach-wind.js';
export const VOLUME_GRID_GLSL=`
uniform bool uVolumeLinear;uniform vec3 uVolumeOrigin;uniform ivec3 uVolumeSize;uniform float uVolumeDx;uniform int uVolumeTiles;
uniform sampler2D uVolumeFraction,uVolumeVelocity,uVolumeSolid;
#ifdef VOLUME_COMPUTE
uniform sampler2D uVBoundary;uniform bool uVOpen;
#endif
ivec2 volumeUV(ivec3 c){c=clamp(c,ivec3(0),uVolumeSize-1);return ivec2((c.z%uVolumeTiles)*uVolumeSize.x+c.x,(c.z/uVolumeTiles)*uVolumeSize.y+c.y);}
ivec3 volumeCell(ivec2 p){ivec2 tile=p/uVolumeSize.xy;return ivec3(p.x%uVolumeSize.x,p.y%uVolumeSize.y,tile.y*uVolumeTiles+tile.x);}
bool volumeInside(ivec3 c){return all(greaterThanEqual(c,ivec3(0)))&&all(lessThan(c,uVolumeSize));}
vec4 volumeFetch(sampler2D t,ivec3 c){return texelFetch(t,volumeUV(c),0);}
vec3 volumePoint(ivec3 c){return uVolumeOrigin+(vec3(c)+.5)*uVolumeDx;}
vec4 volumeSample(sampler2D t,vec3 p){vec3 q=clamp((p-uVolumeOrigin)/uVolumeDx-.5,vec3(0),vec3(uVolumeSize-1));if(!uVolumeLinear){ivec3 b=ivec3(floor(q));vec3 f=fract(q);vec4 value=vec4(0);for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++)value+=volumeFetch(t,b+ivec3(x,y,z))*(x==1?f.x:1.-f.x)*(y==1?f.y:1.-f.y)*(z==1?f.z:1.-f.z);return value;}int z=int(floor(q.z)),z1=min(z+1,uVolumeSize.z-1);vec2 extent=vec2(uVolumeSize.x*uVolumeTiles,uVolumeSize.y*((uVolumeSize.z+uVolumeTiles-1)/uVolumeTiles));vec2 a=vec2((z%uVolumeTiles)*uVolumeSize.x,(z/uVolumeTiles)*uVolumeSize.y)+q.xy+.5,b=vec2((z1%uVolumeTiles)*uVolumeSize.x,(z1/uVolumeTiles)*uVolumeSize.y)+q.xy+.5;return mix(texture(t,a/extent),texture(t,b/extent),fract(q.z));}
vec3 volumeVelocityAt(vec3 p){float h=uVolumeDx*.5;return vec3(volumeSample(uVolumeVelocity,p-vec3(h,0,0)).x,volumeSample(uVolumeVelocity,p-vec3(0,h,0)).y,volumeSample(uVolumeVelocity,p-vec3(0,0,h)).z);}
float volumeAlpha(ivec3 c){if(volumeInside(c))return volumeFetch(uVolumeFraction,c).r;
#ifdef VOLUME_COMPUTE
 if(uVOpen&&c.y>=0&&c.y<uVolumeSize.y){vec4 b=texelFetch(uVBoundary,clamp(c.xz,ivec2(0),uVolumeSize.xz-1),0);return clamp(.5+(b.r-volumePoint(c).y)/uVolumeDx,0.,1.);}
#endif
 return 0.;}
ivec3 volumeAxis(int a){return a==0?ivec3(1,0,0):a==1?ivec3(0,1,0):ivec3(0,0,1);}
float volumeComponent(vec3 v,int a){return a==0?v.x:a==1?v.y:v.z;}
bool volumeOpenFace(ivec3 c,int a){
#ifdef VOLUME_COMPUTE
 return uVOpen&&a!=1&&(c[a]==-1||c[a]==uVolumeSize[a]-1);
#else
 return false;
#endif
}
bool volumeClosed(ivec3 c,int a){if(!volumeInside(c)||!volumeInside(c+volumeAxis(a))){if(!volumeOpenFace(c,a))return true;return volumeFetch(uVolumeSolid,c).r<=0.||volumeFetch(uVolumeSolid,c+volumeAxis(a)).r<=0.;}vec4 s=volumeFetch(uVolumeSolid,c);return s.x<=0.||volumeFetch(uVolumeSolid,c+volumeAxis(a)).x<=0.||(a==0?s.g:a==1?s.b:s.a)<0.;}
float volumeTheta(float a,float b){return clamp((a-.5)/(a-b),.25,1.);}
`;
export const VOLUME_STEP_FRAGMENT=`precision highp float;precision highp int;
in vec2 vUv;out vec4 outColor;
#define VOLUME_COMPUTE
${VOLUME_GRID_GLSL}
${BEACH_WIND_GLSL}
${PLIC_GLSL}
uniform sampler2D uVPressure,uVRhs,uVPlane,uVFlux,uVLimits;uniform int uVPass;
uniform float uVDt,uVTime,uVWind,uVAngle,uVTurbulence;uniform vec4 uVJetOrigin,uVJetDirection;uniform float uVJetLength;
vec3 air(vec3 p){vec2 w=beachWind(p.xz,uVTime,uVWind,uVAngle,uVTurbulence);return vec3(w.x,0,w.y)+windJet(p,uVJetOrigin,uVJetDirection,uVJetLength);}
float atmosphericPressure(vec3 p){ivec3 c=ivec3(floor((p-uVolumeOrigin)/uVolumeDx));vec3 grad=vec3(0);for(int k=0;k<3;k++){ivec3 q=c-ivec3(0,k,0);grad+=vec3(volumeAlpha(q+ivec3(1,0,0))-volumeAlpha(q-ivec3(1,0,0)),volumeAlpha(q+ivec3(0,1,0))-volumeAlpha(q-ivec3(0,1,0)),volumeAlpha(q+ivec3(0,0,1))-volumeAlpha(q-ivec3(0,0,1)));}float slope=dot(grad.xz,vec2(sin(uVAngle),cos(uVAngle)))/max(.2,-grad.y);vec3 jet=windJet(p,uVJetOrigin,uVJetDirection,uVJetLength);return windPressure(p.xz,uVTime,uVWind,uVAngle,uVTurbulence)+.001225*jet.y*jet.y+.00015*uVWind*uVWind*clamp(slope,-1.,1.);}
float fieldPressure(ivec3 c){vec4 rhs=volumeFetch(uVRhs,c);return rhs.y>.5?volumeFetch(uVPressure,c).x:rhs.z;}
float boundaryVelocity(ivec3 c,int a){vec4 b=texelFetch(uVBoundary,clamp(c.xz,ivec2(0),uVolumeSize.xz-1),0);return a==0?b.g:a==2?b.b:0.;}
float faceVelocity(ivec3 c,int a){return volumeInside(c)?volumeComponent(volumeFetch(uVolumeVelocity,c).xyz,a):volumeOpenFace(c,a)?boundaryVelocity(c,a):0.;}
float geometricFlux(ivec3 c,int a){if(volumeClosed(c,a))return 0.;float v=faceVelocity(c,a);ivec3 donor=v>=0.?c:c+volumeAxis(a);float alpha=volumeAlpha(donor);vec4 plane=volumeInside(donor)?volumeFetch(uVPlane,donor):vec4(0,1,0,alpha);return v*planeFlux(alpha,plane,a,v*uVDt/uVolumeDx);}
float rawFlux(ivec3 c,int a){return volumeInside(c)?volumeComponent(volumeFetch(uVFlux,c).xyz,a):geometricFlux(c,a);}
float transportFlux(ivec3 c,int a){float f=rawFlux(c,a);ivec3 donor=f>=0.?c:c+volumeAxis(a);return f*(volumeInside(donor)?volumeFetch(uVLimits,donor).r:1.);}

void main(){ivec3 c=volumeCell(ivec2(gl_FragCoord.xy));if(!volumeInside(c)){outColor=vec4(0);return;}vec3 p=volumePoint(c);float h=uVolumeDx;vec4 state=volumeFetch(uVolumeFraction,c),solid=volumeFetch(uVolumeSolid,c);vec3 velocity=volumeFetch(uVolumeVelocity,c).xyz;
 if(uVPass==6){if(state.x<.00001||state.x>.99999){outColor=vec4(0,1,0,state.x);return;}vec3 n=vec3(volumeAlpha(c-ivec3(1,0,0))-volumeAlpha(c+ivec3(1,0,0)),volumeAlpha(c-ivec3(0,1,0))-volumeAlpha(c+ivec3(0,1,0)),volumeAlpha(c-ivec3(0,0,1))-volumeAlpha(c+ivec3(0,0,1)));float len=dot(abs(n),vec3(1));n=len>.00001?n/len:vec3(0,1,0);outColor=vec4(n,planeOffset(state.x,abs(n)));return;}
 if(uVPass==7){outColor=vec4(geometricFlux(c,0),geometricFlux(c,1),geometricFlux(c,2),0);return;}
 if(uVPass==8){float outgoing=0.;for(int a=0;a<3;a++)outgoing+=max(0.,rawFlux(c,a))+max(0.,-rawFlux(c-volumeAxis(a),a));outColor=vec4(min(1.,state.x/max(.000000001,outgoing*uVDt/h)),0,0,0);return;}
 if(uVPass==0){vec3 next=vec3(0);for(int a=0;a<3;a++){ivec3 axis=volumeAxis(a);float value=0.;if(!volumeClosed(c,a)&&max(state.x,volumeAlpha(c+axis))>=.001){vec3 face=p+vec3(axis)*h*.5,v=volumeVelocityAt(face),mid=face-v*uVDt*.5,back=face-volumeVelocityAt(mid)*uVDt;value=volumeComponent(volumeSample(uVolumeVelocity,back-vec3(axis)*h*.5).xyz,a);if(a==1)value-=9.81*uVDt;float exposed=clamp(1.-volumeAlpha(c+ivec3(0,2,0)),0.,1.),relative=volumeComponent(air(face),a)-value;value+=uVDt*.00005*exposed*relative*abs(relative)/max(.2,h);if(uVOpen){float edge=float(min(min(c.x,uVolumeSize.x-1-c.x),min(c.z,uVolumeSize.z-1-c.z))),blend=clamp((4.-edge)/4.,0.,1.)*uVDt*6.;vec4 b=texelFetch(uVBoundary,c.xz,0);value=mix(value,a==0?b.g:a==2?b.b:0.,blend);}value*=.9999;}if(volumeOpenFace(c,a)&&!volumeClosed(c,a))value=boundaryVelocity(c,a);if(a==0)next.x=value;else if(a==1)next.y=value;else next.z=value;}outColor=vec4(next,0);return;}
 if(uVPass==1){float div=0.;for(int a=0;a<3;a++){ivec3 m=c-volumeAxis(a);div+=volumeComponent(velocity,a)-faceVelocity(m,a);}outColor=vec4(div/h,solid.x>0.&&state.x>.5?1.:0.,atmosphericPressure(p),0);return;}
 if(uVPass==2){vec4 rhs=volumeFetch(uVRhs,c);if(rhs.y<.5){outColor=vec4(0);return;}float sum=0.,den=0.;for(int a=0;a<3;a++)for(int j=0;j<2;j++){int sign=j==0?-1:1;ivec3 n=c+volumeAxis(a)*sign,face=sign>0?c:n;if(volumeClosed(face,a)||volumeOpenFace(face,a))continue;float b=volumeAlpha(n),weight=b>.5?1.:1./volumeTheta(state.x,b);sum+=weight*fieldPressure(n);den+=weight;}outColor=vec4(den>0.?(sum-rhs.x*h*h/uVDt)/den:0.,0,0,0);return;}
 if(uVPass==3){vec3 next=velocity;bool left=volumeFetch(uVRhs,c).y>.5;for(int a=0;a<3;a++){ivec3 n=c+volumeAxis(a);bool right=volumeFetch(uVRhs,n).y>.5;float value=volumeComponent(velocity,a);if(volumeClosed(c,a))value=0.;else if(!volumeOpenFace(c,a)&&(left||right)){float b=volumeAlpha(n),theta=left&&right?1.:left?volumeTheta(state.x,b):volumeTheta(b,state.x);value-=uVDt/h*(fieldPressure(n)-fieldPressure(c))/theta;}if(a==0)next.x=value;else if(a==1)next.y=value;else next.z=value;}outColor=vec4(next,0);return;}
 if(uVPass==4){vec3 next=velocity;for(int a=0;a<3;a++){ivec3 axis=volumeAxis(a);if(volumeClosed(c,a)||volumeOpenFace(c,a)||max(state.x,volumeAlpha(c+axis))>.5)continue;float sum=0.,count=0.;for(int b=0;b<3;b++)for(int j=0;j<2;j++){ivec3 q=c+volumeAxis(b)*(j==0?-1:1);if(volumeInside(q)&&!volumeClosed(q,a)&&max(volumeAlpha(q),volumeAlpha(q+axis))>.5){sum+=volumeComponent(volumeFetch(uVolumeVelocity,q).xyz,a);count++;}}float value=count>0.?sum/count:0.;if(a==0)next.x=value;else if(a==1)next.y=value;else next.z=value;}outColor=vec4(next,0);return;}
 if(uVPass==5){float alpha=state.x;for(int a=0;a<3;a++)alpha-=uVDt/h*(transportFlux(c,a)-transportFlux(c-volumeAxis(a),a));alpha=solid.x<0.?0.:clamp(alpha,0.,1.);vec3 v=volumeVelocityAt(p);float foam=volumeSample(uVolumeFraction,p-v*uVDt).g,speed=length(v),entrained=alpha>.05&&alpha<.95&&volumeAlpha(c-ivec3(0,1,0))<.3&&speed>1.?speed*.15:0.;foam=clamp(foam*exp(-uVDt*.5)+uVDt*entrained,0.,1.);
  outColor=vec4(alpha,foam,solid.x>0.?1.:0.,0);return;}
 outColor=vec4(0);
}`;
