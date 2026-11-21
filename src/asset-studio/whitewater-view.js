import * as THREE from 'three';

// Breakers retain their physical world position as the camera moves.
function drawLocal(p,camera,visit){
 if(!p.windCrest){visit(1);return;}
 const distance=Math.hypot(p.x-camera.position.x,p.z-camera.position.z);
 if(distance<64)visit(Math.min(1,(64-distance)/16));
}
export class WhitewaterView{
 constructor(scene,uniforms,wave,lighting){
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
    if(style.z<.5){p.y+=elevation(p.xz)+.018;slope=waterSlope(p.xz);}
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
  let count=0;
  for(const p of sea.whitewater.particles)drawLocal(p,camera,fade=>{
   const spray=p.kind==='spray',foam=p.kind==='foam',t=p.age/p.life;
   const size=p.size*(spray?1:1+t*.25),alpha=fade*Math.min(1,p.age*15)*Math.min(1,(1-t)*4)*(spray?.35:foam?.59:.46);
   this.attrs.packet.setXYZW(count,p.x,spray?p.y:(p.relief??0),p.z,size);
   this.attrs.axis.setXYZ(count,spray?p.vx:-p.dz,spray?p.vy+.001:0,spray?p.vz:p.dx);
   this.attrs.style.setXYZW(count++,alpha,spray?1.7:p.aspect,spray?1:0,foam?sea.organicLoad:0);
  });
  this.cloud.geometry.instanceCount=count;
  if(count)for(const a of Object.values(this.attrs)){
   a.clearUpdateRanges();a.addUpdateRange(0,count*a.itemSize);a.needsUpdate=true;
  }
 }
 dispose(){this.cloud.removeFromParent();this.cloud.geometry.dispose();this.cloud.material.dispose();}
}
