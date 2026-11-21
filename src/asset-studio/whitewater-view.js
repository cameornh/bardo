import * as THREE from 'three';
import {lipPoint} from './whitewater.js';
import {medium,interfaceOptics} from './water-optics.js';

// Breakers retain their physical world position as the camera moves.
function drawLocal(p,camera,visit){
 if(!p.windCrest){visit(1);return;}
 const distance=Math.hypot(p.x-camera.position.x,p.z-camera.position.z);
 if(distance<64)visit(Math.min(1,(64-distance)/16));
}
export class WhitewaterView{
 constructor(scene,uniforms,wave,lighting){
  const along=20,across=6,stride=(along+1)*(across+1),rows=16;
  this.along=along;this.across=across;
  const g=new THREE.BufferGeometry(),indices=[];
  this.lips=new THREE.Float32BufferAttribute(new Float32Array(rows*stride*3),3);
  this.aeration=new THREE.Float32BufferAttribute(new Float32Array(rows*stride),1);
  for(let k=0;k<rows;k++)for(let a=0;a<along;a++)for(let b=0;b<across;b++){
   const i=k*stride+a*(across+1)+b;indices.push(i,i+1,i+across+1,i+1,i+across+2,i+across+1);
  }
  g.setAttribute('position',this.lips);g.setAttribute('bubbles',this.aeration);g.setIndex(indices);g.setDrawRange(0,0);
  this.ribbon=new THREE.Mesh(g,new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,
   vertexShader:wave+`attribute float bubbles;varying float air;varying vec3 p;void main(){
    p=position;p.y+=elevation(p.xz);air=bubbles;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
   fragmentShader:lighting+medium+interfaceOptics+`varying vec3 p;varying float air;void main(){
    vec3 n=normalize(cross(dFdx(p),dFdy(p)));
    gl_FragColor=vec4(opticalSurface(p,n,.075,air),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`}));
  this.ribbon.frustumCulled=false;scene.add(this.ribbon);
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geometry.setIndex([0,1,2,0,2,3]);
  this.attrs={};for(const [name,n] of [['packet',4],['axis',3],['style',4]]){
   this.attrs[name]=new THREE.InstancedBufferAttribute(new Float32Array(384*n),n);
   geometry.setAttribute(name,this.attrs[name]);
  }
  geometry.instanceCount=0;
  const material=new THREE.ShaderMaterial({uniforms,depthWrite:false,transparent:true,
   vertexShader:wave+`flat varying vec3 centerView,surfaceNormal;attribute vec4 packet,style;attribute vec3 axis;uniform vec2 viewport;varying vec2 gaussian;varying vec4 appearance;
   void main(){
    vec3 p=packet.xyz;
    vec2 slope=vec2(0.);
    if(style.z<.5){p.y=elevation(p.xz)+.018;slope=waterSlope(p.xz);}
    vec3 c=(viewMatrix*vec4(p,1.)).xyz;centerView=c;surfaceNormal=mat3(viewMatrix)*normalize(vec3(-slope.x,1.,-slope.y));float z=max(.03,-c.z);
    float bound=packet.w*2.6*max(1.,style.y);
    vec2 slopes=1./vec2(projectionMatrix[0][0],projectionMatrix[1][1]);
    // Perspective projection is locally linear only in front of the eye.
    // Offscreen spray close to the eye plane can otherwise cover the sky.
    if(-c.z<.04||any(greaterThan(abs(c.xy),z*slopes+bound*sqrt(1.+slopes*slopes)))){
     gl_Position=vec4(2.,2.,2.,1.);appearance=vec4(0.);gaussian=vec2(0.);return;
    }
    vec3 major=normalize(axis);
    vec3 side=normalize(cross(abs(major.y)>.95?vec3(1,0,0):vec3(0,1,0),major)),up=cross(major,side);
    mat3 M=mat3(viewMatrix)*mat3(major*style.y,side,up*mix(.23,1.,style.z));
    vec3 jx=vec3(1.,0.,c.x/z)*projectionMatrix[0][0]*viewport.x*.5*packet.w/z;
    vec3 jy=vec3(0.,1.,c.y/z)*projectionMatrix[1][1]*viewport.y*.5*packet.w/z;
    vec3 a=jx*M,b=jy*M;float xx=dot(a,a),yy=dot(b,b),xy=dot(a,b),minPixel=.17;
    float sx=sqrt(xx+minPixel),sy=xy/sx;gaussian=position.xy*2.6;
    vec2 offset=vec2(sx*gaussian.x,sy*gaussian.x+sqrt(max(.001,yy+minPixel-sy*sy))*gaussian.y);
    vec4 clip=projectionMatrix*vec4(c,1.);clip.xy+=2.*offset*clip.w/viewport;
    gl_Position=clip;appearance=style;appearance.x*=smoothstep(.35*bound,2.*bound,z);
    appearance.x*=sqrt(max(0.,xx*yy-xy*xy)/max(.00001,(xx+minPixel)*(yy+minPixel)-xy*xy));
   }`,
   fragmentShader:lighting+`uniform mat4 projectionMatrix;uniform vec2 viewport;uniform sampler2D bulkDepth;
   flat varying vec3 centerView,surfaceNormal;varying vec2 gaussian;varying vec4 appearance;void main(){
    gl_FragDepth=gl_FragCoord.z;
    if(appearance.z<.5){
     vec2 uv=gl_FragCoord.xy/viewport;
     vec3 ray=vec3((2.*uv-1.)/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),-1.);
     float denom=dot(surfaceNormal,ray);if(abs(denom)<.035)discard;
     float t=dot(centerView,surfaceNormal)/denom;if(t<.03)discard;
     vec4 clip=projectionMatrix*vec4(ray*t,1.);
     float z=.5+.5*clip.z/clip.w,wet=texture2D(bulkDepth,uv).r;
     float metres=clamp(.014*t,.045,.24);
     vec4 allowance=projectionMatrix*vec4(ray*(t+metres),1.);
     float err=abs(.5+.5*allowance.z/allowance.w-z);
     if(wet>=1.||z>wet+err)discard;
     gl_FragDepth=min(z,wet-.00000012);
    }
    float alpha=appearance.x*exp(-.5*dot(gaussian,gaussian));if(alpha<.005)discard;
    vec3 tint=mix(vec3(.94,.98,1.),vec3(.95,.79,.48),appearance.w*.7);
    gl_FragColor=vec4((env(vec3(0,1,0),1.)+vec3(.43))*tint,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  this.cloud=new THREE.Mesh(geometry,material);this.cloud.frustumCulled=false;this.cloud.renderOrder=3;scene.add(this.cloud);
 }
 update(sea,camera){
  let vertices=0,ribbons=0,count=0;
  for(const c of sea.crests)drawLocal(c,camera,fade=>{
   const age=sea.time-c.t;
   for(let a=0;a<=this.along;a++)for(let b=0;b<=this.across;b++){
    const s=2*a/this.along-1,u=b/this.across,p=lipPoint(c,s,u,age);
    this.lips.setXYZ(vertices,p.x,p.y*fade,p.z);
    this.aeration.setX(vertices++,fade*(1-s*s)*u**3*(.14+.31*Math.sin(c.phase+3*s+age)**2));
   }
   ribbons++;
  });
  this.ribbon.geometry.setDrawRange(0,ribbons*this.along*this.across*6);
  if(vertices)for(const attribute of [this.lips,this.aeration]){
   attribute.clearUpdateRanges();attribute.addUpdateRange(0,vertices*attribute.itemSize);attribute.needsUpdate=true;
  }
  for(const p of sea.whitewater.particles)drawLocal(p,camera,fade=>{
   const spray=p.kind==='spray',foam=p.kind==='foam',t=p.age/p.life;
   const size=p.size*(spray?1:1+t*.74),alpha=fade*Math.min(1,.15+p.age*18)*Math.min(1,(1-t)*4)*(spray?.36:foam?.69:.58);
   this.attrs.packet.setXYZW(count,p.x,p.y,p.z,size);
   this.attrs.axis.setXYZ(count,spray?p.vx:-p.dz,spray?p.vy+.001:0,spray?p.vz:p.dx);
   this.attrs.style.setXYZW(count++,alpha,spray?1.7:p.aspect,spray?1:0,foam?sea.organicLoad:0);
  });
  this.cloud.geometry.instanceCount=count;
  if(count)for(const a of Object.values(this.attrs)){
   a.clearUpdateRanges();a.addUpdateRange(0,count*a.itemSize);a.needsUpdate=true;
  }
 }
 dispose(){for(const mesh of [this.cloud,this.ribbon]){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}}
}
