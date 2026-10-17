// A conductor response for this station only. Roughness filters the reflected
// environment and broadens GGX highlights; patina is a dielectric surface film.
export const FOUNTAIN_MATERIAL_GLSL=`
uniform vec3 uFountainColor;uniform float uFountainRoughness,uFountainPatina;
float fountainVisibility(vec3 p,vec3 light){float t=.025,visibility=1.;for(int i=0;i<24;i++){vec3 q=p+light*t;if(q.y>5.9||length(q.xz)>4.8)break;float d=fountainDistance(q);if(d<.005)return 0.;visibility=min(visibility,14.*d/t);t+=max(.02,d*.85);}return clamp(visibility,0.,1.);}
vec3 fountainEnvironment(vec3 d,float roughness){
 float b[16];basisSH(d,b);vec3 filtered=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;float band=i==0?0.:i<4?1.:i<9?2.:3.;filtered+=uSH[i]*b[i]*exp(-band*(band+1.)*roughness*roughness*.5);}
 return mix(labSky(d),max(filtered,vec3(0)),roughness)*uAmbient;
}
vec3 fountainMetal(vec3 p,vec3 n){
 vec3 v=normalize(uEye-p),rd=reflect(-v,n);float pattern=.5+.25*sin(p.y*15.+sin((length(p.xz)>1e-7?atan(p.z,p.x):0.)*12.))+.25*sin(p.x*9.+p.z*7.),patina=uFountainPatina*smoothstep(.15,.85,pattern),roughness=mix(uFountainRoughness,.62,patina),nv=max(0.,dot(n,v));
 vec3 reflection=fountainEnvironment(rd,roughness);
 // The floor is the only analytic reflection receiver. This bounded single
 // bounce deliberately avoids recursive tracing in the metal surface pass.
 if(rd.y<-.015){float t=-p.y/rd.y;vec3 q=p+rd*t;float tile=mod(floor(q.x*1.8)+floor(q.z*1.8),2.),contrast=(1.-roughness)*exp(-t*.045);vec3 ground=vec3(.32,.37,.38)*mix(.675,mix(.35,1.,tile),contrast);reflection=mix(reflection,ground*(environment(vec3(0,1,0))+LAB_SUN*uSunlight*.78*fountainVisibility(q+vec3(0,.03,0),sun())),(1.-smoothstep(-.10,-.015,rd.y)));}
 vec3 f0=uFountainColor,F=f0+(1.-f0)*pow(1.-nv,5.);vec3 reflected=reflection*F*(1.-roughness*.20);
 vec3 direct=vec3(labSpecular(n,v,sun(),roughness,f0.r),labSpecular(n,v,sun(),roughness,f0.g),labSpecular(n,v,sun(),roughness,f0.b))*3.14159265*sunRadiance(p+n*.02)*fountainVisibility(p+n*.025,sun());
 vec3 oxidized=vec3(.055,.16,.12)*(environment(n)+sunRadiance(p+n*.02)*max(0.,dot(n,sun()))*fountainVisibility(p+n*.025,sun()));
 return mix(reflected+direct,oxidized,patina);
}
`;
