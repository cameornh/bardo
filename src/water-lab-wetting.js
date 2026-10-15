import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import * as THREE from 'three';
import {hash,rotate,vesselDistance,normalAt,clamp} from './water-lab-model.js';
import {labAirVelocity,airSolid} from './water-lab-air.js';

export const WET_SPOT_LIMIT=64;
// Optical wetting tracers are a bounded sample of the existing unresolved
// spray/mist, not additional bulk water. Rain reservoirs retain their mass.
export class LabWetting{
 constructor(lab){this.lab=lab;this.cameraEnabled=true;this.reset();}
 reset(){this.tracers=[];this.spots=[];this.lens=[];this.sequence=0;this.rainCredit=0;this.wasUnderwater=false;this.eye=null;this.forward=[0,0,-1];this.right=[1,0,0];this.up=[0,1,0];this.revision=0;}
 needsTracers(){return ['tank','glass','pane'].includes(this.lab.kind)||(this.cameraEnabled&&this.eye&&Math.abs(this.eye[0])<5.6&&Math.abs(this.eye[2])<(this.lab.kind==='river'?19.6:5)&&this.eye[1]<9.1);}
 traceData(positions,velocities,offset,kind){if(!this.needsTracers())return;if(++this.sequence%16||this.tracers.length>=256)return;this.tracers.push({position:Array.from(positions.subarray(offset,offset+3)),velocity:Array.from(velocities.subarray(offset,offset+3)),kind,age:0});}
 trace(position,velocity,kind){if(!this.needsTracers())return;if(++this.sequence%16||this.tracers.length>=256)return;this.tracers.push({position:position.slice(),velocity:velocity.slice(),kind,age:0});}
 addLens(amount=.5,uv=null){if(!this.cameraEnabled)return;const id=++this.sequence,p={x:uv?.[0]??hash(id+3),y:uv?.[1]??hash(id+7),radius:.004+.012*hash(id+19)*Math.min(2,amount),age:0};
  const near=this.lens.find(q=>Math.hypot(q.x-p.x,q.y-p.y)<(q.radius+p.radius)*2);if(near)near.radius=Math.min(.038,Math.cbrt(near.radius**3+p.radius**3));else if(this.lens.length<WET_SPOT_LIMIT)this.lens.push(p);else{const i=id%WET_SPOT_LIMIT;this.lens[i].radius=Math.min(.038,this.lens[i].radius+p.radius*.15);}this.revision++;}
 setCamera(camera){this.eye=camera.position.toArray();const e=camera.matrixWorld.elements;this.right=[e[0],e[1],e[2]];this.up=[e[4],e[5],e[6]];this.forward=[-e[8],-e[9],-e[10]];}
 hitLens(a,b){if(!this.eye||!this.cameraEnabled)return;const center=this.eye.map((v,k)=>v+this.forward[k]*.16),delta=b.map((v,k)=>v-a[k]),da=a.reduce((s,v,k)=>s+(v-center[k])*this.forward[k],0),db=b.reduce((s,v,k)=>s+(v-center[k])*this.forward[k],0);if(da*db>0||Math.abs(da-db)<1e-8)return;
  const t=da/(da-db),q=a.map((v,k)=>v+delta[k]*t-center[k]),x=q.reduce((s,v,k)=>s+v*this.right[k],0)/.25+.5,y=q.reduce((s,v,k)=>s+v*this.up[k],0)/.16+.5;if(x>0&&x<1&&y>0&&y<1)this.addLens(.7,[x,y]);}
 step(dt){const lab=this.lab,scale=lab.spec.scale;
  for(const t of this.tracers){const old=t.position,air=lab.wind||lab.jet?labAirVelocity(old,lab):[0,0,0],drag=t.kind===3?9:1.1;t.velocity=t.velocity.map((v,k)=>v+(air[k]-v)*(1-Math.exp(-dt*drag)));t.velocity[1]-=(t.kind===3?.18:9.81)/scale*dt;const next=old.map((v,k)=>v+t.velocity[k]*dt);this.hitLens(old,next);const hit=lab.rain.solidHit(old,next);t.age+=dt;
   if(hit){if(vesselDistance(hit.point,lab.kind,lab.motion)<.02){const local=rotate(hit.point.map((v,k)=>v-lab.motion.position[k]),lab.motion.tilt,lab.motion.spin,true,lab.motion.pitch);const existing=this.spots.find(p=>Math.hypot(...p.local.map((v,k)=>v-local[k]))<.04);if(existing){existing.radius=Math.min(.07,existing.radius+.002);existing.age=0;}else if(this.spots.length<WET_SPOT_LIMIT)this.spots.push({local,radius:(t.kind===3?.003:.008)/scale,age:0});}t.age=5;}else t.position=next;
  }
  this.tracers=this.tracers.filter(t=>t.age<4);
  for(const p of this.spots){p.age+=dt;p.radius*=Math.exp(-dt*.008);}this.spots=this.spots.filter(p=>p.age<45);
  if(this.eye&&this.cameraEnabled){const underwater=lab.sample(this.eye)>.18;
   if(underwater){this.wasUnderwater=true;this.lens=[];}else if(this.wasUnderwater){this.wasUnderwater=false;for(let i=0;i<32;i++)this.addLens(1.4);}
   if(!underwater&&lab.rain.enabled&&lab.rain.rate>0&&Math.abs(this.eye[0])<4.8&&Math.abs(this.eye[2])<lab.rain.skyDepth*.5){const top=this.eye.map((v,k)=>v+(k===1?12:0));const sheltered=lab.rain.solidHit(this.eye,top,p=>airSolid(p,lab));if(!sheltered){
    // Unresolved drops strike the small virtual pane even when a coarse rain
    // packet misses it. Flux depends on projected area and relative motion.
    const air=labAirVelocity(this.eye,lab),velocity=[air[0],-8/scale,air[2]],incidence=Math.abs(velocity.reduce((s,v,k)=>s+v*this.forward[k],0))*scale/8+.08;
    this.rainCredit+=dt*Math.sqrt(lab.rain.rate)*incidence*.8;const n=Math.min(12,Math.floor(this.rainCredit));this.rainCredit-=n;for(let i=0;i<n;i++)this.addLens(.8);
   }}
  }
  for(const p of this.lens){p.age+=dt;const mobility=Math.max(0,p.radius-.01)*2.5;p.x+=this.right[1]*mobility*dt;p.y+=this.up[1]*-mobility*dt;p.radius*=Math.exp(-dt*.016);}
  this.lens=this.lens.filter(p=>p.y>-.05&&p.x>-.05&&p.x<1.05&&p.radius>.0015);this.revision++;
 }
 glassSpots(){const scale=this.lab.spec.scale,result=this.spots.map(p=>[...p.local,p.radius]);for(const p of this.lab.rain.deposits.values())if(p.local)result.push([...p.local,Math.min(.24,Math.max(.002/scale,Math.cbrt(p.volume)*.7))]);return result.sort((a,b)=>b[3]-a[3]).slice(0,WET_SPOT_LIMIT);}
 uniforms(){return {uWetCount:{value:0},uWetSpots:{value:Array.from({length:WET_SPOT_LIMIT},()=>new THREE.Vector4())},uLensCount:{value:0},uLensDrops:{value:Array.from({length:WET_SPOT_LIMIT},()=>new THREE.Vector4())}};}
 updateUniforms(u){const spots=this.glassSpots();u.uWetCount.value=spots.length;spots.forEach((p,i)=>u.uWetSpots.value[i].fromArray(p));u.uLensCount.value=this.cameraEnabled?this.lens.length:0;this.lens.forEach((p,i)=>u.uLensDrops.value[i].set(p.x,p.y,p.radius,Math.min(1,p.age*8)));}
}
export const GLASS_WETTING_GLSL=`
uniform int uWetCount;uniform vec4 uWetSpots[64];
vec3 wetGlassNormal(vec3 p,vec3 n){vec3 local=rotateLab(p-uContainer,true),g=vec3(0);for(int i=0;i<64;i++){if(i>=uWetCount)break;vec4 drop=uWetSpots[i];vec3 q=(local-drop.xyz)/max(drop.w,.0001);float d=dot(q,q);if(d<9.)g+=q*exp(-.5*d)*.65;}g=rotateLab(g,false);return normalize(n+g-n*dot(g,n));}
`;
export const LENS_FIELD_FRAGMENT=`precision highp float;in vec2 vUv;out vec4 outColor;uniform int uLensCount;uniform vec4 uLensDrops[64];uniform float uLensAspect;
void main(){vec3 field=vec3(0);for(int i=0;i<64;i++){if(i>=uLensCount)break;vec4 p=uLensDrops[i];vec2 q=(vUv-p.xy)*vec2(uLensAspect,1.)/p.z;float d=dot(q,q);if(d<9.){float h=exp(-.5*d)*p.w;field+=vec3(-q*h,h);}}outColor=vec4(field,1);}`;
export const LENS_FRAGMENT=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage,uLensField;uniform float uAmbient,uSunlight;uniform mat4 uViewMatrix;
${LAB_LIGHTING_GLSL}
void main(){vec3 film=texture(uLensField,vUv).xyz;vec2 offset=film.xy*.014;vec3 color=texture(uImage,clamp(vUv+offset,.001,.999)).rgb;float wet=1.-exp(-film.z),rim=clamp(length(film.xy),0.,1.);color=mix(color,color*.94,wet);color+=vec3(.016,.019,.022)*uAmbient*rim+LAB_SUN*uSunlight*labSpecular(normalize(vec3(film.xy,1.)),vec3(0,0,1),mat3(uViewMatrix)*labSunDirection(),.14,.02)*wet;outColor=vec4(color,1);}`;
