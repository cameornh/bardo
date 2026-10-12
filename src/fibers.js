import { Deformable,clamp } from './deformable.js';
import { Terrain } from './terrain.js';

export const FIBER_PRESETS=[
 {name:'Short plush',length:.18,stiffness:55,damping:3,curl:.08,width:.011,roughness:.72,color:[.64,.55,.37],segments:6},
 {name:'Stiff bristles',length:.42,stiffness:96,damping:1.8,curl:.02,width:.008,roughness:.38,color:[.24,.17,.095],segments:8},
 {name:'Curly wool',length:.75,stiffness:84,damping:2,curl:.90,width:.013,roughness:.9,color:[.66,.62,.51],segments:20,guides:24},
 {name:'Long hair',length:1.4,stiffness:28,damping:.65,curl:.08,width:.006,roughness:.22,color:[.22,.065,.025],segments:12},
];
export const fiberHash=n=>{const v=Math.sin(n*93.731+17.73)*43758.54;return v-Math.floor(v);};
export class Groom extends Deformable {
 constructor(index,parameters={...FIBER_PRESETS[index]},{guides=parameters.guides||36}={}){
  const segments=parameters.segments;super(guides*(segments+1));this.index=index;this.parameters={...parameters};this.guides=guides;this.segments=segments;this.center=[(index-1.5)*2.15,1.2,0];this.supportRadius=.52;this.roots=[];
  for(let g=0;g<guides;g++){
   const ny=.2+.8*(g+.5)/guides,phase=g*2.39996323,rr=Math.sqrt(1-ny*ny),n=[Math.cos(phase)*rr,ny,Math.sin(phase)*rr];
   const t=[-Math.sin(phase),0,Math.cos(phase)],b=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]],root=this.center.map((v,k)=>v+n[k]*this.supportRadius);
   this.roots.push({root,n,t,b,phase:fiberHash(g+index*91)*Math.PI*2});
   const length=parameters.length*(.88+.24*fiberHash(g+index*71));
   for(let j=0;j<=segments;j++){
    const s=j/segments,curl=parameters.curl*length*.14,turn=s*Math.PI*5;
    const p=root.map((v,k)=>v+n[k]*length*s*(1-parameters.curl*.35)+t[k]*curl*Math.sin(turn)+b[k]*curl*(1-Math.cos(turn)));
    this.node(g*(segments+1)+j,p,.00045,j<2);
   }
   for(let j=0;j<segments;j++)this.link(g*(segments+1)+j,g*(segments+1)+j+1,1e-7);
   const straight=parameters.curl<.15;
   for(let j=0;j<segments-1;j++){
    if(straight){const a=g*(segments+1)+j;this.rod(a,a+1,a+2,0);continue;}
    const a=g*(segments+1)+j;this.link(a,a+2,0,1);
    this.angle(a,a+1,a+2,0);
    // Chord constraints already encode the bend of a curled segment. Near a
    // straight rod they become insensitive to angle, so add an angular hinge
    // only there. Redundant hard angle+chord constraints on tight curls cause
    // persistent solver energy; a world-space rest vector is worse still.
    if(this.angles.at(-1).rest<Math.PI-.2)this.angles.pop();
   }
   if(!straight)for(let j=0;j<=segments-3;j++)this.link(g*(segments+1)+j,g*(segments+1)+j+3,0,2);
  }
  this.links.sort((a,b)=>b.type-a.type);this.configure(parameters);
 }
 configure(parameters){Object.assign(this.parameters,parameters);const compliance=500*(1e-4/500)**(clamp(this.parameters.stiffness,0,100)/100);for(const a of this.angles)a.compliance=compliance;for(const r of this.rods)r.compliance=compliance;for(const l of this.links)if(l.type)l.compliance=compliance*l.type;}
 step(dt,probe,wind){
  const sub=dt/3;let contacts=0;
  for(let s=0;s<3;s++){
   this.begin(sub,{damping:this.parameters.damping,force:[wind*.00018,0,wind*.00025]});
   for(let i=0;i<3;i++){this.solve(sub);this.collide(probe,sub,.008,[[...this.center,this.supportRadius]]);}
   this.finish(sub);contacts+=this.contacts;
  }
  this.contacts=contacts;
 }
 brush(){this.impulse([1.8,.5,2.8],i=>Math.pow((i%(this.segments+1))/this.segments,1.5));}
}
export class FiberTest {
 constructor(){this.enabled=false;this.terrain=new Terrain();this.wind=.4;this.gust=0;this.followers=6;this.reset();}
 reset(){this.grooms=FIBER_PRESETS.map((p,i)=>new Groom(i,this.grooms?.[i].parameters||p));this.time=0;this.contacts=0;this.totalContacts=0;this.gust=0;}
 rebuild(i,parameters){this.grooms[i]=new Groom(i,{...this.grooms[i].parameters,...parameters});}
 pulse(){this.gust=1;}
 step(dt,probe){if(!this.enabled)return;const start=performance.now();this.contacts=0;const wind=this.wind+6*this.gust*this.gust;
  // Analytic scalp supports collide with the real probe too. They absorb the
  // reaction as fixed fixtures; no per-fiber SDFs or animated paths are used.
  if(probe?.active)for(const groom of this.grooms){const d=probe.position.toArray().map((v,k)=>v-groom.center[k]),length=Math.hypot(...d),r=probe.radius+groom.supportRadius;
   if(length<r&&length>1e-8){const n=d.map(v=>v/length),vn=probe.velocity.toArray().reduce((s,v,k)=>s+v*n[k],0);for(let k=0;k<3;k++){probe.position.setComponent(k,probe.position.getComponent(k)+n[k]*(r-length));if(vn<0)probe.velocity.setComponent(k,probe.velocity.getComponent(k)-n[k]*vn*1.2);}probe.sync();}
  }
  for(const groom of this.grooms){groom.step(dt,probe,wind);this.contacts+=groom.contacts;}
  this.totalContacts+=this.contacts;this.gust=Math.max(0,this.gust-dt);this.time+=dt;this.simMs=performance.now()-start;
 }
}
