import {causticShader,focusUniforms} from './ground-caustics.js';
import {GroundFinish,groundFinishShader} from './ground-finish.js';
import {CELL,MAX_CUTS} from './ground-tools.js';
import * as THREE from 'three';
import {SAND_SIDE,SAND_METRES} from './wind-sand.js';
import {surfaceRelief} from './surface-grain.js';

const bed=`
 uniform bool granular;uniform sampler2D sandBed,localBed;uniform vec2 localOrigin;uniform vec4 localExtent;
 varying vec2 editSlope;
 float localSample(ivec2 c,ivec2 last){
  if(c.x<0||c.y<0||c.x>last.x||c.y>last.y)return 0.;
  return texelFetch(localBed,c,0).r;
 }
 vec2 pchip1D(float p0,float p1,float p2,float p3,float t){
  float d0=p1-p0,d1=p2-p1,d2=p3-p2;
  float m1=d0*d1>0.?2.*d0*d1/(d0+d1):0.;
  float m2=d1*d2>0.?2.*d1*d2/(d1+d2):0.;
  float t2=t*t,omt=1.-t,omt2=omt*omt;
  float v=(1.+2.*t)*omt2*p1+t*omt2*m1+t2*(3.-2.*t)*p2+t2*(t-1.)*m2;
  float dv=6.*t*(t-1.)*(p1-p2)+(3.*t-1.)*(t-1.)*m1+t*(3.*t-2.)*m2;
  return vec2(v,dv);
 }
 vec3 localSurface(vec2 q){
  if(localExtent.z<localExtent.x)return vec3(0.);
  vec2 p=q/${CELL.toFixed(5)}-localOrigin;
  if(any(lessThan(p,localExtent.xy))||any(greaterThan(p,localExtent.zw)))return vec3(0.);
  ivec2 i=ivec2(floor(p)),last=textureSize(localBed,0)-1;vec2 f=fract(p);
  vec2 r0=pchip1D(localSample(i+ivec2(-1,-1),last),localSample(i+ivec2(0,-1),last),localSample(i+ivec2(1,-1),last),localSample(i+ivec2(2,-1),last),f.x);
  vec2 r1=pchip1D(localSample(i+ivec2(-1, 0),last),localSample(i+ivec2(0, 0),last),localSample(i+ivec2(1, 0),last),localSample(i+ivec2(2, 0),last),f.x);
  vec2 r2=pchip1D(localSample(i+ivec2(-1, 1),last),localSample(i+ivec2(0, 1),last),localSample(i+ivec2(1, 1),last),localSample(i+ivec2(2, 1),last),f.x);
  vec2 r3=pchip1D(localSample(i+ivec2(-1, 2),last),localSample(i+ivec2(0, 2),last),localSample(i+ivec2(1, 2),last),localSample(i+ivec2(2, 2),last),f.x);
  vec2 hz=pchip1D(r0.x,r1.x,r2.x,r3.x,f.y);
  float dhdx=pchip1D(r0.y,r1.y,r2.y,r3.y,f.y).x;
  return vec3(hz.x,-vec2(dhdx,hz.y)/${CELL.toFixed(5)});
 }
 bool localEdited(vec2 q,int pad){
  if(localExtent.z<localExtent.x)return false;
  vec2 p=q/${CELL.toFixed(5)}-localOrigin;
  if(any(lessThan(p,localExtent.xy-float(pad)))||any(greaterThan(p,localExtent.zw+float(pad))))return false;
  ivec2 c=ivec2(floor(p)),last=textureSize(localBed,0)-1;
  float m=0.;
  for(int j=-1;j<=2;j++){if(j<0&&pad==0||j>1&&pad==0)continue;
   for(int i=-1;i<=2;i++){if(i<0&&pad==0||i>1&&pad==0)continue;
    m=max(m,abs(texelFetch(localBed,clamp(c+ivec2(i,j),ivec2(0),last),0).r));
   }
  }
  return m>.0003;
 }
 float sandHeight(vec2 q){
  vec2 h=texture2D(sandBed,q/${SAND_METRES.toFixed(1)}+.5/${SAND_SIDE.toFixed(1)}).rg;
  return (dot(h,vec2(65280.,255.))/65535.-.5)*4.;
 }`;
