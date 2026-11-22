// Bed stores metres of loose material above the reference substrate. Airborne
// load uses the same units per cell, so transfers conserve volume exactly.
export const SAND_SIDE=32,SAND_METRES=12,SAND_CAP=320;
const N=SAND_SIDE,CELL=SAND_METRES/N,BASE=.34;
const index=(x,z)=>(x%N+N)%N+N*((z%N+N)%N);
const wrap=x=>x-Math.floor(x/SAND_METRES)*SAND_METRES;
export function entrainment(m){return 4.3*Math.sqrt(m.density/1600)+m.moisture*32+Math.sqrt(m.cohesion+m.adhesion)*.25;}
export function repose(m){return Math.min(2.2,.22+.65*m.friction+.55*m.moisture+.003*Math.sqrt(m.cohesion));}
export function launchGrain(x,y,z,load,wind,wx,wz,excess,random){
 const noise=random(),cross=(random()-.5)*.6,along=wind.speed*(.045+.09*noise);
 return {x,y:y+.013,z,load,r:.009+.011*noise,vx:along*wx-cross*wz,
  vz:along*wz+cross*wx,vy:.4+Math.sqrt(excess)*(.25+.22*random())};
}
export function driftGrain(g,dt,wind,wx,wz){
 const drag=1-Math.exp(-2.7*dt);
 g.vx+=(wx*.19*wind.speed-g.vx)*drag;g.vz+=(wz*.19*wind.speed-g.vz)*drag;
 g.x+=g.vx*dt;g.z+=g.vz*dt;g.y+=g.vy*dt-4.905*dt*dt;g.vy-=9.81*dt;
}
export class WindSand{
 constructor(landscape=null){this.landscape=landscape;this.reset();}
 reset(){
  this.bed=new Float64Array(N*N);this.substrate=new Float64Array(N*N);this.delta=new Float64Array(N*N);
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){
   const a=2*Math.PI*x/N,b=2*Math.PI*z/N;
   const rough=Math.sin(2*a+b+.7*Math.cos(2*b))*.55+.32*Math.cos(a-2*b)+.13*Math.sin(5*a-3*b);
   this.substrate[index(x,z)]=rough;
   this.bed[index(x,z)]=BASE+.011*rough;
  }
  this.grains=[];this.credit=0;this.seed=1733;this.version=0;this.clock=0;
 }
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 height(x,z){return this.driftHeight(x,z)+(this.landscape?.height(x,z)??0);}
 driftHeight(x,z){
  const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,h=this.bed;
  return (1-b)*((1-a)*h[index(i,j)]+a*h[index(i+1,j)])+b*((1-a)*h[index(i,j+1)]+a*h[index(i+1,j+1)])-BASE;
 }
 transfer(windX,windZ,excess,mat,dt){
  const h=this.bed,d=this.delta;d.fill(0);
  const sx=Math.sign(windX),sz=Math.sign(windZ),limit=repose(mat)*CELL;
  const strength=Math.min(.16,excess*.0022)*dt;
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){
   const i=index(x,z),downX=index(x+sx,z),downZ=index(x,z+sz);
   const upX=index(x-sx,z),upZ=index(x,z-sz);
   const shelter=((h[upX]-h[downX])*Math.abs(windX)+(h[upZ]-h[downZ])*Math.abs(windZ))/(2*CELL);
   // Exposed windward faces supply a longer saltation flux. Sheltered lee
   // faces trap incoming grains. Small bed variations seed migrating ridges.
   const exposed=Math.max(.08,Math.min(2.5,1+.86*this.substrate[i]-.50*shelter));
   const amount=Math.min(h[i]*.18,strength*exposed*h[i]/BASE);
   const norm=Math.abs(windX)+Math.abs(windZ)||1;
   d[i]-=amount;d[downX]+=amount*Math.abs(windX)/norm;d[downZ]+=amount*Math.abs(windZ)/norm;
   for(const j of [index(x+1,z),index(x,z+1)]){
    const diff=h[i]-h[j],slip=Math.sign(diff)*Math.max(0,Math.abs(diff)-limit)*.12+diff*Math.min(.035,excess*dt*.006);
    d[i]-=slip;d[j]+=slip;
   }
  }
  for(let i=0;i<h.length;i++)h[i]+=d[i];this.version++;
 }
 advance(dt,wind,material){
  if(dt<=0)return;
  const angle=wind.heading*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle);
  const excess=Math.min(70,Math.max(0,wind.speed-entrainment(material)));
  this.clock+=dt;
  if(this.clock>=.08){if(excess||this.grains.length)this.transfer(wx,wz,excess,material,Math.min(.15,this.clock));this.clock%=.08;}
  this.credit=excess?Math.min(24,this.credit+dt*excess*11):0;
  for(let i=this.grains.length-1;i>=0;i--){
   const g=this.grains[i];driftGrain(g,dt,wind,wx,wz);g.x=wrap(g.x);g.z=wrap(g.z);
   if(g.y<=this.driftHeight(g.x,g.z)){this.bed[index(Math.round(g.x/CELL),Math.round(g.z/CELL))]+=g.load;this.grains.splice(i,1);this.version++;}
  }
  while(this.credit>=1&&this.grains.length<SAND_CAP){
   this.credit--;const x=this.random()*SAND_METRES,z=this.random()*SAND_METRES,i=index(Math.round(x/CELL),Math.round(z/CELL));
   const noise=this.random(),load=Math.min(this.bed[i],.0008+.002*noise);if(load<=0)continue;
   this.bed[i]-=load;this.version++;
   this.grains.push(launchGrain(x,this.driftHeight(x,z),z,load,wind,wx,wz,excess,()=>this.random()));
  }
 }
}
