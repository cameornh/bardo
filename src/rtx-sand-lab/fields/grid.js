import {MATERIAL,WATER,AIR,ATMOSPHERE,humidityAtRH} from '../../fluid-fields/model.js';
import {graph,hierarchy,solveMultigrid,norm} from './multigrid.js';
export {WATER,AIR};
const idx=(d,x,y,z)=>x+d[0]*(y+d[1]*z);
const xyz=(d,i)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// SI units. The simulation lattice never reads the camera. Particles retain
// liquid volume and the free boundary; this grid owns bulk pressure/viscosity.
export class BeachFieldGrid {
 constructor({dims=[20,12,18],h=5,origin=[-50,-5,-45],extent=null}={}){
  if(dims.some(n=>!Number.isInteger(n)||n<2||n>48)||dims.reduce((a,b)=>a*b)>12288||!(h>0))throw Error('Beach fields exceed the bounded lattice');
  this.dims=dims;this.h=h;this.origin=origin;this.cellSize=dims.map((n,k)=>extent?extent[k]/n:h);this.volume=this.cellSize.reduce((a,b)=>a*b,1);this.count=dims.reduce((a,b)=>a*b);this.phase=new Uint8Array(this.count).fill(AIR);
  this.temperature=new Float64Array(this.count).fill(293.15);this.humidity=new Float64Array(this.count).fill(humidityAtRH(.55,293.15));this.pressure=new Float64Array(this.count);
  this.fill=new Float64Array(this.count);this.coords=Array.from({length:this.count},(_,i)=>xyz(dims,i));this.time=0;
  this.ledger={boundaryHeat:0,boundaryVapour:0,remapHeat:0,remapVapour:0,rainHeat:0,dropHeat:0,probeHeat:0,probeVapour:0};
  this.faces=[0,1,2].map(axis=>{
   const d=dims.slice();d[axis]++;const n=d.reduce((a,b)=>a*b),a=new Int32Array(n).fill(-1),b=a.slice(),position=[];
   for(let i=0;i<n;i++){const c=xyz(d,i),lo=c.slice();lo[axis]--;if(lo[axis]>=0)a[i]=idx(dims,...lo);if(c[axis]<dims[axis])b[i]=idx(dims,...c);position.push(c.map((v,k)=>origin[k]+(v+(k===axis?0:.5))*this.cellSize[k]));}
   return {axis,dims:d,a,b,position,velocity:new Float64Array(n),before:new Float64Array(n),weight:new Float64Array(n),coefficient:new Float64Array(n),wall:new Float64Array(n)};
  });
  // MAC face locations never move. A face's transverse velocity samples four
  // other faces (its own component samples one); cache these exact stencils
  // instead of rebuilding three trilinear coordinate transforms per step.
  for(const f of this.faces){
   f.advectionIndices=new Int32Array(f.velocity.length*12).fill(-1);f.advectionWeights=new Float64Array(f.velocity.length*12);
   for(let i=0;i<f.position.length;i++)for(const other of this.faces){let count=0,total=0;const base=i*12+other.axis*4;
    this.stencil(f.position[i],other.dims,[0,1,2].map(k=>k===other.axis?0:.5),(at,w)=>{if(w<1e-12)return;f.advectionIndices[base+count]=at;f.advectionWeights[base+count++]=w;total+=w;});
    for(let k=0;k<count;k++)f.advectionWeights[base+k]/=total;
   }
  }
 }
 position(i){return this.coords[i].map((v,k)=>this.origin[k]+(v+.5)*this.cellSize[k]);}
 cellAt(p){return this.cellXYZ(p[0],p[1],p[2]);}
 cellXYZ(x,y,z){const d=this.dims,h=this.cellSize,o=this.origin,a=Math.floor((x-o[0])/h[0]),b=Math.floor((y-o[1])/h[1]),c=Math.floor((z-o[2])/h[2]);return a<0||b<0||c<0||a>=d[0]||b>=d[1]||c>=d[2]?-1:a+d[0]*(b+d[1]*c);}
 absolutePressure(i){return ATMOSPHERE+this.pressure[i];}
 stencil(p,d,offset,fn){
  const x=(p[0]-this.origin[0])/this.cellSize[0]-offset[0],y=(p[1]-this.origin[1])/this.cellSize[1]-offset[1],z=(p[2]-this.origin[2])/this.cellSize[2]-offset[2],bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z),fx=x-bx,fy=y-by,fz=z-bz;
  for(let n=0;n<8;n++){const dx=n&1,dy=(n>>1)&1,dz=(n>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;if(ix<0||iy<0||iz<0||ix>=d[0]||iy>=d[1]||iz>=d[2])continue;const w=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);if(w>0)fn(idx(d,ix,iy,iz),w);}
 }
 sampleFace(p,face,array=face.velocity,waterOnly=false){
  const axis=face.axis,d=face.dims,x=(p[0]-this.origin[0])/this.cellSize[0]-(axis===0?0:.5),y=(p[1]-this.origin[1])/this.cellSize[1]-(axis===1?0:.5),z=(p[2]-this.origin[2])/this.cellSize[2]-(axis===2?0:.5),bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z),fx=x-bx,fy=y-by,fz=z-bz;let sum=0,w=0;
  for(let n=0;n<8;n++){const dx=n&1,dy=(n>>1)&1,dz=(n>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;if(ix<0||iy<0||iz<0||ix>=d[0]||iy>=d[1]||iz>=d[2])continue;const i=idx(d,ix,iy,iz);if(waterOnly&&this.phase[face.a[i]]!==WATER&&this.phase[face.b[i]]!==WATER)continue;const t=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);sum+=t*array[i];w+=t;}
  return w>1e-12?sum/w:0;
 }
 sampleVelocity(p){return this.faces.map(f=>this.sampleFace(p,f));}
 buildAirVelocity(){
  const n=this.count,d=this.dims,strides=[1,d[0],d[0]*d[1]];
  this.airVelocity??=new Float64Array(n*3);this.airValid??=new Uint8Array(n);
  const v=this.airVelocity,valid=this.airValid;valid.fill(0);v.fill(0);
  for(let i=0;i<n;i++)if(this.phase[i]===AIR){valid[i]=1;const value=this.centerVelocity(i);v.set(value,i*3);}
  // Extrapolate air into only two interface layers. Never feed water velocity
  // back as the wind driving that same water; retain the air/water distinction.
  for(let layer=1;layer<=2;layer++)for(let i=0;i<n;i++)if(!valid[i]&&this.phase[i]===WATER){
   const c=this.coords[i];let x=0,y=0,z=0,count=0;
   for(let axis=0;axis<3;axis++)for(let sign=-1;sign<=1;sign+=2){if(c[axis]+sign<0||c[axis]+sign>=d[axis])continue;const j=i+sign*strides[axis];if(!valid[j]||valid[j]>layer)continue;x+=v[j*3];y+=v[j*3+1];z+=v[j*3+2];count++;}
   if(count){v[i*3]=x/count;v[i*3+1]=y/count;v[i*3+2]=z/count;valid[i]=layer+1;}
  }
 }
 sampleAirVelocity(p){
  if(!this.airVelocity)return [0,0,0];
  let x=0,y=0,z=0,weight=0;const v=this.airVelocity,valid=this.airValid;
  this.stencil(p,this.dims,[.5,.5,.5],(i,w)=>{if(!valid[i])return;x+=v[i*3]*w;y+=v[i*3+1]*w;z+=v[i*3+2]*w;weight+=w;});
  return weight>1e-12?[x/weight,y/weight,z/weight]:[0,0,0];
 }
 centerVelocity(i){const c=this.coords[i];return this.faces.map(f=>{const a=idx(f.dims,...c),stride=f.axis===0?1:f.axis===1?f.dims[0]:f.dims[0]*f.dims[1];return (f.velocity[a]+f.velocity[a+stride])*.5;});}
 totals(){let heat=0,vapour=0;for(let i=0;i<this.count;i++)if(this.phase[i]){const m=MATERIAL[this.phase[i]];heat+=m.density*m.heatCapacity*this.volume*this.temperature[i];if(this.phase[i]===AIR)vapour+=m.density*this.volume*this.humidity[i];}return {heat,vapour};}
 setPhase(next){
  let changed=!this.levels;const volume=this.volume;
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
   const w=active?2*MATERIAL[WATER].density/(MATERIAL[pa].density+MATERIAL[pb].density)*(this.h/this.cellSize[f.axis])**2:0;f.coefficient[k]=w;
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
  const n=positions.length/4,parcelVolume=(spacing*scale)**3/this.volume;
  if(this.particleCell?.length!==n){this.particleCell=new Int32Array(n);this.stencilIndices=new Int32Array(n*24);this.stencilWeights=new Float64Array(n*24);}
  const cells=this.particleCell,indices=this.stencilIndices,weights=this.stencilWeights;indices.fill(-1);
  for(let i=0;i<n;i++){const o=i*4,c=cells[i]=this.cellXYZ(positions[o]*scale,positions[o+1]*scale,positions[o+2]*scale);if(c>=0&&!positions[o+3])mass[c]+=parcelVolume;}
  // Sparse spray is ballistic, not a full incompressible cell. Treating a
  // single droplet as bulk water made tall pressure-supported edge columns.
  // At a sloping shore a cell can contain water even when its CENTER is
  // underground. Actual liquid occupancy wins over that coarse center test;
  // exact particle contacts still prevent penetration. Otherwise the mask
  // invents stair-shaped banks and cuts the shallow water out of projection.
  for(let i=0;i<this.count;i++){const p=this.position(i);phase[i]=mass[i]>.25?WATER:solid(p)<0?0:AIR;}
  this.setPhase(phase);
  for(const f of this.faces){f.weight.fill(0);f.before.fill(0);}
  // Cache each particle's 24 MAC interpolation weights once. Scatter and
  // gather use the identical stencil, with no callbacks/vectors per sample.
  for(let i=0;i<n;i++){
   const o=i*4;if(positions[o+3]||cells[i]<0||phase[cells[i]]!==WATER)continue;
   const x=(positions[o]*scale-this.origin[0])/this.cellSize[0],y=(positions[o+1]*scale-this.origin[1])/this.cellSize[1],z=(positions[o+2]*scale-this.origin[2])/this.cellSize[2];
   for(const f of this.faces){
    const axis=f.axis,d=f.dims,px=x-(axis===0?0:.5),py=y-(axis===1?0:.5),pz=z-(axis===2?0:.5),bx=Math.floor(px),by=Math.floor(py),bz=Math.floor(pz),fx=px-bx,fy=py-by,fz=pz-bz,v=(predicted[o+axis]-positions[o+axis])*scale/dt,base=i*24+axis*8;
    for(let k=0;k<8;k++){const dx=k&1,dy=(k>>1)&1,dz=(k>>2)&1,ix=bx+dx,iy=by+dy,iz=bz+dz;if(ix<0||iy<0||iz<0||ix>=d[0]||iy>=d[1]||iz>=d[2])continue;
     const at=ix+d[0]*(iy+d[1]*iz),w=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);indices[base+k]=at;weights[base+k]=w;f.before[at]+=w*v;f.weight[at]+=w;
    }
   }
  }
  // A sparsely sampled liquid face is still liquid. Sending it through the
  // wind branch erased gravity (and injected wind) at the perimeter. Extend
  // deposited liquid velocities before projection, as in a MAC free surface.
  for(const f of this.faces){
   const valid=f.valid??=new Uint8Array(f.velocity.length);valid.fill(0);
   for(let i=0;i<valid.length;i++)if(f.weight[i]>1e-9){f.before[i]/=f.weight[i];valid[i]=1;}
   for(let layer=1;layer<=3;layer++)for(let i=0;i<valid.length;i++)if(!valid[i]&&(phase[f.a[i]]===WATER||phase[f.b[i]]===WATER)){
    const d=f.dims,x=i%d[0],y=Math.floor(i/d[0])%d[1],z=Math.floor(i/(d[0]*d[1]));let sum=0,count=0;
    const take=j=>{if(valid[j]&&valid[j]<=layer){sum+=f.before[j];count++;}};
    if(x)take(i-1);if(x+1<d[0])take(i+1);if(y)take(i-d[0]);if(y+1<d[1])take(i+d[0]);if(z)take(i-d[0]*d[1]);if(z+1<d[2])take(i+d[0]*d[1]);
    if(count){f.before[i]=sum/count;valid[i]=layer+1;}
   }
  }
  const prior=this.faces.map(f=>f.velocity.slice()),relax=1-Math.exp(-dt*2),limit=this.h*.42/dt;
  for(const f of this.faces)for(let i=0;i<f.velocity.length;i++){
   const p=f.position[i],a=f.a[i],b=f.b[i],pa=this.phase[a],pb=this.phase[b];
   // FLIP must include the wall impulse. Saving the already-clamped velocity
   // erased that impulse and let gravity/outgoing motion accumulate at walls.
   if(!f.coefficient[i]){f.velocity[i]=f.wall[i]=clamp(wallVelocity(p)[f.axis],-limit,limit);continue;}
   if(pa===WATER||pb===WATER){f.velocity[i]=f.before[i];continue;}
   // Semi-Lagrangian air advection and external wind/brush forcing. Clip the
   // backtrace at a solid; a fast brush cannot tunnel through a coarse wall.
   const target=wind(p),q=[0,0,0];for(let axis=0;axis<3;axis++){let v=0;const base=i*12+axis*4;for(let k=0;k<4;k++){const at=f.advectionIndices[base+k];if(at>=0)v+=prior[axis][at]*f.advectionWeights[base+k];}q[axis]=p[axis]-clamp(v*dt,-this.h*.45,this.h*.45);}
   const c=this.cellAt(q),advected=c>=0&&this.phase[c]===AIR?this.sampleFace(q,f,prior[f.axis]):prior[f.axis][i];
   f.velocity[i]=clamp(advected+(target[f.axis]-advected)*relax,-limit,limit);
   f.before[i]=f.velocity[i];
  }
  // Physical kinematic viscosity, conservative symmetric exchange on faces.
  for(const f of this.faces){const delta=new Float64Array(f.velocity.length);for(let i=0;i<f.velocity.length;i++)if(f.coefficient[i]){
   const c=xyz(f.dims,i),phaseHere=this.phase[f.a[i]]||this.phase[f.b[i]];
   for(let axis=0;axis<3;axis++)if(c[axis]+1<f.dims[axis]){const q=c.slice();q[axis]++;const j=idx(f.dims,...q);if(!f.coefficient[j]||(this.phase[f.a[j]]||this.phase[f.b[j]])!==phaseHere)continue;
    const flux=dt*MATERIAL[phaseHere].viscosity/this.cellSize[axis]**2*(f.velocity[j]-f.velocity[i]);delta[i]+=flux;delta[j]-=flux;
   }
  }for(let i=0;i<delta.length;i++)f.velocity[i]+=delta[i];}
  return this.rhs();
 }
 divergence(){const out=new Float64Array(this.count);for(const f of this.faces)for(let i=0;i<f.velocity.length;i++){const a=f.a[i],b=f.b[i],flux=f.velocity[i]/this.cellSize[f.axis];if(a>=0&&this.phase[a])out[a]+=flux;if(b>=0&&this.phase[b])out[b]-=flux;}return out;}
 rhs(){const rhs=this.divergence().map(v=>-v*this.h**2);for(const cells of this.closed){const mean=cells.reduce((s,i)=>s+rhs[i],0)/cells.length;for(const i of cells)rhs[i]-=mean;}return rhs;}
 project(phi,dt){
  for(const f of this.faces)for(let i=0;i<f.velocity.length;i++)if(f.coefficient[i])f.velocity[i]-=f.coefficient[i]*((f.b[i]<0?0:phi[f.b[i]])-(f.a[i]<0?0:phi[f.a[i]]))*this.cellSize[f.axis]/this.h**2;
  for(let i=0;i<this.count;i++)this.pressure[i]=this.phase[i]?phi[i]*MATERIAL[WATER].density/dt:0;
 }
 solve(rhs,dt){const r=solveMultigrid(this.levels,rhs);this.project(r.potential,dt);return r;}
 transfer(positions,predicted,dt,scale,spacing){
  const result=predicted.slice();let coupled=0;const limit=spacing*.45,pic=1-Math.exp(-dt*1.5);
  const indices=this.stencilIndices,weights=this.stencilWeights;
  for(let i=0;i<positions.length/4;i++){
   const o=i*4,cell=this.particleCell[i];if(positions[o+3]||cell<0||this.phase[cell]!==WATER)continue;coupled++;
   let length2=0;
   for(let axis=0;axis<3;axis++){
    const face=this.faces[axis],base=i*24+axis*8;let delta=0,velocity=0,weight=0;
    for(let k=0;k<8;k++){const at=indices[base+k];if(at<0||this.phase[face.a[at]]!==WATER&&this.phase[face.b[at]]!==WATER)continue;const w=weights[base+k];weight+=w;delta+=(face.velocity[at]-face.before[at])*w;velocity+=face.velocity[at]*w;}
    const inv=weight>1e-12?1/weight:0,flip=predicted[o+axis]-positions[o+axis]+delta*inv*dt/scale;
    const move=(1-pic)*flip+pic*velocity*inv*dt/scale;result[o+axis]=move;length2+=move*move;
   }
   const cap=Math.min(1,limit/Math.max(1e-12,Math.sqrt(length2)));for(let axis=0;axis<3;axis++)result[o+axis]=positions[o+axis]+result[o+axis]*cap;
  }
  this.coupled=coupled;return result;
 }
 transport(dt){
  // Unsplit upwind transport needs the SUM of the three directional Courant
  // numbers bounded, not each direction separately (diagonal winds matter).
  const max=this.faces.reduce((s,f)=>s+f.velocity.reduce((m,v)=>Math.max(m,Math.abs(v)),0)/this.cellSize[f.axis],0),steps=Math.max(1,Math.ceil(dt*max/.45)),sub=dt/steps;
  if(steps>16)throw Error('Field scalar CFL budget exceeded');
  for(let step=0;step<steps;step++){
   const heat=new Float64Array(this.count),vapour=new Float64Array(this.count),dilation=new Float64Array(this.count),volume=this.volume;
   for(const f of this.faces)for(let k=0;k<f.velocity.length;k++){
    const a=f.a[k],b=f.b[k],pa=a<0?AIR:this.phase[a],pb=b<0?AIR:this.phase[b];if(!f.coefficient[k]||!pa||!pb)continue;
    const ca=MATERIAL[pa].density*MATERIAL[pa].heatCapacity*volume,cb=MATERIAL[pb].density*MATERIAL[pb].heatCapacity*volume;
    if(pa===pb){const donor=f.velocity[k]>=0?a:b,t=donor<0?293.15:this.temperature[donor],q=donor<0?humidityAtRH(.55,293.15):this.humidity[donor],v=sub*f.velocity[k]/this.cellSize[f.axis];
     const energy=v*ca*(t-273.15),water=pa===AIR?v*MATERIAL[AIR].density*volume*q:0;
     if(a>=0){heat[a]-=energy;vapour[a]-=water;}else{this.ledger.boundaryHeat+=energy;this.ledger.boundaryVapour+=water;}
     if(b>=0){heat[b]+=energy;vapour[b]+=water;}else{this.ledger.boundaryHeat-=energy;this.ledger.boundaryVapour-=water;}
     if(a>=0)dilation[a]+=v;if(b>=0)dilation[b]-=v;
    }
    if(a>=0&&b>=0){const ka=MATERIAL[pa].conductivity,kb=MATERIAL[pb].conductivity,energy=sub*2*ka*kb/(ka+kb)*this.volume/this.cellSize[f.axis]**2*(this.temperature[b]-this.temperature[a]);heat[a]+=energy;heat[b]-=energy;}
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
