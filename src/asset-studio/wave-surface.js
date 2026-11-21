import {OCEAN_SIZE as N,WAVE_BANDS} from './ocean.js';

// GLSL uses the CPU band's world-to-grid rotation and the same two bracketing
// fields. Keeping the band samplers static also works on WebGL 2 / ANGLE.
const bandGLSL=code=>WAVE_BANDS.map((b,i)=>{
 const c=Math.cos(b.angle),s=Math.sin(b.angle);
 const rotation='mat2('+[c,-s,s,c].map(v=>v.toFixed(9)).join(',')+')';
 return code(i,b,rotation);
}).join('\n');
const sampling=bandGLSL((i,b,r)=>`
 uniform sampler2D height${i};
 const mat2 rot${i}=${r};
 vec2 uv${i}(vec2 p){return (rot${i}*p)/${b.metres.toFixed(3)}+vec2(${(.5/N).toFixed(8)});}
`);
const heightSum=bandGLSL((i,b)=>`
  h=textureLod(height${i},uv${i}(p),max(0.,log2(max(1.,spacing*${(N/b.metres).toFixed(8)}))));
  y+=mix(dot(h.rg,unpack16),dot(h.ba,unpack16),bandMix[${i}])*12.-6.;`);
export const waveHeight=sampling+`
 uniform vec3 bandMix;
 uniform vec4 rings[12];uniform int ringCount;
 const vec2 unpack16=vec2(65280.,255.)/65535.;
 float surfaceHeight(vec2 p,float spacing){
  vec4 h;float y=0.;
  ${heightSum}
  for(int i=0;i<12;i++){if(i>=ringCount)break;vec4 r=rings[i];float q=length(p-r.xy)-2.*r.z;
   y+=r.w*cos(6.*q)*exp(-3.*q*q-1.3*r.z)/(1.+spacing*spacing);
  }return y;
 }
 float elevation(vec2 p){return surfaceHeight(p,0.);}
`;
export const wave=waveHeight+bandGLSL(i=>'uniform sampler2D slope'+i+';')+`
 vec2 waterSlope(vec2 p){
  vec2 slope=vec2(0.);vec4 h;
  ${bandGLSL(i=>`h=texture2D(slope${i},uv${i}(p));slope+=transpose(rot${i})*((mix(h.xy,h.zw,bandMix[${i}])*255.-128.)/120.);`)}
  for(int i=0;i<12;i++){if(i>=ringCount)break;vec4 r=rings[i];vec2 dv=p-r.xy;float d=length(dv),q=d-2.*r.z;
   slope+=dv/max(.001,d)*r.w*exp(-3.*q*q-1.3*r.z)*(-6.*sin(6.*q)-6.*q*cos(6.*q));
  }return slope;
 }
`;
export const reflectedSurfaceClip=waveHeight+`
 uniform float clipFloor;uniform bool clipWaves;uniform vec2 clipHeights;
 bool belowReflector(vec3 p){
  if(!clipWaves)return p.y<clipFloor;
  // Coarse vertical rejection avoids texture lookups far from the wave zone.
  if(p.y<clipHeights.x-.012)return true;
  if(p.y>=clipHeights.y-.012)return false;
  return p.y<elevation(p.xz)-.012;
 }`;
