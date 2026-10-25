import {FULL_MOON_RATIO,NIGHT_MODEL_GLSL} from './night-sky-model.js';
import {NIGHT_LOOK} from './night-look.js';
export const CELESTIAL_GLSL=`
${NIGHT_MODEL_GLSL}
uniform mat3 uCelestialRotation;uniform float uMoonPhase,uMoonSize,uMoonElongation;uniform vec3 uSolarRadiance,uMoonDirection;uniform bool uDimMoon;
vec3 skyTransmittance(vec3 d){float el=asin(clamp(d.y,0.,1.))/1.570796327;return textureLod(uAtmosphere,vec2((.5+sqrt(el)*127.)/256.,112.5/128.),0.).rgb*smoothstep(-.003,.001,d.y);}
vec3 celestialSky(vec3 d){
 vec3 trans=skyTransmittance(d),result=vec3(0);
 vec3 moon=uMoonDirection,right=normalize(cross(abs(moon.y)<.99?vec3(0,1,0):vec3(1,0,0),moon)),up=cross(moon,right);
 float radius=.00452*uMoonSize;vec2 q=vec2(dot(d,right),dot(d,up))/radius;float r2=dot(q,q);
 if(dot(d,moon)>0.&&r2<1.){
  float z=sqrt(max(0.,1.-r2)),mu=max(0.,dot(vec3(q,z),vec3(sin(uMoonElongation),0.,2.*uMoonPhase-1.)));
  // Lommel-Seeliger: a full moon has no artificial Lambertian dark rim.
  float surface=2.*mu/max(.0001,mu+z),earth=.19/1905.*lunarPhase(1.-uMoonPhase);
  // Modest procedural maria / albedo, not a claimed lunar survey map.
  float maria=exp(-dot((q-vec2(-.22,.12))*vec2(1.7,1.1),(q-vec2(-.22,.12))*vec2(1.7,1.1))*5.)+ .6*exp(-dot(q-vec2(.38,.4),q-vec2(.38,.4))*22.);
  float detail=sin(q.x*31.+sin(q.y*24.))*sin(q.y*37.-q.x*12.);
  float albedo=clamp(1.12-.38*maria+.045*detail,.55,1.25),edge=1.-smoothstep(.98,1.,r2);
  result+=(uDimMoon?${NIGHT_LOOK.moonDiscGain}:1.)*22.*${FULL_MOON_RATIO}/(radius*radius*3.14159265)*vec3(1.12,1,.86)*(surface+earth)*albedo*trans*edge;
 }
 float theta=acos(clamp(dot(d,uSolarDirection),-1.,1.));
 float sunDisc=1.-smoothstep(.0044,.00475,theta);result+=uSolarRadiance*sunDisc;
 return result;
}
`;
