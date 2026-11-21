import {lipPoint} from './breaking-wave.js';
export {lipPoint} from './breaking-wave.js';
// Positions and velocities use world metres. Crests own the initial curved
// filament, detached spray is ballistic, and organic foam follows surface flow.
const capacity={foam:152,spray:136,whitewater:96};
export class Whitewater{
 constructor(){this.particles=[];this.clock=0;this.count={foam:0,whitewater:0,spray:0};}
 spawn(kind,x,y,z,velocity,size,life,crest,random){
  this.reserve(kind);this.count[kind]++;

  this.particles.push({kind,x,y,z,...velocity,size,life,age:0,windCrest:!!crest.windCrest,
   dx:crest.dx,dz:crest.dz,aspect:1.2+random()*2,phase:random()*6.28});
 }
 reserve(kind){
  if(this.count[kind]<capacity[kind])return;
  const i=this.particles.findIndex(p=>p.kind===kind);
  if(i>=0){this.particles.splice(i,1);this.count[kind]--;}
 }
 reset(){this.particles.length=0;this.clock=0;this.count={foam:0,whitewater:0,spray:0};}
 emit(sea,c,age){
  const random=()=>sea.random(),life=age/c.duration;
  if(life<.22||life>.84)return;
  const count=Math.max(1,Math.min(4,Math.ceil(c.span*2)));
  for(let i=0;i<count;i++){
   const s=(random()+random()-1)*.96,pt=lipPoint(c,s,.68+.10*random(),age);
   if(pt.compression<.28)continue;
   const scale=Math.sqrt(Math.min(.5,c.width));
   const x=pt.x,z=pt.z,y=sea.baseHeight(pt.baseX,pt.baseZ)+pt.y;
   const sideways=(random()-.5)*c.speed*.8;
   this.spawn('spray',x,y,z,{vx:c.dx*c.speed-c.dz*sideways,vy:c.speed*(.55+random()),vz:c.dz*c.speed+c.dx*sideways},
    scale*(.012+.023*random()**2),.7+random()*.45,c,random);
   this.spawn('whitewater',x,y,z,{vx:c.dx*.45,vy:0,vz:c.dz*.45},scale*(.027+.048*random()),.55+random()*.85,c,random);
   if(random()<sea.organicLoad*(.24+.22*life)){
    const radius=scale*(.031+.046*random()),life=3+sea.organicLoad*(4+7*random());
    for(let j=-1;j<=1;j++){
     const f=lipPoint(c,Math.max(-1,Math.min(1,s+j*radius*2.2/c.span)),.95,age);
     this.spawn('foam',f.x,y,f.z,{vx:0,vy:0,vz:0},radius*(1-.2*Math.abs(j)),life*(.9+.1*random()),c,random);
    }
   }
  }
 }
 advance(sea,dt){
  this.clock+=dt;if(this.clock+1e-8<1/60)return;dt=this.clock;this.clock=0;
  const p=this.particles;
  for(let i=p.length-1;i>=0;i--){
   const g=p[i];g.age+=dt;
   if(g.age>=g.life||(g.kind==='foam'&&!sea.organicLoad)){this.count[g.kind]--;p.splice(i,1);continue;}

   if(g.kind==='spray'){
    const air=1-Math.exp(-dt*1.1);g.vx+=(sea.airX*.21-g.vx)*air;g.vz+=(sea.airZ*.21-g.vz)*air;
    g.vy-=9.81*dt;g.y+=g.vy*dt;
   }else{
    const flow=sea.flow(g.x,g.z);
    g.vx+=(flow.x+.018*sea.airX-g.vx)*Math.min(1,dt*3);
    g.vz+=(flow.z+.018*sea.airZ-g.vz)*Math.min(1,dt*3);
   }
   g.x+=g.vx*dt;g.z+=g.vz*dt;
   const level=sea.height(g.x,g.z);
   if(g.kind!=='spray'){g.y=level+.018;g.relief=level-sea.baseHeight(g.x,g.z);}
   else if(g.y<level&&g.vy<0){
    this.count.spray--;if(this.count.whitewater>=capacity.whitewater){p.splice(i,1);continue;}
    g.kind='whitewater';this.count.whitewater++;g.age=0;g.life=.48;g.size*=2;g.y=level+.018;
   }
  }
 }
}
