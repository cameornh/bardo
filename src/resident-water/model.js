import {beachScalePlan,seedBeach,scaleBeachStock} from '../sand-lab/beach-scale.js';
import {SandBed} from '../sand-lab/sand.js';
import {beachBoulders} from '../sand-lab/beach-boulders.js';
import {bodyDistance} from '../sand-lab/objects.js';
import {physicalCoefficients,WATER_SURFACE_TENSION,WATER_DENSITY} from '../sand-lab/water-lab-transport.js';

export const LIMITS=Object.freeze({particles:16384,cells:4096,slots:128,iterations:64,timeout:2500,frameMs:500,width:960,height:540});
export function fixture(resolution=1.4){
 if(!Number.isFinite(resolution)||resolution<1||resolution>2.2)throw Error('Prototype resolution must be 1–2.2');
 const plan=beachScalePlan(1,resolution),seed=seedBeach(plan),sand=new SandBed(plan.sandCells);scaleBeachStock(sand,plan);
 const balls=beachBoulders(sand),items=seed.items.filter(({p})=>balls.every(b=>bodyDistance(p,b)>=seed.spec.spacing*.12));
 const n=items.length;if(n>LIMITS.particles)throw Error('Resident particle budget exceeded');
 const positions=new Float32Array(n*4),velocities=positions.slice(),chem=positions.slice();items.forEach((p,i)=>positions.set([...p.p,0],i*4));
 const geometry=new Float32Array(32+sand.n**2+balls.length*16+1024);geometry.set([sand.n,sand.dx,sand.dz,balls.length,0,0,0,0,0,32,32+sand.n**2]);
 for(let i=0;i<sand.n**2;i++)geometry[32+i]=sand.heightAt(i);
 balls.forEach((b,i)=>geometry.set([...b.position,b.radius,0,1,0,0,0,1,0,0,0,1],32+sand.n**2+i*16));
 return {positions,velocities,chem,geometry,sand,balls,spacing:plan.spacing,scale:10,resolution,dt:1/30};
}
export function gridPlan(f){
 const h=Math.max(f.spacing*1.7,Math.cbrt(11*6*9.8/3200)),origin=[-5.5,-.5,-4.9],extent=[11,6,9.8],dims=extent.map(v=>Math.ceil(v/h)),cell=dims.map((v,k)=>extent[k]/v),count=dims.reduce((a,b)=>a*b),offsets=[];
 let faces=0;for(let a=0;a<3;a++){offsets.push(faces);faces+=dims.reduce((n,v,k)=>n*(v+(a===k?1:0)),1);}
 if(count>LIMITS.cells)throw Error('Resident grid budget exceeded');
 return {origin,extent,dims,cell,count,faces,offsets,bandOffset:faces*4,geometryOffset:faces*4+count};
}
export function parameters(f,g,{wind=0,time=0}={}){
 const c=new Float32Array(32),p=physicalCoefficients(f.spacing,f.scale,f.dt);
 c.set([f.positions.length/4,f.spacing,f.scale,f.dt,1-Math.exp(-f.dt*1.5),p.viscosity,p.capillary,WATER_SURFACE_TENSION/WATER_DENSITY,...g.origin.map(v=>v*f.scale),0,...g.cell.map(v=>v*f.scale),0,g.geometryOffset,g.bandOffset,LIMITS.slots,LIMITS.iterations,...g.dims,0,...g.offsets,0,g.faces,g.count,wind,time]);return c;
}
export function outputState(f){const n=f.positions.length/4,state=new Float32Array(n*20);for(let i=0;i<n;i++){state.set(f.positions.subarray(i*4,i*4+4),i*20);state.set(f.velocities.subarray(i*4,i*4+4),i*20+4);state.set(f.chem.subarray(i*4,i*4+4),i*20+8);}return state;}
export function unpackState(state){const n=state.length/20,p=new Float32Array(n*4),v=p.slice(),chem=p.slice();for(let i=0;i<n;i++){p.set(state.subarray(i*20,i*20+4),i*4);v.set(state.subarray(i*20+4,i*20+8),i*4);chem.set(state.subarray(i*20+8,i*20+12),i*4);}return {positions:p,velocities:v,chem};}
export function frameSchedule(accumulator,elapsed,dt){const available=Math.min(.1,accumulator+Math.max(0,Math.min(.1,elapsed)));const steps=Math.min(3,Math.floor((available+1e-9)/dt));return {steps,accumulator:available-steps*dt};}

// Diagnostics only, outside measured frames. Markers retain fixed volume.
export function stateMetrics(f,state){let speed2=0,maxSpeed=0,escaped=0,penetration=0;for(let i=0;i<state.length;i+=20){const p=Array.from(state.subarray(i,i+3)),v=Math.hypot(...state.subarray(i+4,i+7));speed2+=v*v;maxSpeed=Math.max(maxSpeed,v);if(Math.abs(p[0])>5.501||Math.abs(p[2])>4.901||p[1]>9.001)escaped++;penetration=Math.max(penetration,f.sand.height(p[0],p[2])-p[1],...f.balls.map(b=>-bodyDistance(p,b)));}return {markers:state.length/20,volume:state.length/20*f.spacing**3,rmsSpeed:Math.sqrt(speed2/(state.length/20)),maxSpeed,escaped,maxSolidPenetration:penetration};}
