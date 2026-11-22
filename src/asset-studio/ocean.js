import {LOCAL_IMPULSE_REACH} from './ground-tools.js';
import {windAt} from './wind.js';
import {crestFrame,crestLevel,lipPoint} from './breaking-wave.js';
import {Whitewater} from './whitewater.js';
// A multiscale deep-water wind sea. Authoring units are metres and seconds.
export const OCEAN_SIZE = 32, TILE_METRES = 40, WAVE_HZ = 20;
const N = OCEAN_SIZE, TAU = Math.PI * 2, cell = TILE_METRES / N;
const wrap = x => (x % N + N) % N;
const reverse = Array.from({length:N}, (_,i) => parseInt(i.toString(2).padStart(5,'0').split('').reverse().join(''),2));
const cosine = Array.from({length:N}, (_,i)=>Math.cos(TAU*i/N));
const sine = Array.from({length:N}, (_,i)=>Math.sin(TAU*i/N));

// Unnormalised inverse transform: coefficients below are amplitudes in metres.
function inverseLine(real, imag, offset, stride) {
 for (let i=0;i<N;i++) {
  const a=offset+i*stride,b=offset+reverse[i]*stride;
  if(i<reverse[i]){[real[a],real[b]]=[real[b],real[a]];[imag[a],imag[b]]=[imag[b],imag[a]];}
 }
 for(let span=2;span<=N;span*=2)for(let base=0;base<N;base+=span)for(let j=0;j<span/2;j++){
  const a=offset+(base+j)*stride,b=a+stride*span/2,k=j*N/span;
  const r=real[b]*cosine[k]-imag[b]*sine[k], im=real[b]*sine[k]+imag[b]*cosine[k];
  real[b]=real[a]-r;imag[b]=imag[a]-im;real[a]+=r;imag[a]+=im;
 }
}

// Independent, differently oriented wave bands. World positions map to all three
// grids, so crossing a wrap in one band leaves the physical surface continuous.
export const WAVE_BANDS=[
 {metres:TILE_METRES,angle:0,amplitude:.56,hz:WAVE_HZ,seed:1701},
 {metres:96.7,angle:.483,amplitude:.96,hz:12,seed:3097},
 {metres:318.3,angle:-.732,amplitude:1.13,hz:6,seed:7331},
];
class SpectralBand {
 constructor(config){
  Object.assign(this,config);this.cos=Math.cos(this.angle);this.sin=Math.sin(this.angle);
  this.frames=[new Float32Array(N*N),new Float32Array(N*N)];this.imag=new Float32Array(N*N);
  this.orbitalGain=1.65*Math.sqrt(TILE_METRES/this.metres);
  this.frame=-Infinity;this.time=0;this.version=0;
 }
 setWind(speed,heading){
  this.speed=speed;this.frame=-Infinity;
  const angle=heading*Math.PI/180-this.angle, wx=Math.cos(angle),wz=Math.sin(angle),L=speed*speed/9.81;
  this.modes=[];let energy=0,seed=this.seed;
  const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+.5)/4294967296;
  // Sample one half-plane, add its conjugate explicitly, and use deep-water dispersion.
  for(let iz=0;iz<N/2;iz++)for(let ix=1-N/2;ix<N/2;ix++){
   if(!iz&&ix<=0)continue;
   const k=TAU/this.metres*Math.hypot(ix,iz),aligned=(ix*wx+iz*wz)/Math.hypot(ix,iz);
   const a=Math.sqrt(-2*Math.log(random()))*Math.exp(-.5/(k*k*L*L)-.07*k*k)*aligned*aligned/(k*k);
   const phase=TAU*random(),omega=Math.sqrt(9.81*k)*(aligned>=0?-1:1);
   this.modes.push({a,phase,omega,index:wrap(ix)+N*iz,mirror:wrap(-ix)+N*wrap(-iz)});
   energy+=2*a*a;
  }
  const rms=.0028*speed*speed/(1+(speed/21)**3)**(2/3)*this.amplitude;
  for(const m of this.modes)m.a=energy>1e-20?m.a*rms/Math.sqrt(energy):0;
  this.sampleTime(this.time);
 }
 fill(out,time){
  out.fill(0);this.imag.fill(0);
  if(!this.speed)return;
  for(const {a,phase,omega,index,mirror} of this.modes){
   const t=phase+omega*time,r=a*Math.cos(t),i=a*Math.sin(t);
   out[index]=out[mirror]=r;this.imag[index]=i;this.imag[mirror]=-i;
  }
  for(let i=0;i<N;i++)inverseLine(out,this.imag,N*i,1);
  for(let i=0;i<N;i++)inverseLine(out,this.imag,i,N);
 }
 sampleTime(t){
  this.time=t;const frame=Math.floor(t*this.hz);this.mix=t*this.hz-frame;
  if(frame===this.frame||(!this.speed&&Number.isFinite(this.frame)))return;
  if(frame===this.frame+1)this.frames.reverse();else this.fill(this.frames[0],frame/this.hz);
  this.fill(this.frames[1],(frame+1)/this.hz);this.frame=frame;this.version++;
 }
 sample(x,z,flow){
  const cell=this.metres/N;
  const gx=(this.cos*x+this.sin*z)/cell,gz=(-this.sin*x+this.cos*z)/cell,i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j;
  const a=wrap(i),b=wrap(i+1),c=N*wrap(j),d=N*wrap(j+1);
  const interp=h=>(h[a+c]*(1-u)+h[b+c]*u)*(1-v)+(h[a+d]*(1-u)+h[b+d]*u)*v;
  const first=interp(this.frames[0]),last=interp(this.frames[1]);
  const height=first+(last-first)*this.mix;
  if(flow)flow.y+=(last-first)*this.hz;
  return height;
 }
}

