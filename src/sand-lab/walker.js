// Test 12 snapshot adapter: dynamic contacts are isolated from prior tests.
// Finite-mass capsule. Positions/velocities and all environmental flows are
// in metres, independent of lab scale, drawing detail, or camera coarsening.
const ZERO=[0,0,0];
function drag(velocity,flow,density,area,mass,dt){
 const relative=flow.map((v,k)=>v-velocity[k]),speed=Math.hypot(...relative),rate=.5*density*area*.9/mass*speed*dt;
 const fraction=rate/(1+rate);for(let k=0;k<3;k++)velocity[k]+=relative[k]*fraction;
}
export class Walker {
 constructor(){this.position=[0,1.65,0];this.velocity=[0,0,0];this.grounded=false;this.submerged=0;this.radius=.28;this.eyeHeight=1.65;this.mass=80;this.groundNormal=[0,1,0];}
 step(dt,{forward=[0,0,-1],move=[0,0],buoyant=false,jump=false,sprint=false}={},solid,water=()=>0,environment={}){
  // Sample outside the displaced capsule once per frame, not once per solver
  // iteration. Occupancy-weighted currents include the wave's vertical motion.
  let wet=0;const flow=[0,0,0],eye=this.position;
  for(const offset of [.28,.82,1.36]){const a=water([eye[0],eye[1]-this.eyeHeight+offset,eye[2]]),w=Math.max(0,Math.min(1,typeof a==='number'?a:a.density));wet+=w/3;if(typeof a!=='number')for(let k=0;k<3;k++)flow[k]+=a.velocity[k]*w/3;}
  for(let k=0;k<3;k++)flow[k]/=Math.max(.00001,wet);this.submerged=wet;
  const air=environment.air||ZERO,steps=Math.max(1,Math.ceil(dt/(1/120))),h=dt/steps,walking=Math.hypot(...move)>.001;
  for(let step=0;step<steps;step++){
   const p=this.position,v=this.velocity;
   if(step===0&&jump&&this.grounded&&wet<.05){v[1]=4.6;this.grounded=false;}
   // Input provides bounded traction, never a velocity override. An idle
   // player retains impulses until real ground friction/fluid drag removes them.
   if(walking){const length=Math.hypot(forward[0],forward[2])||1,fx=forward[0]/length,fz=forward[2]/length,m=Math.max(1,Math.hypot(...move)),speed=(sprint?5.5:3.2)*(1-.55*wet),target=[(fx*move[1]-fz*move[0])*speed/m,(fz*move[1]+fx*move[0])*speed/m];
    const dv=[target[0]-v[0],target[1]-v[2]],limit=(this.grounded?16:wet>0?4:2)*h,f=Math.min(1,limit/Math.max(.00001,Math.hypot(...dv)));v[0]+=dv[0]*f;v[2]+=dv[1]*f;}
   v[1]+=h*9.81*((buoyant?Math.min(1.5,2.2*wet):.82*wet)-1);
   drag(v,air,1.225,.65*(1-wet),this.mass,h);if(wet>0)drag(v,flow,1000,.32*wet,this.mass,h);
   if(this.grounded&&!walking){
    // Static/sliding friction also balances gravity on walkable slopes. It
    // cannot pin a capsule against arbitrary wind or erase a body impact.
    const n=this.groundNormal,vn=v.reduce((sum,x,k)=>sum+x*n[k],0),t=v.map((x,k)=>x-vn*n[k]),speed=Math.hypot(...t),friction=.55*9.81*Math.max(.1,1-.82*wet)*h,f=Math.min(1,friction/Math.max(.00001,speed));
    for(let k=0;k<3;k++)v[k]-=t[k]*f;
   }
   for(let k=0;k<3;k++)p[k]+=v[k]*h;this.grounded=false;
   for(let iteration=0;iteration<4;iteration++)for(const offset of [.28,.82,1.36]){
    const q=[p[0],p[1]-this.eyeHeight+offset,p[2]],hit=solid(q);if(!hit||hit.distance>=this.radius+.002)continue;
    const n=hit.normal;if(hit.resolve)hit.resolve(this,q);else{
     const push=Math.max(0,Math.min(.5,this.radius-hit.distance+.0001));for(let k=0;k<3;k++)p[k]+=n[k]*push;
     const vn=v.reduce((a,x,k)=>a+x*n[k],0);if(vn<0)for(let k=0;k<3;k++)v[k]-=vn*n[k];
    }
    if(n[1]>.5){this.grounded=true;this.groundNormal=n.slice();}
   }
  }
 }
}
export function sdfContact(field,p){const d=field.distance(p),n=field.normal(p),e=.004,g=Math.max(.15,Math.abs((field.distance(p.map((v,k)=>v+n[k]*e))-d)/e));return {distance:d/g,normal:n};}
export function cycleInteraction(options,current,direction){if(!options.length)return current;const index=options.indexOf(current);return options[((index<0?0:index)+Math.sign(direction)+options.length)%options.length];}
