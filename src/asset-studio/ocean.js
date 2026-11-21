import {Whitewater,lipPoint} from './whitewater.js';
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
export class WindSea {
 constructor(speed=0,heading=0){
  this.bands=WAVE_BANDS.map(b=>new SpectralBand(b));
  this.whitewater=new Whitewater();this.organicLoad=0;this.crests=[];this.ripples=[];this.drops=[];this.serial=0;this.breakTick=-1;this.time=0;this.setWind(speed,heading);
 }
 setWind(speed,heading){
  if(this.speed===speed&&this.heading===heading)return;
  this.speed=speed;this.heading=heading;this.wx=Math.cos(heading*Math.PI/180);this.wz=Math.sin(heading*Math.PI/180);
  for(const band of this.bands)band.setWind(speed,heading);
 }
 sampleTime(t){this.time=t;for(const band of this.bands)band.sampleTime(t);}
 bulk(x,z){
  let h=0;for(const band of this.bands)h+=band.sample(x,z);return h;
 }
 flow(x,z){
  const flow={x:0,y:0,z:0};let along=0;
  for(const band of this.bands)along+=band.sample(x,z,flow)*band.orbitalGain;
  flow.x=this.wx*along;flow.z=this.wz*along;return flow;
 }
 height(x,z){
  let y=this.bulk(x,z);
  for(const p of this.ripples){const dist=Math.hypot(x-p.x,z-p.z),age=this.time-p.t,q=dist-2*age;
   y+=p.a*Math.cos(6*q)*Math.exp(-3*q*q-1.3*age);}
  return y;
 }
 ripple(x,z,a){
  if(this.ripples.length>=12)this.ripples.shift();
  this.ripples.push({x,z,t:this.time,a});
 }
 reset(){
  this.mergedVolume=0;
  this.crests.length=0;this.whitewater.reset();this.release();this.breakTick=-1;this.serial=0;this.ripples.length=0;this.drops.length=0;this.sampleTime(0);
 }
 appendDrop(drop){
  if(this.drops.length>=MAX_PARCELS){
   const index=this.drops.findIndex(p=>!p.held);
   if(index<0)return;
   this.drops.splice(index,1);
  }
  this.drops.push(drop);
 }
 random(){
  const a=Math.sin(++this.serial*127.1)*43758.5453;
  return a-Math.floor(a);
 }
 splash(x,z,strength=1,dx=0,dz=0){
  const y=this.height(x,z);this.ripple(x,z,.14*Math.min(1.8,strength));
  for(let i=0;i<8;i++){
   const a=this.random()*TAU,spread=(.22+.95*this.random())*strength;
   const vx=spread*Math.cos(a)+dx,vz=spread*Math.sin(a)+dz;
   this.appendDrop({x:x+vx*.018,y:y+.035,z:z+vz*.018,vx,vz,
    vy:(1.35+2*this.random())*Math.sqrt(strength),r:(.029+.058*this.random())*Math.sqrt(strength),foam:.25});
  }
 }
 breakCrest(x,z,energy,dx,dz,windCrest=false){
  const width=Math.min(.9,.35+energy*.2),speed=Math.min(4,1+energy);
  const c={x,z,dx,dz,t:this.time,width,speed,span:width*(1.7+1.9*this.random()),
   phase:this.random()*TAU,windCrest,duration:.46+.15*this.random()+.055*energy,emitted:-1};
  if(this.crests.length>=16)this.crests.shift();
  this.crests.push(c);
  // The root is a contact marker. The visible lip is a single continuous surface.
  this.appendDrop({x,y:this.height(x,z)-.03,z,vx:0,vy:0,vz:0,r:.02,crest:c,u:0,lateral:0,windCrest});
 }
 advanceBreakers(){
  const tick=Math.floor(this.time*8);if(this.breakTick===tick)return;this.breakTick=tick;
  if(this.speed<7)return;
  // Sample an interleaved set of physical grid cells around the studio origin and recent interactions.
  let best=.105,bx=0,bz=0;
  for(let j=0;j<24;j++){
   const index=(tick*73+j*137)%(N*N),origin=j%2?this.ripples.at(-1):null;
   const x=(origin?.x??0)+(index%N-N/2+this.random())*cell*1.6;
   const z=(origin?.z??0)+(Math.floor(index/N)-N/2+this.random())*cell*1.6;
   const crest=this.bulk(x,z),front=this.bulk(x+this.wx*cell,z+this.wz*cell);
   const back=this.bulk(x-this.wx*cell,z-this.wz*cell);
   const steepness=(crest-front)/cell;
   if(crest>0&&2*crest>front+back&&steepness>best){best=steepness;bx=x;bz=z;}
  }
  if(best>.105)this.breakCrest(bx,bz,Math.min(2.5,best*4),this.wx,this.wz,true);
 }
 lift(x,z){
  this.release();const y=this.height(x,z);this.ripple(x,z,-.15);
  this.held=[];this.grip={x,y,z,t:this.time,vx:0,vy:0,vz:0};
  for(let i=0;i<10;i++){
   const a=i*2.3999632,r=.070*Math.sqrt(i),offset=[Math.cos(a)*r,.06*Math.sin(a),Math.sin(a)*r];
   const drop={x:x+offset[0],y:y+offset[1],z:z+offset[2],r:.105+.053*this.random(),vx:0,vy:0,vz:0,held:true};
   this.held.push({drop,offset});this.appendDrop(drop);
  }
 }
 moveLift(p){
  if(!this.held)return;
  const g=this.grip,dt=Math.max(1/60,this.time-g.t);
  for(const axis of ['x','y','z'])g['v'+axis]=Math.max(-3,Math.min(3,(p[axis]-g[axis])/dt));
  Object.assign(g,{x:p.x,y:p.y,z:p.z,t:this.time});
  for(const {drop,offset} of this.held){
   const lag=(.16-drop.r)*.46;
   drop.x=p.x+offset[0]-g.vx*lag;drop.y=p.y+offset[1]-g.vy*lag;drop.z=p.z+offset[2]-g.vz*lag;
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
  this.ripples=this.ripples.filter(p=>this.time-p.t<3);
  if(this.held){
   const relax=1-Math.exp(-12*dt),g=this.grip;
   for(const axis of ['vx','vy','vz'])g[axis]*=1-relax;
   for(const {drop,offset} of this.held){
    drop.x+=(g.x+offset[0]-drop.x)*relax;drop.y+=(g.y+offset[1]-drop.y)*relax;drop.z+=(g.z+offset[2]-drop.z)*relax;
   }
  }
  for(let i=this.drops.length-1;i>=0;i--){
   const d=this.drops[i];
   if(d.held)continue;
   if(d.crest){
    const c=d.crest,age=this.time-c.t;
    if(age<c.duration){const p=lipPoint(c,0,0,age);d.x=p.x;d.z=p.z;d.y=this.height(p.x,p.z)-.03;continue;}
    // A single irregular liquid fragment can peel away behind the thinner spray.
    const p=lipPoint(c,.62*Math.sin(c.phase),.84,c.duration*.7);
    d.x=p.x;d.z=p.z;d.y=this.height(p.x,p.z)+Math.max(.04,p.y);d.r=.022+.035*this.random();
    d.vx=c.dx*c.speed;d.vz=c.dz*c.speed;d.vy=c.speed*1.15;d.foam=.28;d.crest=null;
   }
   const drag=1-Math.exp(-dt*.009*this.speed/Math.max(.05,d.r));
   d.vx+=(this.speed*.26*this.wx-d.vx)*drag;d.vz+=(this.speed*.26*this.wz-d.vz)*drag;
   if(collide&&!d.windCrest&&!d.previous)d.previous={x:d.x,y:d.y,z:d.z,t:this.time};
   d.vy-=9.81*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;
   if(collide&&d.previous&&this.time-d.previous.t>=1/30){
    collide(d,d.previous);d.previous=null;
   }
   if(d.vy<0&&d.y+d.r<=this.height(d.x,d.z)){this.drops.splice(i,1);if(!d.windCrest&&i%3===0)this.ripple(d.x,d.z,.022);}
  }
 }
}
