// A single velocity field drives the water, loose material, vegetation and bodies.
// Gusts are advected value noise, not a displacement applied to the water surface.
const fract=x=>x-Math.floor(x),mix=(a,b,t)=>a+(b-a)*t;
function hash(x,z){x=((x%64)+64)%64;z=((z%64)+64)%64;let n=(Math.imul(x,374761393)+Math.imul(z,668265263))>>>0;n=Math.imul(n^(n>>>13),1274126177)>>>0;return ((n^(n>>>16))&65535)/65535;}
export function windNoise(x,z){const i=Math.floor(x),j=Math.floor(z),a=fract(x),b=fract(z),u=a*a*(3-2*a),v=b*b*(3-2*b);return mix(mix(hash(i,j),hash(i+1,j),u),mix(hash(i,j+1),hash(i+1,j+1),u),v);}
export function windAt(x,z,t,speed,angle,turbulence=1){if(speed===0)return [0,0];const dx=Math.sin(angle),dz=Math.cos(angle),q=[x*.125-dx*t*speed*.085,z*.125-dz*t*speed*.085],gust=1+.7*turbulence*(windNoise(...q)-.5),cross=(windNoise(q[0]*2+11,q[1]*2+7)-.5)*.2*turbulence;return [(dx*gust+dz*cross)*speed,(dz*gust-dx*cross)*speed];}
export function windJet(point,jet){if(!jet||jet.strength<=0)return [0,0,0];const d=point.map((x,i)=>x-jet.origin[i]),along=d.reduce((s,x,i)=>s+x*jet.direction[i],0);if(along<0||along>jet.length)return [0,0,0];const radial=d.reduce((s,x,i)=>s+(x-along*jet.direction[i])**2,0),width=jet.radius+along*.035,weight=Math.exp(-radial/(width*width))*Math.exp(-along/Math.max(jet.length,1));return jet.direction.map(x=>x*jet.strength*weight);}
export function airVelocity(point,time,speed,angle,jet,turbulence=1){const w=windAt(point[0],point[2],time,speed,angle,turbulence),j=windJet(point,jet);return [w[0]+j[0],j[1],w[1]+j[2]];}
export function windPressure(x,z,t,speed,angle,turbulence=1){if(speed===0||turbulence===0)return 0;const dx=Math.sin(angle),dz=Math.cos(angle),q=[x*.125-dx*t*speed*.085,z*.125-dz*t*speed*.085];return .006*speed*speed*turbulence*(windNoise(...q)-.5);}
export const BEACH_WIND_GLSL=`
float windHash(vec2 p){p=mod(p,64.);uint n=uint(p.x)*374761393u+uint(p.y)*668265263u;n=(n^(n>>13u))*1274126177u;return float((n^(n>>16u))&65535u)/65535.;}
float windNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(windHash(i),windHash(i+vec2(1,0)),f.x),mix(windHash(i+vec2(0,1)),windHash(i+vec2(1)),f.x),f.y);}
vec2 beachWind(vec2 p,float t,float speed,float angle,float turbulence){vec2 d=vec2(sin(angle),cos(angle)),q=p*.125-d*t*speed*.085;float gust=1.+.7*turbulence*(windNoise(q)-.5),cross=(windNoise(q*2.+vec2(11,7))-.5)*.2*turbulence;return (d*gust+vec2(d.y,-d.x)*cross)*speed;}
vec3 windJet(vec3 p,vec4 originRadius,vec4 directionStrength,float extent){vec3 q=p-originRadius.xyz;float along=dot(q,directionStrength.xyz);if(along<0.||along>extent||directionStrength.w<=0.)return vec3(0);float width=originRadius.w+along*.035;return directionStrength.xyz*directionStrength.w*exp(-dot(q-along*directionStrength.xyz,q-along*directionStrength.xyz)/(width*width))*exp(-along/max(extent,1.));}
float windPressure(vec2 p,float t,float speed,float angle,float turbulence){vec2 q=p*.125-vec2(sin(angle),cos(angle))*t*speed*.085;return .006*speed*speed*turbulence*(windNoise(q)-.5);}
`;
