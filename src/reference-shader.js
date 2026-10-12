import { FIELD_GLSL } from './world.js';
export const REFERENCE_FRAGMENT = `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPositionTexture,uNormalTexture,uColorTexture,uMaterialTexture;
uniform mat4 uInverseProjection,uCameraMatrix;
uniform vec3 uEye,uLight;
uniform vec3 uColors[7];
uniform vec4 uMaterials[7];
uniform int uView;
uniform bool uReflections;
uniform bool uShowChunks;
uniform float uTime;
${FIELD_GLSL}
const float PI=3.14159265359;
vec3 sky(vec3 d){
 vec3 horizon=vec3(.76,.78,.73),zenith=vec3(.37,.49,.55);
 vec3 color=mix(horizon,zenith,smoothstep(-.05,.8,d.y));
 color=mix(vec3(.27,.25,.19),color,smoothstep(-.4,.05,d.y));
 float sun=pow(max(dot(d,normalize(uLight)),0.),180.);
 color+=vec3(2.7,1.9,1.05)*sun;
 // Broad studio-sky panels make view-dependent reflection easy to read.
 float panel=pow(max(dot(d,normalize(vec3(-.4,.5,1.))),0.),38.);
 color+=vec3(.85,.79,.64)*panel;
 return color;
}
vec3 groundColor(vec3 p){
 if(uTerrainMode){
  float elevation=smoothstep(-2.,3.5,p.y);
  vec3 color=mix(vec3(.27,.32,.16),vec3(.47,.38,.23),elevation);
  if(p.y<-1.2)color=mix(color,vec3(.39,.25,.14),.4);
  if(uShowChunks){vec2 edge=abs(mod(p.xz+8.,16.)-8.);float line=1.-smoothstep(.035,.10,min(edge.x,edge.y));color=mix(color,vec3(.9,.4,.10),line);}
  return color;
 }
 // Integrate the checker over its pixel footprint instead of aliasing an
 // arbitrarily fine world-space pattern near the horizon.
 vec2 uv=p.xz*.65,w=max(fwidth(uv),vec2(.0001));
 vec2 average=2.*(abs(fract((uv-w*.5)*.5)-.5)-abs(fract((uv+w*.5)*.5)-.5))/w;
 float checker=.5-.5*average.x*average.y;
 vec3 color=mix(vec3(.20,.22,.19),vec3(.74,.73,.64),checker);
 return color;
}
float shadow(vec3 p,vec3 light){
 float t=.07,res=1.;
 for(int i=0;i<24;i++){
  float h=mapScene(p+light*t,-1).x;
  if(h<.001)return .12;
  res=min(res,9.*h/t);t+=clamp(h,.045,.75);if(t>9.)break;
 }
 return clamp(res,.12,1.);
}
vec3 quickShade(vec3 p,vec3 n,int id,vec3 direction){
 vec3 base=id==6?groundColor(p):uColors[id];
 float diffuse=max(dot(n,normalize(uLight)),0.);
 return base*(.32+.80*diffuse)+sky(reflect(direction,n))*.12;
}
vec3 traceEnvironment(vec3 origin,vec3 direction,int omit){
 float t=.055;
 for(int i=0;i<44;i++){
  vec3 p=origin+direction*t;vec2 h=mapScene(p,omit);
  if(h.x<.008){int id=int(h.y+.5);return quickShade(p,fieldNormal(p,id),id,direction);}
  t+=max(h.x*.8,.008);if(t>24.)break;
 }
 return sky(direction);
}
vec3 roughTransmission(vec3 origin,vec3 direction,float rough){
 if(rough<.08)return traceEnvironment(origin,direction,3);
 vec3 tangent=normalize(cross(direction,abs(direction.y)<.95?vec3(0,1,0):vec3(1,0,0)));
 vec3 bitangent=cross(direction,tangent),sum=vec3(0.);
 // Deterministic angular integration; spreading transmitted rays blurs scene
 // structure instead of turning the glass white. A finite-sample approximation.
 float spread=rough*rough*1.5;
 for(int i=0;i<12;i++){
  float phase=float(i)*2.39996323;
  float radius=sqrt((float(i)+.5)/12.)*spread;
  vec3 d=normalize(direction+radius*(cos(phase)*tangent+sin(phase)*bitangent));
  sum+=traceEnvironment(origin,d,3);
 }
 return sum/12.;
}
vec3 shade(vec3 p,vec3 n,vec3 base,float rough,float metal,float transmission,float scatter,int id){
 vec3 v=normalize(uEye-p),l=normalize(uLight),h=normalize(l+v);
 float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);
 float sh=shadow(p+n*.035,l);
 vec3 f0=mix(vec3(.04),base,metal),F=f0+(1.-f0)*pow(1.-vh,5.);
 float a=max(rough*rough,.025),a2=a*a,denom=nh*nh*(a2-1.)+1.;
 float D=a2/(PI*denom*denom),k=(rough+1.)*(rough+1.)/8.;
 float G=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
 vec3 spec=D*G*F/max(4.*nv*nl,.001);
 vec3 diffuse=(1.-F)*(1.-metal)*base/PI;
 vec3 color=(diffuse+spec)*vec3(3.5,3.1,2.6)*nl*sh;
 float occlusion=1.;
 if(id!=6){for(int j=1;j<4;j++){float d=float(j)*.15;occlusion-=max(d-mapScene(p+n*d,-1).x,0.)*.32;}}
 else {for(int j=0;j<6;j++){vec3 c=uCenters[j];float r=j==1?1.1:(j==5?.43:.85);float height=max(c.y-r,0.);occlusion-=exp(-dot(p.xz-c.xz,p.xz-c.xz)/(r*r*.8))*exp(-height*1.8)*.28;}}
 color+=base*(1.-metal)*(.24+.15*max(n.y,0.))*clamp(occlusion,.28,1.);
 vec3 reflected=reflect(-v,n),environment=sky(reflected);
 if(uReflections&&rough<.65)environment=mix(traceEnvironment(p+n*.045,reflected,id),environment,rough*rough);
 vec3 fresnel=f0+(1.-f0)*pow(1.-nv,5.);
 color+=environment*fresnel*(1.-rough*.65);
 if(scatter>.0){
  // Wrapped diffuse / thickness-inspired backlight. Not volumetric transport.
  float wrap=max((dot(n,l)+.55)/1.55,0.);
  float back=pow(max(dot(v,-l),0.),3.)*(1.-nl);
  color+=base*vec3(1.08,.93,.70)*scatter*(wrap*.25+back*.8);
 }
 if(id==4)color+=vec3(.66,.51,.30)*pow(1.-nv,2.)*.65;
 if(transmission>.01){
  // Two Snell interfaces through the analytic glass sphere, Beer-Lambert tint.
  const float ior=1.46;
  vec3 inside=refract(-v,n,1./ior);
  vec3 enter=p-n*.012;
  vec3 relative=enter-uCenters[3];
  float b=dot(relative,inside),c=dot(relative,relative)-.76*.76;
  float thickness=max(-b+sqrt(max(b*b-c,0.)),.02);
  vec3 exitPoint=enter+inside*thickness;
  vec3 exitN=normalize(exitPoint-uCenters[3]);
  vec3 outgoing=refract(inside,-exitN,ior);
  if(length(outgoing)<.001)outgoing=reflect(inside,exitN);
  vec3 through=roughTransmission(exitPoint+outgoing*.04,outgoing,rough);
  vec3 absorption=exp(-(vec3(1.)-base)*thickness*1.25);
  vec3 glass=mix(through*absorption,environment,clamp(.04+.96*pow(1.-nv,5.),0.,1.));
  color=mix(color,glass,transmission);
 }
 return color;
}
void main(){
 vec4 farP=uInverseProjection*vec4(vUv*2.-1.,1,1);
 vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 vec3 color=sky(ray);
 vec4 position=texture(uPositionTexture,vUv),normal=texture(uNormalTexture,vUv),base=texture(uColorTexture,vUv),material=texture(uMaterialTexture,vUv);
 float w=position.w;
 vec3 p,n,albedo;float rough,metal,transmission,scatter;int id=6;
 bool hit=w>.001;
 if(hit){p=position.xyz/w+uEye;n=normalize(normal.xyz);albedo=base.xyz/w;rough=base.w/w;material/=w;metal=material.x;transmission=material.y;scatter=material.z;id=int(material.w+.5);if((id==0&&uEditCount>0)||(id==6&&uTerrainEditCount>0))n=fieldNormal(p,id);}
 if(uView==3){
  hit=false;float t=.05;
  for(int i=0;i<160;i++){vec3 point=uEye+ray*t;vec2 s=mapScene(point,-1);if(s.x<.003){hit=true;p=point;id=int(s.y+.5);n=fieldNormal(p,id);break;}t+=max(s.x*.8,.002);if(t>100.)break;}
  if(hit){albedo=uColors[id];rough=uMaterials[id].x;metal=uMaterials[id].y;transmission=uMaterials[id].z;scatter=uMaterials[id].w;}
 }
 if(hit){
  if(id==6)albedo=groundColor(p);
  if(uView==1)color=n*.5+.5;
  else if(uView==2)color=albedo;
  else color=shade(p,n,albedo,rough,metal,transmission,scatter,id);
  float fog=1.-exp(-max(length(p-uEye)-(uTerrainMode?18.:10.),0.)*(uTerrainMode?.035:.018));
  color=mix(color,sky(ray),fog);
 }
 // A restrained filmic response; softness comes from spatial representation.
 color=color/(color+vec3(.70));
 color=pow(max(color,vec3(0)),vec3(1./2.2));
 float vignette=1.-.075*dot(vUv-.5,vUv-.5);
 outColor=vec4(color*vignette,1.);
}
`;

export const LIGHT_FUNCTIONS = REFERENCE_FRAGMENT.slice(REFERENCE_FRAGMENT.indexOf('const float PI'), REFERENCE_FRAGMENT.lastIndexOf('void main(){'));
