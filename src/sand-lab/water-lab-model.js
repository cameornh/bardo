import {riverHeight,riverDistance,riverSeed,riverRockDistance,RIVER_GLSL} from './water-lab-river.js';
// Bounded fixtures for one water material. Coordinates are normalized by scale;
// particle volumes and gravity are converted back to SI at the solver boundary.
export const LAB_PRESETS={
 pipe:{name:'Pipe / impinging jet',scale:1,spacing:.25,eye:[9,6,11],target:[0,1.5,0]},
 waterfall:{name:'Waterfall',scale:3,spacing:.32,eye:[10,8,13],target:[0,2.7,0]},
 pool:{name:'Pool / submerged jets',scale:1.5,spacing:.29,eye:[9,7,11],target:[0,1,0]},
 tank:{name:'Moving glass tank',scale:1,spacing:.23,eye:[7,5,9],target:[0,1.7,0]},
 river:{name:'River / sediment / solutes',scale:2,spacing:.48,minSpacing:.42,eye:[55,80,80],target:[0,4,0]},
 glass:{name:'Spinning drinking glass',scale:.05,spacing:.19,eye:[5,4,7],target:[0,1.6,0]},
 ocean:{name:'Bounded sand beach',scale:10,spacing:.42,eye:[11,8,13],target:[0,1.1,0]},
 pane:{name:'Movable glass pane',scale:1,spacing:.23,eye:[-5,6,7],target:[0,2,0]},
};
export const LAB_IDS=Object.keys(LAB_PRESETS),NEIGHBORS=128;
// Parcels are quadrature samples, not hard spheres of half a grid cell.
// Boundary support supplies pressure; this small skin only prevents crossing.
export const WATER_CONTACT_SKIN=.12;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const dot=(a,b)=>a.reduce((v,x,k)=>v+x*b[k],0);
export const length=a=>Math.hypot(...a);
export const hash=i=>{const q=Math.sin(i*91.173+18.17)*43758.54;return q-Math.floor(q);};
export function rotate(p,tilt=0,spin=0,inverse=false,pitch=0){const c=Math.cos(tilt),s=Math.sin(tilt),a=Math.cos(spin),b=Math.sin(spin),cp=Math.cos(pitch||0),sp=Math.sin(pitch||0);if(inverse){p=[p[0],cp*p[1]+sp*p[2],-sp*p[1]+cp*p[2]];const q=[c*p[0]+s*p[1],-s*p[0]+c*p[1],p[2]];return [a*q[0]-b*q[2],q[1],b*q[0]+a*q[2]];}const q=[a*p[0]+b*p[2],p[1],-b*p[0]+a*p[2]],r=[c*q[0]-s*q[1],s*q[0]+c*q[1],q[2]];return [r[0],cp*r[1]-sp*r[2],sp*r[1]+cp*r[2]];}
export function box(p,b){const q=p.map((v,k)=>Math.abs(v)-b[k]);return length(q.map(v=>Math.max(v,0)))+Math.min(Math.max(...q),0);}
export function floorHeight(p,kind,slope=.1){if(kind==='river')return riverHeight(p,slope);if(kind==='ocean')return Math.max(-.3,(p[2]-1)*.48);return 0;}
export function vesselLocal(p,motion){return rotate(p.map((v,k)=>v-motion.position[k]),motion.tilt,motion.spin,true,motion.pitch);}
export function vesselDistance(p,kind,motion){if(!['tank','glass','pane'].includes(kind))return 100;const q=vesselLocal(p,motion);if(kind==='pane')return box(q,[2.4,.045,1.7]);if(kind==='glass'){const r=Math.hypot(q[0],q[2]);return Math.min(Math.max(Math.abs(r-1.1)-.095,Math.abs(q[1]) -1.5),Math.max(r-1.2,Math.abs(q[1]+1.5)-.095));}let d=box([q[0],q[1]+1.7,q[2]],[2.2,.12,1.6]);for(const a of [0,2])for(const side of [-1,1]){const v=q.slice(),b=[2.2,1.7,1.6];v[a]-=side*(a===0?2.1:1.5);b[a]=.12;d=Math.min(d,box(v,b));}return d;}
export function opaqueDistance(p,kind,bedDelta=0,slope=.1,waterfallHeight=4.8){
 let d=(p[1]-floorHeight(p,kind,slope)-bedDelta)*(kind==='river'?.22:1);
 if(kind==='river')d=Math.min(d,riverRockDistance(p,slope));if(kind==='waterfall')d=Math.min(d,box([p[0],p[1]-waterfallHeight*.5,p[2]+3],[3.2,waterfallHeight*.5,1.8]));
 if(kind==='pipe')d=Math.min(d,Math.max(Math.abs(Math.hypot(p[1]-3.6,p[2])-.34)-.075,Math.abs(p[0]+4.65)-.85));
 if(kind==='pool')for(const a of [0,2])for(const side of [-1,1]){const q=[p[0],p[1]-1,p[2]],b=[4,1,3.1];q[a]-=side*(a===0?3.9:3);b[a]=.12;d=Math.min(d,box(q,b));}return d;
}
export function fixtureDistance(p,kind,motion,bedDelta=0,slope=.1,waterfallHeight=4.8,bounded=true){let d=kind==='river'?riverDistance(p,slope,bedDelta):p[1]-floorHeight(p,kind)-bedDelta;if(kind==='river')d=Math.min(d,riverRockDistance(p,slope));if(kind==='waterfall')d=Math.min(d,box([p[0],p[1]-waterfallHeight*.5,p[2]+3],[3.2,waterfallHeight*.5,1.8]));if(kind==='pool')for(const a of [0,2])for(const side of [-1,1]){const q=[p[0],p[1]-1,p[2]],b=[4,1,3.1];q[a]-=side*(a===0?3.9:3);b[a]=.12;d=Math.min(d,box(q,b));}if(kind==='pipe')d=Math.min(d,opaqueDistance(p,kind));d=Math.min(d,vesselDistance(p,kind,motion));return bounded?Math.min(d,5.5-Math.abs(p[0]),(kind==='river'?59.5:4.9)-Math.abs(p[2]),(kind==='river'?27:9)-p[1]):d;}
export function normalAt(p,field){const e=.003,n=[0,1,2].map(k=>{const a=p.slice(),b=p.slice();a[k]+=e;b[k]-=e;return field(a)-field(b);}),l=length(n)||1;return n.map(v=>v/l);}
// Geometry fields may be conservative distance bounds (the sand uses .65).
// Kernel support and parcel clearance need metric distance, not that bound.
export function boundaryMetric(p,field,reach=Infinity){const e=.003,d=field(p);if(d>=reach)return {distance:d,normal:[0,0,0]};const g=[0,1,2].map(k=>{const a=p.slice(),b=p.slice();a[k]+=e;b[k]-=e;return (field(a)-field(b))/(2*e);}),m=Math.max(.05,Math.hypot(...g));return {distance:d/m,normal:g.map(v=>v/m)};}
export function collideBoundary(p,radius,field){for(let i=0;i<3;i++){const b=boundaryMetric(p,field,radius);if(b.distance>=radius)break;p=p.map((v,k)=>v+b.normal[k]*(radius-b.distance));}return p;}
export function wallVelocity(p,m){const r=p.map((v,k)=>v-m.position[k]),axis=rotate([0,1,0],m.tilt,0,false,m.pitch),tiltAxis=rotate([0,0,1],0,0,false,m.pitch),omega=tiltAxis.map((v,k)=>v*m.tiltVelocity+axis[k]*m.spinVelocity+(k===0?(m.pitchVelocity||0):0));return [m.velocity[0]+omega[1]*r[2]-omega[2]*r[1],m.velocity[1]+omega[2]*r[0]-omega[0]*r[2],m.velocity[2]+omega[0]*r[1]-omega[1]*r[0]];}
export function createMotion(){return {position:[0,2,0],velocity:[0,0,0],target:[0,2,0],tilt:0,targetTilt:0,tiltVelocity:0,pitch:0,targetPitch:0,pitchVelocity:0,spin:0,spinVelocity:0,targetSpin:0};}
export function stepMotion(m,dt){for(let k=0;k<3;k++){m.velocity[k]+=(25*(m.target[k]-m.position[k])-9*m.velocity[k])*dt;m.position[k]+=m.velocity[k]*dt;}m.tiltVelocity+=(25*(m.targetTilt-m.tilt)-9*m.tiltVelocity)*dt;m.tilt+=m.tiltVelocity*dt;m.pitchVelocity+=(25*(m.targetPitch-m.pitch)-9*m.pitchVelocity)*dt;m.pitch+=m.pitchVelocity*dt;m.spinVelocity+=(m.targetSpin-m.spinVelocity)*(1-Math.exp(-dt*3));m.spin+=m.spinVelocity*dt;}
export function seedWater(kind,spec=LAB_PRESETS[kind]){const s=spec.spacing,result=[];const add=(p,v=[0,0,0])=>result.push({p,v,held:false,chem:[0,0,0,0]});
 if(kind==='river')return riverSeed(spec,spec.riverSlope??.1,spec.sourceSpeed??1.5);
 if(kind==='pipe'){for(let i=0;i<1200;i++)add([-4.875+(i%40)*s,s*.45+Math.floor(i/800)*s,(Math.floor(i/40)%20-9.5)*s]);return result;}
 if(kind==='waterfall'){
  const height=spec.waterfallHeight??4.8;
  for(let i=0;i<1600;i++)add([(i%28-13.5)*s,s*.48+Math.floor(i/448)*s,(Math.floor(i/28)%16)*s-.5]);
  for(let i=0;i<220;i++)add([(i%14-6.5)*s,height+s*.5+Math.floor(i/140)*s,-4.35+(Math.floor(i/14)%10)*s],[0,0,6/spec.scale]);
  for(let y=0;y<Math.floor((height-.1)/s);y++)for(let x=0;x<14;x++){const drop=y*s,age=Math.sqrt(2*drop/(9.81/spec.scale)),speed=6/spec.scale;add([(x-6.5)*s,height+.15-drop,-1.1+speed*age],[0,-9.81/spec.scale*age,speed]);}
  return result;
 }
 for(let z=-4.4;z<4.5;z+=s)for(let y=.24;y<3;y+=s)for(let x=-4.7;x<4.8;x+=s){let yes=false;if(kind==='pool')yes=Math.abs(x)<3.5&&Math.abs(z)<2.6&&y<1.4;if(kind==='tank')yes=Math.abs(x)<1.87&&Math.abs(z)<1.26&&y>.55&&y<2.1;if(kind==='glass')yes=Math.hypot(x,z)<.87&&y>.66&&y<2.35;if(kind==='ocean')yes=y>floorHeight([x,y,z],kind)+.16&&y<1.35;if(yes)add([x,y,z]);}return result;
}
// Symmetric lists: both particles accept a pair or neither does. Diffusion
// therefore exchanges equal solute mass; no directional nearest-N truncation.
export function buildNeighbors(positions,spacing){
 const n=positions.length/4,reach=spacing*2.65,r2max=reach*reach,bins=new Map(),counts=new Uint16Array(n),data=new Float32Array(n*NEIGHBORS);data.fill(-1);
 const key=(x,y,z)=>(x+512)+(y+512)*1024+(z+512)*1048576;
 for(let i=0;i<n;i++){const o=i*4,x=Math.floor(positions[o]/reach),y=Math.floor(positions[o+1]/reach),z=Math.floor(positions[o+2]/reach),id=key(x,y,z);let bin=bins.get(id);if(!bin){bin={x,y,z,ids:[]};bins.set(id,bin);}bin.ids.push(i);}
 let overflow=0;
 const pair=(i,j)=>{const a=i*4,b=j*4,x=positions[a]-positions[b],y=positions[a+1]-positions[b+1],z=positions[a+2]-positions[b+2];if(x*x+y*y+z*z>=r2max)return;if(counts[i]===NEIGHBORS||counts[j]===NEIGHBORS){overflow++;return;}data[i*NEIGHBORS+counts[i]++]=j;data[j*NEIGHBORS+counts[j]++]=i;};
 // Visit each occupied cell pair once. Symmetric typed lists avoid N temporary
 // neighbor arrays and 27 hash lookups per particle on every rebuild.
 for(const bin of bins.values()){
  const ids=bin.ids;for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)pair(ids[a],ids[b]);
  for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
   if(z<0||z===0&&y<0||z===0&&y===0&&x<=0)continue;
   const other=bins.get(key(bin.x+x,bin.y+y,bin.z+z));if(!other)continue;for(const i of ids)for(const j of other.ids)pair(i,j);
  }
 }
 return {data,overflow};
}
export function kernel(r,h){const q=Math.max(0,1-r*r/(h*h));return 315/(64*Math.PI*h**3)*q**3;}
export function kernelGradient(d,h){const r=length(d);if(r<1e-6||r>=h)return [0,0,0];const c=-45/(Math.PI*h**6)*(h-r)**2/r;return d.map(x=>x*c);}
export function densityAt(positions,p,spacing){const h2=4*spacing*spacing,w=315/(512*Math.PI);let d=0;for(let i=0;i<positions.length;i+=4){const x=p[0]-positions[i],y=p[1]-positions[i+1],z=p[2]-positions[i+2],q=1-(x*x+y*y+z*z)/h2;if(q>0)d+=w*q*q*q;}return d;}
export function buoyancyAcceleration(ratio,submerged,scale=1){return 9.81/scale*(submerged/ratio-1);}
// Integral of the normalized poly6 support occupied by a locally planar
// solid. Completing this missing support prevents a numerical wall meniscus.
// The solid has no movable particle gradient: its contribution is to self only.
export function boundaryKernel(distance,h){
 const q=clamp(distance/h,0,1),q2=q*q;
 return {density:.5-315/256*q*(1-q2*(4/3-q2*(6/5-q2*(4/7-q2/9)))),gradient:-315/(256*h)*(1-q2)**4};
}
export const BOUNDARY_KERNEL_GLSL=`
vec2 boundaryKernel(float distance,float h){float q=clamp(distance/h,0.,1.),q2=q*q;return vec2(.5-315./256.*q*(1.-q2*(4./3.-q2*(6./5.-q2*(4./7.-q2/9.)))),-315./(256.*h)*pow(1.-q2,4.));}
`;
export function solveDensity(positions,neighbors,spacing,iterations=3,collide=p=>p,boundary=null){const n=positions.length/4,h=spacing*2,volume=spacing**3;let pos=positions.slice();const lambdas=new Float32Array(n),density=new Float32Array(n),wallGradient=new Float32Array(n*3);for(let iteration=0;iteration<iterations;iteration++){
 for(let i=0;i<n;i++){let rho=volume*kernel(0,h),sum=0,gradient=[0,0,0];for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const d=[0,1,2].map(k=>pos[i*4+k]-pos[j*4+k]),g=kernelGradient(d,h).map(x=>x*volume);rho+=volume*kernel(length(d),h);sum+=dot(g,g);gradient=gradient.map((v,k)=>v+g[k]);}if(boundary){const p=Array.from(pos.subarray(i*4,i*4+3)),metric=boundaryMetric(p,boundary,h),wall=boundaryKernel(metric.distance,h),g=wall.density>1e-6?metric.normal.map(v=>v*wall.gradient):[0,0,0];rho+=wall.density;wallGradient.set(g,i*3);gradient=gradient.map((v,k)=>v+g[k]);}density[i]=rho;lambdas[i]=-Math.max(0,rho-1)/(sum+dot(gradient,gradient)+.04/(h*h));}
 const next=pos.slice();for(let i=0;i<n;i++){if(pos[i*4+3]>.5)continue;let delta=[0,1,2].map(k=>lambdas[i]*wallGradient[i*3+k]);for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const d=[0,1,2].map(k=>pos[i*4+k]-pos[j*4+k]),g=kernelGradient(d,h),r=length(d),scorr=-.00015*Math.pow(kernel(r,h)/kernel(.3*h,h),4);for(let k=0;k<3;k++)delta[k]+=(lambdas[i]+lambdas[j]+scorr)*volume*g[k];}const limit=Math.min(1,spacing*.2/(length(delta)||1)),p=collide([0,1,2].map(k=>pos[i*4+k]+delta[k]*limit));next.set(p,i*4);}pos=next;}return {positions:pos,density};}