export const MAX_PARCELS=96;
export function scoopProfile(r,time){
 // A spreading depression of fixed integral. Its deficit decreases as the lifted water returns.
 const width2=.44**2+.8*(time-r.t)**2;
 return {width2,depth:3*r.volume/(Math.PI*width2)};
}
export class WindSea {
 constructor(speed=0,heading=0,turbulence=0){
  this.bands=WAVE_BANDS.map(b=>new SpectralBand(b));
  this.whitewater=new Whitewater();this.organicLoad=0;this.crests=[];this.ripples=[];this.drops=[];this.serial=0;this.breakTick=-1;this.time=0;this.setWind(speed,heading,turbulence);
 }
 setWind(speed,heading,turbulence=0){
  const meanChanged=this.speed!==speed||this.heading!==heading;
  this.speed=speed;this.heading=heading;this.turbulence=turbulence;
  this.wx=Math.cos(heading*Math.PI/180);this.wz=Math.sin(heading*Math.PI/180);
  if(meanChanged)for(const band of this.bands)band.setWind(speed,heading);
  this.updateAir();
 }
 updateAir(){
  const air=windAt(this,this.time,0,0,this.gust??={}),angle=air.heading*Math.PI/180;
  this.airX=air.speed*Math.cos(angle);this.airZ=air.speed*Math.sin(angle);
 }
 sampleTime(t){
  this.time=t;this.updateAir();for(const band of this.bands)band.sampleTime(t);
  for(const c of this.crests)c.frame=crestFrame(c,t-c.t);
 }
 bulk(x,z){
  let h=0;for(const band of this.bands)h+=band.sample(x,z);return h;
 }
 flow(x,z){
  const flow={x:0,y:0,z:0};let along=0;
  for(const band of this.bands)along+=band.sample(x,z,flow)*band.orbitalGain;
  flow.x=this.wx*along;flow.z=this.wz*along;return flow;
 }
 height(x,z){let y=this.baseHeight(x,z);for(const c of this.crests)y+=crestLevel(c,x,z);return y;}
 baseHeight(x,z){
  let y=this.bulk(x,z);
  for(const p of this.ripples){const dist=Math.hypot(x-p.x,z-p.z),age=this.time-p.t,q=dist-2*age;
   if(p.scoop){const {width2,depth}=scoopProfile(p,this.time);y-=depth*Math.max(0,1-dist*dist/width2)**2;continue;}
   y+=p.a*Math.cos(6*q)*Math.exp(-3*q*q-1.3*age-dist*p.attenuation);}
  return y;
 }
 ripple(x,z,a,scoop=false,reach=LOCAL_IMPULSE_REACH){
  if(this.ripples.length>=12){
   const oldestWave=this.ripples.findIndex(p=>!p.scoop||p.volume<=1e-8);
   if(oldestWave<0&&!scoop)return;
   this.ripples.splice(Math.max(0,oldestWave),1);
  }
  const ring={x,z,t:this.time,a,scoop,attenuation:1/reach,volume:0};this.ripples.push(ring);return ring;
 }
 reset(){
  this.mergedVolume=0;
  this.crests.length=0;this.whitewater.reset();this.release();this.breakTick=-1;this.serial=0;this.ripples.length=0;this.drops.length=0;this.sampleTime(0);
 }
 appendDrop(drop){
  if(this.drops.length>=MAX_PARCELS){
   const index=this.drops.findIndex(p=>!p.held);
   if(index<0)return;
   this.returnDrop(this.drops[index]);this.drops.splice(index,1);
  }
  this.drops.push(drop);
 }
 random(){
  const a=Math.sin(++this.serial*127.1)*43758.5453;
  return a-Math.floor(a);
 }
 splash(x,z,strength=1,dx=0,dz=0,reach=LOCAL_IMPULSE_REACH){
  const y=this.height(x,z);this.ripple(x,z,.14*Math.min(1.8,strength),false,reach);
  for(let i=0;i<8;i++){
   const a=this.random()*TAU,spread=(.16+.7*this.random())*Math.sqrt(strength);
   const vx=spread*Math.cos(a)+dx,vz=spread*Math.sin(a)+dz;
   this.appendDrop({x:x+vx*.018,y:y+.035,z:z+vz*.018,vx,vz,
    vy:(1.35+2*this.random())*Math.sqrt(strength),r:(.029+.058*this.random())*Math.sqrt(strength),foam:.25});
  }
 }
 breakCrest(x,z,energy,dx,dz,windCrest=false,radius=Infinity){
  if(this.bedHeight&&this.bedHeight(x,z)>=this.height(x,z))return;
  const norm=Math.hypot(dx,dz);if(norm<.01||energy<=0||this.crests.length>=16)return;
  dx/=norm;dz/=norm;
  const width=Math.min(.74,.12+energy*.23,radius*.63);
  if(width<.035)return;
  const span=Math.min(width*(windCrest?5.3:3.5),radius*1.35);
  // Several contacts on the same front reinforce one rolling wave.
  if(this.crests.some(c=>{
   const rx=x-c.frame.x,rz=z-c.frame.z;
   return c.dx*dx+c.dz*dz>.25&&Math.abs(rx*dx+rz*dz)<(width+c.width)*.9&&Math.abs(rz*dx-rx*dz)<.8*(span+c.span);
  }))return;
  const speed=Math.min(3.2,Math.sqrt(9.81*width)*(.7+.14*energy));
  const c={x,z,dx,dz,t:this.time,width,speed,span,skew:(this.random()-.5)*.28,curvature:.24,travelSpeed:speed*.46,
   phase:this.random()*TAU,windCrest,duration:.66+.22*Math.sqrt(width)+.12*this.random(),emitted:-1};
  if(windCrest){
   // Follow the existing spectral ridge on both sides of the breaking point.
   // Its path and phase speed come from the water which is already moving here.
   const ridge=s=>{
    const px=x-dz*span*s,pz=z+dx*span*s;
    const back=this.bulk(px-dx*cell,pz-dz*cell),mid=this.bulk(px,pz),front=this.bulk(px+dx*cell,pz+dz*cell);
    return Math.max(-.54,Math.min(.54,(front-back)*cell/(2*Math.max(.04,2*mid-front-back)*width)));
   };
   const left=ridge(-1),right=ridge(1);
   c.curvature=(left+right)*.5;c.skew=(right-left)*.5;
   const slope=(this.bulk(x,z)-this.bulk(x+dx*cell,z+dz*cell))/cell;
   const rise=this.flow(x+.6*dx*cell,z+.6*dz*cell).y;
   c.travelSpeed=Math.max(.5,Math.min(6,rise/Math.max(.08,slope)));
  }
  c.frame=crestFrame(c,0);this.crests.push(c);
  // The root is a contact marker. The visible lip is a single continuous surface.
  this.appendDrop({x,y:this.height(x,z)-.03,z,vx:0,vy:0,vz:0,r:.02,crest:c,u:0,lateral:0,windCrest});
 }
 advanceBreakers(){
  const tick=Math.floor(this.time*8);if(this.breakTick===tick)return;this.breakTick=tick;
  if(this.speed<7)return;
  // Wind searches a physical patch independently of tool and contact events.
  const threshold=.13/(1+.23*this.turbulence*Math.sin(this.time*1.31));
  let best=threshold,bx=0,bz=0,sideSlope=0;
  for(let j=0;j<24;j++){
   const index=(tick*73+j*137)%(N*N);
   const x=(index%N-N/2+((tick*31+j*13)%53)/53)*cell*1.6;
   const z=(Math.floor(index/N)-N/2+((tick*23+j*29)%61)/61)*cell*1.6;
   const crest=this.bulk(x,z),front=this.bulk(x+this.wx*cell,z+this.wz*cell);
   const back=this.bulk(x-this.wx*cell,z-this.wz*cell);
   const steepness=(crest-front)/cell;
   if(crest>0&&crest>=back&&steepness>best){
    const peak=cell*.5*(front-back)/Math.max(.001,2*crest-front-back);
    best=steepness;bx=x+peak*this.wx;bz=z+peak*this.wz;
    sideSlope=(this.bulk(x-this.wz*cell,z+this.wx*cell)-this.bulk(x+this.wz*cell,z-this.wx*cell))/(2*cell);}
  }
  if(best>threshold)this.breakCrest(bx,bz,Math.min(2.5,best*4),this.wx*best+this.wz*sideSlope,this.wz*best-this.wx*sideSlope,true);
 }
 returnDrop(d){
  if(d.scoop){d.scoop.volume=Math.max(0,d.scoop.volume-4*Math.PI*d.r**3/3);d.scoop=null;}
 }
 lift(x,z){
  this.release();const y=this.height(x,z),scoop=this.ripple(x,z,0,true);
  this.held=[];this.grip={x,y,z,t:this.time,vx:0,vy:0,vz:0};
  for(let i=0;i<10;i++){
   const a=i*2.3999632,r=.070*Math.sqrt(i),offset=[Math.cos(a)*r,.06*Math.sin(a),Math.sin(a)*r];
   const drop={x:x+offset[0],y:y+offset[1],z:z+offset[2],r:.105+.053*this.random(),vx:0,vy:0,vz:0,held:true};
   drop.scoop=scoop;scoop.volume+=4*Math.PI*drop.r**3/3;
   this.held.push({drop,offset});this.appendDrop(drop);
  }
 }
 moveLift(p,collide){
  if(!this.held)return;
  const g=this.grip,dt=Math.max(1/60,this.time-g.t);
  for(const axis of ['x','y','z'])g['v'+axis]=Math.max(-3,Math.min(3,(p[axis]-g[axis])/dt));
  Object.assign(g,{x:p.x,y:p.y,z:p.z,t:this.time});
  for(const {drop,offset} of this.held){
   const from={x:drop.x,y:drop.y,z:drop.z},lag=(.16-drop.r)*.46;
   drop.x=p.x+offset[0]-g.vx*lag;drop.y=p.y+offset[1]-g.vy*lag;drop.z=p.z+offset[2]-g.vz*lag;collide?.(drop,from);
  }
 }
 release(){
  for(const {drop} of this.held||[]){drop.held=false;drop.vx=this.grip.vx;drop.vy=this.grip.vy;drop.vz=this.grip.vz;}
  this.held=null;this.grip=null;
 }
 advance(dt,collide){
  this.sampleTime(this.time+dt);
  this.advanceBreakers();
  for(let k=this.crests.length-1;k>=0;k--){
   const c=this.crests[k],age=this.time-c.t;
   if(age>=c.duration){this.crests.splice(k,1);continue;}
   const emission=Math.floor(age/(.063+.015*Math.cos(c.phase)));
   if(emission!==c.emitted){c.emitted=emission;this.whitewater.emit(this,c,age);}
  }
  this.whitewater.advance(this,dt);
  this.ripples=this.ripples.filter(p=>p.scoop?p.volume>1e-8&&scoopProfile(p,this.time).depth>.0002:this.time-p.t<3);
  if(this.held){
   const relax=1-Math.exp(-12*dt),g=this.grip;
   for(const axis of ['vx','vy','vz'])g[axis]*=1-relax;
   for(const {drop,offset} of this.held){
    const from={x:drop.x,y:drop.y,z:drop.z};
    drop.x+=(g.x+offset[0]-drop.x)*relax;drop.y+=(g.y+offset[1]-drop.y)*relax;drop.z+=(g.z+offset[2]-drop.z)*relax;collide?.(drop,from);
   }
  }
  for(let i=this.drops.length-1;i>=0;i--){
   const d=this.drops[i];
   if(d.held)continue;
   if(d.crest){
    const c=d.crest,age=this.time-c.t;
    if(age<c.duration*.57){const p=lipPoint(c,0,0,age);d.x=p.x;d.z=p.z;d.y=this.height(p.x,p.z)-.03;continue;}
    // A single irregular liquid fragment can peel away behind the thinner spray.
    const p=lipPoint(c,.45*Math.sin(c.phase),.70,age);
    d.x=p.x;d.z=p.z;d.y=this.baseHeight(p.baseX,p.baseZ)+p.y;d.r=Math.min(.055,c.width*.09)*(.6+.65*this.random());
    d.vx=c.dx*c.speed;d.vz=c.dz*c.speed;d.vy=c.speed*1.15;d.foam=.28;d.crest=null;
   }
   const drag=1-Math.exp(-dt*.009*this.speed/Math.max(.05,d.r));
   d.vx+=(this.airX*.26-d.vx)*drag;d.vz+=(this.airZ*.26-d.vz)*drag;
   const from=collide?{x:d.x,y:d.y,z:d.z}:null;
   d.vy-=9.81*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;
   if(from)collide(d,from);
   if(this.bedHeight&&d.vy<0&&d.y-d.r<=this.bedHeight(d.x,d.z)&&this.bedHeight(d.x,d.z)>this.height(d.x,d.z)){this.drops.splice(i,1);this.returnDrop(d);continue;}
   if(d.vy<0&&d.y+d.r<=this.height(d.x,d.z)){this.returnDrop(d);this.drops.splice(i,1);if(d.r>.065&&!d.windCrest&&i%3===0)this.ripple(d.x,d.z,Math.min(.023,d.r*.12));}
  }
 }
}
