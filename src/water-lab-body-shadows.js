// Analytic sphere visibility, shared by sunlight and the three pool lamps.
// Glass uses straight-through hollow-shell Fresnel/absorption: this does not
// focus refractive caustics or trace the interior reflected rays.
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function bodyLightTransmission(p,d,maxDistance,balls,{scale=1,sourceRadius=.06,angularRadius=0}={}){
 const result=[1,1,1];
 for(const b of balls){const q=b.position.map((v,k)=>v-p[k]),t=dot(q,d),r=b.radius;
  if(Math.hypot(...q)<=r+.008||t<=.008)continue;
  const nearest=Math.min(t,maxDistance),miss=Math.hypot(...q.map((v,k)=>v-d[k]*nearest)),soft=.004+angularRadius*nearest+sourceRadius*nearest/maxDistance,coverage=1-smooth(r-soft,r+soft,miss);if(coverage<=0)continue;
  let transmission=[0,0,0];if(b.kind==='glass'){const cosine=Math.sqrt(Math.max(0,1-Math.min(1,miss*miss/(r*r)))),f=.04+.96*(1-cosine)**5,path=.24*r*scale/Math.max(.15,cosine);transmission=[.07,.028,.02].map(a=>(1-f)**4*Math.exp(-a*path));}
  for(let k=0;k<3;k++)result[k]*=1-coverage*(1-transmission[k]);
 }
 return result;
}
export const BODY_SHADOW_GLSL=`
uniform bool uBodyShadows;
vec3 bodyTransmission(vec3 p,vec3 direction,float limit,float scale,float sourceRadius,float angularRadius){
 vec3 visibility=vec3(1);if(!uBodyShadows)return visibility;
 for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i);vec3 q=b.xyz-p;float t=dot(q,direction),radius=b.w;
  if(length(q)<=radius+.008||t<=.008)continue;
  float nearest=min(t,limit),miss=length(q-direction*nearest),soft=.004+angularRadius*nearest+sourceRadius*nearest/limit,coverage=1.-smoothstep(radius-soft,radius+soft,miss);if(coverage<=0.)continue;
  vec3 transmission=vec3(0);float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;
  if(kind<.5){float cosine=sqrt(max(0.,1.-min(1.,miss*miss/(radius*radius)))),f=.04+.96*pow(1.-cosine,5.),path=.24*radius*scale/max(.15,cosine);transmission=vec3(pow(1.-f,4.))*exp(-vec3(.07,.028,.02)*path);}
  visibility*=mix(vec3(1),transmission,coverage);if(max(visibility.r,max(visibility.g,visibility.b))<.001)break;
 }
 return visibility;
}
vec3 bodySun(vec3 p,float scale){return bodyTransmission(p,normalize(vec3(-.4,1,.3)),10000.,scale,0.,.0047);}
`;
