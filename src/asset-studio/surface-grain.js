import * as THREE from 'three';

// A reusable periodic height field in surface coordinates. Each seed is a signed
// ellipsoidal Gaussian with a height in the normal direction. Mips integrate
// subpixel relief. Both finite surfaces and ground sample this same distribution.
export function grainTexture(){
 const size=128,field=new Float32Array(size*size);let seed=9367;
 const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+.5)/4294967296;
 for(let i=0;i<950;i++){
  const x=random()*size,y=random()*size,angle=random()*Math.PI;
  const r=.8+random()**2*3.6,s=r*(.45+.55*random()),a=(random()-.45)*1.4;
  const c=Math.cos(angle),t=Math.sin(angle),bound=Math.ceil(3*r);
  for(let iy=Math.floor(y)-bound;iy<=y+bound;iy++)for(let ix=Math.floor(x)-bound;ix<=x+bound;ix++){
   const dx=ix-x,dy=iy-y,u=(c*dx+t*dy)/r,v=(c*dy-t*dx)/s;
   field[(ix+size)%size+size*((iy+size)%size)]+=a*Math.exp(-.5*(u*u+v*v));
  }
 }
 const data=new Uint8Array(size*size*4),get=(x,y)=>field[(x+size)%size+size*((y+size)%size)];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=4*(x+size*y),encode=v=>Math.round(255*Math.max(0,Math.min(1,.5+.26*v)));
  data[i]=encode(get(x,y));data[i+1]=encode((get(x+1,y)-get(x-1,y))*.5);
  data[i+2]=encode((get(x,y+1)-get(x,y-1))*.5);data[i+3]=255;
 }
 const tex=new THREE.DataTexture(data,size,size);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
 tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;return tex;
}
export const grainParams=m=>[m.grainDepth??1.1,m.grainLength??.08,m.grainScale??2.8];
export const surfaceRelief=/*glsl*/`
 uniform sampler2D grainMap;
 float reliefDepth(float depth,vec3 p,vec3 normal,float height,mat4 projection){
  vec3 eye=cameraPosition-p;
  float viewZ=(viewMatrix*vec4(p,1.)).z;
  float along=height/(max(.25,abs(dot(normalize(eye),normal)))*max(.03,length(eye)));
  float newZ=viewZ*(1.-clamp(along,-.08,.08));
  return clamp(depth-.5*projection[3][2]*(1./newZ-1./viewZ),0.,1.);
 }
 float grainSurface(vec3 coord,vec3 localNormal,vec3 grain,inout vec3 n,inout vec3 base,vec3 viewDir){
  if(grain.x<=0.)return 0.;
  vec3 an=abs(localNormal);vec2 st=an.y>=max(an.x,an.z)?coord.xz:(an.z>an.x?coord.xy:coord.zy);
  float pitch=max(.08,grain.z*.27),stretch=1.+17.*pow(grain.y,3.);
  vec2 uv=st/pitch;
  uv.y+=pow(grain.y,4.)*(.21*sin(1.7*uv.x+.6*sin(uv.y))+.11*sin(3.3*uv.x+.9*uv.y));
  uv.x/=stretch;
  vec3 d=texture2D(grainMap,uv).rgb-.5;
  // Geometric tangent frame from screen derivatives also follows transformed assets.
  vec3 px=dFdx(-viewDir),py=dFdy(-viewDir),tu=cross(py,n),tv=cross(n,px);
  float det=dot(px,tu);
  if(abs(det)>1e-10){
   vec3 v=normalize(viewDir);vec3 tangent=v-n*dot(v,n);
   vec2 slope=(dot(tangent,tu)*dFdx(uv)+dot(tangent,tv)*dFdy(uv))/det;
   uv+=slope*(d.r/.26*grain.x*.001/max(.25,abs(dot(v,n))));
   d=texture2D(grainMap,uv).rgb-.5;
   vec2 dh=(d.gb/.26)*(grain.x*.001*128.);
   vec3 bump=(tu*dot(dFdx(uv),dh)+tv*dot(dFdy(uv),dh))/det;
   n=normalize(n-bump/max(1.,3.*length(bump)));
  }
  base*=1.+d.r*min(.75,grain.x*.13+.22*grain.y);
  return d.r/.26*grain.x*.001;
 }`;
