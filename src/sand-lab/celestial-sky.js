import * as THREE from 'three';
import catalogue from './bright-stars.json' with {type:'json'};
import {starIrradiance,starColor,FULL_MOON_RATIO,NIGHT_MODEL_GLSL} from './night-sky-model.js';
// Unresolved point sources convolved with a small angular Gaussian PSF. The
// tangent covariance is projected through the lat/long Jacobian, including
// the cos(declination) term. Normalize by texel solid angle to conserve flux.
// No random stars, per-frame spawning, or camera-dependent celestial positions.
export function starAtlas(stars=catalogue,width=2048,height=1024){
 const data=new Float32Array(width*height*4),sigma=.00045,scale=1e8;
 for(const [ra,dec,mag,bv] of stars){
  const lat=dec*Math.PI/180,cos=Math.max(.004,Math.cos(lat)),x=ra/360*width-.5,y=(dec/180+.5)*height-.5;
  const sx=Math.max(.2,sigma*width/(2*Math.PI*cos)),sy=Math.max(.2,sigma*height/Math.PI),color=starColor(bv),flux=starIrradiance(mag)*scale;
  const taps=[];let total=0;
  for(let j=Math.max(0,Math.floor(y-4*sy));j<=Math.min(height-1,Math.ceil(y+4*sy));j++)for(let i=Math.floor(x-4*sx);i<=Math.ceil(x+4*sx);i++){
   const weight=Math.exp(-.5*((i-x)**2/sx**2+(j-y)**2/sy**2)),solidAngle=2*Math.PI/width*Math.PI/height*Math.cos(((j+.5)/height-.5)*Math.PI);
   taps.push([((i%width+width)%width+j*width)*4,weight]);total+=weight*solidAngle;
  }
  for(const [o,w] of taps)for(let k=0;k<3;k++)data[o+k]+=flux*color[k]*w/total;
 }
 return {data,width,height,scale};
}
export function createSkyAtlas(extinction){
 const stars=starAtlas(),data=new Float32Array(2048*1152*4);data.set(stars.data);data.set(extinction,(1024*2048+256)*4);
 const texture=new THREE.DataTexture(data,2048,1152,THREE.RGBAFormat,THREE.FloatType);
 texture.wrapS=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
export const CELESTIAL_GLSL=`
${NIGHT_MODEL_GLSL}
uniform mat3 uCelestialRotation;uniform float uMoonPhase;uniform vec3 uSolarRadiance,uMoonDirection;
vec3 skyTransmittance(vec3 d){float el=asin(clamp(d.y,0.,1.))/1.570796327;return textureLod(uAtmosphere,vec2((256.5+sqrt(el)*127.)/2048.,1024.5/1152.),0.).rgb*smoothstep(-.003,.001,d.y);}
vec3 celestialSky(vec3 d){
 vec3 trans=skyTransmittance(d),e=uCelestialRotation*d;
 vec2 uv=vec2(atan(e.x,e.z)/6.283185307+.5,asin(clamp(e.y,-1.,1.))/3.14159265+.5);
 vec3 result=texture(uAtmosphere,vec2(uv.x,clamp(uv.y,.5/1024.,1.-.5/1024.)*1024./1152.)).rgb*1e-8*trans;
 vec3 moon=uMoonDirection,right=normalize(cross(vec3(0,1,0),moon)),up=cross(moon,right);
 vec2 q=vec2(dot(d,right),dot(d,up))/.00452;float r2=dot(q,q);
 if(dot(d,moon)>0.&&r2<1.){
  float z=sqrt(max(0.,1.-r2)),phi=acos(clamp(2.*uMoonPhase-1.,-1.,1.)),mu=max(0.,dot(vec3(q,z),vec3(dot(uSolarDirection,right),dot(uSolarDirection,up),-dot(uSolarDirection,moon))));
  // Lommel-Seeliger: a full moon has no artificial Lambertian dark rim.
  float surface=2.*mu/max(.0001,mu+z),earth=.19/1905.*lunarPhase(1.-uMoonPhase);
  // Modest procedural maria / albedo, not a claimed lunar survey map.
  float maria=exp(-dot((q-vec2(-.22,.12))*vec2(1.7,1.1),(q-vec2(-.22,.12))*vec2(1.7,1.1))*5.)+ .6*exp(-dot(q-vec2(.38,.4),q-vec2(.38,.4))*22.);
  float detail=sin(q.x*31.+sin(q.y*24.))*sin(q.y*37.-q.x*12.);
  float albedo=clamp(1.12-.38*maria+.045*detail,.55,1.25),edge=1.-smoothstep(.98,1.,r2);
  result+=22.*${FULL_MOON_RATIO}/(.00452*.00452*3.14159265)*vec3(1.12,1,.86)*(surface+earth)*albedo*trans*edge;
 }
 float theta=acos(clamp(dot(d,uSolarDirection),-1.,1.));
 float sunDisc=1.-smoothstep(.0044,.00475,theta);result+=uSolarRadiance*sunDisc;
 return result;
}
`;
