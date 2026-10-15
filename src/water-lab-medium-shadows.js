import * as THREE from 'three';
import {QUAD_VERTEX} from './shaders.js';
import {LAB_GEOMETRY_GLSL, vesselDistance, opaqueDistance} from './water-lab-model.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
import {SOLUTE_GLSL,soluteCoefficients} from './water-lab-solutes.js';
import {labSky,LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import {poolLamp} from './water-lab-pool-shadows.js';

const clamp=x=>Math.max(0,Math.min(1,x));
const wet=r=>{const t=clamp((r-.12)/.12);return t*t*(3-2*t);};
export const MEDIUM_STEPS=128;
// CPU reference/fallback for the same bounded ray integration used by the GPU.
// Glass is straight-through extinction + Fresnel interfaces, not opaque glass.
export function mediumOpticalDepth(p,d,limit,{sample,solid=()=>100,glass=()=>100,scale=1,organic=0,turbidity=0,step=.18}){
 const tau=[0,0,0];let t=.012,free=solid(p)>.005,lastGlass=glass(p)<0;
 for(let i=0;i<MEDIUM_STEPS&&t<limit;i++){
  const q=p.map((v,k)=>v+d[k]*t),gd=glass(q),sd=solid(q);if(sd>.008)free=true;
  if(free&&sd<-.012)return [16,16,16];
  const ds=Math.min(limit-t,step,Math.max(.012,Math.abs(gd)*.75)),mid=q.map((v,k)=>v+d[k]*ds*.5),a=sample(mid),ext=soluteCoefficients(a.slice(1).map(v=>v/Math.max(a[0],.0001)),organic,turbidity).extinction;
  const inside=glass(mid)<0;if(inside!==lastGlass){const e=.004,n=[0,1,2].map(k=>{const lo=mid.slice(),hi=mid.slice();lo[k]-=e;hi[k]+=e;return glass(hi)-glass(lo);}),len=Math.hypot(...n)||1,cos=Math.abs(n.reduce((v,x,k)=>v+x*d[k]/len,0)),F=.04+.96*(1-cos)**5;for(let k=0;k<3;k++)tau[k]-=Math.log(Math.max(.02,1-F));}lastGlass=inside;
  for(let k=0;k<3;k++)tau[k]+=(sd<0?0:ext[k]*wet(a[0]))*ds*scale+(inside?[.07,.028,.02][k]*ds*scale:0);t+=ds;
 }
 return tau.map(v=>Math.min(16,v));
}
// Fixed cosine-weighted quadrature of the whole upper hemisphere. Average
// transmitted radiance, not optical depth: unblocked sky must remain visible
// beside an absorbing volume. No camera-dependent or temporally random rays.
export const SKY_SAMPLES=8;
export function skyDirection(i){const r=Math.sqrt((i+.5)/SKY_SAMPLES),a=i*2.399963229728653;return [r*Math.cos(a),Math.sqrt(1-r*r),r*Math.sin(a)];}
export function mediumSkyDepth(p,limit,options){
 const light=[0,0,0],total=[0,0,0];
 for(let i=0;i<SKY_SAMPLES;i++){const d=skyDirection(i),sky=labSky(d),tau=mediumOpticalDepth(p,d,limit(d),options);for(let k=0;k<3;k++){light[k]+=sky[k]*Math.exp(-tau[k]);total[k]+=sky[k];}}
 return light.map((v,k)=>-Math.log(Math.max(Math.exp(-16),v/total[k])));
}
export const MEDIUM_INTEGRATE_GLSL=`
uniform float uScale,uTannins,uTurbidity;
vec3 mediumOpticalDepth(vec3 p,vec3 d,float limit,float stepSize){
 vec3 tau=vec3(0);float t=.012;bool free=labOpaque(p)>.005,lastGlass=vessel(p)<0.;
 for(int i=0;i<128;i++){if(t>=limit)break;vec3 q=p+d*t;float gd=vessel(q),sd=labOpaque(q);if(sd>.008)free=true;if(free&&sd<-.012)return vec3(16);
 float ds=min(limit-t,min(stepSize,max(.012,abs(gd)*.75)));vec3 mid=q+d*ds*.5;vec4 a=parcelSample(mid);bool inside=vessel(mid)<0.;
 if(inside!=lastGlass){float e=.004;vec3 n=vec3(vessel(mid+vec3(e,0,0))-vessel(mid-vec3(e,0,0)),vessel(mid+vec3(0,e,0))-vessel(mid-vec3(0,e,0)),vessel(mid+vec3(0,0,e))-vessel(mid-vec3(0,0,e)));float cosine=abs(dot(n/max(1e-8,length(n)),d)),F=.04+.96*pow(1.-cosine,5.);tau-=vec3(log(max(.02,1.-F)));}lastGlass=inside;
 if(sd>=0.)tau+=soluteExtinction(a.yzw/max(a.x,.0001),uTannins,uTurbidity)*smoothstep(.12,.24,a.x)*ds*uScale;
 if(inside)tau+=vec3(.07,.028,.02)*ds*uScale;t+=ds;
 }return min(tau,vec3(16));
}
`;
export const MEDIUM_SHADOW_GLSL=`
uniform bool uMediumShadows;uniform sampler2D uMediumTransport;
uniform vec3 uMediumMin,uMediumMax,uMediumSize;uniform float uMediumStep;
vec3 mediumSlice(vec3 q,float y,float light){vec2 uv=vec2((q.x+.5+(y+light*uMediumSize.y)*uMediumSize.x)/(uMediumSize.x*uMediumSize.y*5.),(q.z+.5)/uMediumSize.z);return texture(uMediumTransport,uv).rgb;}
vec3 mediumLookup(vec3 p,float light){vec3 grid=(p-uMediumMin)/(uMediumMax-uMediumMin)*(uMediumSize-1.),outside=max(vec3(0),max(-grid,grid-(uMediumSize-1.)));float fade=1.-smoothstep(0.,2.,max(outside.x,max(outside.y,outside.z)));if(fade<=0.)return vec3(0);vec3 q=clamp(grid,vec3(0),uMediumSize-1.);float y=floor(q.y);return mix(mediumSlice(q,y,light),mediumSlice(q,min(y+1.,uMediumSize.y-1.),light),fract(q.y))*fade;}
vec3 mediumSun(vec3 p){return uMediumShadows?exp(-mediumLookup(p,0.)):vec3(1);}
vec3 mediumPool(vec3 p,int i){return uMediumShadows?exp(-mediumLookup(p,float(i+1))):vec3(1);}
vec3 mediumSky(vec3 p){return uMediumShadows?exp(-mediumLookup(p,4.)):vec3(1);}
`;
const fragment=`precision highp float;precision highp int;
${LAB_GEOMETRY_GLSL}${LAB_FIELD_GLSL}${SOLUTE_GLSL}${LAB_LIGHTING_GLSL}${MEDIUM_INTEGRATE_GLSL}
uniform vec3 uMediumMin,uMediumMax,uMediumSize;uniform float uMediumStep;out vec4 outColor;
float distanceToEdge(vec3 p,vec3 d){vec3 edge=mix(uMediumMin,uMediumMax,greaterThanEqual(d,vec3(0)));vec3 t=(edge-p)/(d+vec3(1e-8));return max(.01,min(t.x,min(t.y,t.z)));}
void main(){float light=floor(gl_FragCoord.x/(uMediumSize.x*uMediumSize.y)),column=mod(floor(gl_FragCoord.x),uMediumSize.x*uMediumSize.y);vec3 cell=vec3(mod(column,uMediumSize.x),floor(column/uMediumSize.x),floor(gl_FragCoord.y)),p=mix(uMediumMin,uMediumMax,cell/(uMediumSize-1.)),d=normalize(vec3(-.4,1,.3));outColor=vec4(0);
 if(light<.5)outColor.rgb=mediumOpticalDepth(p,d,distanceToEdge(p,d),uMediumStep);
 else if(light>3.5){vec3 transmitted=vec3(0),total=vec3(0);for(int i=0;i<8;i++){float r=sqrt((float(i)+.5)/8.),a=float(i)*2.399963229728653;vec3 skyRay=vec3(r*cos(a),sqrt(1.-r*r),r*sin(a)),radiance=labSky(skyRay);transmitted+=radiance*exp(-mediumOpticalDepth(p,skyRay,distanceToEdge(p,skyRay),uMediumStep));total+=radiance;}outColor.rgb=-log(max(vec3(exp(-16.)),transmitted/total));}
 else if(uStation==2){vec3 delta=vec3((light-2.)*2.7,.65,-2.75)-p;float r=length(delta);outColor.rgb=p.z< -2.8?vec3(16):mediumOpticalDepth(p,delta/max(r,.0001),r,uMediumStep);}
}`;
export function sampleFieldCPU(data,l,p){
 const q=p.map((v,k)=>(v-l.min[k])/l.dx);if(q.some((v,k)=>v<0||v>l.dimensions[k]-1))return [0,0,0,0];const low=q.map((v,k)=>Math.min(l.dimensions[k]-2,Math.floor(v))),f=q.map((v,k)=>v-low[k]),out=[0,0,0,0];
 for(let y=0;y<2;y++)for(let z=0;z<2;z++)for(let x=0;x<2;x++){const j=low[1]+y,px=(j%l.columns)*(l.dimensions[0]+2)+1+low[0]+x,py=Math.floor(j/l.columns)*(l.dimensions[2]+2)+1+low[2]+z,w=(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);for(let k=0;k<4;k++)out[k]+=data[(py*l.width+px)*4+k]*w;}return out;
}
export class LabMediumShadows{
 constructor(renderer,lab,density,uniforms){this.renderer=renderer;this.lab=lab;this.density=density;this.enabled=true;this.cpu=!renderer.extensions.has('EXT_color_buffer_float');this.u={uMediumShadows:{value:true},uMediumTransport:{value:null},uMediumMin:{value:new THREE.Vector3()},uMediumMax:{value:new THREE.Vector3()},uMediumSize:{value:new THREE.Vector3(32,24,32)},uMediumStep:{value:.18}};this.uniforms={...uniforms,...this.u};this.geometry=new THREE.PlaneGeometry(2,2);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();}
 update(){const lab=this.lab;this.u.uMediumShadows.value=this.enabled;if(!this.enabled)return;const l=this.density.layout,key=JSON.stringify([lab.revision,lab.tannins,lab.spec.scale,lab.motion.position,lab.motion.tilt,lab.motion.spin,lab.motion.pitch,lab.riverSlope,this.uniforms.uTurbidity.value,this.cpu]);if(key===this.key)return;this.key=key;
 // Fixed resolution and a bounded integration count independent of camera LOD.
 const min=l.min.map((v,k)=>v-(k===1?0:2)),max=l.max.map((v,k)=>v+(k===1?0:2));this.u.uMediumMin.value.fromArray(min);this.u.uMediumMax.value.fromArray(max);const size=this.u.uMediumSize.value.toArray(),tileWidth=size[0]*size[1],width=tileWidth*5,height=size[2],step=Math.max(.1,Math.hypot(...max.map((v,k)=>v-min[k]))/92);this.u.uMediumStep.value=step;
 if(!this.target)this.target=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});

 if(this.cpu){const data=this.density.fallback?.image.data;if(!data)throw new Error('CPU medium lighting requires the CPU density field');const array=new Float32Array(width*height*4);const options={sample:p=>sampleFieldCPU(data,l,p),solid:p=>opaqueDistance(p,lab.kind,lab.bedDelta(p),lab.riverSlope),glass:p=>vesselDistance(p,lab.kind,lab.motion),scale:lab.spec.scale,organic:lab.tannins,turbidity:this.uniforms.uTurbidity.value,step};
 for(let z=0;z<size[2];z++)for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++){const p=[x,y,z].map((v,k)=>min[k]+(max[k]-min[k])*v/(size[k]-1)),d=[-.4,1,.3].map(v=>v/Math.sqrt(1.25)),limit=Math.min(...d.map((v,k)=>((v>=0?max[k]:min[k])-p[k])/v)),sky=mediumSkyDepth(p,d=>Math.max(.01,Math.min(...d.map((v,k)=>((v>=0?max[k]:min[k])-p[k])/(v+1e-8)))),options),offset=(z*width+y*size[0]+x)*4;array.set([...mediumOpticalDepth(p,d,limit,options),0],offset);array.set([...sky,0],offset+tileWidth*16);for(let i=0;i<3;i++){const delta=poolLamp(i).map((v,k)=>v-p[k]),r=Math.hypot(...delta),tau=lab.kind==='pool'?(p[2]<-2.8?[16,16,16]:mediumOpticalDepth(p,delta.map(v=>v/r),r,options)):[0,0,0];array.set([...tau,0],offset+(i+1)*tileWidth*4);}}
 this.fallback?.dispose();this.fallback=new THREE.DataTexture(array,width,height,THREE.RGBAFormat,THREE.FloatType);this.fallback.minFilter=this.fallback.magFilter=THREE.LinearFilter;this.fallback.needsUpdate=true;this.u.uMediumTransport.value=this.fallback;
 }else{const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);this.u.uMediumTransport.value=this.target.texture;}}

 dispose(){[this.target,this.geometry,this.material,this.fallback].forEach(x=>x?.dispose());}
}
