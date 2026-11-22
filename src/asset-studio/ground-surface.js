import {GroundFinish,groundFinishShader} from './ground-finish.js';
import {CELL,MAX_CUTS} from './ground-tools.js';
import * as THREE from 'three';
import {SAND_SIDE,SAND_METRES} from './wind-sand.js';
import {surfaceRelief} from './surface-grain.js';

const bed=`
 uniform bool granular;uniform sampler2D sandBed;
 varying vec2 editSlope;
 #ifdef SAND_VERTEX
 uniform sampler2D localBed;uniform vec2 localOrigin;uniform vec4 localExtent;
 vec3 localSurface(vec2 q){
  vec2 p=q/${CELL.toFixed(5)}-localOrigin;
  if(any(lessThan(p,localExtent.xy))||any(greaterThan(p,localExtent.zw)))return vec3(0.);
  ivec2 i=ivec2(floor(p)),last=textureSize(localBed,0)-1;vec2 f=fract(p);
  ivec2 diag=f.x+f.y<1.?ivec2(0):ivec2(1);
  float corner=texelFetch(localBed,clamp(i+diag,ivec2(0),last),0).r;
  float hx=texelFetch(localBed,clamp(i+ivec2(1,0),ivec2(0),last),0).r;
  float hz=texelFetch(localBed,clamp(i+ivec2(0,1),ivec2(0),last),0).r;
  float h=corner*abs(1.-f.x-f.y)+hx*min(f.x,1.-f.y)+hz*min(f.y,1.-f.x);
  return vec3(h,diag.x==0?vec2(corner-hx,corner-hz):vec2(hz-corner,hx-corner));
 }
 #endif
 float sandHeight(vec2 q){
  vec2 h=texture2D(sandBed,q/${SAND_METRES.toFixed(1)}+.5/${SAND_SIDE.toFixed(1)}).rg;
  return (dot(h,vec2(65280.,255.))/65535.-.5)*4.;
 }`;
export function groundSurface(view,lighting){
 const u=view.groundMaterial.uniforms,shared=view.oceanView.uniforms;
 view.finishMap=new GroundFinish();Object.assign(u,view.finishMap.uniforms);
 Object.assign(u,{sandBed:{value:view.sandView.texture},granular:{value:false},grain:{value:new THREE.Vector3()},
  grainMap:view.uniforms.grainMap,mirrorColor:shared.mirrorColor,mirrorVP:shared.mirrorVP});
 view.groundMaterial.vertexShader='#define SAND_VERTEX\n'+bed+`varying vec3 worldPosition;
  void main(){worldPosition=(modelMatrix*vec4(position,1.)).xyz;
   editSlope=vec2(0.);
   if(granular){
    vec2 p=worldPosition.xz;float fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p));
    vec3 local=localSurface(p);
    worldPosition.y+=(sandHeight(p)+local.x)*fade;
    editSlope=local.yz*fade;
   }
   gl_Position=projectionMatrix*viewMatrix*vec4(worldPosition,1.);}`;
 view.groundMaterial.fragmentShader=lighting.replace('n=faceforward(n,-v,n);','')+surfaceRelief+groundFinishShader+bed+`
 #ifndef GROUND_PATCH
 uniform int cutCount;uniform vec4 cutBounds;uniform vec2 cutCenters[${MAX_CUTS}];
 #endif
 uniform mat4 projectionMatrix;uniform vec3 color,grain;uniform vec4 properties;uniform sampler2D mirrorColor;uniform mat4 mirrorVP;
 varying vec3 worldPosition;
 void main(){
  vec3 p=worldPosition,base=color,n=vec3(0,1,0);
  #ifndef GROUND_PATCH
  if(cutCount>0&&all(greaterThanEqual(p.xz,cutBounds.xy))&&all(lessThanEqual(p.xz,cutBounds.zw))){
   for(int i=0;i<${MAX_CUTS};i++){if(i>=cutCount)break;vec2 d=p.xz-cutCenters[i];
    if(max(max(abs(d.x),abs(d.y)),abs(d.x+d.y))<${CELL.toFixed(5)})discard;}
  }
  #endif
  if(granular){
   const float d=${(SAND_METRES/SAND_SIDE*.5).toFixed(5)};
   float fade=1.-smoothstep(25.,65.,length(cameraPosition.xz-p.xz));
   n=normalize(vec3((sandHeight(p.xz-vec2(d,0))-sandHeight(p.xz+vec2(d,0)))*fade+editSlope.x,2.*d,
      (sandHeight(p.xz-vec2(0,d))-sandHeight(p.xz+vec2(0,d)))*fade+editSlope.y));
  }
  #ifdef GROUND_PATCH
  n=normalize(cross(dFdx(p),dFdy(p)));if(n.y<0.)n=-n;
  #endif
  vec3 prior=n;float lift=grainSurface(p,vec3(0,1,0),grain,n,base,cameraPosition-p);gl_FragDepth=reliefDepth(gl_FragCoord.z,p,prior,lift,projectionMatrix);vec2 finish=groundFinish(p.xz);
  vec4 props=properties;float wet=clamp((finish.x-.92*finish.y)/.28,0.,1.);
  base*=1.-min(.93,.88*finish.y+wet*(1.-properties.y)*.28);
  props.x=mix(props.x,min(props.x,.13),wet*.84);
  vec3 lit=shade(base,n,p,props);
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
  gl_FragColor=vec4(mix(lit,vec3(.38,.45,.48),1.-exp(-length(cameraPosition-p)*.003)),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
 const grid=new THREE.PlaneGeometry(2,2,112,112);
 const axis=v=>Math.sign(v)*(9*Math.abs(v)+26*Math.abs(v)**3+9950*Math.abs(v)**13);
 const pos=grid.attributes.position;
 for(let i=0;i<pos.count;i++)pos.setXY(i,axis(pos.getX(i)),axis(pos.getY(i)));
 return grid;
}
