// Small CPU XPBD solver shared by fabric nodes and hair guides. Compliance is
// inverse discrete constraint stiffness, not a calibrated continuum material.
export const DEFORM_STEP=1/60;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Deformable {
 constructor(count){
  this.count=count;for(const name of ['positions','previous','velocities','rest'])this[name]=new Float32Array(count*3);
  this.inverseMass=new Float32Array(count);this.mass=new Float32Array(count);this.pinned=new Uint8Array(count);
  this.links=[];this.bends=[];this.angles=[];this.rods=[];this.contacts=0;this.broken=0;this.simMs=0;
 }
 node(i,p,mass,pin=false){this.positions.set(p,i*3);this.rest.set(p,i*3);this.mass[i]=mass;this.pinned[i]=pin?1:0;this.inverseMass[i]=pin?0:1/mass;}
 link(a,b,compliance,type=0){const p=this.rest,rest=Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]);const link={a,b,rest,compliance,type,lambda:0,broken:false};this.links.push(link);return this.links.length-1;}
 bend(a,b,c,compliance,restShape=false){const p=this.rest;this.bends.push({a,b,c,compliance,rest:[0,1,2].map(k=>restShape?p[a*3+k]-2*p[b*3+k]+p[c*3+k]:0),lambda:[0,0,0],broken:false});}
 angle(a,b,c,compliance){const p=this.rest,u=[0,1,2].map(k=>p[a*3+k]-p[b*3+k]),v=[0,1,2].map(k=>p[c*3+k]-p[b*3+k]);const cosine=u.reduce((s,x,k)=>s+x*v[k],0)/(Math.hypot(...u)*Math.hypot(...v));this.angles.push({a,b,c,compliance,rest:Math.acos(clamp(cosine,-1,1)),lambda:0});}
 // A zero-curvature vector constraint for almost straight guide rods. Its
 // constant gradient stays well conditioned at 180 degrees. Normalizing by
 // each rest segment length avoids forcing unequal segments to equal length.
 rod(a,b,c,compliance){const p=this.rest,ab=Math.hypot(...[0,1,2].map(k=>p[a*3+k]-p[b*3+k])),bc=Math.hypot(...[0,1,2].map(k=>p[b*3+k]-p[c*3+k]));this.rods.push({nodes:[a,b,c],weights:[1/ab,-1/ab-1/bc,1/bc],compliance,lambda:[0,0,0]});}
 begin(dt,{damping=1,gravity=9.81,force=[0,0,0]}={}){
  this.previous.set(this.positions);this.contacts=0;
  const attenuation=Math.exp(-damping*dt);
  for(let i=0;i<this.count;i++)if(this.inverseMass[i])for(let k=0;k<3;k++){
   const o=i*3+k;this.velocities[o]=this.velocities[o]*attenuation+((k===1?-gravity:0)+force[k]*this.inverseMass[i])*dt;this.positions[o]+=this.velocities[o]*dt;
  }
  for(const l of this.links)l.lambda=0;for(const b of this.bends)b.lambda.fill(0);for(const a of this.angles)a.lambda=0;for(const r of this.rods)r.lambda.fill(0);
 }
 solve(dt){
  const p=this.positions,w=this.inverseMass;
  for(const r of this.rods){
   const [a,b,c]=r.nodes,[wa,wb,wc]=r.weights,alpha=r.compliance/(dt*dt),sum=w[a]*wa*wa+w[b]*wb*wb+w[c]*wc*wc;if(sum===0)continue;
   for(let k=0;k<3;k++){const C=wa*p[a*3+k]+wb*p[b*3+k]+wc*p[c*3+k],delta=(-C-alpha*r.lambda[k])/(sum+alpha);r.lambda[k]+=delta;p[a*3+k]+=w[a]*wa*delta;p[b*3+k]+=w[b]*wb*delta;p[c*3+k]+=w[c]*wc*delta;}
  }
  // Rotation-invariant angle constraints for guide rods. Solve these before
  // segment lengths so the final projection prioritizes extension resistance.
  for(const q of this.angles){
   const a=q.a*3,b=q.b*3,c=q.c*3;
   let ux=p[a]-p[b],uy=p[a+1]-p[b+1],uz=p[a+2]-p[b+2],vx=p[c]-p[b],vy=p[c+1]-p[b+1],vz=p[c+2]-p[b+2];
   const lu=Math.hypot(ux,uy,uz),lv=Math.hypot(vx,vy,vz);if(lu<1e-8||lv<1e-8)continue;ux/=lu;uy/=lu;uz/=lu;vx/=lv;vy/=lv;vz/=lv;
   const cos=clamp(ux*vx+uy*vy+uz*vz,-1,1),sin=Math.sqrt(Math.max(0,1-cos*cos));if(sin<1e-6)continue;
   const ax=(cos*ux-vx)/(lu*sin),ay=(cos*uy-vy)/(lu*sin),az=(cos*uz-vz)/(lu*sin);
   const cx=(cos*vx-ux)/(lv*sin),cy=(cos*vy-uy)/(lv*sin),cz=(cos*vz-uz)/(lv*sin),bx=-ax-cx,by=-ay-cy,bz=-az-cz;
   const alpha=q.compliance/(dt*dt),sum=w[q.a]*(ax*ax+ay*ay+az*az)+w[q.b]*(bx*bx+by*by+bz*bz)+w[q.c]*(cx*cx+cy*cy+cz*cz);if(sum<1e-12)continue;
   const delta=(-(Math.acos(cos)-q.rest)-alpha*q.lambda)/(sum+alpha);q.lambda+=delta;
   p[a]+=w[q.a]*delta*ax;p[a+1]+=w[q.a]*delta*ay;p[a+2]+=w[q.a]*delta*az;
   p[b]+=w[q.b]*delta*bx;p[b+1]+=w[q.b]*delta*by;p[b+2]+=w[q.b]*delta*bz;
   p[c]+=w[q.c]*delta*cx;p[c+1]+=w[q.c]*delta*cy;p[c+2]+=w[q.c]*delta*cz;
  }
  for(const l of this.links){if(l.broken)continue;const a=l.a*3,b=l.b*3,dx=p[a]-p[b],dy=p[a+1]-p[b+1],dz=p[a+2]-p[b+2],length=Math.hypot(dx,dy,dz),alpha=l.compliance/(dt*dt),sum=w[l.a]+w[l.b];if(sum===0||length<1e-9)continue;
   const delta=(-(length-l.rest)-alpha*l.lambda)/(sum+alpha);l.lambda+=delta;const s=delta/length;
   p[a]+=w[l.a]*s*dx;p[a+1]+=w[l.a]*s*dy;p[a+2]+=w[l.a]*s*dz;p[b]-=w[l.b]*s*dx;p[b+1]-=w[l.b]*s*dy;p[b+2]-=w[l.b]*s*dz;
  }
  for(const b of this.bends){if(b.broken)continue;const a=b.a*3,m=b.b*3,c=b.c*3,alpha=b.compliance/(dt*dt),sum=w[b.a]+4*w[b.b]+w[b.c];if(sum===0)continue;
   for(let k=0;k<3;k++){const C=p[a+k]-2*p[m+k]+p[c+k]-b.rest[k],delta=(-C-alpha*b.lambda[k])/(sum+alpha);b.lambda[k]+=delta;p[a+k]+=w[b.a]*delta;p[m+k]-=2*w[b.b]*delta;p[c+k]+=w[b.c]*delta;}
  }
 }
 collide(probe,dt,radius=.02,spheres=[]){
  const p=this.positions,w=this.inverseMass;let rx=0,ry=0,rz=0;
  for(let i=0;i<this.count;i++)if(w[i]){
   const o=i*3;if(p[o+1]<radius){p[o+1]=radius;p[o]+=(this.previous[o]-p[o])*.15;p[o+2]+=(this.previous[o+2]-p[o+2])*.15;}
   for(const s of spheres){const dx=p[o]-s[0],dy=p[o+1]-s[1],dz=p[o+2]-s[2],length=Math.hypot(dx,dy,dz),r=s[3]+radius;if(length<r&&length>1e-8){const push=(r-length)/length;p[o]+=dx*push;p[o+1]+=dy*push;p[o+2]+=dz*push;}}
   if(probe?.active){let dx=p[o]-probe.position.x,dy=p[o+1]-probe.position.y,dz=p[o+2]-probe.position.z;const length=Math.hypot(dx,dy,dz),r=probe.radius+radius;
    if(length<r){if(length<1e-8){dx=0;dy=0;dz=1;}else{dx/=length;dy/=length;dz/=length;}
     const share=probe.mass/(probe.mass+this.mass[i]),push=(r-length)*.9,b=push*(1-share);
     p[o]+=dx*push*share;p[o+1]+=dy*push*share;p[o+2]+=dz*push*share;
     probe.position.x-=dx*b;probe.position.y-=dy*b;probe.position.z-=dz*b;rx-=dx*b;ry-=dy*b;rz-=dz*b;this.contacts++;
    }
   }
  }
  if(probe?.active){probe.velocity.x+=rx/dt;probe.velocity.y+=ry/dt;probe.velocity.z+=rz/dt;probe.sync();}
 }
 finish(dt){for(let i=0;i<this.count*3;i++)this.velocities[i]=(this.positions[i]-this.previous[i])/dt;}
 impulse(velocity,weight=()=>1){for(let i=0;i<this.count;i++)if(this.inverseMass[i]){const w=weight(i);for(let k=0;k<3;k++)this.velocities[i*3+k]+=velocity[k]*w;}}
 strain(l){const p=this.positions;return Math.hypot(p[l.a*3]-p[l.b*3],p[l.a*3+1]-p[l.b*3+1],p[l.a*3+2]-p[l.b*3+2])/l.rest-1;}
}
