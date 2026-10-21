const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
// One constitutive curve over the entire saturation range. Plastic history is
// a strength contribution, never a substitute for the actual water content.
// A barely damp handful must not acquire a permanent clay bond.
export function sandMaterial(wet=0,memory=0){
 const saturation=clamp(wet),cohesion=smooth(saturation),history=smooth(memory),residual=.2*history**4;
 const adhesion=residual+(1-residual)*cohesion;
 // A normalized yield stress for rearranging a supported aggregate. Yielding
 // compares this continuous strength to a load; there are no wet/dry modes.
 const shapeYield=1.1*cohesion**3+residual;
 return {saturation,cohesion,adhesion,residual,shapeYield,
  friction:.67+1.8*adhesion,
  repose:.67+1.8*adhesion+80*cohesion**4,
  density:.55+1.15*saturation,
  compaction:saturation,
  entrainmentSpeed:7+85*adhesion+18*saturation,
  dispersion:1-.88*adhesion};
}
// Plastic flow is continuous at the yield point. The load is dimensionless;
// .16 is the reference self-weight/spreading load of a deposited aggregate.
export function sandMobility(wet,memory=0,load=.16){
 return clamp(1-sandMaterial(wet,memory).shapeYield/Math.max(1e-12,load));
}
export function sandAdhesion(wet,memory=0){
 return sandMaterial(wet,memory).adhesion;
}
export const sandFriction=(wet,memory=0)=>sandMaterial(wet,memory).friction;

// Conservative viscous/cohesive exchange between touching mobile portions.
// Weakly damp grains share some velocity, rather than jumping directly from
// independent grains to a rigid handful. Static yield/fracture is handled by
// the contact solver, separately from these continuous material coefficients.
export function sandVelocityExchange(a,b,dt){
 const adhesion=Math.min(sandAdhesion(a.wet,a.memory||0),sandAdhesion(b.wet,b.memory||0));
 const fraction=1-Math.exp(-dt*24*adhesion),mass=a.mass+b.mass;
 if(mass<=0)return;
 for(let k=0;k<3;k++){
  const delta=(b.velocity[k]-a.velocity[k])*fraction;
  a.velocity[k]+=delta*b.mass/mass;b.velocity[k]-=delta*a.mass/mass;
 }
}
