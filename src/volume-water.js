// Three-dimensional free-surface MAC reference. Velocity lives on positive cell
// faces; liquid fraction, solid distance and pressure live at cell centres.
// Nothing in this solver prescribes a crest shape or rotates a wave surface.
import { planeOffset,planeFlux } from './volume-interface.js';
import { airVelocity,windPressure } from './beach-wind.js';
export const VOLUME_DEFAULT={size:[40,28,80],dx:.4,origin:[-16,-4.8,-23.2],dt:1/60,iterations:28};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class VolumeReference{
 constructor({size=VOLUME_DEFAULT.size,dx=.4,origin=VOLUME_DEFAULT.origin,iterations=28,terrain=null,boundary=null,open=false}={}){
  this.size=size.slice();this.dx=dx;this.origin=origin.slice();this.iterations=iterations;this.terrain=terrain;this.boundary=boundary;this.open=open;this.count=size.reduce((a,b)=>a*b,1);this.velocity=new Float32Array(this.count*4);this.fraction=new Float32Array(this.count*4);this.pressure=new Float32Array(this.count);this.solid=new Float32Array(this.count);this.faces=new Float32Array(this.count*3);this.time=0;this.wind=0;this.angle=0;this.turbulence=1;this.jet=null;this.reset();
 }
 index(x,y,z){const [nx,ny,nz]=this.size;return (clamp(z,0,nz-1)*ny+clamp(y,0,ny-1))*nx+clamp(x,0,nx-1);}
 coords(i){const [nx,ny]=this.size;return [i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];}
 point(c,axis=-1){return c.map((v,k)=>this.origin[k]+(v+.5+(k===axis?.5:0))*this.dx);}
 inside(c){return c.every((v,k)=>v>=0&&v<this.size[k]);}
 boundaryAt(c){const p=this.point(c.map((v,k)=>k===1?v:clamp(v,0,this.size[k]-1)));return this.boundary?.(p[0],p[2])||{surface:0,u:0,v:0};}
 openFace(c,a){if(!this.open||a===1)return false;return c[a]===-1||c[a]===this.size[a]-1;}
 faceVelocity(v,c,a){if(this.inside(c))return v[this.index(...c)*4+a];if(this.openFace(c,a)){const b=this.boundaryAt(c);return a===0?b.u||0:b.v||0;}return 0;}
 liquid(c){if(this.inside(c))return this.fraction[this.index(...c)*4];if(this.open&&c[1]>=0&&c[1]<this.size[1])return clamp(.5+(this.boundaryAt(c).surface-this.point(c)[1])/this.dx,0,1);return 0;}
 wall(c){return !this.inside(c)||this.solid[this.index(...c)]<=0;}
 reset(){this.velocity.fill(0);this.pressure.fill(0);this.fraction.fill(0);for(let i=0;i<this.count;i++){const p=this.point(this.coords(i)),s=this.terrain?this.terrain.distance(p):p[1]+3;this.solid[i]=s;for(let axis=0;axis<3;axis++){const q=this.point(this.coords(i),axis);this.faces[i*3+axis]=this.terrain?this.terrain.distance(q):q[1]+3;}const b=this.boundary?.(p[0],p[2])||{surface:0,u:0,v:0};this.fraction[i*4+2]=s>0?1:0;this.fraction[i*4]=s>0?clamp(.5+(b.surface-p[1])/this.dx,0,1):0;this.velocity[i*4]=b.u||0;this.velocity[i*4+2]=b.v||0;this.pressure[i]=Math.max(0,b.surface-p[1])*9.81;}this.time=0;}
 sample(data,p,component=0,axis=-1,stride=4){const q=p.map((v,k)=>(v-this.origin[k])/this.dx-.5-(k===axis?.5:0)),b=q.map(Math.floor),f=q.map((v,k)=>v-b[k]);let sum=0;for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)sum+=data[this.index(b[0]+x,b[1]+y,b[2]+z)*stride+component]*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);return sum;}
 vector(data,p){return [0,1,2].map(a=>this.sample(data,p,a,a));}
 faceClosed(c,a){const n=c.slice();n[a]++;if(!this.inside(n)||!this.inside(c)){if(!this.openFace(c,a))return true;return this.solid[this.index(...c)]<=0||this.solid[this.index(...n)]<=0;}return this.wall(c)||this.wall(n)||this.faces[this.index(...c)*3+a]<0;}
 airPressure(c){if(this.airCache)return this.airCache[this.index(...c)];const p=this.point(c);const jet=airVelocity(p,this.time,0,this.angle,this.jet,0);const grad=[0,1,2].map(a=>{const hi=c.slice(),lo=c.slice();hi[a]++;lo[a]--;let sum=0;for(let k=0;k<3;k++){sum+=this.liquid(hi)-this.liquid(lo);hi[1]--;lo[1]--;}return sum;}),slope=(grad[0]*Math.sin(this.angle)+grad[2]*Math.cos(this.angle))/Math.max(.2,-grad[1]);return windPressure(p[0],p[2],this.time,this.wind,this.angle,this.turbulence)+.001225*jet[1]*jet[1]+.00015*this.wind*this.wind*clamp(slope,-1,1);}
 theta(a,b){return clamp((a-.5)/(a-b),.25,1);}
 predict(dt){const out=this.velocity.slice(),h=this.dx;
  for(let i=0;i<this.count;i++){const c=this.coords(i);for(let axis=0;axis<3;axis++){if(this.faceClosed(c,axis)){out[i*4+axis]=0;continue;}if(this.openFace(c,axis)){const b=this.boundaryAt(c);out[i*4+axis]=axis===0?b.u||0:b.v||0;continue;}const n=c.slice();n[axis]++;const wet=Math.max(this.liquid(c),this.liquid(n));if(wet<.001){out[i*4+axis]=0;continue;}const p=this.point(c,axis),v=this.vector(this.velocity,p),mid=p.map((x,k)=>x-v[k]*dt*.5),mv=this.vector(this.velocity,mid),back=p.map((x,k)=>x-mv[k]*dt);let value=this.sample(this.velocity,back,axis,axis);if(axis===1)value-=9.81*dt;
    const above=c.slice();above[1]++;above[1]++;const exposed=clamp(1-this.liquid(above),0,1),air=airVelocity(p,this.time,this.wind,this.angle,this.jet,this.turbulence),relative=air[axis]-value;value+=dt*.00005*exposed*relative*Math.abs(relative)/Math.max(.2,h);if(this.open){const edge=Math.min(c[0],this.size[0]-1-c[0],c[2],this.size[2]-1-c[2]),blend=clamp((4-edge)/4,0,1)*dt*6,b=this.boundaryAt(c);value=value*(1-blend)+(axis===0?b.u||0:axis===2?b.v||0:0)*blend;}out[i*4+axis]=value*.9999;
  }}return out;
 }
 project(velocity,dt){const h=this.dx,div=new Float32Array(this.count),active=new Uint8Array(this.count);
  for(let i=0;i<this.count;i++){const c=this.coords(i);active[i]=this.solid[i]>0&&this.fraction[i*4]>.5?1:0;let d=0;for(let a=0;a<3;a++){const m=c.slice();m[a]--;d+=velocity[i*4+a]-this.faceVelocity(velocity,m,a);}div[i]=d/h;}
  let pressure=this.pressure.slice();for(let it=0;it<this.iterations;it++){const next=new Float32Array(this.count);for(let i=0;i<this.count;i++){if(!active[i])continue;const c=this.coords(i),alpha=this.fraction[i*4];let sum=0,den=0;for(let a=0;a<3;a++)for(const sign of [-1,1]){const n=c.slice();n[a]+=sign;const face=sign>0?c:n;if(this.faceClosed(face,a)||this.openFace(face,a))continue;const j=this.index(...n),b=this.liquid(n),weight=b>.5?1:1/this.theta(alpha,b);sum+=weight*(active[j]?pressure[j]:this.airPressure(n));den+=weight;}next[i]=den?(sum-div[i]*h*h/dt)/den:0;}pressure=next;}
  const result=velocity.slice();for(let i=0;i<this.count;i++){const c=this.coords(i);for(let a=0;a<3;a++){const n=c.slice();n[a]++;const j=this.index(...n);if(this.faceClosed(c,a)){result[i*4+a]=0;continue;}if(this.openFace(c,a)||!active[i]&&!active[j])continue;const left=active[i]?pressure[i]:this.airPressure(c),right=active[j]?pressure[j]:this.airPressure(n),theta=active[i]&&active[j]?1:active[i]?this.theta(this.liquid(c),this.liquid(n)):this.theta(this.liquid(n),this.liquid(c));result[i*4+a]-=dt/h*(right-left)/theta;}}
  this.pressure=pressure;return result;
 }
 extrapolate(v){const out=v.slice();for(let i=0;i<this.count;i++){const c=this.coords(i);for(let a=0;a<3;a++){const n=c.slice();n[a]++;if(this.faceClosed(c,a)||this.openFace(c,a)||Math.max(this.liquid(c),this.liquid(n))>.5)continue;let sum=0,count=0;for(let b=0;b<3;b++)for(const sign of [-1,1]){const q=c.slice();q[b]+=sign;const r=q.slice();r[a]++;if(this.inside(q)&&!this.faceClosed(q,a)&&Math.max(this.liquid(q),this.liquid(r))>.5){sum+=v[this.index(...q)*4+a];count++;}}out[i*4+a]=count?sum/count:0;}}return out;}
 transport(v,dt){const out=this.fraction.slice(),h=this.dx,planes=new Float32Array(this.count*4),raw=new Float32Array(this.count*3),limits=new Float32Array(this.count);
  for(let i=0;i<this.count;i++){const c=this.coords(i),alpha=this.liquid(c);if(alpha<1e-5||alpha>1-1e-5){planes.set([0,1,0,alpha],i*4);continue;}const n=[0,1,2].map(a=>{const hi=c.slice(),lo=c.slice();hi[a]++;lo[a]--;return this.liquid(lo)-this.liquid(hi);});let length=n.reduce((v,x)=>v+Math.abs(x),0);if(length<.00001){n[1]=1;length=1;}for(let a=0;a<3;a++)n[a]/=length;planes.set([...n,planeOffset(alpha,n.map(Math.abs))],i*4);}
  const geometric=(c,a)=>{if(this.faceClosed(c,a))return 0;const speed=this.faceVelocity(v,c,a),donor=c.slice();if(speed<0)donor[a]++;const alpha=this.liquid(donor),id=this.index(...donor)*4,normal=this.inside(donor)?Array.from(planes.subarray(id,id+3)):[0,1,0],offset=this.inside(donor)?planes[id+3]:alpha;return speed*planeFlux(alpha,normal,offset,a,speed*dt/h);};
  for(let i=0;i<this.count;i++){const c=this.coords(i);for(let a=0;a<3;a++)raw[i*3+a]=geometric(c,a);}
  const rawAt=(c,a)=>this.inside(c)?raw[this.index(...c)*3+a]:geometric(c,a);
  for(let i=0;i<this.count;i++){const c=this.coords(i);let outgoing=0;for(let a=0;a<3;a++){const m=c.slice();m[a]--;outgoing+=Math.max(0,rawAt(c,a))+Math.max(0,-rawAt(m,a));}limits[i]=Math.min(1,this.liquid(c)/Math.max(1e-9,outgoing*dt/h));}
  const flux=(c,a)=>{const f=rawAt(c,a),donor=c.slice();if(f<0)donor[a]++;return f*(this.inside(donor)?limits[this.index(...donor)]:1);};
  for(let i=0;i<this.count;i++){const c=this.coords(i);let alpha=this.fraction[i*4];for(let a=0;a<3;a++){const m=c.slice();m[a]--;alpha-=dt/h*(flux(c,a)-flux(m,a));}if(this.solid[i]<0)alpha=0;out[i*4]=clamp(alpha,0,1);const p=this.point(c),velocity=this.vector(v,p),back=p.map((x,k)=>x-velocity[k]*dt),foam=this.sample(this.fraction,back,1),speed=Math.hypot(...velocity),under=c.slice();under[1]--;const entrained=alpha>.05&&alpha<.95&&this.liquid(under)<.3&&speed>1?speed*.15:0;out[i*4+1]=clamp(foam*Math.exp(-dt*.5)+dt*entrained,0,1);

  }return out;
 }
 step(dt=1/60){this.airCache=null;const air=new Float32Array(this.count);for(let i=0;i<this.count;i++)air[i]=this.airPressure(this.coords(i));this.airCache=air;const prediction=this.predict(dt),projected=this.project(prediction,dt);this.velocity=this.extrapolate(projected);this.fraction=this.transport(this.velocity,dt);this.time+=dt;}
 metrics(){const [nx,ny,nz]=this.size,plane=nx*ny;let volume=0,overhangs=0,maxSpeed=0,minSurface=Infinity,maxSurface=-Infinity;const crests=[];const labels=new Int32Array(this.count),queue=new Int32Array(this.count);let label=0,largest=0,largestSize=0;
  for(let i=0;i<this.count;i++){const a=this.fraction[i*4];volume+=a*this.dx**3;if(a>.05)maxSpeed=Math.max(maxSpeed,Math.hypot(this.velocity[i*4],this.velocity[i*4+1],this.velocity[i*4+2]));if(labels[i]||a<.55)continue;label++;let head=0,end=1;queue[0]=i;labels[i]=label;while(head<end){const j=queue[head++],x=j%nx,y=Math.floor(j/nx)%ny,z=Math.floor(j/plane);for(const n of [x>0?j-1:-1,x<nx-1?j+1:-1,y>0?j-nx:-1,y<ny-1?j+nx:-1,z>0?j-plane:-1,z<nz-1?j+plane:-1])if(n>=0&&!labels[n]&&this.fraction[n*4]>.55){labels[n]=label;queue[end++]=n;}}if(end>largestSize){largestSize=end;largest=label;}}
  // A connected sheet above an air gap and underlying water distinguishes an
  // overturning crest from an isolated spray particle or water atop dry rock.
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){let waterBelow=false,airGap=false,top=-Infinity;for(let y=0;y<ny;y++){const i=(z*ny+y)*nx+x,a=this.fraction[i*4];if(this.solid[i]<=0){waterBelow=false;airGap=false;continue;}if(a>.55){if(waterBelow&&airGap&&labels[i]===largest&&x>3&&x<nx-4&&z>3&&z<nz-4){overhangs++;crests.push([x,y,z]);}waterBelow=true;airGap=false;top=this.origin[1]+(y+.5)*this.dx;}else if(a<.3&&waterBelow)airGap=true;}if(Number.isFinite(top)){minSurface=Math.min(minSurface,top);maxSurface=Math.max(maxSurface,top);}}
  return {volume,overhangs,maxSpeed,minSurface,maxSurface,crests};}
}
