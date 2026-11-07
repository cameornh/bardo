// Live renderer only. Keep each geometric ray query in a separate program
// from receiver lighting. GLSL functions are inlined by many browser drivers;
// calling a shaded scene query from water/volume lighting multiplied the SDF
// and shadow loops, even after separating the primary hit from its shading.
export function replaceShaderFunction(source,name,replacement){
 const pattern=new RegExp('\\b(?:void|bool|int|float|vec[234])\\s+'+name+'\\s*\\([^;{}]*\\)\\s*\\{','g');
 const match=pattern.exec(source);if(!match)throw Error('Missing shader function: '+name);
 let end=pattern.lastIndex,depth=1;
 for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
 if(depth||pattern.exec(source.slice(end)))throw Error('Ambiguous shader function: '+name);
 return source.slice(0,match.index)+replacement+source.slice(end);
}

// Scattering samples share the existing world-space illumination field.
// Surface receivers still evaluate their geometric shadows. A volume sample
// must not launch another terrain/body shadow march for every lamp, at every
// integration point, for both reflection and refraction.
export function cachedVolumeLighting(source){
 return replaceShaderFunction(source,'soluteVolume',`vec3 soluteVolume(vec3 bottom,vec3 p,vec3 direction,float path,vec3 c,vec3 ray){
  vec3 extinction=soluteExtinction(c,uTannins,uTurbidity),scatter=soluteScatter(c,uTannins,uTurbidity);
  vec3 color=bottom*exp(-extinction*path);
  float opticalLimit=min(path,8./max(.001,min(extinction.r,min(extinction.g,extinction.b)))),stepSize=opticalLimit/5.;
  for(int i=0;i<5;i++){
   float start=float(i)*stepSize,d=start+stepSize*.5;vec3 q=p+direction*(d/uScale);
   vec3 weight=exp(-extinction*start)*(1.-exp(-extinction*stepSize))*scatter/extinction;
   vec3 incident=environment(vec3(0,1,0))*mediumSky(q);
   incident+=LAB_SUN*uSunlight*mediumSun(q)*spraySun(q)*3.14159265*phaseHG(dot(ray,sun()),.55);
   if(uStation==2)for(int lamp=0;lamp<3;lamp++)incident+=poolColor(lamp)*3.*uLights*poolFalloff(q,poolLamp(lamp))*mediumPool(q,lamp)*3.14159265*phaseHG(dot(ray,normalize(poolLamp(lamp)-q)),.55);
   for(int lamp=0;lamp<uBodyCount;lamp++){
    if(texelFetch(uBodies,ivec2((lamp*2+1)%256,(lamp*2+1)/256),0).w<2.5)continue;
    vec4 b=labBody(lamp);vec3 delta=b.xyz-q;float distance=max(.00001,length(delta)),r=max(.00001,b.w),g=.55*(1.-clamp(r/max(r,distance),0.,1.));
    // One analytic Beer path through the current medium, rather than eight
    // atlas samples followed by terrain and per-body shadow marches.
    vec3 lampLight=bodyExtra(lamp,0).rgb*uLights*LIGHT_BALL_RADIANCE*r*r/(r*r+distance*distance)*exp(-extinction*max(0.,distance-r)*uScale);
    incident+=lampLight*3.14159265*phaseHG(dot(ray,delta/distance),g);
   }
   color+=weight*incident;
  }return color;
 }`);
}

export const OPTIC_UNIFORMS=`
uniform highp sampler2D uSurfaceHit,uSurfaceMedium,uOpticOpaque,uOpticGlass,uReflectedColor,uTransmittedColor;
uniform bool uOpticReflection;
`;

export function opticRayGLSL(kind){
 const header=`bool liveOpticRay(out vec3 origin,out vec3 direction){
  ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 h=texelFetch(uSurfaceHit,pixel,0);vec3 ray=rayAt(vUv);`;
 if(kind==='opaque')return header+`
  if(h.w<=0.||h.w>=9999.)return false;
  vec3 p=uEye+ray*h.w;bool mirror=false;
  for(int i=0;i<uBodyCount;i++){float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(kind>.5&&kind<1.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02)){mirror=true;break;}}
  if(!mirror)return false;origin=p+h.xyz*.025;direction=reflect(ray,h.xyz);return true;
 }`;
 if(kind==='water')return header+`
  vec4 m=texelFetch(uSurfaceMedium,pixel,0);if(m.w<=0.||m.w>=9999.)return false;
  if(uOpticReflection&&!uWaterSceneReflections)return false;
  vec3 p=uEye+ray*m.w;
  origin=uOpticReflection?p+h.xyz*clamp(uSpacing*.01,.00004,.003):p;
  direction=uOpticReflection?reflect(ray,h.xyz):refract(ray,h.xyz,1./WATER_IOR);return true;
 }`;
 if(kind==='submerged')return header+`
  vec4 m=texelFetch(uSurfaceMedium,pixel,0);if(m.w<=0.)return false;
  vec3 p=uEye+ray*h.w,outRay;float F=waterExitFresnel(ray,h.xyz,outRay);
  if(!uOpticReflection&&F>=1.)return false;
  direction=uOpticReflection?reflect(ray,h.xyz):outRay;origin=p+direction*.012;return true;
 }`;
 throw Error('Unsupported optical surface: '+kind);
}

export function opticTraceMain(kind){
 return `layout(location=0)out vec4 opaqueHit;layout(location=1)out vec4 glassHit;
 void main(){
  vec3 origin,direction;opaqueHit=vec4(0,0,0,1e4);glassHit=vec4(0,1,0,1e4);
  if(!liveOpticRay(origin,direction))return;
  float t=traceOpaque(origin,direction);opaqueHit=vec4(t<9999.?opaqueNormal(origin+direction*t):vec3(0),t);
  ${kind==='opaque'?'':`vec3 n;float g=traceGlass(${kind==='water'?'origin+(!uOpticReflection?direction*.012:vec3(0))':'origin'},direction,t,n);glassHit=vec4(n,g);`}
 }`;
}

