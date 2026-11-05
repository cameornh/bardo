import * as THREE from 'three';
import {BeachFieldGrid,AIR,WATER} from './grid.js';
import {MATERIAL,relativeHumidity} from '../../fluid-fields/model.js';
import {solveMultigrid,norm} from './multigrid.js';
import {GPUMultigrid} from './gpu-multigrid.js';
import {AirFieldTexture} from './air-texture.js';
import {surfaceConstraints} from './surface-constraints.js';
import {packNeighborTexture} from '../../sand-lab/neighbor-texture.js';
import {windAt} from '../../beach-wind.js';
import {bodyDistance} from '../../sand-lab/objects.js';
import {pointVelocity} from '../../sand-lab/rigid-contacts.js';

export class BeachFields {
 constructor(lab){this.lab=lab;this.enabled=true;this.backend='cpu';this.stats={backend:'CPU multigrid-PCG · preparing'};this.events=[];this.attach();}
 attach(){
  const lab=this.lab,air=lab.air;this.originalAirUpdate=air.update.bind(air);this.originalAirSample=air.sampleGrid.bind(air);
  air.update=(...args)=>{if(!this.enabled)return this.originalAirUpdate(...args);air.grid=this.grid||null;air.lab=lab;air.jet=lab.jet;};
  air.sampleGrid=p=>this.enabled&&this.grid?this.grid.sampleVelocity(p.map(v=>v*lab.spec.scale)).map(v=>v/lab.spec.scale):this.originalAirSample(p);
  const impact=lab.rain.impact.bind(lab.rain);
  lab.rain.impact=(drop,hit)=>{if(this.enabled&&this.grid){drop.temperature=this.sampleAir(hit.point).temperature;if(hit.particle>=0&&this.events.length<256)this.events.push({point:hit.point.slice(),volume:drop.volume,temperature:drop.temperature});}return impact(drop,hit);};
 }
 reset(){this.grid=null;this.events=[];this.stats={backend:'CPU multigrid-PCG · preparing'};if(!this.gpu?.busy)this.gpu?.clear();}
 ensure(){
  if(this.grid)return;const lab=this.lab,scale=lab.spec.scale;
  let h=Math.max(lab.spacing*scale*1.7,Math.cbrt(11*6*9.8*scale**3/3200));let dims;
  do{dims=[11,6,9.8].map(v=>Math.ceil(v*scale/h));if(dims.reduce((a,b)=>a*b)<=4096)break;h*=1.025;}while(true);
  this.grid=new BeachFieldGrid({dims,h,origin:[-5.5,-.5,-4.9].map(v=>v*scale)});
 }
 sampleAir(point){const g=this.grid,scale=this.lab.spec.scale,p=point.map(v=>v*scale);let i=g.cellAt(p);
  if(i>=0&&g.phase[i]!==AIR){const c=g.coords[i];let best=Infinity,found=-1;for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const q=[c[0]+x,c[1]+y,c[2]+z];if(q.some((v,k)=>v<0||v>=g.dims[k]))continue;const j=q[0]+g.dims[0]*(q[1]+g.dims[1]*q[2]);if(g.phase[j]!==AIR)continue;const d=x*x+y*y+z*z;if(d<best){best=d;found=j;}}i=found;}
  return i>=0?{i,temperature:g.temperature[i],humidity:g.phase[i]===AIR?g.humidity[i]:0,rh:g.phase[i]===AIR?relativeHumidity(g.humidity[i],g.temperature[i],g.absolutePressure(i)):0}:{i:-1,temperature:293.15,humidity:0,rh:0};
 }
 prepare(context){
  this.ensure();const lab=this.lab,g=this.grid,scale=lab.spec.scale,dt=context.dt,start=performance.now();
  const wind=p=>{const v=windAt(p[0],p[2],lab.time,lab.wind,0,lab.windTurbulence),out=[v[0],0,v[1]];if(lab.jet){const q=p.map((v,k)=>v/scale-lab.jet.origin[k]),along=q.reduce((s,v,k)=>s+v*lab.jet.direction[k],0),r2=q.reduce((s,v,k)=>s+(v-along*lab.jet.direction[k])**2,0),w=along>0?Math.exp(-r2/lab.radius**2-along/25):0;for(let k=0;k<3;k++)out[k]+=lab.jet.direction[k]*lab.windStrength*w;}return out;};
  // SDFs remain authoritative at contacts; this is only the bulk occupancy mask.
  const solid=p=>lab.solid(p.map(v=>v/scale),true,false)*scale;
  const wall=p=>{const q=p.map(v=>v/scale);for(const b of lab.balls)if(!b.fixed&&bodyDistance(q,b)<g.h/scale*.5)return pointVelocity(b,q).map(v=>v*scale);if(lab.player&&lab.playerDistance(q)<0)return lab.player.velocity.map(v=>v*scale);return [0,0,0];};
  this.rhs=g.deposit(context.old,context.predicted,dt,scale,lab.spacing,solid,wind,wall);this.before=norm(g.divergence());this.prepareMs=performance.now()-start;
  return this.rhs;
 }
 solve(context){const rhs=this.prepare(context),result=solveMultigrid(this.grid.levels,rhs);return this.finish(context,result);}
 async solveAsync(context){
  const rhs=this.prepare(context);let result;
  if(this.backend==='gpu'&&this.gpu?.disabled){this.backend='cpu';this.stats.fallback='GPU pressure exceeded its time/work budget; CPU multigrid active';}
  if(this.backend==='gpu'&&this.gpu?.validated&&!this.gpu.disabled){try{result=await this.gpu.solve(this.grid.levels,rhs);}catch(error){this.stats.fallback=error.message;this.backend='cpu';}}
  // A reset while the single GPU job is in flight must never write new state.
  if(context.generation!==this.lab.generation)return null;
  result??=solveMultigrid(this.grid.levels,rhs);return this.finish(context,result);
 }
 finish(context,result){
  if(!Number.isFinite(result.relativeResidual)||result.relativeResidual>1e-3&&result.absoluteResidual>1e-8)throw Error('Beach field pressure failed convergence: '+result.relativeResidual);
  const lab=this.lab,g=this.grid,start=performance.now();g.project(result.potential,context.dt);g.transport(context.dt);this.thermal(context.dt);
  const transferred=g.transfer(context.old,context.predicted,context.dt,context.scale,context.s),neighbors=lab.gpu.neighborList(transferred,context.s);lab.gpu.neighbors=neighbors.data;lab.gpu.overflow=neighbors.overflow;
  const surfaceStart=performance.now(),surface=surfaceConstraints(lab,transferred,neighbors.data,g);
  this.stats={...this.stats,...result,potential:undefined,...g.summary(),before:this.before,prepareMs:this.prepareMs,transferMs:surfaceStart-start,surfaceMs:performance.now()-surfaceStart,surfaceParticles:surface.active,surfaceBackend:surface.backend,totalParticles:lab.count};
  if(!lab.gpu.cpu){this.publish(context,surface.positions);(this.airTexture??=new AirFieldTexture(lab.renderer,lab.air)).update(g,lab.spec.scale);}else lab.air.u.uAirEnabled.value=false;
  lab.air.grid=g;return surface.positions;
 }
 publish(context,next){
  const gpu=this.lab.gpu,n=next.length/4;gpu.allocate(n);gpu.finishDeferredPressure=null;
  gpu.data.fill(0);gpu.data.set(context.predicted);gpu.texture.needsUpdate=true;
  if(gpu.packedTexture)packNeighborTexture(gpu.neighbors,gpu.neighborData,n);else{gpu.neighborData.fill(-1);gpu.neighborData.set(gpu.neighbors);}gpu.neighborTexture.needsUpdate=true;gpu.uploadedNeighbors=gpu.neighbors;
  if(!gpu.cpuResult)gpu.cpuResult=new THREE.DataTexture(new Float32Array(gpu.data.length),64,gpu.height,THREE.RGBAFormat,THREE.FloatType);
  gpu.cpuResult.image.data.fill(0);gpu.cpuResult.image.data.set(next);gpu.cpuResult.needsUpdate=true;gpu.resultTexture=gpu.cpuResult;gpu.contactArithmetic=this.stats.backend+' / surface-band contacts';
 }
 thermal(dt){
  const lab=this.lab,g=this.grid,water=MATERIAL[WATER],air=MATERIAL[AIR],waterCapacity=water.density*water.heatCapacity*g.h**3,airCapacity=air.density*air.heatCapacity*g.h**3;
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
 async verify(){
  if(this.lab.asyncPending)throw Error('Pause and wait for the current step before verifying');
  const grid=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]}),phase=new Uint8Array(grid.count).fill(AIR);for(let i=0;i<grid.count;i++)if(grid.coords[i][1]<2)phase[i]=WATER;grid.setPhase(phase);
  const rhs=Float64Array.from({length:grid.count},(_,i)=>Math.sin(i*.31)*.1);this.gpu??=new GPUMultigrid(this.lab.renderer);
  const result=await this.gpu.verify(grid.levels,rhs);this.verification=result;return result;
 }
 dispose(){this.airTexture?.dispose();this.gpu?.dispose();}
}
