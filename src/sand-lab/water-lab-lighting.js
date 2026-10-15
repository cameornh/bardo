// Linear radiance shared by every lab material. SH contains only the sky dome;
// the sun is a separate directional source. Diffuse SH is cosine-convolved.
export const LAB_SUN=[1.9,1.75,1.45];
export function labSky(d){const t=Math.max(0,Math.min(1,(d[1]+.05)/.85)),s=t*t*(3-2*t);return [.66,.77,.81].map((v,k)=>v+([.12,.3,.55][k]-v)*s);}
export function diffuseSHBand(i){return i===0?1:i<4?2/3:i<9?1/4:0;}
export function phaseHG(cosine,g=.55){return (1-g*g)/(4*Math.PI*(1+g*g-2*g*cosine)**1.5);}
export const LAB_LIGHTING_GLSL=`
uniform vec3 uDaySun,uDayTint,uSolarDirection;uniform float uDaySky;
#define LAB_SUN (vec3(1.9,1.75,1.45)*uDayTint)
vec3 labSunDirection(){return uDaySun;}
vec3 labSky(vec3 d){return mix(vec3(.66,.77,.81),vec3(.12,.3,.55),smoothstep(-.05,.8,d.y));}
float diffuseSHBand(int i){return i==0?1.:i<4?2./3.:i<9?.25:0.;}
float phaseHG(float cosine,float g){return (1.-g*g)/(12.56637061*pow(max(.001,1.+g*g-2.*g*cosine),1.5));}
// GGX returns BRDF * cosine. No constant direct fill on back-facing surfaces.
float labSpecular(vec3 n,vec3 v,vec3 l,float roughness,float f0){
 float nv=max(0.,dot(n,v)),nl=max(0.,dot(n,l));if(nv<=0.||nl<=0.||length(v+l)<1e-6)return 0.;
 vec3 h=normalize(v+l);float nh=max(0.,dot(n,h)),vh=max(0.,dot(v,h)),a=max(.045,roughness*roughness),a2=a*a;
 float D=a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.)),k=pow(roughness+1.,2.)/8.;
 float G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k),F=f0+(1.-f0)*pow(1.-vh,5.);
 return D*G*F/(4.*max(.01,nv));
}
float poolFalloff(vec3 p,vec3 lamp){vec3 delta=p-lamp;return smoothstep(0.,.12,delta.z)/(1.+dot(delta,delta)*.7);}
`;