export function diffuseChemistry(chem,neighbors,positions,spacing,dt){const out=chem.slice(),n=positions.length/4,h=spacing*2;for(let i=0;i<n;i++)for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;if(j<=i)continue;const a0=i*4,b0=j*4,r=Math.hypot(positions[a0]-positions[b0],positions[a0+1]-positions[b0+1],positions[a0+2]-positions[b0+2]),w=Math.max(0,1-r/h)*Math.min(.006,dt*.12);for(let k=0;k<3;k++){const exchange=(chem[j*4+k]-chem[i*4+k])*w;out[i*4+k]+=exchange;out[j*4+k]-=exchange;}}return out;}
export const LAB_GEOMETRY_GLSL=`
${RIVER_GLSL}
uniform highp sampler2D uLabBed;uniform int uStation;uniform vec3 uContainer;uniform float uTilt,uSpin,uPitch,uWaterfallHeight;
float fallHeight(){return uWaterfallHeight>0.?uWaterfallHeight:4.8;}uniform vec4 uPlayer;uniform float uPlayerHeight;uniform int uBodyCount;uniform highp sampler2D uBodies;
vec3 rotateLab(vec3 p,bool inverse){float c=cos(uTilt),s=sin(uTilt),a=cos(uSpin),b=sin(uSpin);if(inverse){vec3 pitched=vec3(p.x,cos(uPitch)*p.y+sin(uPitch)*p.z,-sin(uPitch)*p.y+cos(uPitch)*p.z);vec3 q=vec3(c*pitched.x+s*pitched.y,-s*pitched.x+c*pitched.y,pitched.z);return vec3(a*q.x-b*q.z,q.y,b*q.x+a*q.z);}vec3 q=vec3(a*p.x+b*p.z,p.y,-b*p.x+a*p.z);vec3 r=vec3(c*q.x-s*q.y,s*q.x+c*q.y,q.z);return vec3(r.x,cos(uPitch)*r.y-sin(uPitch)*r.z,sin(uPitch)*r.y+cos(uPitch)*r.z);}
float labBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
uniform highp sampler2D uSand,uBodyExtra,uSandParcels,uSandBins;
uniform int uSandCount;uniform vec3 uSandMin,uSandMax;
// Cubic B-spline reconstruction with four hardware-linear texture reads.
// This is the same positive, partition-of-unity kernel as SandBed.height.
float sandHeight(vec2 p){
 float size=float(textureSize(uSand,0).x),last=size-1.;vec2 q=clamp((p+vec2(5.5,4.9))/vec2(11.,9.8)*last,0.,last),base=floor(q),f=fract(q),a=1.-f;
 vec2 w0=a*a*a/6.,w1=(3.*f*f*f-6.*f*f+4.)/6.,w2=(-3.*f*f*f+3.*f*f+3.*f+1.)/6.,w3=f*f*f/6.;
 vec2 g0=w0+w1,g1=w2+w3,h0=(base-1.+w1/g0+.5)/size,h1=(base+1.+w3/g1+.5)/size;
 return g0.y*(g0.x*texture(uSand,h0).r+g1.x*texture(uSand,vec2(h1.x,h0.y)).r)+g1.y*(g0.x*texture(uSand,vec2(h0.x,h1.y)).r+g1.x*texture(uSand,h1).r);
}
float labFloor(vec3 p){if(uStation==4)return riverBase(p)+texture(uLabBed,p.xz/vec2(12,120)+.5).r;if(uStation==6)return sandHeight(p.xz);return 0.;}

vec4 bodyExtra(int i,int j){return texelFetch(uBodyExtra,ivec2((i*3+j)%256,(i*3+j)/256),0);}
vec3 bodyLocal(vec3 p,int i){vec4 r=bodyExtra(i,1);vec3 q=p-texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0).xyz;float cp=cos(r.z),sp=sin(r.z),c=cos(r.x),s=sin(r.x),a=cos(r.y),b=sin(r.y);q=vec3(q.x,cp*q.y+sp*q.z,-sp*q.y+cp*q.z);q=vec3(c*q.x+s*q.y,-s*q.x+c*q.y,q.z);return vec3(a*q.x-b*q.z,q.y,b*q.x+a*q.z);}
float bodyDistance(vec3 p,int i){vec4 b=texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);if(bodyExtra(i,0).w<.5)return length(p-b.xyz)-b.w;vec3 q=bodyLocal(p,i);float radial=length(q.xz),r=b.w;return min(max(abs(radial-r*.84)-r*.16,abs(q.y)-r),max(radial-r,abs(q.y+r)-r*.16));}
vec3 bodyNormal(vec3 p,int i){float e=max(.000001,min(.003,texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0).w*.02));return normalize(vec3(bodyDistance(p+vec3(e,0,0),i)-bodyDistance(p-vec3(e,0,0),i),bodyDistance(p+vec3(0,e,0),i)-bodyDistance(p-vec3(0,e,0),i),bodyDistance(p+vec3(0,0,e),i)-bodyDistance(p-vec3(0,0,e),i)));}
float sandParcelDistance(vec3 p,int index){vec4 a=texelFetch(uSandParcels,ivec2((index*2)%256,(index*2)/256),0),meta=texelFetch(uSandParcels,ivec2((index*2+1)%256,(index*2+1)/256),0);float aspect=meta.y>0.?meta.y:1.;vec3 v=p-a.xyz;v.y/=aspect;float d=(length(v)-a.w)*min(1.,aspect);for(int j=0;j<int(meta.w);j++){int i=int(meta.z)+j*2;vec4 cut=texelFetch(uSandParcels,ivec2(i%256,i/256),0);float ca=texelFetch(uSandParcels,ivec2((i+1)%256,(i+1)/256),0).x;ca=ca>0.?ca:1.;v=p-cut.xyz;v.y/=ca;float q=(length(v)-abs(cut.w))*min(1.,ca);d=max(d,cut.w>0.?-q:q);}return d;}
float sandDistance(vec3 p){float d=(p.y-labFloor(p))*.65;if(uSandCount==0||any(lessThan(p,uSandMin))||any(greaterThan(p,uSandMax)))return d;ivec2 c=ivec2(clamp((p.xz+vec2(5.5,4.9))/vec2(11.,9.8)*32.,0.,31.));bool overflow=texelFetch(uSandBins,ivec2(c.x*16+15,c.y),0).r< -1.5;int count=overflow?uSandCount:16;for(int j=0;j<count;j++){int index=overflow?j:int(texelFetch(uSandBins,ivec2(c.x*16+j,c.y),0).r);if(index<0)break;vec4 a=texelFetch(uSandParcels,ivec2((index*2)%256,(index*2)/256),0);float q=sandParcelDistance(p,index),k=min(.08,a.w*.5),h=max(k-abs(d-q),0.)/max(k,.00001);d=min(d,q)-h*h*k*.25;}return d;}

// The material follows the same smooth union as geometry, so wet airborne
// clumps keep their own moisture instead of inheriting the bed below them.
float sandWetness(vec3 p){
 float size=float(textureSize(uSand,0).x);float wet=texture(uSand,clamp((p.xz+vec2(5.5,4.9))/vec2(11.,9.8),0.,1.)*((size-1.)/size)+vec2(.5/size)).g;
 if(uSandCount==0||any(lessThan(p,uSandMin))||any(greaterThan(p,uSandMax)))return wet;
 float d=(p.y-labFloor(p))*.65;ivec2 c=ivec2(clamp((p.xz+vec2(5.5,4.9))/vec2(11.,9.8)*32.,0.,31.));
 bool overflow=texelFetch(uSandBins,ivec2(c.x*16+15,c.y),0).r< -1.5;int count=overflow?uSandCount:16;
 for(int j=0;j<count;j++){int index=overflow?j:int(texelFetch(uSandBins,ivec2(c.x*16+j,c.y),0).r);if(index<0)break;
  ivec2 uv=ivec2((index*2)%256,(index*2)/256);vec4 a=texelFetch(uSandParcels,uv,0);float q=sandParcelDistance(p,index),k=min(.08,a.w*.5),h=clamp(.5+.5*(d-q)/max(k,.00001),0.,1.);
  wet=mix(wet,texelFetch(uSandParcels,ivec2((index*2+1)%256,(index*2+1)/256),0).r,h);d=mix(d,q,h)-k*h*(1.-h);
 }return wet;
}

float vessel(vec3 p){if(uStation!=3&&uStation!=5&&uStation!=7)return 100.;vec3 q=rotateLab(p-uContainer,true);if(uStation==7)return labBox(q,vec3(2.4,.045,1.7));if(uStation==5){float r=length(q.xz);return min(max(abs(r-1.1)-.095,abs(q.y)-1.5),max(r-1.2,abs(q.y+1.5)-.095));}float d=labBox(q+vec3(0,1.7,0),vec3(2.2,.12,1.6));for(int a=0;a<2;a++)for(int j=0;j<2;j++){vec3 v=q,b=vec3(2.2,1.7,1.6);int axis=a==0?0:2;v[axis]-=(j==0?-1.:1.)*(a==0?2.1:1.5);b[axis]=.12;d=min(d,labBox(v,b));}return d;}
// Visible opaque fixture geometry; simulation-only bounding walls are excluded.
float labOpaque(vec3 p){float d=uStation==6?sandDistance(p):(p.y-labFloor(p))*(uStation==4?.22:1.);
 if(uStation==4)d=min(d,riverRockDistance(p));if(uStation==1)d=min(d,labBox(p+vec3(0,-fallHeight()*.5,3),vec3(3.2,fallHeight()*.5,1.8)));
 if(uStation==0)d=min(d,max(abs(length(p.yz-vec2(3.6,0))-.34)-.075,abs(p.x+4.65)-.85));
 if(uStation==2)for(int a=0;a<2;a++)for(int s=0;s<2;s++){vec3 q=p-vec3(0,1.,0),b=vec3(4.,1.,3.1);int axis=a==0?0:2;q[axis]-=(s==0?-1.:1.)*(a==0?3.9:3.);b[axis]=.12;d=min(d,labBox(q,b));}return d;
}
float fixture(vec3 p){float d=uStation==4?riverDistance(p,texture(uLabBed,p.xz/vec2(12,120)+.5).r):(uStation==6?sandDistance(p):p.y-labFloor(p));if(uStation==4)d=min(d,riverRockDistance(p));if(uStation==1)d=min(d,labBox(p+vec3(0,-fallHeight()*.5,3),vec3(3.2,fallHeight()*.5,1.8)));if(uStation==2)for(int a=0;a<2;a++)for(int s=0;s<2;s++){vec3 q=p-vec3(0,1.,0),b=vec3(4.,1.,3.1);int axis=a==0?0:2;q[axis]-=(s==0?-1.:1.)*(a==0?3.9:3.);b[axis]=.12;d=min(d,labBox(q,b));}if(uStation==0)d=min(d,labOpaque(p));return min(d,vessel(p));}
vec4 labBody(int i){return texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);}
float playerDistance(vec3 p){vec3 q=p-uPlayer.xyz;q.y-=clamp(q.y,0.,uPlayerHeight);return uPlayer.w>0.?length(q)-uPlayer.w:100.;}
float labPhysicalSolid(vec3 p){float d=fixture(p);for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i);if(length(p-b.xyz)-b.w*1.5<d)d=min(d,bodyDistance(p,i));}return min(d,playerDistance(p));}
float labSolid(vec3 p){return min(labPhysicalSolid(p),min(5.5-abs(p.x),min((uStation==4?59.5:4.9)-abs(p.z),(uStation==4?27.:9.)-p.y)));}
vec3 labPhysicalNormal(vec3 p){float e=.003;return normalize(vec3(labPhysicalSolid(p+vec3(e,0,0))-labPhysicalSolid(p-vec3(e,0,0)),labPhysicalSolid(p+vec3(0,e,0))-labPhysicalSolid(p-vec3(0,e,0)),labPhysicalSolid(p+vec3(0,0,e))-labPhysicalSolid(p-vec3(0,0,e))));}

vec3 labNormal(vec3 p){float e=.003;return normalize(vec3(labSolid(p+vec3(e,0,0))-labSolid(p-vec3(e,0,0)),labSolid(p+vec3(0,e,0))-labSolid(p-vec3(0,e,0)),labSolid(p+vec3(0,0,e))-labSolid(p-vec3(0,0,e))));}
vec4 labBoundaryMetric(vec3 p,float reach){float e=.003,d=labSolid(p);if(d>=reach)return vec4(0,0,0,d);vec3 g=vec3(labSolid(p+vec3(e,0,0))-labSolid(p-vec3(e,0,0)),labSolid(p+vec3(0,e,0))-labSolid(p-vec3(0,e,0)),labSolid(p+vec3(0,0,e))-labSolid(p-vec3(0,0,e)))/(2.*e);float m=max(.05,length(g));return vec4(g/m,d/m);}
vec3 labCollide(vec3 p,float radius){for(int i=0;i<3;i++){vec4 b=labBoundaryMetric(p,radius);if(b.w>=radius)break;p+=b.xyz*(radius-b.w);}return p;}
`;
