// One bounded terrain basin, in simulation metres before the common SI scale.
export const RIVER_BOUNDS={min:[-6,-2,-60],max:[6,28,60]};
export const RIVER_BED={width:64,height:512,spanX:12,spanZ:120,thickness:2.4};
export const RIVER_SLOPE=.10;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export const riverCenter=z=>2.6*Math.sin((z+53)*Math.PI/14);
export const riverCenterSlope=z=>2.6*Math.PI/14*Math.cos((z+53)*Math.PI/14);
export const riverBottom=(z,slope=RIVER_SLOPE)=>.35+(33-clamp(z,-54,33))*slope;
const derivative=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return 6*t*(1-t)/(b-a);};
// Height and analytic gradient avoid five terrain evaluations per distance query.
export function riverProfile(p,slope=RIVER_SLOPE){
 const [x,,z]=p,b=riverBottom(z,slope),offset=x-riverCenter(z),edge=Math.abs(offset);
 const bank=smooth(1.1,3.4,edge)+smooth(0,3.9,-54-z)+smooth(39,45,z);
 const channel=b+1.6*Math.min(1,bank),r=Math.hypot(x,(z-42)*.5),pond=.05+.06*r*r+1.6*smooth(3.6,5,r);
 if(pond<channel){const g=.12+1.6*derivative(3.6,5,r)/Math.max(r,.0001);return [pond,g*x,g*(z-42)*.25];}
 const side=bank<1?1.6*derivative(1.1,3.4,edge)*Math.sign(offset):0;
 const gz=(z>-54&&z<33?-slope:0)-side*riverCenterSlope(z)+(bank<1?1.6*(-derivative(0,3.9,-54-z)+derivative(39,45,z)):0);
 return [channel,side,gz];
}
export const riverHeight=(p,slope=RIVER_SLOPE)=>riverProfile(p,slope)[0];
export function riverDistance(p,slope=RIVER_SLOPE,delta=0){const [h,gx,gz]=riverProfile(p,slope);return (p[1]-h-delta)/Math.sqrt(1+gx*gx+gz*gz);}
export function riverVelocity(z,speed,scale,slope=RIVER_SLOPE){const d=[riverCenterSlope(z),-slope,1],n=Math.hypot(...d);return d.map(v=>v*speed/(scale*n));}
export function riverSeed(spec,slope=RIVER_SLOPE,speed=1.5){
 const result=[],s=spec.spacing;
 for(let z=-53.9;z<52;z+=s)for(let x=-5.2;x<5.3;x+=s){
  const bed=riverHeight([x,0,z],slope),surface=z<32.1?Math.max(1.55,riverBottom(z,slope)+1.15):1.55;
  if(bed>surface-s*.55)continue;
  for(let y=bed+s*.5;y<surface;y+=s){if(riverRockDistance([x,y,z],slope)<s*.45)continue;result.push({p:[x,y,z],v:z<32.1?riverVelocity(z,speed,spec.scale,slope):[0,0,0],held:false,chem:[0,0,0,0]});}
 }
 return result;
}
export const RIVER_ROCKS=Array.from({length:22},(_,i)=>{
 const z=-49+i*3.7,x=riverCenter(z)+Math.sin(i*2.4)*1.1;
 return {x,z,r:.38+(i%4)*.14,height:1.1+(i%5)*.28,angle:i*1.731};
});
export function riverRockDistance(p,slope=RIVER_SLOPE){const nearest=clamp(Math.round((p[2]+49)/3.7),0,21);let d=100;
 // Nearby facets are exact. Distant rocks contribute a conservative positive
 // distance bound, never an invented surface. No 22-rock loop per normal tap.
 for(let i=0;i<22;i++){if(Math.abs(i-nearest)>1)d=Math.min(d,Math.max(1,Math.abs(p[2]-RIVER_ROCKS[i].z)-1.4));}
 for(let i=Math.max(0,nearest-1);i<=Math.min(21,nearest+1);i++){const rock=RIVER_ROCKS[i];
 const a=rock.angle,c=Math.cos(a),s=Math.sin(a),x=p[0]-rock.x,z=p[2]-rock.z,y=p[1]-riverBottom(rock.z,slope)-rock.height*.3,qx=Math.abs(x*c-z*s),qz=Math.abs(x*s+z*c),qy=Math.abs(y);
 // Intersect six axis planes and eight slanted planes to form chipped blocks.
 const shape=Math.max(qx-rock.r,qz-rock.r*.8,qy-rock.height*.7,(qx+qz+qy*.65-rock.r*1.28-rock.height*.16)/Math.sqrt(2.4225));d=Math.min(d,shape);
 }return d;
}
// Texture-center interpolation is shared with the GPU terrain field.
export function riverBedWeights(p){
 const b=RIVER_BED,x=clamp((p[0]/b.spanX+.5)*b.width-.5,0,b.width-1),z=clamp((p[2]/b.spanZ+.5)*b.height-.5,0,b.height-1),ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
 return [[iz*b.width+ix,(1-fx)*(1-fz)],[iz*b.width+Math.min(ix+1,b.width-1),fx*(1-fz)],[Math.min(iz+1,b.height-1)*b.width+ix,(1-fx)*fz],[Math.min(iz+1,b.height-1)*b.width+Math.min(ix+1,b.width-1),fx*fz]];
}
export function exchangeRiverSediment(lab,dt){
 const b=RIVER_BED,area=b.spanX*b.spanZ/(b.width*b.height),pv=lab.spacing**3;
 // Settling transfers concentration to lower neighboring liquid parcels. The
 // equal-and-opposite update cannot create or delete suspended sediment.
 const settling=new Float32Array(lab.count),neighbors=lab.gpu?.neighbors;
 if(neighbors)for(let i=0;i<lab.count;i++){const o=i*4,c=lab.chem[o+2];if(c<=0||lab.positions[o+3])continue;let lower=-1,best=Infinity;
  for(let a=0;a<128;a++){const j=neighbors[i*128+a];if(j<0)break;const q=j*4,dy=lab.positions[o+1]-lab.positions[q+1],dx=lab.positions[o]-lab.positions[q],dz=lab.positions[o+2]-lab.positions[q+2],r2=dx*dx+dz*dz;if(dy>lab.spacing*.15&&dy<lab.spacing*2&&r2<lab.spacing**2&&r2<best&&!lab.positions[q+3]){best=r2;lower=j;}}
  if(lower>=0){const flux=c*(1-Math.exp(-dt*.18/(lab.spec.scale*lab.spacing)));settling[i]-=flux;settling[lower]+=flux;}
 }
 for(let i=0;i<lab.count;i++)lab.chem[i*4+2]+=settling[i];
 for(let i=0;i<lab.count;i++){
  const o=i*4;if(lab.positions[o+3])continue;const p=Array.from(lab.positions.subarray(o,o+3)),weights=riverBedWeights(p),bed=riverHeight(p,lab.riverSlope)+lab.bedDelta(p),contact=clamp(1-(p[1]-bed)/(lab.spacing*2.2),0,1);
  if(contact<=0||riverRockDistance(p,lab.riverSlope)<lab.spacing*.6)continue;
  const speed=Math.hypot(lab.velocities[o],lab.velocities[o+2])*lab.spec.scale,capacity=clamp((speed*speed-.36)*.055,0,.18),concentration=lab.chem[o+2];
  const exchange=1-Math.exp(-dt*(capacity>concentration?1.1:4.5)*contact),settled=concentration*(1-Math.exp(-dt*.18/(lab.spec.scale*lab.spacing)*contact));
  let change=Math.max(-concentration*pv,((capacity-concentration)*exchange-settled)*pv);
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
float riverCenter(float z){return 2.6*sin((z+53.)*3.14159265359/14.);}
float riverDerivative(float a,float b,float v){float t=clamp((v-a)/(b-a),0.,1.);return 6.*t*(1.-t)/(b-a);}
vec3 riverProfile(vec3 p){
 float z=p.z,b=.35+(33.-clamp(z,-54.,33.))*uRiverSlope,offset=p.x-riverCenter(z),edge=abs(offset);
 float bank=smoothstep(1.1,3.4,edge)+smoothstep(0.,3.9,-54.-z)+smoothstep(39.,45.,z);
 float channel=b+1.6*min(1.,bank),r=length(vec2(p.x,(p.z-42.)*.5)),pond=.05+.06*r*r+1.6*smoothstep(3.6,5.,r);
 if(pond<channel){float g=.12+1.6*riverDerivative(3.6,5.,r)/max(r,.0001);return vec3(pond,g*p.x,g*(z-42.)*.25);}
 float side=bank<1.?1.6*riverDerivative(1.1,3.4,edge)*sign(offset):0.;
 float gz=(z>-54.&&z<33.?-uRiverSlope:0.)-side*2.6*3.14159265359/14.*cos((z+53.)*3.14159265359/14.)+(bank<1.?1.6*(-riverDerivative(0.,3.9,-54.-z)+riverDerivative(39.,45.,z)):0.);
 return vec3(channel,side,gz);
}
float riverRockDistance(vec3 p){int nearest=clamp(int(floor((p.z+49.)/3.7+.5)),0,21);float d=100.;
 if(nearest>1)d=min(d,max(1.,p.z-(-49.+float(nearest-2)*3.7)-1.4));
 if(nearest<20)d=min(d,max(1.,(-49.+float(nearest+2)*3.7)-p.z-1.4));
 for(int j=-1;j<=1;j++){int i=nearest+j;if(i<0||i>=22)continue;float f=float(i),z=-49.+f*3.7,r=.38+float(i%4)*.14,h=1.1+float(i%5)*.28;
 vec3 q=p-vec3(riverCenter(z)+sin(f*2.4)*1.1,.35+(33.-clamp(z,-54.,33.))*uRiverSlope+h*.3,z);float c=cos(f*1.731),s=sin(f*1.731);q=abs(vec3(q.x*c-q.z*s,q.y,q.x*s+q.z*c));float shape=max(max(q.x-r,q.z-r*.8),max(q.y-h*.7,(q.x+q.z+q.y*.65-r*1.28-h*.16)/sqrt(2.4225)));d=min(d,shape);
 }return d;}
float riverBase(vec3 p){return riverProfile(p).x;}
float riverDistance(vec3 p,float delta){vec3 h=riverProfile(p);return (p.y-h.x-delta)/sqrt(1.+dot(h.yz,h.yz));}
`;