export {bed as sandReliefShader};
export const cutMask=`uniform int cutCount;uniform vec4 cutBounds;uniform vec2 cutCenters[${MAX_CUTS}];
void discardCut(vec2 point){
  if(cutCount>0&&all(greaterThanEqual(point,cutBounds.xy))&&all(lessThanEqual(point,cutBounds.zw))){
   for(int i=0;i<${MAX_CUTS};i++){if(i>=cutCount)break;vec2 d=point-cutCenters[i];
    if(max(max(abs(d.x),abs(d.y)),abs(d.x+d.y))<${CELL.toFixed(5)})discard;}
  }
}`;
export function groundSurface(view,lighting){
 const u=view.groundMaterial.uniforms,shared=view.oceanView.uniforms;
 view.finishMap=new GroundFinish();Object.assign(u,view.finishMap.uniforms,focusUniforms());
 Object.assign(u,{sandBed:{value:view.sandView.texture},granular:{value:false},grain:{value:new THREE.Vector3()},
  localBed:u.localBed??{value:null},localOrigin:u.localOrigin??{value:new THREE.Vector2()},localExtent:u.localExtent??{value:new THREE.Vector4(1,1,-1,-1)},
  grainMap:view.uniforms.grainMap,mirrorColor:shared.mirrorColor,mirrorVP:shared.mirrorVP,
  sunDirection:view.uniforms.sunDirection,sunColor:view.uniforms.sunColor,hazeColor:view.uniforms.hazeColor});
 view.groundMaterial.vertexShader=bed+`varying vec3 worldPosition;
  void main(){worldPosition=(modelMatrix*vec4(position,1.)).xyz;
   editSlope=vec2(0.);
   if(granular){
    vec2 p=worldPosition.xz;float fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p));
    vec3 local=localSurface(p);
    worldPosition.y+=(sandHeight(p)+local.x)*fade;
    editSlope=local.yz*fade;
   }
   gl_Position=projectionMatrix*viewMatrix*vec4(worldPosition,1.);}`;
 view.groundMaterial.fragmentShader=lighting.replace('n=faceforward(n,-v,n);','')+surfaceRelief+groundFinishShader+'\n#ifndef COASTAL_GROUND\n'+causticShader+'\n#endif\n'+bed+`
 #ifndef GROUND_PATCH
 ${cutMask}
 #endif
 uniform mat4 projectionMatrix;uniform vec3 color,grain,hazeColor;uniform vec4 properties;uniform sampler2D mirrorColor;uniform mat4 mirrorVP;
 varying vec3 worldPosition;
 void main(){
  vec3 p=worldPosition,base=color,n=vec3(0,1,0);
  #ifndef GROUND_PATCH
  discardCut(p.xz);
  #endif
  if(granular){
   const float d=${(SAND_METRES/SAND_SIDE*.5).toFixed(5)};
   float fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p.xz));
   vec2 sSlope=vec2(sandHeight(p.xz-vec2(d,0))-sandHeight(p.xz+vec2(d,0)),sandHeight(p.xz-vec2(0,d))-sandHeight(p.xz+vec2(0,d)))/(2.*d);
   vec2 lSlope=localSurface(p.xz).yz;
   n=normalize(vec3((sSlope.x+lSlope.x)*fade,1.,(sSlope.y+lSlope.y)*fade));
  }
  #ifdef GROUND_PATCH
  n=normalize(cross(dFdx(p),dFdy(p)));if(n.y<0.)n=-n;
  #endif
  vec3 prior=n;float lift=grainSurface(p,vec3(0,1,0),grain,n,base,cameraPosition-p);gl_FragDepth=reliefDepth(gl_FragCoord.z,p,prior,lift,projectionMatrix);vec2 finish=groundFinish(p.xz);
  vec4 props=properties;float wet=clamp((finish.x-.92*finish.y)/.28,0.,1.);
  base*=1.-min(.93,.88*finish.y+wet*(1.-properties.y)*.28);
  props.x=mix(props.x,min(props.x,.13),wet*.84);
  vec3 lit=shade(base,n,p,props);
  #ifndef COASTAL_GROUND
  lit+=base*(1.-.9*props.y)*focusedLight(p.xz);
  #endif
  if(properties.y>.02){
   vec3 offset=(n-vec3(0,1,0))*min(.7,length(cameraPosition-p)*.11);
   vec4 clip=mirrorVP*vec4(p+offset,1.);vec2 uv=clip.xy/max(.001,clip.w)*.5+.5;
   if(clip.w>0.&&all(greaterThan(uv,vec2(0.)))&&all(lessThan(uv,vec2(1.)))){
    vec2 radius=(.001+.012*properties.x*properties.x)*vec2(.75,1.);
    vec4 m=.4*texture2D(mirrorColor,uv);
    m+=.15*(texture2D(mirrorColor,uv+radius)+texture2D(mirrorColor,uv-radius)+texture2D(mirrorColor,uv+radius*vec2(1,-1))+texture2D(mirrorColor,uv-radius*vec2(1,-1)));
    float amount=properties.y*(1.-properties.x*.7);lit=lit*(1.-amount*m.a)+amount*m.rgb*mix(vec3(1.),base,.65);
   }
  }
  gl_FragColor=vec4(mix(lit,hazeColor,1.-exp(-length(cameraPosition-p)*.003)),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
 const grid=new THREE.PlaneGeometry(2,2,112,112);
 const axis=v=>Math.sign(v)*(9*Math.abs(v)+26*Math.abs(v)**3+9950*Math.abs(v)**13);
 const pos=grid.attributes.position;
 for(let i=0;i<pos.count;i++)pos.setXY(i,axis(pos.getX(i)),axis(pos.getY(i)));
 return grid;
}
