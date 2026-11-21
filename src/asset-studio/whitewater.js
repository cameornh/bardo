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
  for(let i=0;i<3;i++){
   const s=random()*2-1,pt=lipPoint(c,s,.8+.2*random(),age);
   const x=pt.x,z=pt.z,y=sea.height(x,z)+pt.y;
   const sideways=(random()-.5)*c.speed*.8;
   this.spawn('spray',x,y,z,{vx:c.dx*c.speed-c.dz*sideways,vy:c.speed*(.55+random()),vz:c.dz*c.speed+c.dx*sideways},
    .009+.023*random()**2,.7+random()*.45,c,random);
   this.spawn('whitewater',x,y,z,{vx:c.dx*.45,vy:0,vz:c.dz*.45},.04+.07*random(),.55+random()*.85,c,random);
   if(random()<sea.organicLoad*(.24+.22*life)){
    const radius=.035+.048*random(),life=3+sea.organicLoad*(4+7*random());
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
    const air=1-Math.exp(-dt*1.1);g.vx+=(sea.wx*sea.speed*.21-g.vx)*air;g.vz+=(sea.wz*sea.speed*.21-g.vz)*air;
    g.vy-=9.81*dt;g.y+=g.vy*dt;
   }else{
    const flow=sea.flow(g.x,g.z);
    g.vx+=(flow.x+.018*sea.wx*sea.speed-g.vx)*Math.min(1,dt*3);
    g.vz+=(flow.z+.018*sea.wz*sea.speed-g.vz)*Math.min(1,dt*3);
   }
   g.x+=g.vx*dt;g.z+=g.vz*dt;
   const level=sea.height(g.x,g.z);
   if(g.kind!=='spray')g.y=level+.018;
   else if(g.y<level&&g.vy<0){
    this.count.spray--;if(this.count.whitewater>=capacity.whitewater){p.splice(i,1);continue;}
    g.kind='whitewater';this.count.whitewater++;g.age=0;g.life=.48;g.size*=2;g.y=level+.018;
   }
  }
 }
}
// s traverses the crest, u moves through the curling cross-section. Both
// endpoints taper into the bulk. Different portions of the lip spill in sequence.
export function lipPoint(c,s,u,age){
 const taper=Math.pow(Math.max(0,1-s*s),.68),phase=Math.max(0,Math.min(1,age/c.duration));
 const sweep=.16*Math.sin(3*s+c.phase)+.12*s*s+.08*s;
 const progress=Math.max(0,Math.min(1,phase*(1.23+.25*s)-.11*(s+1)));
 const h=c.width*taper*Math.sin(Math.PI*(.035+.95*progress))*(.72+.21*Math.cos(3*s+c.phase));
 const turn=u*(2.0+1.72*progress),forward=c.speed*age*.37+c.width*sweep+h*(1-Math.cos(turn))*.86;
 const cross=s*c.span;
 return {x:c.x+c.dx*forward-c.dz*cross,y:h*(Math.sin(turn)+.22*u)-.025*(1-u),z:c.z+c.dz*forward+c.dx*cross};
}
