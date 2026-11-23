import {AIR_CAPACITY,clamp,ROOM,saturation} from './material-air.js';

const WATER_LATENT=2.26e6;
// Enthalpy per kilogram of remaining substrate. The two plateaus absorb energy
// before temperature can rise again. A non-aqueous vapour stays out of humidity.
const vaporHeat=m=>WATER_LATENT*m.waterContent+(1-m.waterContent)*Math.max(180000,4*m.latentHeat);
export function enthalpyAt(m,t,liquid=t>m.meltingPoint){
 return m.heatCapacity*t+(liquid?m.latentHeat:0)+(t>m.boilingPoint?vaporHeat(m):0);
}
export function phaseState(m,h){
 const cp=m.heatCapacity,fusion=m.meltingPoint*cp,boil=m.boilingPoint*cp+m.latentHeat;
 const melt=m.latentHeat?clamp((h-fusion)/m.latentHeat,0,1):Number(h>=fusion);
 const gas=clamp((h-boil)/vaporHeat(m),0,1);
 return {t:Math.max(50,(h-melt*m.latentHeat-gas*vaporHeat(m))/cp),melt,gas};
}
export function surfaceState(material,key,position,area=1,mass=area*.008*material.density){
 mass=Math.max(.001,mass);area=Math.max(.001,area);
 const h=enthalpyAt(material,material.initialTemperature,material.initialTemperature>material.meltingPoint);
 return {material,key,position,area,mass,h,water:material.moisture*mass,fuel:material.fuelEnergy>0?1:0,
  bulkWater:material.waterContent*mass,lost:0,volts:0,electrode:null,watts:0,burning:0,scale:1,strength:1,finish:0,trapped:0,...phaseState(material,h)};
}
// Entrapment is the cloudy fraction of the total mass. Fast growth
// retains more inclusions. Melting removes them with the disappearing ice.
export const opticalIce=m=>m.waterContent>.5&&m.phase==='solid'&&m.opacity<1;
export function heat(s,joules,dt=.125){
 if(joules===0)return;
 const m=s.material,previous=s.melt;
 s.h=clamp(s.h+joules/activeMass(s),m.heatCapacity*50,enthalpyAt(m,12000));
 Object.assign(s,phaseState(m,s.h));
 if(m.waterContent>.5&&s.melt!==previous){
  const prior=s.trapped||0,frozen=previous-s.melt;
  if(frozen>0)s.trapped=(s.trapped||0)+m.waterContent*frozen*(-Math.expm1(-frozen/(.09*dt)));
  else s.trapped=prior*(1-s.melt)/(1-previous);
  if(s.depositBed&&s.trapped!==prior)s.depositBed.version++;
 }
}
export const activeMass=s=>Math.max(1e-9,s.mass*(1-s.lost));
export const poreMass=s=>Math.max(.000001,s.area*.008*s.material.porosity*1000);
const mobility=m=>m.permeability/(m.permeability+1e-12);
export function addWater(s,kg){
 const absorbed=Math.min(kg,Math.max(0,poreMass(s)*s.material.waterAffinity+.08*s.area-s.water));
 s.water+=absorbed;return absorbed;
}
export function react(s,air,cell,dt,windSpeed){
 const m=s.material,gas=air.read(cell),mass=activeMass(s),cap=mass*m.heatCapacity;
 s.burning=0;
 // A submerged surface exchanges with the contacting liquid through the graph.
 if(!s.submerged){
 const absolute=Math.min(1600,s.t),room=Math.min(1600,gas.temperature);
 const conv=(8+2*Math.sqrt(windSpeed))*s.area;
 const radiative=m.emissivity*5.67e-8*s.area*(absolute+room)*(absolute*absolute+room*room);
 const capacity=cap*AIR_CAPACITY/(cap+AIR_CAPACITY),exchange=(gas.temperature-s.t)*capacity*(-Math.expm1(-dt*(conv+radiative)/capacity));
 heat(s,exchange,dt);cell.heat-=exchange;
 // Liquid on a hot face can flash to steam even in saturated air. Take the
 // latent heat from the substrate, including energy stored in phase changes.
 if(s.water>0&&s.t>373.15){
  const excess=mass*(s.h-enthalpyAt(m,373.15));
  const steam=Math.min(s.water,Math.max(0,excess)/WATER_LATENT);
  s.water-=steam;cell.water+=steam;heat(s,-steam*WATER_LATENT);
 }
 const roomWet=gas.water/saturation(s.t),wet=s.water/poreMass(s);
 // Free film evaporates; pores retain water according to affinity. At the
 // dew point even a non-porous surface condenses a thin film.
 const target=poreMass(s)*m.waterAffinity*(1-s.melt)*clamp(roomWet,0,1);
 const transfer=s.area*dt*(.00015+.003*mobility(m))*(1+.14*Math.sqrt(windSpeed));
 let uptake=0;
 if(roomWet>1||s.water<target){
  uptake=Math.min(gas.water,Math.max(0,target-s.water)+Math.max(0,roomWet-1)*.008*s.area,
   transfer*(Math.max(0,roomWet-1)+m.waterAffinity*mobility(m)*Math.max(0,roomWet-wet)));
 }else{
  const demand=transfer*Math.max(0,1-roomWet)*(1+Math.max(0,s.t-330)*.13);
  uptake=-Math.min(s.water,Math.max(0,s.water-target),demand,(s.t-50)*cap/WATER_LATENT);
 }
 s.water+=uptake;cell.water-=uptake;heat(s,uptake*WATER_LATENT);
 if(uptake<=0&&s.melt>0&&s.bulkWater>0&&roomWet<1){
  const evap=Math.min(s.bulkWater,Math.max(0,.985-s.lost)*s.mass,
   s.area*dt*.00065*(1-roomWet)*(1+.18*Math.sqrt(windSpeed))*s.melt,
   (s.t-50)*cap/WATER_LATENT);
  s.lost+=evap/s.mass;s.bulkWater-=evap;cell.water+=evap;heat(s,-evap*WATER_LATENT);
 }
 // Boil off only the vapour supported by the enthalpy balance. The
 // remaining mass retains its enthalpy on the liquid side of the plateau.
 if(s.gas>0&&s.lost<.985){
  const fraction=Math.min(.985-s.lost,(1-s.lost)*s.gas);
  const evaporated=s.mass*fraction;
  const liquidH=m.heatCapacity*m.boilingPoint+m.latentHeat;
  s.h=Math.max(liquidH,(mass*s.h-evaporated*(liquidH+vaporHeat(m)))/Math.max(1e-9,mass-evaporated));
  const waterVapour=Math.min(s.bulkWater,evaporated*s.bulkWater/Math.max(.0001,mass));
  s.lost+=fraction;s.bulkWater-=waterVapour;cell.water+=waterVapour;cell.vapour+=evaporated-waterVapour;
  Object.assign(s,phaseState(m,s.h));
 }
 const ignition=clamp((s.t-m.ignitionTemperature)/45,0,1),dry=1/(1+30*(s.water+s.bulkWater)/mass);
 if(ignition>0&&s.fuel>0&&m.burnRate>0&&gas.oxygen>0){
  const oxygenPerKg=Math.max(.1,m.fuelEnergy/13e6);
  const kg=Math.min(s.fuel*mass,mass*m.burnRate*dt*ignition*dry*dry,gas.oxygen/oxygenPerKg);
  s.burning=kg/dt; s.fuel=Math.max(0,s.fuel-kg/mass);
  cell.oxygenUsed+=kg*oxygenPerKg;cell.smoke+=kg*m.smokeYield;
  const energy=kg*m.fuelEnergy;heat(s,energy*.32);cell.heat+=energy*.68;
 }
 }
 const char=m.fuelEnergy>0?1-s.fuel:0;
 const wetFinish=1-Math.exp(-Math.max(0,s.water-m.moisture*s.mass)/(s.area*.12));
 s.finish=clamp(.92*char+.28*wetFinish,0,.96);
 s.scale=clamp(1+m.expansion*(s.t-m.initialTemperature),.86,1.18);
 s.strength=clamp((1-.97*s.melt)*(1-s.lost)*(m.fuelEnergy>0?.06+.94*s.fuel:1),.002,1);
}
export function exchangePair(a,b,area,dt){
 const ma=a.material,mb=b.material;
 const k=(2*ma.thermalConductivity*mb.thermalConductivity)/(ma.thermalConductivity+mb.thermalConductivity||1);
 const ca=activeMass(a)*ma.heatCapacity,cb=activeMass(b)*mb.heatCapacity,c=ca*cb/(ca+cb);
 const q=(b.t-a.t)*c*(-Math.expm1(-dt*k*area/(.016*c)));
 heat(a,q,dt);heat(b,-q,dt);
 const wa=a.water/poreMass(a),wb=b.water/poreMass(b);
 const [from,to]=wa>wb?[a,b]:[b,a];
 const amount=Math.min(from.water,Math.abs(wa-wb)*dt*area*.075*mobility(to.material)*to.material.waterAffinity);
 from.water-=addWater(to,amount);
 for(const [source,sink] of [[a,b],[b,a]])if(source.melt>0&&source.bulkWater>0){
  const available=Math.max(0,.985-source.lost)*source.mass;
  const accepted=addWater(sink,Math.min(available,source.bulkWater,dt*area*source.melt*mobility(sink.material)*sink.material.waterAffinity));
  source.bulkWater-=accepted;source.lost+=accepted/source.mass;
 }
}
const conductivity=s=>s.material.electricalConductivity*(1-.99*s.material.waterContent*(1-s.melt))+.13*s.material.waterAffinity*clamp(s.water/poreMass(s),0,1);
export function conductance(a,b,area){
 const x=conductivity(a),y=conductivity(b);
 return area/(.016/Math.max(1e-16,x)+.016/Math.max(1e-16,y)+.0005);
}
// Backward-Euler RC network. Jacobi-preconditioned conjugate gradients solve
// connected conductors together. Currents and heat use the same voltage drop.
export function chargeNetwork(nodes,edges,dt){
 const n=nodes.length;if(!n)return;
 const diag=new Float64Array(n),rhs=new Float64Array(n),v=new Float64Array(n),r=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);
 for(let i=0;i<n;i++){
  const s=nodes[i],c=.004*s.area/dt; s.watts=0;s.index=i;
  diag[i]=c+1e-8;rhs[i]=c*s.volts;v[i]=s.volts;
  if(s.electrode!=null){diag[i]+=8;rhs[i]+=8*s.electrode;}
 }
 for(const e of edges){e.g=conductance(e.a,e.b,e.area);diag[e.a.index]+=e.g;diag[e.b.index]+=e.g;}
 const apply=(x,out)=>{for(let i=0;i<n;i++)out[i]=diag[i]*x[i];for(const {a,b,g} of edges){out[a.index]-=g*x[b.index];out[b.index]-=g*x[a.index];}};
 apply(v,ap);let rz=0;
 for(let i=0;i<n;i++){r[i]=rhs[i]-ap[i];p[i]=r[i]/diag[i];rz+=r[i]*p[i];}
 for(let iter=0;iter<Math.min(n,64)&&rz>1e-15;iter++){
  apply(p,ap);let denom=0;for(let i=0;i<n;i++)denom+=p[i]*ap[i];
  if(denom<1e-24)break;
  const alpha=rz/denom;let next=0;
  for(let i=0;i<n;i++){v[i]+=alpha*p[i];r[i]-=alpha*ap[i];next+=r[i]*r[i]/diag[i];}
  for(let i=0;i<n;i++)p[i]=r[i]/diag[i]+next/rz*p[i];rz=next;
 }
 for(let i=0;i<n;i++)nodes[i].volts=v[i];
 for(const {a,b,g} of edges){
  const half=.5*g*(a.volts-b.volts)**2;
  a.watts+=half;b.watts+=half;heat(a,half*dt);heat(b,half*dt);
 }
}

// Smooth conductors reflect the scene; transmissive solids use the finite-volume optical pass.
export const solidOptics=m=>m.phase==='solid'&&(opticalIce(m)||(m.opacity<.98&&m.ior>1.001)||(m.metallic>=.985&&m.roughness<=.10));
