// Realtime RGB adaptation of Jensen et al. (SIGGRAPH 2001), sections 4–6.
// Irradiances are converted to the existing atmosphere's linear radiance units.
// Celestial motion uses the test day clock (not an ephemeris/date/location).
// The star sphere has a fixed 40° observer latitude, independent of the camera.
export const SKY_UNITS=22/1905;
export const FULL_MOON_RATIO=2*.072/3*(1737/384400)**2;
export const MOON_COLOR=[1.12,1,.86];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function lunarPhase(illuminated=1){
 const phi=Math.acos(clamp(2*illuminated-1,-1,1));
 if(phi<1e-5)return 1;if(phi>Math.PI-1e-4)return 0;
 const h=phi/2;return Math.max(0,1-Math.sin(h)*Math.tan(h)*Math.log(1/Math.tan(h/2)));
}
export function moonIrradiance(illuminated=1){return FULL_MOON_RATIO*(lunarPhase(illuminated)+.19/1905*lunarPhase(1-illuminated));}
export function moonDirection(sun,illuminated=1,elongation=null){
 const s=sun.map(v=>v/Math.hypot(...sun)),candidate=[-s[1],s[0],.08],dot=candidate.reduce((a,v,k)=>a+v*s[k],0),t=candidate.map((v,k)=>v-dot*s[k]),l=Math.hypot(...t),a=elongation??Math.acos(clamp(1-2*illuminated,-1,1));
 return s.map((v,k)=>v*Math.cos(a)-t[k]/l*Math.sin(a));
}
export function starIrradiance(magnitude){return 10**(.4*(-magnitude-19+.4))*SKY_UNITS;}
export function starColor(bv){
 // Paper eq. 8 + Planck radiance at RGB representative wavelengths.
 const t=clamp(7000/(bv+.56),2200,30000),rgb=[615,550,460].map(w=>1/(w**5*Math.expm1(1.4387769e7/(w*t))));
 const y=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;return rgb.map(c=>c/y);
}
export function celestialMatrix(day=0){
 const angle=(day/24)*2*Math.PI,cs=Math.cos(angle),sn=Math.sin(angle),lat=40*Math.PI/180,s=Math.sin(lat),c=Math.cos(lat);
 // Columns, for a THREE.Matrix3 / GLSL mat3. Equatorial y is north.
 return [cs,0,-sn,sn*c,s,cs*c,-sn*s,c,-cs*s];
}
export function celestialDirection(d,day=0){const m=celestialMatrix(day);return [m[0]*d[0]+m[3]*d[1]+m[6]*d[2],m[1]*d[0]+m[4]*d[1]+m[7]*d[2],m[2]*d[0]+m[5]*d[1]+m[8]*d[2]];}
export function nightBackground(d,sun,day=0){
 const e=celestialDirection(d,day),pole=[.198076,.455984,.867666],latitude=e.reduce((s,v,k)=>s+v*pole[k],0);
 // Smooth unresolved galactic band, not a photograph or a cloud layer.
 const band=Math.exp(-latitude*latitude/.025),elongation=Math.acos(clamp(d.reduce((s,v,k)=>s+v*sun[k],0),-1,1));
 const ecliptic=d[0]*.3+d[1]*.4+d[2]*.8660254;
 const zodiacal=Math.exp(-ecliptic*ecliptic/.018)*Math.exp(-elongation/.42);
 const airglow=1/Math.sqrt(1-(6360/6450)**2*(1-d[1]*d[1]));
 return [0,1,2].map(k=>SKY_UNITS/Math.PI*(4e-8+2e-8*band*[1.04,1,.94][k]+1.2e-7*zodiacal*[1.1,1,.85][k]+5.1e-8*airglow*[.65,1,.45][k]));
}
export const NIGHT_MODEL_GLSL=`
const float SKY_UNITS=22./1905.;
float lunarPhase(float lit){float phi=acos(clamp(2.*lit-1.,-1.,1.));if(phi<1e-5)return 1.;if(phi>3.14149265)return 0.;float h=phi*.5;return max(0.,1.-sin(h)*tan(h)*log(1./tan(h*.5)));}
float moonIrradiance(float lit){return ${FULL_MOON_RATIO}*(lunarPhase(lit)+.19/1905.*lunarPhase(1.-lit));}
vec3 nightBackground(vec3 d,vec3 sun,mat3 rotation){vec3 e=rotation*d;float latitude=dot(e,vec3(.198076,.455984,.867666)),band=exp(-latitude*latitude/.025),elongation=acos(clamp(dot(d,sun),-1.,1.)),ecliptic=dot(d,vec3(.3,.4,.8660254));float zodiacal=exp(-ecliptic*ecliptic/.018)*exp(-elongation/.42),airglow=inversesqrt(1.-pow(6360./6450.,2.)*(1.-d.y*d.y));return SKY_UNITS/3.14159265*(vec3(4e-8)+2e-8*band*vec3(1.04,1,.94)+1.2e-7*zodiacal*vec3(1.1,1,.85)+5.1e-8*airglow*vec3(.65,1,.45));}
`;