export function opticShadeMain(kind){
 return `out vec4 outColor;void main(){
  vec3 origin,direction;if(!liveOpticRay(origin,direction)){outColor=vec4(0);return;}
  ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 h=texelFetch(uOpticOpaque,pixel,0),g=texelFetch(uOpticGlass,pixel,0);
  vec3 color=h.w<9999.?reflectedSurfaceColor(origin+direction*h.w,h.xyz,-direction):sky(direction);
  ${kind==='water'?`
  if(!uOpticReflection){
   vec4 primary=texelFetch(uSurfaceHit,pixel,0),m=texelFetch(uSurfaceMedium,pixel,0);vec3 ray=rayAt(vUv);
   float path=min(primary.w,h.w)*uScale;
   if(g.w<h.w){float front=min(path,g.w*uScale);vec3 p=origin+direction*g.w;
    color=soluteVolume(color,p,direction,max(0.,path-front),m.xyz,ray);color=shadeGlass(p,g.xyz,direction,color);path=front;
   }
   color=soluteVolume(color,origin,direction,path,m.xyz,ray);
  }else if(g.w<h.w)color=shadeGlass(origin+direction*g.w,g.xyz,direction,color);`:
  kind==='submerged'?`if(g.w<h.w)color=shadeGlass(origin+direction*g.w,g.xyz,direction,color);`:''}
  outColor=vec4(color,h.w);
 }`;
}

export const OPAQUE_COMPOSE=`vec3 floorColor(vec3 p,vec3 n){
 if(uSandWetnessView&&uStation==6){bool body=false;for(int i=0;i<uBodyCount;i++)body=body||abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02);if(!body)return sandWetnessColor(sandWetness(p));}
 for(int i=0;i<uBodyCount;i++){
  float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;
  if(kind>.5&&kind<1.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02)){
   vec4 reflected=texelFetch(uReflectedColor,ivec2(gl_FragCoord.xy),0);vec3 color=reflected.rgb,rd=reflect(normalize(p-uEye),n);
   if(uStation==2)for(int lamp=0;lamp<3;lamp++){
    vec3 delta=vec3(float(lamp-1)*2.7,.65,-2.87)-p;float t=dot(delta,rd),miss=length(delta-rd*t),width=max(.008,fwidth(miss));
    float coverage=(t>0.&&p.z>-2.75&&t<reflected.a+.2)?1.-smoothstep(.15-width,.15+width,miss):0.;
    color=mix(color,poolColor(lamp)*uLights*poolTransmission(p,lamp,uScale),coverage);
   }
   if(reflected.a>9999.)color+=LAB_SUN*uSunlight*600.*smoothstep(.99994,.99998,dot(rd,sun()))*sunTransmission(p+n*.025,uScale);
   return color*bodyExtra(i,0).rgb;
  }
 }return surfaceColor(p,n);
}`;

export const WATER_COMPOSE=`vec3 shadeWater(vec3 p,vec3 n,vec3 ray,float path,vec3 concentration){
 ivec2 pixel=ivec2(gl_FragCoord.xy);vec3 reflected=uWaterSceneReflections?texelFetch(uReflectedColor,pixel,0).rgb:sky(reflect(ray,n));
 vec3 color=mix(texelFetch(uTransmittedColor,pixel,0).rgb,reflected,waterFresnel(dot(n,-ray)));
 color+=dielectricHighlights(p,n,-ray,uWaterRoughness,.02037);
 if(uView==1)color=n*.5+.5;if(uView==2)color=concentration;return color;
}`;

export const SUBMERGED_TRACE=`void main(){
 if(rho(uEye)<=.18)discard;vec3 ray=rayAt(vUv);vec4 background=texture(uImage,vUv);
 float path=0.,lastPath=0.,end=min(background.a,75.);vec4 chemicals=vec4(0);bool exited=false;
 for(int i=0;i<384;i++){lastPath=path;float stepSize=uSpacing*.35*waterDetailScale(path),t=min(end,path+stepSize);vec4 a=parcelSample(uEye+ray*((path+t)*.5));chemicals+=vec4(a.yzw/max(a.x,.0001),1.)*(t-path);path=t;if(path>=end)break;if(rho(uEye+ray*path)<.14){exited=true;break;}}
 vec3 n=vec3(0);if(exited){float lo=lastPath,hi=path;for(int i=0;i<9;i++){float mid=(lo+hi)*.5;if(rho(uEye+ray*mid)>.14)lo=mid;else hi=mid;}path=(lo+hi)*.5;n=fluidNormal(uEye+ray*path);}
 hit=vec4(n,path);medium=vec4(chemicals.xyz/max(.00001,chemicals.w),exited?path:-max(end,.00001));
}`;

export const SUBMERGED_COMPOSE=`void main(){
 ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 m=texelFetch(uSurfaceMedium,pixel,0);if(m.w==0.)discard;
 vec4 h=texelFetch(uSurfaceHit,pixel,0);vec3 ray=rayAt(vUv),color=texture(uImage,vUv).rgb;
 if(m.w>0.){vec3 outRay;float F=waterExitFresnel(ray,h.xyz,outRay);color=texelFetch(uReflectedColor,pixel,0).rgb;if(F<1.)color=mix(texelFetch(uTransmittedColor,pixel,0).rgb,color,F);}
 color=soluteVolume(color,uEye,ray,h.w*uScale,m.xyz,ray);outColor=vec4(color,abs(m.w));
}`;
