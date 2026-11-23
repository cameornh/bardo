import {polishedShell} from './polished-shell.js';
import * as T from 'three';
import {solidOptics,opticalIce} from './material-reactions.js';
import {polishedShape} from './polished-shapes.js';

export function supportedOptic(part,material){
 return material&&solidOptics(material)&&!opticalIce(material)&&!material.fiberLength&&material.surfaceMode!=='gaussian'&&polishedShape(part.stamps);
}
const vertex=`
 varying vec3 hull,worldNormal;
 void main(){worldNormal=transpose(mat3(viewMatrix))*normalMatrix*normal;hull=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
`;
const boundary=`
 varying vec3 hull,worldNormal;
 uniform int count;
 uniform vec4 centres[4];uniform vec3 radii[4];
 uniform mat4 localFromWorld,projectionMatrix;
 vec2 intervalAt(int i,vec3 p,vec3 ray){
  vec3 q=(p-centres[i].xyz)/radii[i],d=ray/radii[i];
  if(centres[i].w<.5){
   float a=dot(d,d),b=dot(q,d);vec3 perp=cross(q,d);float h=a-dot(perp,perp);
   if(h<=0.)return vec2(1e20,-1e20);
   return (-b+vec2(-1.,1.)*sqrt(h))/a;
  }
  for(int k=0;k<3;k++)if(abs(d[k])<1e-9&&abs(q[k])>=1.)return vec2(1e20,-1e20);
  vec3 safe=mix(d,vec3(1e-12),lessThan(abs(d),vec3(1e-12)));
  vec3 a=(-1.-q)/safe,b=(1.-q)/safe,lo=min(a,b),hi=max(a,b);
  return vec2(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
 }
 bool hit(vec3 origin,vec3 direction,float epsilon,out float t,out vec3 normal){
  vec3 p=(localFromWorld*vec4(origin,1.)).xyz,d=mat3(localFromWorld)*direction;
  vec2 ranges[4];
  for(int i=0;i<4;i++){if(i>=count)break;ranges[i]=intervalAt(i,p,d);}
  if(ranges[0].y<max(epsilon,ranges[0].x))return false;
  t=1e20;int owner=-1;
  for(int i=0;i<4;i++){
   if(i>=count)break;if(ranges[i].x>=ranges[i].y)continue;
   for(int k=0;k<2;k++){
    // Starting on a tessellated shell can put us microscopically outside
    // the analytic surface. Seek only exits from the glass volume.
    if((i==0&&k==0)||(i!=0&&k==1))continue;
    float root=ranges[i][k];
    if(root<epsilon||root>=t||root<ranges[0].x||root>ranges[0].y)continue;
    bool carved=false;
    for(int j=1;j<4;j++){if(j>=count)break;if(i!=j&&root>ranges[j].x&&root<ranges[j].y)carved=true;}
    if(!carved){t=root;owner=i;}
   }
  }
  if(owner<0)return false;
  vec3 q=(p+d*t-centres[owner].xyz)/radii[owner];
  if(centres[owner].w>.5){vec3 a=abs(q);q=a.x>=max(a.y,a.z)?vec3(sign(q.x),0.,0.):a.y>=a.z?vec3(0.,sign(q.y),0.):vec3(0.,0.,sign(q.z));}
  normal=normalize(transpose(mat3(localFromWorld))*(q/radii[owner]))*(owner==0?1.:-1.);return true;
 }
`;
const optics=`
 uniform vec3 tint,skyColor,floorColor;uniform vec4 finish;uniform vec2 coating;
 uniform float underwater;uniform bool hasWater;
 uniform sampler2D sceneColor,sceneDepth,bulkColor,bulkDepth;
 uniform mat4 inverseProjection;
 float viewZ(vec2 uv,float depth){vec4 h=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return h.z/h.w;}
 vec3 radiance(vec3 p,vec3 ray){
  vec3 fallback=mix(floorColor*env(vec3(0.,1.,0.),1.),env(ray,0.),smoothstep(-.06,.04,ray.y));
  vec3 vp=(viewMatrix*vec4(p,1.)).xyz,dir=mat3(viewMatrix)*ray;
  float t=.018,last=0.;
  for(int i=0;i<12;i++){
   vec3 q=vp+dir*t;vec4 clip=projectionMatrix*vec4(q,1.);
   vec2 uv=clip.xy/max(.001,clip.w)*.5+.5;
   if(clip.w<=0.||any(lessThanEqual(uv,vec2(0.)))||any(greaterThanEqual(uv,vec2(1.))))break;
   float d=texture2D(sceneDepth,uv).r,w=hasWater?texture2D(bulkDepth,uv).r:1.;
   float delta=viewZ(uv,min(d,w))-q.z;
   if(min(d,w)<1.&&delta>=-.001&&delta<.035+t-last)return w<d?texture2D(bulkColor,uv).rgb:texture2D(sceneColor,uv).rgb;
   last=t;t=t*1.77+.042;
  }
  return fallback;
 }
 void main(){
  vec3 p=hull,ray=normalize(p-cameraPosition),n=normalize(worldNormal);
  bool inside=dot(ray,n)>0.;if(inside)n=-n;
  vec3 reflected=reflect(ray,n),result=radiance(p,reflected);
  float ior=finish.y/(underwater>.5?1.333:1.);
  float F0=pow(abs(1.-ior)/(1.+ior),2.),F=F0+(1.-F0)*pow(1.+clamp(dot(ray,n),-1.,0.),5.);
  if(finish.x>.98){result=mix(result,env(n,1.),coating.x*coating.x)*tint;F=1.;}
  else{
   vec3 bent=refract(ray,n,inside?ior:1./ior),exitP=p,exitN;float travel=0.;
   if(!inside&&hit(p,bent,.00001,travel,exitN)){
    exitP=p+bent*travel;bent=refract(bent,-exitN,ior);
   }
   if(dot(bent,bent)>.5){
    vec3 attenuation=exp(-travel*(finish.z*(1.-.85*tint)+vec3(finish.w+coating.y)));
    vec3 transmitted=mix(radiance(exitP,bent),env(bent,1.),coating.x*coating.x);
    result=mix(transmitted*attenuation+(1.-attenuation)*tint*.16,result,F);
   }
  }
  vec3 spec;studioIrradiance(p,n,-ray,coating.x,spec);
  result+=F*(spec+sunColor*pow(max(0.,dot(reflected,normalize(sunDirection))),mix(420.,6.,coating.x*coating.x))*sampleSunShadow(p,n));
  if(underwater>.5)result=mix(result,skyColor*vec3(.15,.52,.66),1.-exp(-.085*length(p-cameraPosition)));
  gl_FragColor=vec4(result,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
function uniforms(){return {count:{value:0},centres:{value:Array.from({length:4},()=>new T.Vector4())},
 radii:{value:Array.from({length:4},()=>new T.Vector3())},localFromWorld:{value:new T.Matrix4()}};}
export class PolishedView{
 constructor(view,lighting){
  this.view=view;this.geometries=new Map();
  const u=view.oceanView.uniforms;
  this.material=new T.ShaderMaterial({side:T.FrontSide,vertexShader:vertex,fragmentShader:lighting+boundary+optics,
   uniforms:{...view.uniforms,...uniforms(),sceneColor:u.sceneColor,sceneDepth:u.sceneDepth,bulkColor:u.bulkColor,bulkDepth:u.bulkDepth,
    inverseProjection:u.inverseProjection,skyColor:u.skyColor,underwater:u.submerged,hasWater:{value:false},
    tint:{value:new T.Color()},finish:{value:new T.Vector4()},coating:{value:new T.Vector2()},floorColor:{value:new T.Color()}}});
 }
 begin(){this.used=new Set();}
 end(){for(const [key,g] of this.geometries)if(!this.used.has(key)){g.dispose();this.geometries.delete(key);}}
 mesh(shape,material){
  const key=shape.primitives.map(s=>[Number(s.box),...s.center.toArray(),...s.size.toArray()].join(',')).join('/');
  this.used.add(key);
  const shadowKey=key+'#shadow';this.used.add(shadowKey);
  if(!this.geometries.has(key))this.geometries.set(key,polishedShell(shape));
  if(!this.geometries.has(shadowKey))this.geometries.set(shadowKey,polishedShell(shape,true));
  const mesh=new T.Mesh(this.geometries.get(key),this.material);mesh.layers.set(1);
  const shadow=new T.Mesh(this.geometries.get(shadowKey),this.material);shadow.layers.set(2);mesh.add(shadow);
  mesh.userData.polished={shape,material};
  mesh.onBeforeRender=(_r,_s,_c,_g,mat)=>{
   if(mat!==this.material)return;
   const u=mat.uniforms;u.count.value=shape.primitives.length;u.localFromWorld.value.copy(mesh.parent.matrixWorld).invert();
   for(const [i,s] of shape.primitives.entries()){u.centres.value[i].set(s.center.x,s.center.y,s.center.z,Number(s.box));u.radii.value[i].copy(s.size);}
   u.tint.value.set(material.color);u.finish.value.set(material.metallic,material.ior,material.absorption,material.scattering);
   u.coating.value.set(material.roughness,-Math.log(Math.max(.001,1-material.opacity)));
   u.floorColor.value.set(this.view.groundSurface.color);u.hasWater.value=!!this.view.sea;
   mat.uniformsNeedUpdate=true;
  };
  return mesh;
 }
 dispose(){this.material.dispose();for(const g of this.geometries.values())g.dispose();}
}
