// A periodic deep-water wind sea. Authoring units are metres and seconds.
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

export class WindSea {
 constructor(speed=0,heading=0) {
  this.frames=[new Float32Array(N*N),new Float32Array(N*N)];
  this.imag=new Float32Array(N*N);this.frame=-Infinity;this.version=0;
  this.ripples=[];this.drops=[];this.serial=0;this.time=0;this.setWind(speed,heading);
 }
 setWind(speed,heading){
  if(this.speed===speed&&this.heading===heading)return;
  this.speed=speed;this.heading=heading;this.frame=-Infinity;
  const angle=heading*Math.PI/180, wx=Math.cos(angle),wz=Math.sin(angle),L=speed*speed/9.81;
  this.modes=[];let energy=0,seed=1701;
  const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+.5)/4294967296;
  // Sample one half-plane, add its conjugate explicitly, and use deep-water dispersion.
  for(let iz=0;iz<N/2;iz++)for(let ix=1-N/2;ix<N/2;ix++){
   if(!iz&&ix<=0)continue;
   const k=TAU/TILE_METRES*Math.hypot(ix,iz),aligned=(ix*wx+iz*wz)/Math.hypot(ix,iz);
   const a=Math.sqrt(-2*Math.log(random()))*Math.exp(-.5/(k*k*L*L)-.07*k*k)*aligned*aligned/(k*k);
   const phase=TAU*random(),omega=Math.sqrt(9.81*k)*(aligned>=0?-1:1);
   this.modes.push({a,phase,omega,index:wrap(ix)+N*iz,mirror:wrap(-ix)+N*wrap(-iz)});
   energy+=2*a*a;
  }
  const rms=Math.min(.8,.0028*speed*speed);
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
  this.time=t;const frame=Math.floor(t*WAVE_HZ);this.mix=t*WAVE_HZ-frame;
  if(frame===this.frame)return;
  if(frame===this.frame+1)this.frames.reverse();else this.fill(this.frames[0],frame/WAVE_HZ);
  this.fill(this.frames[1],(frame+1)/WAVE_HZ);this.frame=frame;this.version++;
 }
 height(x,z){
  const gx=x/cell,gz=z/cell,i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j;
  const a=wrap(i),b=wrap(i+1),c=N*wrap(j),d=N*wrap(j+1);
  const interp=h=>(h[a+c]*(1-u)+h[b+c]*u)*(1-v)+(h[a+d]*(1-u)+h[b+d]*u)*v;
  let y=interp(this.frames[0])*(1-this.mix)+interp(this.frames[1])*this.mix;
  for(const p of this.ripples){const dist=Math.hypot(x-p.x,z-p.z),age=this.time-p.t,q=dist-2*age;
   y+=p.a*Math.cos(6*q)*Math.exp(-3*q*q-1.3*age);}
  return y;
 }
 ripple(x,z,a){
  if(this.ripples.length>=12)this.ripples.shift();
  this.ripples.push({x,z,t:this.time,a});
 }
 reset(){
  this.release();this.ripples.length=0;this.drops.length=0;this.sampleTime(0);
 }
 appendDrop(drop){
  if(this.drops.length>=96)this.drops.splice(this.drops.findIndex(p=>!p.held),1);
  this.drops.push(drop);
 }
 splash(x,z){
  this.ripple(x,z,.14);
  const y=this.height(x,z);
  for(let i=0;i<8;i++){
   const angle=++this.serial*2.3999632,spread=.4+.9*(i%4)/3;
   this.appendDrop({x,y:y+.025,z,vx:spread*Math.cos(angle),vz:spread*Math.sin(angle),vy:1.6+i*.19,r:.035+i*.004});
  }
 }
 lift(x,z){
  this.release();const y=this.height(x,z);this.ripple(x,z,-.15);
  this.held=[];
  for(let i=0;i<10;i++){
   const a=i*2.3999632,r=.038*Math.sqrt(i),offset=[Math.cos(a)*r,.05*Math.sin(a),Math.sin(a)*r];
   const drop={x:x+offset[0],y:y+offset[1],z:z+offset[2],r:.075,vx:0,vy:0,vz:0,held:true};
   this.held.push({drop,offset});this.appendDrop(drop);
  }
 }
 moveLift(p){for(const {drop,offset} of this.held||[]){drop.x=p.x+offset[0];drop.y=p.y+offset[1];drop.z=p.z+offset[2];}}
 release(){for(const {drop} of this.held||[])drop.held=false;this.held=null;}
 advance(dt){
  this.sampleTime(this.time+dt);
  this.ripples=this.ripples.filter(p=>this.time-p.t<3);
  for(let i=this.drops.length-1;i>=0;i--){
   const d=this.drops[i];if(d.held)continue;d.vy-=9.81*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;
   if(d.vy<0&&d.y<=this.height(d.x,d.z)){this.drops.splice(i,1);if(i%3===0)this.ripple(d.x,d.z,.022);}
  }
 }
}
