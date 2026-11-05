import {MATERIAL,WATER,AIR,ATMOSPHERE,humidityAtRH} from '../../fluid-fields/model.js';
import {graph,hierarchy,solveMultigrid,norm} from './multigrid.js';
export {WATER,AIR};
const idx=(d,x,y,z)=>x+d[0]*(y+d[1]*z);
const xyz=(d,i)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// SI units. The simulation lattice never reads the camera. Particles retain
// liquid volume and the free boundary; this grid owns bulk pressure/viscosity.
export class BeachFieldGrid {
 constructor({dims=[20,12,18],h=5,origin=[-50,-5,-45]}={}){
  if(dims.some(n=>!Number.isInteger(n)||n<2||n>48)||dims.reduce((a,b)=>a*b)>12288||!(h>0))throw Error('Beach fields exceed the bounded lattice');
  this.dims=dims;this.h=h;this.origin=origin;this.count=dims.reduce((a,b)=>a*b);this.phase=new Uint8Array(this.count).fill(AIR);
  this.temperature=new Float64Array(this.count).fill(293.15);this.humidity=new Float64Array(this.count).fill(humidityAtRH(.55,293.15));this.pressure=new Float64Array(this.count);
  this.fill=new Float64Array(this.count);this.coords=Array.from({length:this.count},(_,i)=>xyz(dims,i));this.time=0;
  this.ledger={boundaryHeat:0,boundaryVapour:0,remapHeat:0,remapVapour:0,rainHeat:0,dropHeat:0,probeHeat:0,probeVapour:0};
  this.faces=[0,1,2].map(axis=>{
   const d=dims.slice();d[axis]++;const n=d.reduce((a,b)=>a*b),a=new Int32Array(n).fill(-1),b=a.slice(),position=[];
   for(let i=0;i<n;i++){const c=xyz(d,i),lo=c.slice();lo[axis]--;if(lo[axis]>=0)a[i]=idx(dims,...lo);if(c[axis]<dims[axis])b[i]=idx(dims,...c);position.push(c.map((v,k)=>origin[k]+(v+(k===axis?0:.5))*h));}
   return {axis,dims:d,a,b,position,velocity:new Float64Array(n),before:new Float64Array(n),weight:new Float64Array(n),coefficient:new Float64Array(n),wall:new Float64Array(n)};
  });
 }
 position(i){return this.coords[i].map((v,k)=>this.origin[k]+(v+.5)*this.h);}
 cellAt(p){const c=p.map((v,k)=>Math.floor((v-this.origin[k])/this.h));return c.some((v,k)=>v<0||v>=this.dims[k])?-1:idx(this.dims,...c);}
 absolutePressure(i){return ATMOSPHERE+this.pressure[i];}
 stencil(p,d,offset,fn){
  const x=(p[0]-this.origin[0])/this.h-offset[0],y=(p[1]-this.origin[1])/this.h-offset[1],z=(p[2]-this.origin[2])/this.h-offset[2],bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z),fx=x-bx,fy=y-by,fz=z-bz;
  for(let n=0;n<8;n++){const dx=n&1,dy=(n>>1)&1,dz=(n>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;if(ix<0||iy<0||iz<0||ix>=d[0]||iy>=d[1]||iz>=d[2])continue;const w=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);if(w>0)fn(idx(d,ix,iy,iz),w);}
 }
 sampleFace(p,face,array=face.velocity,waterOnly=false){
  const axis=face.axis,d=face.dims,x=(p[0]-this.origin[0])/this.h-(axis===0?0:.5),y=(p[1]-this.origin[1])/this.h-(axis===1?0:.5),z=(p[2]-this.origin[2])/this.h-(axis===2?0:.5),bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z),fx=x-bx,fy=y-by,fz=z-bz;let sum=0,w=0;
  for(let n=0;n<8;n++){const dx=n&1,dy=(n>>1)&1,dz=(n>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;if(ix<0||iy<0||iz<0||ix>=d[0]||iy>=d[1]||iz>=d[2])continue;const i=idx(d,ix,iy,iz);if(waterOnly&&this.phase[face.a[i]]!==WATER&&this.phase[face.b[i]]!==WATER)continue;const t=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);sum+=t*array[i];w+=t;}
  return w>1e-12?sum/w:0;
 }
 sampleVelocity(p){return this.faces.map(f=>this.sampleFace(p,f));}
 centerVelocity(i){const c=this.coords[i];return this.faces.map(f=>{const a=idx(f.dims,...c),stride=f.axis===0?1:f.axis===1?f.dims[0]:f.dims[0]*f.dims[1];return (f.velocity[a]+f.velocity[a+stride])*.5;});}
 totals(){let heat=0,vapour=0;for(let i=0;i<this.count;i++)if(this.phase[i]){const m=MATERIAL[this.phase[i]];heat+=m.density*m.heatCapacity*this.h**3*this.temperature[i];if(this.phase[i]===AIR)vapour+=m.density*this.h**3*this.humidity[i];}return {heat,vapour};}
 setPhase(next){
  let changed=!this.levels;const volume=this.h**3;
  for(let i=0;i<this.count;i++)if(this.phase[i]!==next[i]){
   changed=true;const old=MATERIAL[this.phase[i]],m=MATERIAL[next[i]],t=next[i]===WATER?287.15:293.15,q=next[i]===AIR?humidityAtRH(.55,t):0;
   // The open atmosphere is a reservoir. Explicitly account for displaced air
   // and newly occupied liquid cells, rather than silently claiming closed heat.
   this.ledger.remapHeat+=(m?m.density*m.heatCapacity*volume*t:0)-(old?old.density*old.heatCapacity*volume*this.temperature[i]:0);
   this.ledger.remapVapour+=(next[i]===AIR?MATERIAL[AIR].density*volume*q:0)-(this.phase[i]===AIR?MATERIAL[AIR].density*volume*this.humidity[i]:0);
   this.temperature[i]=t;this.humidity[i]=q;this.phase[i]=next[i];
  }
  if(!changed)return false;
  const rows=Array.from({length:this.count},()=>new Map()),boundary=new Float64Array(this.count);
  for(const f of this.faces)for(let k=0;k<f.velocity.length;k++){
   const a=f.a[k],b=f.b[k],pa=a<0?AIR:this.phase[a],pb=b<0?AIR:this.phase[b],outer=a<0||b<0;
   // Closed sea perimeter, open atmosphere. Exact particle contacts retain
   // bowls, cup walls and other geometry below the field cell size.
   const active=pa&&pb&&!(outer&&(pa===WATER||pb===WATER));
   const w=active?2*MATERIAL[WATER].density/(MATERIAL[pa].density+MATERIAL[pb].density):0;f.coefficient[k]=w;
   if(!w)continue;
   if(a>=0&&b>=0){rows[a].set(b,w);rows[b].set(a,w);}else boundary[Math.max(a,b)]+=w;
  }
  // Independent gauge anchors for sealed cavities. They do not add flux:
  // a compatible closed-component RHS makes the anchored pressure zero.
  this.closed=[];const seen=new Uint8Array(this.count);
  for(let i=0;i<this.count;i++)if(this.phase[i]&&!seen[i]){
   const cells=[i];seen[i]=1;let open=false;
   for(const j of cells){open ||= boundary[j]>0;for(const k of rows[j].keys())if(!seen[k]){seen[k]=1;cells.push(k);}}
   if(!open){this.closed.push(cells);boundary[i]+=1;}
  }
  for(let i=0;i<this.count;i++)if(!this.phase[i])boundary[i]=1;
  this.levels=hierarchy(graph(rows,boundary,this.coords,Array.from(this.phase)));this.topologyVersion=(this.topologyVersion||0)+1;return true;
 }
 deposit(positions,predicted,dt,scale,spacing,solid,wind,wallVelocity=()=>[0,0,0]){
  const phase=new Uint8Array(this.count),mass=this.fill;mass.fill(0);
  for(let o=0;o<positions.length;o+=4){if(positions[o+3])continue;const c=this.cellAt([positions[o]*scale,positions[o+1]*scale,positions[o+2]*scale]);if(c>=0)mass[c]+=(spacing*scale/this.h)**3;}
  for(let i=0;i<this.count;i++){const p=this.position(i);phase[i]=solid(p)<0?0:mass[i]>.015?WATER:AIR;}
  this.setPhase(phase);
  for(const f of this.faces){f.weight.fill(0);f.before.fill(0);}
  for(let o=0;o<positions.length;o+=4){if(positions[o+3])continue;const p=[positions[o]*scale,positions[o+1]*scale,positions[o+2]*scale],cell=this.cellAt(p);if(cell<0||phase[cell]!==WATER)continue;
   for(const f of this.faces)this.stencil(p,f.dims,[0,1,2].map(k=>k===f.axis?0:.5),(i,w)=>{f.before[i]+=w*(predicted[o+f.axis]-positions[o+f.axis])*scale/dt;f.weight[i]+=w;});
  }
  const prior=this.faces.map(f=>f.velocity.slice()),relax=1-Math.exp(-dt*2),limit=this.h*.42/dt;
  for(const f of this.faces)for(let i=0;i<f.velocity.length;i++){
   const p=f.position[i],a=f.a[i],b=f.b[i],pa=this.phase[a],pb=this.phase[b];
   if(!f.coefficient[i]){f.velocity[i]=f.wall[i]=clamp(wallVelocity(p)[f.axis],-limit,limit);continue;}
   if(f.weight[i]>1e-9&&(pa===WATER||pb===WATER)){f.velocity[i]=f.before[i]/f.weight[i];continue;}
   // Semi-Lagrangian air advection and external wind/brush forcing. Clip the
   // backtrace at a solid; a fast brush cannot tunnel through a coarse wall.
   const velocity=this.faces.map((face,k)=>this.sampleFace(p,face,prior[k])),target=wind(p),q=p.map((v,k)=>v-clamp(velocity[k]*dt,-this.h*.45,this.h*.45));
   const c=this.cellAt(q),advected=c>=0&&this.phase[c]===AIR?this.sampleFace(q,f,prior[f.axis]):prior[f.axis][i];
   f.velocity[i]=clamp(advected+(target[f.axis]-advected)*relax,-limit,limit);
  }
  for(const f of this.faces)f.before.set(f.velocity);
  // Physical kinematic viscosity, conservative symmetric exchange on faces.
  for(const f of this.faces){const delta=new Float64Array(f.velocity.length);for(let i=0;i<f.velocity.length;i++)if(f.coefficient[i]){
   const c=xyz(f.dims,i),phaseHere=this.phase[f.a[i]]||this.phase[f.b[i]];
   for(let axis=0;axis<3;axis++)if(c[axis]+1<f.dims[axis]){const q=c.slice();q[axis]++;const j=idx(f.dims,...q);if(!f.coefficient[j]||(this.phase[f.a[j]]||this.phase[f.b[j]])!==phaseHere)continue;
    const flux=dt*MATERIAL[phaseHere].viscosity/this.h**2*(f.velocity[j]-f.velocity[i]);delta[i]+=flux;delta[j]-=flux;
   }
  }for(let i=0;i<delta.length;i++)f.velocity[i]+=delta[i];}
  return this.rhs();
 }
 divergence(){const out=new Float64Array(this.count);for(const f of this.faces)for(let i=0;i<f.velocity.length;i++){const a=f.a[i],b=f.b[i],flux=f.velocity[i]/this.h;if(a>=0&&this.phase[a])out[a]+=flux;if(b>=0&&this.phase[b])out[b]-=flux;}return out;}
 rhs(){const rhs=this.divergence().map(v=>-v*this.h**2);for(const cells of this.closed){const mean=cells.reduce((s,i)=>s+rhs[i],0)/cells.length;for(const i of cells)rhs[i]-=mean;}return rhs;}
 project(phi,dt){
  for(const f of this.faces)for(let i=0;i<f.velocity.length;i++)if(f.coefficient[i])f.velocity[i]-=f.coefficient[i]*((f.b[i]<0?0:phi[f.b[i]])-(f.a[i]<0?0:phi[f.a[i]]))/this.h;
  for(let i=0;i<this.count;i++)this.pressure[i]=this.phase[i]?phi[i]*MATERIAL[WATER].density/dt:0;
 }
 solve(rhs,dt){const r=solveMultigrid(this.levels,rhs);this.project(r.potential,dt);return r;}
 transfer(positions,predicted,dt,scale,spacing){
  const result=predicted.slice();let coupled=0;const limit=spacing*.45;
  const delta=this.faces.map(f=>f.velocity.map((v,i)=>v-f.before[i]));
  for(let o=0;o<positions.length;o+=4){if(positions[o+3])continue;const p=[positions[o]*scale,positions[o+1]*scale,positions[o+2]*scale],i=this.cellAt(p);if(i<0||this.phase[i]!==WATER)continue;coupled++;
   const move=[0,0,0];for(let axis=0;axis<3;axis++)move[axis]=predicted[o+axis]-positions[o+axis]+this.sampleFace(p,this.faces[axis],delta[axis],true)*dt/scale;
   const cap=Math.min(1,limit/Math.max(1e-12,Math.hypot(...move)));for(let axis=0;axis<3;axis++)result[o+axis]=positions[o+axis]+move[axis]*cap;
  }
  this.coupled=coupled;return result;
 }
 transport(dt){
  // Unsplit upwind transport needs the SUM of the three directional Courant
  // numbers bounded, not each direction separately (diagonal winds matter).
  const max=this.faces.reduce((s,f)=>s+f.velocity.reduce((m,v)=>Math.max(m,Math.abs(v)),0),0),steps=Math.max(1,Math.ceil(dt*max/(this.h*.45))),sub=dt/steps;
  if(steps>16)throw Error('Field scalar CFL budget exceeded');
  for(let step=0;step<steps;step++){
   const heat=new Float64Array(this.count),vapour=new Float64Array(this.count),dilation=new Float64Array(this.count),volume=this.h**3;
   for(const f of this.faces)for(let k=0;k<f.velocity.length;k++){
    const a=f.a[k],b=f.b[k],pa=a<0?AIR:this.phase[a],pb=b<0?AIR:this.phase[b];if(!f.coefficient[k]||!pa||!pb)continue;
    const ca=MATERIAL[pa].density*MATERIAL[pa].heatCapacity*volume,cb=MATERIAL[pb].density*MATERIAL[pb].heatCapacity*volume;
    if(pa===pb){const donor=f.velocity[k]>=0?a:b,t=donor<0?293.15:this.temperature[donor],q=donor<0?humidityAtRH(.55,293.15):this.humidity[donor],v=sub*f.velocity[k]/this.h;
     const energy=v*ca*(t-273.15),water=pa===AIR?v*MATERIAL[AIR].density*volume*q:0;
     if(a>=0){heat[a]-=energy;vapour[a]-=water;}else{this.ledger.boundaryHeat+=energy;this.ledger.boundaryVapour+=water;}
     if(b>=0){heat[b]+=energy;vapour[b]+=water;}else{this.ledger.boundaryHeat-=energy;this.ledger.boundaryVapour-=water;}
     if(a>=0)dilation[a]+=v;if(b>=0)dilation[b]-=v;
    }
    if(a>=0&&b>=0){const ka=MATERIAL[pa].conductivity,kb=MATERIAL[pb].conductivity,energy=sub*2*ka*kb/(ka+kb)*this.h*(this.temperature[b]-this.temperature[a]);heat[a]+=energy;heat[b]-=energy;}
   }
   for(let i=0;i<this.count;i++)if(this.phase[i]){
    const m=MATERIAL[this.phase[i]],capacity=m.density*m.heatCapacity*volume;
    // The moving interface changes the volume occupied by each phase. Use
    // material advection (constant fields stay constant), with the Eulerian
    // remap/reservoir energy and vapour exchange explicitly in the ledger.
    const remap=dilation[i]*capacity*(this.temperature[i]-273.15),waterRemap=this.phase[i]===AIR?dilation[i]*m.density*volume*this.humidity[i]:0;
    heat[i]+=remap;vapour[i]+=waterRemap;this.ledger.remapHeat+=remap;this.ledger.remapVapour+=waterRemap;
    this.temperature[i]+=heat[i]/capacity;if(this.phase[i]===AIR)this.humidity[i]+=vapour[i]/(m.density*volume);
   }
  }this.time+=dt;
 }
 summary(){return {cells:this.count,waterCells:this.phase.reduce((n,p)=>n+(p===WATER),0),divergence:norm(this.divergence()),coupled:this.coupled||0};}
}
