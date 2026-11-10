import {FieldTransfer} from './native-transfer.js';
import {BeachFieldGrid,AIR,WATER} from './grid.js';
import {MATERIAL,relativeHumidity} from '../../fluid-fields/model.js';
import {norm} from './multigrid.js';
import {GPUMultigrid} from './gpu-multigrid.js';
import {AirFieldTexture} from './air-texture.js';
import {surfaceConstraints} from './surface-constraints.js';
import {windAt} from '../../beach-wind.js';
import {bodyDistance} from '../../sand-lab/objects.js';
import {pointVelocity} from '../../sand-lab/rigid-contacts.js';
import {FieldTransport} from './native-transport.js';
import {FieldNeighbors} from './neighbors.js';
import {FieldPressure} from './native-pressure.js';
import {simdKernel} from '../simd/kernels.js';
import {ParticlePipeline} from './particles/pipeline.js';
import {verifyParticles} from './particles/verify.js';
import {ConnectedPipeline} from './connected/pipeline.js';
import {verifyConnected,freshGrid} from './connected/verify.js';

export class BeachFields {
 constructor(lab){this.lab=lab;this.enabled=true;this.backend='cpu';this.particleBackend='cpu';this.stats={backend:'CPU multigrid-PCG · preparing'};this.events=[];this.attach();}
 attach(){
  const lab=this.lab,air=lab.air;this.originalAirUpdate=air.update.bind(air);this.originalAirSample=air.sampleGrid.bind(air);
  air.update=(...args)=>{if(!this.enabled)return this.originalAirUpdate(...args);air.grid=this.grid||null;air.lab=lab;air.jet=lab.jet;};
  air.sampleGrid=p=>this.enabled&&this.grid?this.grid.sampleAirVelocity(p.map(v=>v*lab.spec.scale)).map(v=>v/lab.spec.scale):this.originalAirSample(p);
  const impact=lab.rain.impact.bind(lab.rain);
  lab.rain.impact=(drop,hit)=>{if(this.enabled&&this.grid){drop.temperature=this.sampleAir(hit.point).temperature;if(hit.particle>=0&&this.events.length<256)this.events.push({point:hit.point.slice(),volume:drop.volume,temperature:drop.temperature});}return impact(drop,hit);};
 }
 reset(){this.grid=null;this.events=[];this.stats={backend:'CPU multigrid-PCG · preparing'};if(!this.gpu?.busy)this.gpu?.clear();}
 ensure(){
  if(this.grid){this.configureTopology?.(this.grid);return;}const lab=this.lab,scale=lab.spec.scale;
  let h=Math.max(lab.spacing*scale*1.7,Math.cbrt(11*6*9.8*scale**3/3200));let dims;
  do{dims=[11,6,9.8].map(v=>Math.ceil(v*scale/h));if(dims.reduce((a,b)=>a*b)<=4096)break;h*=1.025;}while(true);
  this.grid=new BeachFieldGrid({dims,h,origin:[-5.5,-.5,-4.9].map(v=>v*scale),extent:[11,6,9.8].map(v=>v*scale)});
  this.configureTopology?.(this.grid);
 }
 sampleAir(point){const g=this.grid,scale=this.lab.spec.scale,p=point.map(v=>v*scale);let i=g.cellAt(p);
  if(i>=0&&g.phase[i]!==AIR){const c=g.coords[i];let best=Infinity,found=-1;for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const q=[c[0]+x,c[1]+y,c[2]+z];if(q.some((v,k)=>v<0||v>=g.dims[k]))continue;const j=q[0]+g.dims[0]*(q[1]+g.dims[1]*q[2]);if(g.phase[j]!==AIR)continue;const d=x*x+y*y+z*z;if(d<best){best=d;found=j;}}i=found;}
  return i>=0?{i,temperature:g.temperature[i],humidity:g.phase[i]===AIR?g.humidity[i]:0,rh:g.phase[i]===AIR?relativeHumidity(g.humidity[i],g.temperature[i],g.absolutePressure(i)):0}:{i:-1,temperature:293.15,humidity:0,rh:0};
 }
 environment(){
  const lab=this.lab,g=this.grid,scale=lab.spec.scale;
  const wind=p=>{const v=windAt(p[0],p[2],lab.time,lab.wind,0,lab.windTurbulence),out=[v[0],0,v[1]];if(lab.jet){const q=p.map((v,k)=>v/scale-lab.jet.origin[k]),along=q.reduce((s,v,k)=>s+v*lab.jet.direction[k],0),r2=q.reduce((s,v,k)=>s+(v-along*lab.jet.direction[k])**2,0),w=along>0?Math.exp(-r2/lab.radius**2-along/25):0;for(let k=0;k<3;k++)out[k]+=lab.jet.direction[k]*lab.windStrength*w;}return out;};
  // SDFs remain authoritative at contacts; this is only the bulk occupancy mask.
  const solid=p=>lab.solid(p.map(v=>v/scale),true,false)*scale;
  const wall=p=>{const q=p.map(v=>v/scale);for(const b of lab.balls)if(!b.fixed&&bodyDistance(q,b)<g.h/scale*.5)return pointVelocity(b,q).map(v=>v*scale);if(lab.player&&lab.playerDistance(q)<0)return lab.player.velocity.map(v=>v*scale);return [0,0,0];};
  return {solid,wind,wall};
 }
 prepare(context){
  this.lab.completeWaterPrediction?.(context);this.ensure();const lab=this.lab,g=this.grid,scale=lab.spec.scale,dt=context.dt,start=performance.now(),{solid,wind,wall}=this.environment();
  g.nativeTransfer=lab.optimizations?.nativeFieldTransfer===true?(this.nativeTransfer??=new FieldTransfer()):null;
  this.rhs=g.deposit(context.old,context.predicted,dt,scale,lab.spacing,solid,wind,wall);this.before=norm(g.divergence());this.prepareMs=performance.now()-start;
  return this.rhs;
 }
 solveCPU(rhs){
  const kernel=this.lab.optimizations?.simdPressure&&simdKernel('pressure');
  const solver=kernel?(this.simdPressure??=new FieldPressure(kernel,'WebAssembly SIMD CPU multigrid-PCG')):(this.cpuPressure??=new FieldPressure());
  return solver.solve(this.grid.levels,rhs);
 }
 solve(context,{deferConsumers=false}={}){const rhs=this.prepare(context),result=this.solveCPU(rhs);return this.finish(context,result,false,null,deferConsumers);}
 async solveAsync(context){
  if(this.particleBackend==='connected'){
   if(this.connected?.validated&&!this.connected.disabled){
    let particles;this.ensure();
    try{particles=await this.connected.solve(context,this.lab,this.grid,{environment:this.environment()});}
    catch(error){this.stats.particleFallback=error.message;this.particleBackend='cpu';this.backend='cpu';}
    if(context.generation!==this.lab.generation)return null;
    if(particles){
     const result=particles.fieldResult;this.connected.fields.commit(result);this.before=norm(result.rhs)/this.grid.h**2;this.prepareMs=result.prepareMs;
     this.finishFields(context,result,true);return this.finish(context,{...result,faces:undefined,rhs:undefined,milliseconds:null},true,particles);
    }
   }else{this.particleBackend='cpu';this.backend='cpu';this.stats.particleFallback=this.connected?.failure||'Connected GPU backend requires verification';}
  }
  const rhs=this.prepare(context);let result;
  if(this.backend==='gpu'&&this.gpu?.disabled){this.backend='cpu';this.stats.fallback='GPU pressure exceeded its time/work budget; CPU multigrid active';}
  if(this.backend==='gpu'&&this.gpu?.validated&&!this.gpu.disabled){try{result=await this.gpu.solve(this.grid.levels,rhs);}catch(error){this.stats.fallback=error.message;this.backend='cpu';}}
  // A reset while the single GPU job is in flight must never write new state.
  if(context.generation!==this.lab.generation)return null;
  result??=this.solveCPU(rhs);
  if(this.particleBackend==='webgpu'&&this.particles?.validated&&!this.particles.disabled){
   this.finishFields(context,result);
   let particles;
   try{particles=await this.particles.solve(context,this.lab,this.grid);}catch(error){this.stats.particleFallback=error.message;this.particleBackend='cpu';}
   if(context.generation!==this.lab.generation)return null;
   return this.finish(context,result,true,particles);
  }
  if(this.particles?.disabled){if(this.particleBackend==='webgpu')this.stats.particleFallback=this.particles.failure||'GPU particle backend unavailable';this.particleBackend='cpu';}
  return this.finish(context,result);
 }
 finishFields(context,result,projected=false){
  if(!Number.isFinite(result.relativeResidual)||result.relativeResidual>1e-3&&result.absoluteResidual>1e-8)throw Error('Beach field pressure failed convergence: '+result.relativeResidual);
  const lab=this.lab,g=this.grid,start=performance.now();if(!projected)g.project(result.potential,context.dt);g.buildAirVelocity();g.transport(context.dt);this.thermal(context.dt);
  this.scalarMs=performance.now()-start;
 }
 finish(context,result,prepared=false,particles=null,deferConsumers=false){
  if(!prepared)this.finishFields(context,result);
  const lab=this.lab,g=this.grid,start=performance.now(),scalarDone=start;let surface;
  if(particles){
   surface={positions:particles.positions};context.transport=particles.transport;context.cpuTransport=true;context.particleReadback=particles.stats;
   this.stats={...this.stats,...result,potential:undefined,...g.summary(),before:this.before,prepareMs:this.prepareMs,scalarMs:this.scalarMs,totalParticles:lab.count,surfaceParticles:null,surfaceMs:null,gatherMs:null,neighborMs:null,transferMs:null,surfaceBackend:'WebGPU exact contacts',transportBackend:particles.stats.backend,transportMs:particles.stats.totalMs,particleCompute:particles.stats};
   lab.gpu.overflow=0;lab.gpu.neighborReused=false;lab.gpu.neighborBackend='WebGPU spatial buckets';lab.gpu.neighborMs=0;
  }else{
  const transferred=g.transfer(context.old,context.predicted,context.dt,context.scale,context.s),gatherDone=performance.now(),builder=this.neighbors??=new FieldNeighbors(),neighbors=builder.build(transferred,context.s,{native:lab.gpu.nativeNeighbors!==false,reuse:lab.optimizations?.neighborReuse!==false});lab.gpu.neighborMs=performance.now()-gatherDone;lab.gpu.neighbors=neighbors.data;lab.gpu.overflow=neighbors.overflow;lab.gpu.neighborReused=builder.reused;lab.gpu.neighborBackend=builder.backend;
  const surfaceStart=performance.now(),computedSurface=surfaceConstraints(lab,transferred,neighbors.data,g);surface=computedSurface;
  this.stats={...this.stats,...result,topologyUploads:undefined,potential:undefined,...g.summary(),before:this.before,prepareMs:this.prepareMs,transferMs:surfaceStart-start,scalarMs:this.scalarMs,gatherMs:gatherDone-scalarDone,neighborMs:lab.gpu.neighborMs,surfaceMs:performance.now()-surfaceStart,surfaceParticles:surface.active,surfaceBackend:surface.backend,totalParticles:lab.count};
  const transportStart=performance.now();
  // Local density relaxation re-spaces markers after bulk projection. It is
  // not another pressure impulse: feeding the whole shift into velocity was
  // continually launching jets at terrain contacts. Exact collision impulses
  // remain in next - shiftedOld (including moving walls and carried bodies).
  const shiftedOld=context.old.slice(),shiftedPrediction=context.predicted.slice();
  for(let o=0;o<surface.shift.length;o+=4)for(let k=0;k<3;k++){shiftedOld[o+k]+=surface.shift[o+k];shiftedPrediction[o+k]+=surface.shift[o+k];}
  context.transport=(this.transport??=new FieldTransport()).solve(shiftedOld,surface.positions,lab.velocities,lab.chem,neighbors.data,context.s,context.scale,context.dt,shiftedPrediction,!neighbors.overflow);
  context.cpuTransport=true;this.stats.transportBackend=this.transport.backend;this.stats.transportMs=performance.now()-transportStart;this.stats.particleCompute=null;
  }
  this.stats.transferBackend=g.nativeTransfer?.scattered===context.old?'WebAssembly CPU':'JavaScript CPU reference';
  lab.gpu.contactArithmetic=this.stats.backend+' / '+this.stats.surfaceBackend+' surface / '+this.stats.transportBackend;
  if(!deferConsumers)this.publishAir();
  lab.air.grid=g;return surface.positions;
 }
 publishAir(){const lab=this.lab;if(!lab.gpu.cpu)(this.airTexture??=new AirFieldTexture(lab.renderer,lab.air)).update(this.grid,lab.spec.scale);else lab.air.u.uAirEnabled.value=false;
 }
 thermal(dt){
  const lab=this.lab,g=this.grid,water=MATERIAL[WATER],air=MATERIAL[AIR],waterCapacity=water.density*water.heatCapacity*g.volume,airCapacity=air.density*air.heatCapacity*g.volume;
  for(const e of this.events){const i=g.cellAt(e.point.map(v=>v*lab.spec.scale));if(i<0||g.phase[i]!==WATER)continue;const c=e.volume*lab.spec.scale**3*water.density*water.heatCapacity,energy=(e.temperature-g.temperature[i])*c*waterCapacity/(c+waterCapacity);g.temperature[i]+=energy/waterCapacity;g.ledger.rainHeat+=energy;}this.events=[];
  // Existing rain-only capillary patches share air temperature/humidity and
  // exchange sensible heat conservatively. No unrequested evaporation/weather
  // model is invented, and neither sand nor the player gains condensation.
  for(const p of lab.rain.surfaceDrops.patches.values()){
   const sample=this.sampleAir(lab.rain.surfaceDrops.frame(p).point);p.temperature??=sample.temperature;p.ambientHumidity=sample.humidity;p.relativeHumidity=sample.rh;
   const c=p.volume*lab.spec.scale**3*water.density*water.heatCapacity;if(c<1e-12||sample.i<0)continue;
   const energy=(sample.temperature-p.temperature)*(1-Math.exp(-dt*.08))*c*airCapacity/(c+airCapacity);p.temperature+=energy/c;g.temperature[sample.i]-=energy/airCapacity;g.ledger.dropHeat-=energy;
  }
 }
 sharedDevice(){const r=this.lab.renderer;return r.isSharedSceneWebGPU?{device:r.device,createTiming:()=>r.createPassTiming(),adapterInfo:{vendor:r.adapter.info?.vendor,architecture:r.adapter.info?.architecture}}:undefined;}
 async verifyParticles(){
  if(this.lab.asyncPending)throw Error('Pause and wait for the current step');
  this.particleBackend='cpu';this.particles?.dispose();this.particles=await new ParticlePipeline().initialize(this.sharedDevice());
  const result=await verifyParticles(this.particles);this.particleVerification=result;if(result.pass)delete this.stats.particleFallback;
  if(result.pass&&this.lab.count){
   // Exercise the actual geometry/count while paused. Discard the result:
   // verification must never advance the beach, moisture, tides or player.
   this.ensure();const lab=this.lab,g=this.grid,grid=new BeachFieldGrid({dims:g.dims,h:g.h,origin:g.origin,extent:g.cellSize.map((v,k)=>v*g.dims[k])}),context={old:lab.positions.slice(),predicted:lab.positions.slice(),dt:lab.timestep,s:lab.spacing,scale:lab.spec.scale};
   const rhs=grid.deposit(context.old,context.predicted,context.dt,context.scale,context.s,p=>lab.solid(p.map(v=>v/context.scale))*context.scale,()=>[0,0,0]);grid.solve(rhs,context.dt);
   try{const warm=await this.particles.solve(context,lab,grid);result.sceneWarmup=warm.stats;}
   catch(e){result.sceneWarning=e.message;this.particles.validated=false;result.pass=false;}
  }return result;
 }
 async verifyConnected(){
  if(this.lab.asyncPending)throw Error('Pause and wait for the current step');
  this.particleBackend='cpu';this.connected?.dispose();this.connected=await (this.createConnectedPipeline?.()||new ConnectedPipeline()).initialize(this.sharedDevice());
  const result=await verifyConnected(this.connected);this.connectedVerification=result;
  if(result.pass&&this.connected.verifyState){result.resident=await this.connected.verifyState();result.pass=result.resident.pass;this.connected.validated=result.pass;}
  if(result.pass&&this.lab.count){
   this.ensure();const lab=this.lab,grid=freshGrid(this.grid),context={old:lab.positions.slice(),predicted:lab.positions.slice(),dt:lab.timestep,s:lab.spacing,scale:lab.spec.scale};
   try{const warm=await this.connected.solve(context,lab,grid,{environment:this.environment()});result.sceneWarmup=warm.stats;}
   catch(e){result.sceneWarning=e.message;this.connected.validated=false;result.pass=false;}
  }
  if(result.pass)delete this.stats.particleFallback;return result;
 }
 async verify(){
  if(this.lab.asyncPending)throw Error('Pause and wait for the current step before verifying');
  const grid=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]}),phase=new Uint8Array(grid.count).fill(AIR);for(let i=0;i<grid.count;i++)if(grid.coords[i][1]<2)phase[i]=WATER;grid.setPhase(phase);
  const rhs=Float64Array.from({length:grid.count},(_,i)=>Math.sin(i*.31)*.1);this.gpu??=new GPUMultigrid(this.lab.renderer);
  const result=await this.gpu.verify(grid.levels,rhs);this.verification=result;return result;
 }
 dispose(){this.connected?.dispose();this.particles?.dispose();this.airTexture?.dispose();this.gpu?.dispose();}
}
