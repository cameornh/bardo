import { VOLUME_GRID_GLSL } from './volume-water-shaders.js';
// The liquid interface may cross a vertical column several times. These queries
// retain the underside of an overturning sheet rather than collapsing it to y(x,z).
export const VOLUME_RENDER_GLSL=`
${VOLUME_GRID_GLSL}
uniform bool uVolumeEnabled;
float volumeWeight(vec3 p){if(!uVolumeEnabled)return 0.;vec3 q=(p-uVolumeOrigin)/uVolumeDx;float edge=min(min(q.x,float(uVolumeSize.x)-q.x),min(q.z,float(uVolumeSize.z)-q.z));return smoothstep(1.,4.,edge)*step(0.,q.y)*step(q.y,float(uVolumeSize.y));}
// Reconstruct only through fluid/air cells. Solid cells are unavailable data,
// not bubbles: including their zero fraction invents an optical seabed interface.
float liquidDensity(vec3 p){vec4 s=volumeSample(uVolumeFraction,p);return s.b>.0001?s.r/s.b:1.;}
float surfaceAlpha(ivec3 c){return volumeFetch(uVolumeSolid,c).r<=0.?1.:volumeAlpha(c);}
vec3 liquidGradient(vec3 p){float h=uVolumeDx*.65;return vec3(liquidDensity(p+vec3(h,0,0))-liquidDensity(p-vec3(h,0,0)),liquidDensity(p+vec3(0,h,0))-liquidDensity(p-vec3(0,h,0)),liquidDensity(p+vec3(0,0,h))-liquidDensity(p-vec3(0,0,h)))/(2.*h);}
vec3 liquidNormal(vec3 p){vec3 g=-liquidGradient(p);return length(g)>.001?normalize(g):vec3(0,1,0);}
float liquidField(vec3 p){float base=p.y-surfaceHeight(p.xz,1);return mix(base,(.5-liquidDensity(p))*uVolumeDx,volumeWeight(p));}
vec3 waterNormal3(vec3 p,float e){float w=volumeWeight(p);vec3 base=surfaceNormal(p.xz,1,e);return w>0.?normalize(mix(base,liquidNormal(p),w)):base;}
bool waterAt3(vec3 p){return volumeWeight(p)>.5?liquidDensity(p)>.5:p.y<surfaceHeight(p.xz,1)&&waterState(p.xz).x>.005;}
vec2 volumeInterval(vec3 o,vec3 d){vec3 inv=1./(d+vec3(1e-8)),a=(uVolumeOrigin-o)*inv,b=(uVolumeOrigin+vec3(uVolumeSize)*uVolumeDx-o)*inv,lo=min(a,b),hi=max(a,b);return vec2(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));}
float traceVolume(vec3 o,vec3 d,float maxT,bool exiting){if(!uVolumeEnabled)return 1e5;vec2 range=volumeInterval(o,d);float t=max(.012,range.x),end=min(maxT,range.y),last=t;if(t>end)return 1e5;float direction=exiting?-1.:1.;
 for(int i=0;i<400;i++){vec3 p=o+d*t;float f=liquidField(p)*direction;if(f<0.&&volumeWeight(p)>.01){float a=last,b=t;for(int j=0;j<6;j++){float m=(a+b)*.5;if(liquidField(o+d*m)*direction>0.)a=m;else b=m;}return (a+b)*.5;}last=t;t+=uVolumeDx*.65;if(t>end)break;}return 1e5;}
`;
