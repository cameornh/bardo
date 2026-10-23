import {moonIrradiance,moonDirection,MOON_COLOR,nightBackground,NIGHT_MODEL_GLSL} from './night-sky-model.js';
// Single-scattering reference, in kilometres. Molecular extinction is RGB
// wavelength-dependent; aerosols add a small forward-scattering sun halo.
// Transport formulation: https://ebruneton.github.io/precomputed_atmospheric_scattering/
export const ATMOSPHERE={radius:6360,height:100,rayleigh:[.0058,.0135,.0331],mie:.003,rayleighHeight:8,mieHeight:1.2,solar:22,viewSteps:16,lightSteps:8};
export const MOON_DIRECTION=[.6,.6,-.4].map(v=>v/Math.sqrt(.88));
export const DEFAULT_SUN=[-.4,1,.3].map(v=>v/Math.sqrt(1.25));
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),add=(p,d,t)=>p.map((v,k)=>v+d[k]*t),normalize=d=>{const l=Math.hypot(...d);return d.map(v=>v/l);};
// Work relative to the surface to avoid subtracting two planet-sized floats.
function height(p){const q=dot(p,p)+2*ATMOSPHERE.radius*p[1];return q/(Math.sqrt(q+ATMOSPHERE.radius**2)+ATMOSPHERE.radius);}
function boundary(p,d,h){const R=ATMOSPHERE.radius,b=dot(p,d)+R*d[1],c=dot(p,p)+2*R*p[1]-h*(2*R+h),disc=b*b-c;if(disc<0)return [-1,-1];const q=-b-(b>=0?1:-1)*Math.sqrt(disc),a=q,bRoot=Math.abs(q)>1e-10?c/q:-b;return [Math.min(a,bRoot),Math.max(a,bRoot)];}
function density(p){const h=Math.max(0,height(p));return [Math.exp(-h/8),Math.exp(-h/1.2)];}
export function atmosphereTransmission(p,light){
 const earth=boundary(p,light,0);if(earth[0]>0)return [0,0,0];
 const end=boundary(p,light,100)[1],depth=[0,0];
 for(let i=0;i<ATMOSPHERE.lightSteps;i++){const a=end*(i/8)**2,b=end*((i+1)/8)**2,rho=density(add(p,light,(a+b)*.5));for(let k=0;k<2;k++)depth[k]+=rho[k]*(b-a);}
 return ATMOSPHERE.rayleigh.map(beta=>Math.exp(-beta*depth[0]-.003*depth[1]));
}
export function atmosphereScatter(ray,light){
 const origin=[0,.02,0],end=boundary(origin,ray,100)[1],mu=dot(ray,light),g=.76;
 const phaseR=3/(16*Math.PI)*(1+mu*mu),phaseM=3/(8*Math.PI)*(1-g*g)*(1+mu*mu)/((2+g*g)*(1+g*g-2*g*mu)**1.5),depth=[0,0],sum=[0,0,0];
 for(let i=0;i<ATMOSPHERE.viewSteps;i++){const a=end*(i/16)**2,b=end*((i+1)/16)**2,ds=b-a,p=add(origin,ray,(a+b)*.5),rho=density(p),sun=atmosphereTransmission(p,light);
  for(let k=0;k<3;k++){const beta=ATMOSPHERE.rayleigh[k],trans=Math.exp(-beta*(depth[0]+rho[0]*ds*.5)-.003*(depth[1]+rho[1]*ds*.5));sum[k]+=sun[k]*trans*(rho[0]*beta*phaseR+rho[1]*.003*phaseM)*ds*22;}
  for(let k=0;k<2;k++)depth[k]+=rho[k]*ds;
 }
 return sum;
}
export function atmosphereSky(direction,sun=DEFAULT_SUN,{moonPhase=1,day=0,elongation=null}={}){
 const d=normalize(direction),ground=Math.max(0,-d[1]),ray=normalize([d[0],Math.max(.001,d[1]),d[2]]),solar=atmosphereScatter(ray,sun),lunar=atmosphereScatter(ray,moonDirection(sun,moonPhase,elongation)),trans=atmosphereTransmission([0,.02,0],ray),background=nightBackground(ray,sun,day);
 const moon=moonIrradiance(moonPhase);
 return solar.map((v,k)=>(v+lunar[k]*moon*MOON_COLOR[k]+background[k]*trans[k])*(1-.85*Math.sqrt(ground)));
}
export const ATMOSPHERE_GLSL=`
${NIGHT_MODEL_GLSL}
uniform vec3 uAtmosphereMoonDirection;uniform float uAtmosphereMoon;uniform mat3 uAtmosphereRotation;
const float ATMO_R=6360.;const vec3 ATMO_BETA=vec3(.0058,.0135,.0331);
float atmoHeight(vec3 p){float q=dot(p,p)+2.*ATMO_R*p.y;return q/(sqrt(q+ATMO_R*ATMO_R)+ATMO_R);}
vec2 atmoBoundary(vec3 p,vec3 d,float h){float b=dot(p,d)+ATMO_R*d.y,c=dot(p,p)+2.*ATMO_R*p.y-h*(2.*ATMO_R+h),disc=b*b-c;if(disc<0.)return vec2(-1);float q=-b-(b>=0.?1.:-1.)*sqrt(disc),other=abs(q)>1e-10?c/q:-b;return vec2(min(q,other),max(q,other));}
vec2 atmoDensity(vec3 p){float h=max(0.,atmoHeight(p));return exp(-h/vec2(8.,1.2));}
vec3 atmosphereTransmission(vec3 p,vec3 light){if(atmoBoundary(p,light,0.).x>0.)return vec3(0);float end=atmoBoundary(p,light,100.).y;vec2 depth=vec2(0);for(int i=0;i<8;i++){float a=end*pow(float(i)/8.,2.),b=end*pow(float(i+1)/8.,2.);depth+=atmoDensity(p+light*(a+b)*.5)*(b-a);}return exp(-ATMO_BETA*depth.x-.003*depth.y);}
vec3 atmosphereScatter(vec3 ray,vec3 light){vec3 origin=vec3(0,.02,0);float end=atmoBoundary(origin,ray,100.).y,mu=dot(ray,light),g=.76,phaseR=3./(16.*3.14159265)*(1.+mu*mu),phaseM=3./(8.*3.14159265)*(1.-g*g)*(1.+mu*mu)/((2.+g*g)*pow(1.+g*g-2.*g*mu,1.5));vec2 depth=vec2(0);vec3 sum=vec3(0);for(int i=0;i<16;i++){float a=end*pow(float(i)/16.,2.),b=end*pow(float(i+1)/16.,2.),ds=b-a;vec3 p=origin+ray*(a+b)*.5;vec2 rho=atmoDensity(p),mid=depth+rho*ds*.5;sum+=atmosphereTransmission(p,light)*exp(-ATMO_BETA*mid.x-.003*mid.y)*(rho.x*ATMO_BETA*phaseR+rho.y*.003*phaseM)*ds*22.;depth+=rho*ds;}return sum;}
vec3 atmosphereSky(vec3 d,vec3 sun){d=normalize(d);float ground=max(0.,-d.y);vec3 ray=normalize(vec3(d.x,max(.001,d.y),d.z));return (atmosphereScatter(ray,sun)+atmosphereScatter(ray,uAtmosphereMoonDirection)*moonIrradiance(uAtmosphereMoon)*vec3(1.12,1,.86)+nightBackground(ray,sun,uAtmosphereRotation)*atmosphereTransmission(vec3(0,.02,0),ray))*(1.-.85*sqrt(ground));}
`;
