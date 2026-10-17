// Test 12 snapshot adapter: dynamic contacts are isolated from prior tests.
// Kinematic capsule with gravity and density-based buoyancy. Position is the eye.
// Scene adapters supply the same solid field and water occupancy as each test.
export class Walker {
 constructor(){this.position=[0,1.65,0];this.velocity=[0,0,0];this.grounded=false;this.submerged=0;this.radius=.28;this.eyeHeight=1.65;}
 step(dt,{forward=[0,0,-1],move=[0,0],buoyant=false,jump=false,sprint=false}={},solid,water=()=>0){
  const steps=Math.max(1,Math.ceil(dt/(1/120))),h=dt/steps;
  for(let step=0;step<steps;step++){
   const p=this.position,v=this.velocity;let wet=0;for(const offset of [.28,.82,1.36])wet+=water([p[0],p[1]-this.eyeHeight+offset,p[2]])/3;this.submerged=Math.max(0,Math.min(1,wet));
   if(step===0&&jump&&this.grounded&&this.submerged<.05){v[1]=4.6;this.grounded=false;}
   const length=Math.hypot(forward[0],forward[2])||1,fx=forward[0]/length,fz=forward[2]/length,m=Math.max(1,Math.hypot(...move)),speed=(sprint?5.5:3.2)*(1-.55*this.submerged),target=[(fx*move[1]-fz*move[0])*speed/m,(fz*move[1]+fx*move[0])*speed/m];
   const response=1-Math.exp(-h*(this.grounded?14:6));v[0]+=(target[0]-v[0])*response;v[2]+=(target[1]-v[2])*response;
   // Sink by default. Space supports the body at partial immersion, with
   // upward acceleration capped so a fully submerged swimmer is not launched.
   const resting=this.grounded&&this.submerged<.05&&Math.hypot(...move)<.001&&!jump;if(resting)v.fill(0);
   if(!resting)v[1]+=h*9.81*((buoyant?Math.min(1.5,2.2*this.submerged):.82*this.submerged)-1);v[1]/=1+h*1.8*this.submerged;
   for(let k=0;k<3;k++)p[k]+=v[k]*h;this.grounded=false;
   for(let iteration=0;iteration<4;iteration++)for(const offset of [.28,.82,1.36]){
    const q=[p[0],p[1]-this.eyeHeight+offset,p[2]],hit=solid(q);if(!hit||hit.distance>=this.radius+.002)continue;if(hit.resolve){hit.resolve(this,q);if(hit.normal[1]>.5)this.grounded=true;continue;}const n=hit.normal,push=Math.max(0,Math.min(.5,this.radius-hit.distance+.0001));for(let k=0;k<3;k++)p[k]+=n[k]*push;const vn=v.reduce((a,x,k)=>a+x*n[k],0);if(vn<0)for(let k=0;k<3;k++)v[k]-=vn*n[k];if(n[1]>.5){this.grounded=true;if(Math.hypot(...move)<.001&&this.submerged<.05)v.fill(0);}
   }
  }
 }
}
export function sdfContact(field,p){const d=field.distance(p),n=field.normal(p),e=.004,g=Math.max(.15,Math.abs((field.distance(p.map((v,k)=>v+n[k]*e))-d)/e));return {distance:d/g,normal:n};}
export function cycleInteraction(options,current,direction){if(!options.length)return current;const index=options.indexOf(current);return options[((index<0?0:index)+Math.sign(direction)+options.length)%options.length];}
