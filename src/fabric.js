import { Deformable,clamp } from './deformable.js';
import { Terrain } from './terrain.js';

export const FABRIC_PRESETS=[
 {name:'Silk-like',stretch:78,bend:12,damping:.8,density:.10,anisotropy:1.5,tear:.35,color:[.22,.55,.67],roughness:.22},
 {name:'Canvas',stretch:97,bend:70,damping:3.2,density:.65,anisotropy:1.15,tear:.65,color:[.66,.52,.30],roughness:.90},
 {name:'Knit',stretch:38,bend:28,damping:.45,density:.24,anisotropy:2.4,tear:1.4,color:[.53,.12,.19],roughness:.82},
 {name:'Leather-like',stretch:88,bend:94,damping:4.2,density:1.1,anisotropy:1,tear:.85,color:[.22,.095,.035],roughness:.38},
];
const compliance=(value,lo,hi)=>hi*(lo/hi)**(clamp(value,0,100)/100);
export class FabricPatch extends Deformable {
 constructor(index,parameters={...FABRIC_PRESETS[index]},{cols=14,rows=18}={}){
  super((cols+1)*(rows+1));this.index=index;this.parameters={...parameters};this.cols=cols;this.rows=rows;this.width=1.65;this.height=2.2;this.centerX=(index-1.5)*2.1;this.cells=[];this.pulling=false;this.pull=0;
  const mass=parameters.density*this.width*this.height/this.count;
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const i=y*(cols+1)+x;this.node(i,[this.centerX+(x/cols-.5)*this.width,3.4-y/rows*this.height,.045*Math.sin(x/cols*Math.PI*3)*y/rows],mass,y===0&&(x===0||x===cols));}
  const horizontal=[],vertical=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const i=y*(cols+1)+x;if(x<cols)horizontal[i]=this.link(i,i+1,0,0);if(y<rows)vertical[i]=this.link(i,i+cols+1,0,1);
   if(x<cols&&y<rows){this.link(i,i+cols+2,0,2);this.link(i+1,i+cols+1,0,2);}
   if(x+2<=cols)this.bend(i,i+1,i+2,0);if(y+2<=rows)this.bend(i,i+cols+1,i+2*(cols+1),0);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=y*(cols+1)+x;this.cells.push({nodes:[i,i+1,i+cols+1,i+cols+2],edges:[horizontal[i],horizontal[i+cols+1],vertical[i],vertical[i+1]],x,y});}
  this.configure(parameters);
  // Slightly closer clamps gather the sheet; its interior is free to drape.
  this.positions[0]+=.13;this.positions[cols*3]-=.13;
 }
 configure(parameters){Object.assign(this.parameters,parameters);const m=this.parameters,stretch=compliance(m.stretch,5e-5,2),bend=compliance(m.bend,1e-4,120);
  for(let i=0;i<this.count;i++){this.mass[i]=m.density*this.width*this.height/this.count;this.inverseMass[i]=this.pinned[i]?0:1/this.mass[i];}
  for(const l of this.links)l.compliance=stretch*(l.type===0?m.anisotropy:l.type===1?1/m.anisotropy:2.5);for(const b of this.bends)b.compliance=bend;
 }
 setPull(on){
  this.pulling=on;this.pull=0;const start=this.rows*(this.cols+1);
  // Grip the deformed hem where it is. Teleporting it back to the rest plane
  // instantly sheared off the flexible silk's bottom row when tearing was on.
  this.pullOrigins=on?this.positions.slice(start*3):null;
  for(let x=0;x<=this.cols;x++){const i=start+x;this.pinned[i]=on?2:0;this.inverseMass[i]=on?0:1/this.mass[i];for(let k=0;k<3;k++)this.velocities[i*3+k]=0;}
 }
 releasePins(){this.setPull(false);for(let i=0;i<this.count;i++){this.pinned[i]=0;this.inverseMass[i]=1/this.mass[i];}}
 breakLink(link){if(link.broken)return;link.broken=true;this.broken++;
  // Bending paths may not bridge a broken structural edge.
  for(const b of this.bends)if((b.a===link.a&&b.b===link.b)||(b.b===link.a&&b.c===link.b)||(b.a===link.b&&b.b===link.a)||(b.b===link.b&&b.c===link.a))b.broken=true;
 }
 step(dt,probe,pressure,tearing){
  const force=pressure*this.width*this.height/this.count;
  const sub=dt/3;let contacts=0;
  for(let step=0;step<3;step++){
  this.begin(sub,{damping:this.parameters.damping,force:[force*.16,0,force]});
  if(this.pulling){this.pull=Math.min(1.4,this.pull+sub*.9);for(let x=0;x<=this.cols;x++){const i=this.rows*(this.cols+1)+x,o=i*3,grip=x*3;this.positions[o]=this.pullOrigins[grip]+(x/this.cols-.5)*this.pull*.25;this.positions[o+1]=Math.max(.035,this.pullOrigins[grip+1]-this.pull);this.positions[o+2]=this.pullOrigins[grip+2]+this.pull*.6;}}
  for(let k=0;k<3;k++){this.solve(sub);this.collide(probe,sub,.025);}
  // Fracture follows the relaxed material strain, not the temporary error
  // introduced by prediction or a moving clamp before constraints react.
  if(tearing)for(const l of this.links)if(!l.broken&&this.strain(l)>this.parameters.tear)this.breakLink(l);
  this.finish(sub);contacts+=this.contacts;
  }
  this.contacts=contacts;this.maxStrain=0;for(const l of this.links)if(!l.broken&&l.type<2)this.maxStrain=Math.max(this.maxStrain,this.strain(l));
 }
 cellVisible(cell){return cell.edges.every(i=>!this.links[i].broken);}
}
export class FabricTest {
 constructor(){this.enabled=false;this.terrain=new Terrain();this.wind=.25;this.gust=0;this.tearing=false;this.time=0;this.reset();}
 reset(){this.patches=FABRIC_PRESETS.map((p,i)=>new FabricPatch(i,this.patches?.[i].parameters||p));this.time=0;this.contacts=0;this.totalContacts=0;this.broken=0;this.gust=0;}
 resetPatch(i,restore=false){this.patches[i]=new FabricPatch(i,restore?FABRIC_PRESETS[i]:this.patches[i].parameters);}
 pulse(){this.gust=1;}
 step(dt,probe){if(!this.enabled)return;const start=performance.now();this.contacts=0;this.broken=0;const pressure=this.wind+5*this.gust*this.gust;
  for(const patch of this.patches){patch.step(dt,probe,pressure,this.tearing);this.contacts+=patch.contacts;this.broken+=patch.broken;}
  this.totalContacts+=this.contacts;this.gust=Math.max(0,this.gust-dt);this.time+=dt;this.simMs=performance.now()-start;
 }
}
