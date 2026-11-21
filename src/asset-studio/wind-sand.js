// Mobile skin of an otherwise solid granular ground. Each airborne packet carries
// the exact bed volume debited at take-off, including across periodic boundaries.
export const SAND_SIDE=24,SAND_METRES=12,SAND_CAP=320;
const cells=SAND_SIDE*SAND_SIDE,wrap=x=>x-Math.floor(x/SAND_METRES)*SAND_METRES;
const cell=(x,z)=>Math.floor(wrap(x)*SAND_SIDE/SAND_METRES)+SAND_SIDE*Math.floor(wrap(z)*SAND_SIDE/SAND_METRES);
export class WindSand{
 constructor(){this.reset();}
 reset(){this.bed=new Float32Array(cells).fill(.012);this.grains=[];this.credit=0;this.seed=1733;this.version=0;}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 advance(dt,wind,material){
  if(dt<=0)return;
  const angle=wind.heading*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle);
  const threshold=4.3*Math.sqrt(material.density/1600)+material.moisture*32+Math.sqrt(material.cohesion+material.adhesion)*.25;
  const excess=Math.min(55,Math.max(0,wind.speed-threshold));
  this.credit=excess?Math.min(24,this.credit+dt*excess*11):0;
  for(let i=this.grains.length-1;i>=0;i--){
   const g=this.grains[i],drag=1-Math.exp(-2.7*dt);
   g.vx+=(wx*.19*wind.speed-g.vx)*drag;g.vz+=(wz*.19*wind.speed-g.vz)*drag;
   g.x=wrap(g.x+g.vx*dt);g.z=wrap(g.z+g.vz*dt);g.y+=g.vy*dt-4.905*dt*dt;g.vy-=9.81*dt;
   if(g.y<=0){this.bed[cell(g.x,g.z)]+=g.load;this.grains.splice(i,1);this.version++;}
  }
  while(this.credit>=1&&this.grains.length<SAND_CAP){
   this.credit--;const x=this.random()*SAND_METRES,z=this.random()*SAND_METRES,idx=cell(x,z);
   const noise=this.random(),load=Math.min(this.bed[idx],.00025+.0005*noise);if(!load)continue;
   const cross=(this.random()-.5)*.6,along=wind.speed*(.045+.09*noise);
   this.bed[idx]-=load;this.version++;this.grains.push({x,y:.012,z,load,r:.009+.011*noise,
    vx:along*wx-cross*wz,vz:along*wz+cross*wx,vy:.4+Math.sqrt(excess)*(.25+.22*this.random())});
  }
 }
}
