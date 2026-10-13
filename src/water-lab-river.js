// One bounded terrain basin, in simulation metres before the common SI scale.
export const RIVER_BOUNDS={min:[-6,-2,-20],max:[6,13,20]};
export const RIVER_BED={width:64,height:192,spanX:12,spanZ:40,thickness:.75};
export const RIVER_SLOPE=.10;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export const riverCenter=z=>2.6*Math.sin((z+17)*Math.PI/14);
export const riverCenterSlope=z=>2.6*Math.PI/14*Math.cos((z+17)*Math.PI/14);
export const riverBottom=(z,slope=RIVER_SLOPE)=>.35+(11-clamp(z,-18,11))*slope;
const derivative=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return 6*t*(1-t)/(b-a);};
// Height and analytic gradient avoid five terrain evaluations per distance query.
export function riverProfile(p,slope=RIVER_SLOPE){
 const [x,,z]=p,b=riverBottom(z,slope),offset=x-riverCenter(z),edge=Math.abs(offset);
 const bank=smooth(1.1,3.4,edge)+smooth(0,1.3,-18-z)+smooth(11,13,z);
 const channel=b+1.6*Math.min(1,bank),r=Math.hypot(x,z-14),pond=.05+.06*r*r+1.6*smooth(3.6,5,r);
 if(pond<channel){const g=.12+1.6*derivative(3.6,5,r)/Math.max(r,.0001);return [pond,g*x,g*(z-14)];}
 const side=bank<1?1.6*derivative(1.1,3.4,edge)*Math.sign(offset):0;
 const gz=(z>-18&&z<11?-slope:0)-side*riverCenterSlope(z)+(bank<1?1.6*(-derivative(0,1.3,-18-z)+derivative(11,13,z)):0);
 return [channel,side,gz];
}
export const riverHeight=(p,slope=RIVER_SLOPE)=>riverProfile(p,slope)[0];
export function riverDistance(p,slope=RIVER_SLOPE,delta=0){const [h,gx,gz]=riverProfile(p,slope);return (p[1]-h-delta)/Math.sqrt(1+gx*gx+gz*gz);}
export function riverVelocity(z,speed,scale,slope=RIVER_SLOPE){const d=[riverCenterSlope(z),-slope,1],n=Math.hypot(...d);return d.map(v=>v*speed/(scale*n));}
export function riverSeed(spec,slope=RIVER_SLOPE,speed=1.5){
 const result=[],s=spec.spacing;
 for(let z=-17.9;z<18;z+=s)for(let x=-5.2;x<5.3;x+=s){
  const bed=riverHeight([x,0,z],slope),surface=z<10.7?Math.max(1.55,riverBottom(z,slope)+1.15):1.55;
  if(bed>surface-s*.55)continue;
  for(let y=bed+s*.5;y<surface;y+=s)result.push({p:[x,y,z],v:z<10.7?riverVelocity(z,speed,spec.scale,slope):[0,0,0],held:false,chem:[0,0,0,0]});
 }
 return result;
}
// Texture-center interpolation is shared with the GPU terrain field.
export function riverBedWeights(p){
 const b=RIVER_BED,x=clamp((p[0]/b.spanX+.5)*b.width-.5,0,b.width-1),z=clamp((p[2]/b.spanZ+.5)*b.height-.5,0,b.height-1),ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
 return [[iz*b.width+ix,(1-fx)*(1-fz)],[iz*b.width+Math.min(ix+1,b.width-1),fx*(1-fz)],[Math.min(iz+1,b.height-1)*b.width+ix,(1-fx)*fz],[Math.min(iz+1,b.height-1)*b.width+Math.min(ix+1,b.width-1),fx*fz]];
}
export function exchangeRiverSediment(lab,dt){
 const b=RIVER_BED,area=b.spanX*b.spanZ/(b.width*b.height),pv=lab.spacing**3;
 for(let i=0;i<lab.count;i++){
  const o=i*4;if(lab.positions[o+3])continue;const p=Array.from(lab.positions.subarray(o,o+3)),weights=riverBedWeights(p),bed=riverHeight(p,lab.riverSlope)+lab.bedDelta(p),contact=clamp(1-(p[1]-bed)/(lab.spacing*2.2),0,1);
  if(contact<=0)continue;
  const speed=Math.hypot(lab.velocities[o],lab.velocities[o+2])*lab.spec.scale,capacity=clamp((speed*speed-.16)*.065,0,.24),concentration=lab.chem[o+2];
  let change=(capacity-concentration)*pv*(1-Math.exp(-dt*(capacity>concentration?2.2:3.5)*contact));
  if(change>0)for(const [cell,w] of weights)if(w>0)change=Math.min(change,lab.bedStock[cell]/w);
  // Suspended material and bed stock exchange equal volume. Deposition raises
  // the same field queried for collision, shading and subsequent erosion.
  for(const [cell,w] of weights){lab.bedStock[cell]-=change*w;lab.bedData[cell*4]=(lab.bedStock[cell]/area-b.thickness);lab.bedData[cell*4+1]+=Math.max(0,change)*w/area;lab.bedData[cell*4+2]+=Math.max(0,-change)*w/area;}
  lab.chem[o+2]+=change/pv;lab.eroded+=Math.max(0,change);lab.deposited+=Math.max(0,-change);
 }
 lab.bedTexture.needsUpdate=true;
}
export const RIVER_GLSL=`
uniform float uRiverSlope;
float riverCenter(float z){return 2.6*sin((z+17.)*3.14159265359/14.);}
float riverDerivative(float a,float b,float v){float t=clamp((v-a)/(b-a),0.,1.);return 6.*t*(1.-t)/(b-a);}
vec3 riverProfile(vec3 p){
 float z=p.z,b=.35+(11.-clamp(z,-18.,11.))*uRiverSlope,offset=p.x-riverCenter(z),edge=abs(offset);
 float bank=smoothstep(1.1,3.4,edge)+smoothstep(0.,1.3,-18.-z)+smoothstep(11.,13.,z);
 float channel=b+1.6*min(1.,bank),r=length(p.xz-vec2(0,14)),pond=.05+.06*r*r+1.6*smoothstep(3.6,5.,r);
 if(pond<channel){float g=.12+1.6*riverDerivative(3.6,5.,r)/max(r,.0001);return vec3(pond,g*p.x,g*(z-14.));}
 float side=bank<1.?1.6*riverDerivative(1.1,3.4,edge)*sign(offset):0.;
 float gz=(z>-18.&&z<11.?-uRiverSlope:0.)-side*2.6*3.14159265359/14.*cos((z+17.)*3.14159265359/14.)+(bank<1.?1.6*(-riverDerivative(0.,1.3,-18.-z)+riverDerivative(11.,13.,z)):0.);
 return vec3(channel,side,gz);
}
float riverBase(vec3 p){return riverProfile(p).x;}
float riverDistance(vec3 p,float delta){vec3 h=riverProfile(p);return (p.y-h.x-delta)/sqrt(1.+dot(h.yz,h.yz));}
`;
