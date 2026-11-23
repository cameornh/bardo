// Integrate a fixed pupil quadrature in world space. The two radial bands keep
// the narrow paraxial focus separate from the softer spherical aberration.
import {FocusMap} from './focus-map.js';
import {Color,Vector3,Vector4} from 'three';
import {opticalHit,traceOptic,transformedOptic} from './polished-shapes.js';
const PATHS=12,BANDS=2,SIDE=10,SPOTS=PATHS*BANDS;
export const causticShader=`uniform int focusCount;uniform vec4 focusShape[${SPOTS}];uniform vec4 focusLight[${SPOTS}];
uniform sampler2D focusMap;uniform vec4 focusBounds;uniform float focusMapScale;
vec3 focusedLight(vec2 xz){
 if(focusCount==0&&focusMapScale<=0.)return vec3(0.);
 vec2 uv=(xz-focusBounds.xy)*focusBounds.zw;
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec3(0.);
 vec3 sum=focusMapScale>0.?texture2D(focusMap,uv).rgb*focusMapScale:vec3(0.);
 for(int i=0;i<${SPOTS};i++){
  if(i>=focusCount)break;
  vec2 d=xz-focusShape[i].xy;
  float q=dot(d*d,focusShape[i].zw)+focusLight[i].w*d.x*d.y;
  if(q<12.)sum+=focusLight[i].rgb*exp(-.5*max(q,0.));
 }
 return sum;
}`;
export function focusUniforms(){
 const array=()=>({value:Array.from({length:SPOTS},()=>new Vector4())});
 return {focusMap:{value:null},focusBounds:{value:new Vector4()},focusMapScale:{value:0},focusCount:{value:0},focusShape:array(),focusLight:array()};
}
export function beamGain(cosine,limit){
 if(limit<=-1)return 1;
 const t=Math.max(0,Math.min(1,(cosine-limit)/Math.max(.00001,(1-limit)*.22)));
 return t*t*(3-2*t)*Math.min(32,2/Math.max(.001,1-limit));
}
function blocked(from,dir,distance,blockers){
 for(const b of blockers){
  const offset=b.center.clone().sub(from),along=offset.dot(dir);
  if(along+b.radius<0||along-b.radius>distance||offset.lengthSq()-along*along>b.radius*b.radius)continue;
  const hit=opticalHit(b,from,dir,1e-5);
  if(hit&&hit.t<distance-.0001)return true;
 }
 return false;
}
function receiver(p,dir,height){
 if(dir.y>=-.005)return null;
 let t=-p.y/dir.y;
 if(height){
  for(let i=0;i<6;i++){
   const h=height(p.x+dir.x*t,p.z+dir.z*t);
   const gap=p.y+t*dir.y-h;if(Math.abs(gap)<.012)break;
   t-=gap/dir.y;
   if(!Number.isFinite(t)||Math.abs(t)>150)return null;
  }
  if(Math.abs(p.y+t*dir.y-height(p.x+t*dir.x,p.z+t*dir.z))>.05)return null;
 }
 return t>.0001&&t<150?p.clone().addScaledVector(dir,t):null;
}
export function groundFocus(optic,material,source,height=null,blockers=[]){
 const {shape,matrix}=optic,center=shape.center.clone().applyMatrix4(matrix);
 const axis=source.position?center.clone().sub(source.position).normalize():source.direction;
 const u=new Vector3().crossVectors(axis,Math.abs(axis.y)>.9?new Vector3(1,0,0):new Vector3(0,1,0)).normalize();
 const v=new Vector3().crossVectors(axis,u),e=matrix.elements;
 const extent=n=>['x','y','z'].reduce((sum,k,i)=>sum+Math.abs(n.x*e[4*i]+n.y*e[4*i+1]+n.z*e[4*i+2])*shape.size[k],0);
 const rx=extent(u),ry=extent(v),area=4*rx*ry/(SIDE*SIDE);
 const bands=[[],[]],tint=new Color(material.color);
 const start=extent(axis)*2+.01;
 for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
  const a=(x+.5)*2/SIDE-1,b=(y+.5)*2/SIDE-1;
  const target=center.clone().addScaledVector(u,a*rx).addScaledVector(v,b*ry);
  const origin=source.position??target.clone().addScaledVector(axis,-start);
  const dir=source.position?target.clone().sub(origin).normalize():axis;
  let power=area;
  if(source.position){
   power*=Math.max(0,dir.dot(axis))*beamGain(dir.dot(source.direction),source.limit)/(1+target.distanceToSquared(origin)/source.range2);
   if(power<1e-8)continue;
  }
  const front=opticalHit(optic,origin,dir);
  const out=traceOptic(optic,origin,dir,material,front);
  if(!out)continue;
  const ground=receiver(out.origin,out.direction,height);
  if(!ground)continue;
  // The source housing may intercept sunlight, but must not shadow its own emission.
  if(blockers.length){
   if(blocked(front.point,dir.clone().negate(),source.position?front.t:150,blockers)||
      blocked(out.origin,out.direction,ground.distanceTo(out.origin),blockers))continue;
  }
  power*=material.metallic>=.985?1:(1-((material.ior-1)/(material.ior+1))**2)**2*Math.exp(-out.distance*(material.scattering+material.absorption*.15-Math.log(1-material.opacity)));
  bands[Number(a*a+b*b>.36)].push({x:ground.x,z:ground.z,power});
 }
 return bands.flatMap(samples=>{
  if(!samples.length)return [];
  let flux=0,x=0,z=0;
  for(const s of samples){flux+=s.power;x+=s.x*s.power;z+=s.z*s.power;}
  x/=flux;z/=flux;
  // A finite emitter and surface roughness keep an ideal point focus finite.
  const blur=.026+Math.min(rx,ry)*(.035+.8*material.roughness);
  let xx=blur**2,zz=xx,xz=0;
  for(const s of samples){const w=s.power/flux,dx=s.x-x,dz=s.z-z;xx+=w*dx*dx;zz+=w*dz*dz;xz+=w*dx*dz;}
  const det=xx*zz-xz*xz,peak=flux/(2*Math.PI*Math.sqrt(det));
  const color=source.color.clone().multiplyScalar(peak).multiply(material.metallic>=.985?tint:tint.clone().lerp(new Color(1,1,1),.8));
  return [{shape:new Vector4(x,z,zz/det,xx/det),light:new Vector4(color.r,color.g,color.b,-2*xz/det)}];
 });
}
export class GroundCaustics{
 constructor(){this.map=new FocusMap(SPOTS);this.cache=new Map();this.hand=0;this.next=0;}
 reset(){this.cache.clear();this.map.last=null;this.hand=0;this.next=0;}
 dispose(){this.map.dispose();}
 update(view){
  const now=performance.now();
  if(!view.opticalParts?.length){this.map.update(view,[]);return;}
  const terrain=view.activePhysics?.sandTerrain??view.sand,edits=view.activePhysics?.cuts;
  const height=terrain||edits?.nodes.size?(x,z)=>(terrain?.height(x,z)??0)+(edits?.offset(x,z)??0):null;
  const candidates=[],lamps=view.activeLamps,lights=view.shadowUniforms;
  const sources=lamps.map((lamp,i)=>({id:i,object:lamp.object,position:new Vector3().copy(lights.studioLampPosition.value[i]),
   range2:lights.studioLampPosition.value[i].w,direction:new Vector3().copy(lights.studioLampAim.value[i]),limit:lights.studioLampAim.value[i].w,color:lights.studioLampColor.value[i]}));
  const sun=view.uniforms.sunDirection.value;
  if(sun.y>0)sources.push({id:'sun',direction:sun.clone().normalize().negate(),color:view.uniforms.sunColor.value});
  const solids=[];
  for(const part of view.raySolids){
   if(!part.object.visible||!part.object.parent.visible)continue;
   part.object.updateWorldMatrix(true,false);
   const m=part.object.matrixWorld,solid=transformedOptic(part.shape,m);
   solids.push({...solid,object:part.object,center:part.shape.center.clone().applyMatrix4(m),radius:part.shape.size.length()*m.getMaxScaleOnAxis()});
  }
  // Version only changes when world poses change. Camera movement never retraces light.
  const blockerKey=solids.map(b=>b.matrix.elements.map(n=>Math.round(n*1000)).join(',')).join('/');
  for(const mesh of view.opticalParts){
   if(!mesh.parent.visible||!mesh.parent.parent.visible)continue;
   const {shape,material}=mesh.userData.polished;
   mesh.parent.updateWorldMatrix(true,false);
   const optic=transformedOptic(shape,mesh.parent.matrixWorld),center=shape.center.clone().applyMatrix4(optic.matrix);
   const radius=shape.size.length()*optic.matrix.getMaxScaleOnAxis();
   for(const source of sources){
    if(source.object===mesh.parent)continue;
    const d=source.position?center.distanceToSquared(source.position):0;
    if(source.position&&source.limit> -1&&d>radius*radius){
     const axis=center.clone().sub(source.position).normalize();
     const arc=Math.asin(radius/Math.sqrt(d));
     if(axis.dot(source.direction)<Math.cos(Math.min(Math.PI,Math.acos(source.limit)+arc)))continue;
    }
    const intensity=Math.max(source.color.r,source.color.g,source.color.b)/(1+d/(source.range2||1));
    if(intensity<.001)continue;
    candidates.push({id:mesh.id+':'+source.id,optic,source,material,object:mesh.parent,priority:intensity*shape.size.lengthSq()*optic.matrix.getMaxScaleOnAxis()**2});
   }
  }
  candidates.sort((a,b)=>b.priority-a.priority);candidates.length=Math.min(PATHS,candidates.length);
  let updates=0;
  // Round-robin updates bound work even when several optics are thrown together.
  for(let k=0;k<candidates.length;k++){
   const c=candidates[(k+this.hand)%candidates.length],s=c.source;
   const signature=[blockerKey,terrain?.version,view.sand?.version,edits?.version,s.color.r,s.color.g,s.color.b,s.range2,s.limit,
    ...s.direction.toArray(),...(s.position?.toArray()??[]),...c.optic.matrix.elements,c.material.color,c.material.ior,c.material.roughness,c.material.opacity,c.material.absorption,c.material.scattering].join('|');
   let entry=this.cache.get(c.id);
   if(entry?.signature!==signature&&updates<2&&now>=this.next){
    const blockers=solids.filter(b=>b.object!==c.object&&b.object!==s.object);
    entry={signature,spots:groundFocus(c.optic,c.material,s,height,blockers)};this.cache.set(c.id,entry);updates++;
   }
  }
  if(updates){this.hand=(this.hand+2)%Math.max(1,candidates.length);this.next=now+24;}
  this.map.update(view,candidates.flatMap(c=>this.cache.get(c.id)?.spots??[]));
 }
}
