// A conductor response for this station only. Roughness filters the reflected
// environment and broadens GGX highlights; patina is a dielectric surface film.
export const FOUNTAIN_MATERIAL_GLSL=`
uniform vec3 uFountainColor;uniform float uFountainRoughness,uFountainPatina;

vec3 fountainEnvironment(vec3 d,float roughness){
 float b[16];basisSH(d,b);vec3 filtered=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;float band=i==0?0.:i<4?1.:i<9?2.:3.;filtered+=uSH[i]*b[i]*exp(-band*(band+1.)*roughness*roughness*.5);}
 return mix(labSky(d),max(filtered,vec3(0)),roughness)*uAmbient;
}
// One non-recursive ambient water reflection. Direct sunlight at this bounce
// is supplied by photons, so it is not counted again in the environment term.
vec3 fountainWaterReflection(vec3 origin,vec3 rd,vec3 behind,float roughness){
 if(rd.y>-.015)return behind;float t=.04;
 for(int i=0;i<64;i++){vec3 q=origin+rd*t;if(q.y<0.||t>8.)break;if(rho(q)>=PARCEL_ISO){vec3 n=fluidNormal(q);if(dot(n,-rd)<0.)n=-n;float F=waterFresnel(dot(n,-rd));vec3 skyLight=fountainEnvironment(reflect(rd,n),roughness);return mix(behind,skyLight,F);}t+=.125;}
 return behind;
}
vec3 fountainMetalFrom(vec3 p,vec3 n,vec3 v){
 vec3 rd=reflect(-v,n);float pattern=.5+.25*sin(p.y*15.+sin((length(p.xz)>1e-7?atan(p.z,p.x):0.)*12.))+.25*sin(p.x*9.+p.z*7.),patina=uFountainPatina*smoothstep(.15,.85,pattern),roughness=mix(uFountainRoughness,.62,patina),nv=max(0.,dot(n,v));
 vec3 reflection=fountainEnvironment(rd,roughness);
 // The floor and water provide bounded single-bounce environment reflections;
 // no recursive metal-to-metal queries enter the surface pass.
 if(rd.y<-.015){float t=-p.y/rd.y;vec3 q=p+rd*t;float tile=mod(floor(q.x*1.8)+floor(q.z*1.8),2.),contrast=(1.-roughness)*exp(-t*.045);vec3 ground=vec3(.32,.37,.38)*mix(.675,mix(.35,1.,tile),contrast);reflection=mix(reflection,ground*(environment(vec3(0,1,0))*fountainGroundSky(q)+LAB_SUN*uSunlight*.78*fountainVisibility(q+vec3(0,.03,0),sun())),(1.-smoothstep(-.10,-.015,rd.y)));}
 reflection=fountainWaterReflection(p+n*.025,rd,reflection,roughness);
 vec3 f0=uFountainColor,F=f0+(1.-f0)*pow(1.-nv,5.);vec3 reflected=reflection*F*(1.-roughness*.20);
 vec3 direct=vec3(labSpecular(n,v,sun(),roughness,f0.r),labSpecular(n,v,sun(),roughness,f0.g),labSpecular(n,v,sun(),roughness,f0.b))*3.14159265*sunRadiance(p+n*.02);
 vec3 oxidized=vec3(.055,.16,.12)*(environment(n)+sunRadiance(p+n*.02)*max(0.,dot(n,sun())));
 return mix(reflected+direct,oxidized,patina)+fountainBounceLight(p,n,v,roughness,mix(f0,vec3(.04),patina),patina)*mix(vec3(1),vec3(.055,.16,.12),patina);
}
`;
