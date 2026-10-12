import { WATER_MATERIAL } from './water-material.js';
import { windAt,windPressure,airVelocity,windJet,windNoise,BEACH_WIND_GLSL } from './beach-wind.js';
export { windAt } from './beach-wind.js';
export const BEACH_N=128,BEACH_DX=.65,BEACH_DT=1/75;
export const BEACH_ROCKS=[[-8,-.7,-12,2.6],[5,-1.1,-19,3.2],[16,-.4,-8,1.8]];
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function beachBed(x,z){
 const shore=2.8*Math.sin(x*.035)+1.4*Math.sin(x*.081),s=z-shore;
 let y=Math.min(5,Math.max(-8,.115*s))+Math.max(0,Math.min(40,s-10))*.014*(1+Math.sin(x*.14+z*.08));
 y+=Math.max(0,Math.min(1,(s-6)/12))*(.8+.65*Math.sin(x*.095+z*.11))*Math.exp(-(((s-28)/24)**2));
 // A closed depression is terrain, not a second kind of water.
 const pool=Math.hypot(x-12,z-15);y-=2.3*Math.exp(-((pool/3.6)**4));
 return y;
}
export function rockHeight(x,z){let y=-1e5;for(const [cx,cy,cz,r] of BEACH_ROCKS){const q=r*r-(x-cx)**2-(z-cz)**2;if(q>0)y=Math.max(y,cy+Math.sqrt(q));}return y;}
export function solidHeight(x,z){return Math.max(beachBed(x,z),rockHeight(x,z));}
export function terrainSDF(p,height=beachBed(p[0],p[2])){let d=(p[1]-height)*.5;for(const [x,y,z,r] of BEACH_ROCKS)d=Math.min(d,Math.hypot(p[0]-x,p[1]-y,p[2]-z)-r);return d;}
export function initialCell(x,z){const bed=solidHeight(x,z),eta=Math.hypot(x-12,z-15)<4?.22:0;return [Math.max(0,eta-bed),0,0,0];}

// Finite volume shallow water and balanced gravity.
// Reference for the GPU kernel. Closed borders unless a caller supplies forcing.
function flux(a,b,ba,bb,axis){
 const top=Math.max(ba,bb),ha=Math.max(0,a[0]+ba-top),hb=Math.max(0,b[0]+bb-top);
 const ua=a[0]>.0001?a[axis]/a[0]:0,ub=b[0]>.0001?b[axis]/b[0]:0;
 const A=[ha,a[1]*ha/Math.max(a[0],.0001),a[2]*ha/Math.max(a[0],.0001)],B=[hb,b[1]*hb/Math.max(b[0],.0001),b[2]*hb/Math.max(b[0],.0001)];
 const c=Math.max(Math.abs(ua)+Math.sqrt(9.81*ha),Math.abs(ub)+Math.sqrt(9.81*hb));
 return A.map((v,k)=>(v*ua+B[k]*ub)*.5+(k===axis?2.4525*(ha*ha+hb*hb):0)-.5*c*(B[k]-v));
}
export function stepBeachReference(flow,aux,bed,n,dx,dt,{wind=0,angle=0,time=0,origin=[0,0],open=false,periodic=false,brush=[0,0,1,0],balls=[],jet=null,boundary=null,impulses=null,mobileBed=true,bedrock=null,turbulence=1}={}){
 const next=new Float32Array(flow.length),ground=new Float32Array(aux.length);
 const cell=(x,z,axis)=>{const outside=x<0||z<0||x>=n||z>=n;if(periodic){x=(x+n)%n;z=(z+n)%n;}const i=(clamp(z,0,n-1)*n+clamp(x,0,n-1))*4,a=Array.from(flow.subarray(i,i+4));if(outside&&!open&&!periodic)a[axis]*=-1;return [a,bed[i/4]+aux[i+3]];};
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const i=(z*n+x)*4,a=Array.from(flow.subarray(i,i+4)),b=bed[i/4]+aux[i+3],out=a.slice(0,3);
  for(const [sx,sz,axis,sign] of [[1,0,1,1],[-1,0,1,-1],[0,1,2,1],[0,-1,2,-1]]){
   const [nb,bn]=cell(x+sx,z+sz,axis),A=a,B=nb,f=sign===1?flux(A,B,b,bn,axis):flux(B,A,bn,b,axis);
   const height=Math.max(0,A[0]+b-Math.max(b,bn));f[axis]+=.5*9.81*(a[0]*a[0]-height*height);
   for(let k=0;k<3;k++)out[k]-=sign*dt/dx*f[k];
  }
  out[0]=Math.max(0,out[0]);const wx=origin[0]+(x+.5)*dx,wz=origin[1]+(z+.5)*dx,air=airVelocity([wx,b+out[0],wz],time,wind,angle,jet,turbulence),w=[air[0],air[2]];
  const pressure=(x,z)=>{const v=airVelocity([x,b+out[0],z],time,0,angle,jet);return windPressure(x,z,time,wind,angle,turbulence)+.001225*v[1]*v[1]+.0003*Math.hypot(...v)**2*turbulence*(windNoise(x*.5-time*1.7,z*.5-time*.9)-.5);};
  const pressureGradient=[(pressure(wx+dx,wz)-pressure(wx-dx,wz))/(2*dx),(pressure(wx,wz+dx)-pressure(wx,wz-dx))/(2*dx)];
  const jetAir=windJet([wx,b+out[0],wz],jet),jetSpeed=Math.hypot(jetAir[0],jetAir[2]),coupling=Math.min(1,out[0]/.12);
  for(let k=1;k<3;k++)out[k]=(out[k]+dt*(.000003*w[k-1]*Math.hypot(...w)+.0008*jetAir[k===1?0:2]*jetSpeed*coupling-out[0]*pressureGradient[k-1]))/(1+dt*(.012+.04/Math.max(out[0],.08)+.008*jetSpeed));
  if(open&&boundary&&b<0){const border=Math.min(x,z,n-1-x,n-1-z),relax=clamp((10-border)/10,0,1)*dt*4,far=boundary(wx,wz),h=Math.max(0,far.eta-b);out[0]+=(h-out[0])*relax;out[1]+=(far.u*h-out[1])*relax;out[2]+=(far.v*h-out[2])*relax;}
  if(impulses){out[0]=Math.max(0,out[0]+impulses[i]);out[1]+=impulses[i+1];out[2]+=impulses[i+2];}
  const bx=wx-brush[0],bz=wz-brush[1],bw=Math.exp(-(bx*bx+bz*bz)/Math.max(brush[2]*brush[2],.001));out[1]+=bx*bw*brush[3]*out[0]*dt*5;out[2]+=bz*bw*brush[3]*out[0]*dt*5;
  const bend=.008*Math.hypot(...w),target=[w[0]*bend,w[1]*bend];let wake=0;
  for(const ball of balls){const dx=wx-ball.position[0],dz=wz-ball.position[2],r=ball.radius+.65,weight=Math.exp(-(dx*dx+dz*dz)/(r*r)),reach=clamp((b+1.4-ball.position[1]+ball.radius)*2,0,1),length=Math.hypot(dx+.001,dz+.001);target[0]+=(dx+.001)/length*weight*reach*1.4;target[1]+=(dz+.001)/length*weight*reach*1.4;const sub=clamp((b+out[0]-ball.position[1]+ball.radius)/(2*ball.radius),0,1),du=ball.velocity[0]-out[1]/Math.max(out[0],.02),dv=ball.velocity[2]-out[2]/Math.max(out[0],.02);out[1]+=du*weight*sub*dt*.7;out[2]+=dv*weight*sub*dt*.7;wake+=weight*sub*Math.hypot(du,dv)*.15;}
  if(out[0]<.002){out[1]=out[2]=0;}
  const [r,br]=cell(x+1,z,1),[l,bl]=cell(x-1,z,1),[u,bu]=cell(x,z+1,2),[d,bd]=cell(x,z-1,2);
  const slope=Math.hypot(r[0]+br-l[0]-bl,u[0]+bu-d[0]-bd)/(2*dx),compression=Math.max(0,-((r[1]/Math.max(r[0],.02)-l[1]/Math.max(l[0],.02))+(u[2]/Math.max(u[0],.02)-d[2]/Math.max(d[0],.02)))/(2*dx));
  const speed=Math.hypot(out[1],out[2])/Math.max(out[0],.02),breaking=Math.max(0,slope-.09)*speed*2+Math.max(0,compression-.18)*.5;
  const px=x-a[1]/Math.max(a[0],.02)*dt/dx,pz=z-a[2]/Math.max(a[0],.02)*dt/dx,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz;
  const foamAt=(cx,cz)=>cell(cx,cz,1)[0][3],advected=(foamAt(ix,iz)*(1-fx)+foamAt(ix+1,iz)*fx)*(1-fz)+(foamAt(ix,iz+1)*(1-fx)+foamAt(ix+1,iz+1)*fx)*fz;
  const foam=clamp(advected*Math.exp(-dt*.32)+dt*(breaking+wake)*Math.min(1,out[0]*8),0,1);

  ground[i+1]=aux[i+1]+(target[0]-aux[i+1])*(1-Math.exp(-dt*3));ground[i+2]=aux[i+2]+(target[1]-aux[i+2])*(1-Math.exp(-dt*3));
  let soil=aux[i+3];if(mobileBed)for(const [ox,oz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=clamp(x+ox,0,n-1),nz=clamp(z+oz,0,n-1),j=(nz*n+nx)*4;if(bedrock&&(bedrock[i/4]||bedrock[j/4]))continue;const diff=bed[j/4]+aux[j+3]-b,wet=(aux[i]+aux[j])*.5,repose=.55+.45*wet;const transfer=dt*(1.8*(1-wet)+.35*wet)*Math.sign(diff)*Math.max(0,Math.abs(diff)-repose*dx);soil+=transfer;out[0]+=transfer>0?-Math.min(a[0]*.1,transfer):Math.min(flow[j]*.1,-transfer);}ground[i+3]=soil+(impulses?impulses[i+3]:0);out[0]=Math.max(0,out[0]);ground[i]=clamp(aux[i]+dt*(out[0]>.018?1.6:-.018),0,1);next.set([...out,foam],i);
 }
 return {flow:next,aux:ground};
}

// Redistribute a mound into its surrounding ring (or reverse), conserving sand.
export function sandBrush(bed,n,dx,origin,point,radius,amount,bedrock=null){
 const weights=[];let sum=0,count=0;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){if(bedrock?.[z*n+x])continue;const r=Math.hypot(origin[0]+(x+.5)*dx-point[0],origin[1]+(z+.5)*dx-point[1])/radius;if(r>2)continue;const w=Math.exp(-r*r*2)-.25*Math.exp(-r*r*.5);weights.push([z*n+x,w]);sum+=w;count++;}
 if(!count)return [];const changed=[];for(const [i,w] of weights){bed[i]+=amount*(w-sum/count);changed.push(i);}return changed;
}
export function submergedVolume(radius,center,water){const h=clamp(water-center+radius,0,2*radius);return Math.PI*h*h*(radius-h/3);}
export function glassBallMass(radius,shell=.012){return 2500*4*Math.PI/3*(radius**3-(radius-shell)**3);}
export function stepBeachBall(ball,dt,sample,wind,terrain=null,volume=null){
 const p=ball.position,v=ball.velocity,r=ball.radius,s=sample(p[0],p[2]),inVolume=volume?.contains(p);let vol=s.h>.002?submergedVolume(r,p[1],s.surface):0,flow=[s.u,0,s.v];
 if(inVolume){let wet=0;flow=[0,0,0];for(let i=0;i<24;i++){const y=1-2*(i+.5)/24,ring=Math.sqrt(1-y*y),angle=i*2.39996323,rad=r*Math.cbrt(((i*7)%24+.5)/24),q=[p[0]+Math.cos(angle)*ring*rad,p[1]+y*rad,p[2]+Math.sin(angle)*ring*rad],a=volume.liquidAt(q),velocity=volume.velocityAt(q);wet+=a;for(let k=0;k<3;k++)flow[k]+=velocity[k]*a;}for(let k=0;k<3;k++)flow[k]/=Math.max(wet,.001);vol=wet/24*(4*Math.PI/3*r**3);}
 const fraction=vol/(4*Math.PI/3*r**3),buoyancy=WATER_MATERIAL.density*9.81*vol,relative=flow.map((x,k)=>x-v[k]),drag=.5*WATER_MATERIAL.density*.47*Math.PI*r*r*fraction*Math.hypot(...relative);
 v[1]+=dt*(-9.81+buoyancy/ball.mass);
 // A bounded waterline radiation-damping approximation (20% critical).
 const waterlineArea=Math.PI*Math.max(0,r*r-(p[1]-s.surface)**2),radiation=.4*Math.sqrt(WATER_MATERIAL.density*9.81*waterlineArea*ball.mass);
 if(s.h>.005&&!inVolume)v[1]/=1+dt*radiation/ball.mass;
 // Implicit drag avoids instability for lightweight hollow shells in water.
 const k=drag*dt/ball.mass;for(let j=0;j<3;j++)v[j]=(v[j]+k*flow[j])/(1+k);
 const air=1-fraction;const wind3=wind.length===3?wind:[wind[0],0,wind[1]];v[1]+=dt*.5*1.225*.47*Math.PI*r*r*air*(wind3[1]-v[1])*Math.abs(wind3[1]-v[1])/ball.mass;v[0]+=dt*.5*1.225*.47*Math.PI*r*r*air*(wind[0]-v[0])*Math.abs(wind[0]-v[0])/ball.mass;v[2]+=dt*.5*1.225*.47*Math.PI*r*r*air*(wind3[2]-v[2])*Math.abs(wind3[2]-v[2])/ball.mass;
 for(let j=0;j<3;j++)p[j]+=v[j]*dt;
 const floor=sample(p[0],p[2]);ball.contact=!terrain&&p[1]-r<floor.bed;
 if(ball.contact){p[1]=floor.bed+r;if(v[1]<0)v[1]*=-.12;v[0]-=9.81*floor.dx*dt;v[2]-=9.81*floor.dz*dt;const f=Math.exp(-dt*(floor.wet> .5?3:1.5));v[0]*=f;v[2]*=f;}
 if(terrain){const collision=terrain.projectSphere(p,r);ball.contact=collision.contact;if(collision.contact){const n=collision.normal,inward=v.reduce((sum,x,k)=>sum+x*n[k],0);if(inward<0)for(let k=0;k<3;k++)v[k]-=1.12*inward*n[k];const drag=Math.exp(-dt*(floor.wet>.5?3:1.5));for(let k=0;k<3;k++)v[k]*=drag;}}
 ball.submerged=fraction;ball.spin[0]+=v[2]/r*dt;ball.spin[2]-=v[0]/r*dt;
}

export const BEACH_WORLD_GLSL=`
float beachBed(vec2 p){float shore=2.8*sin(p.x*.035)+1.4*sin(p.x*.081),s=p.y-shore;
 float y=min(5.,max(-8.,.115*s))+clamp(s-10.,0.,40.)*.014*(1.+sin(p.x*.14+p.y*.08));
 y+=clamp((s-6.)/12.,0.,1.)*(.8+.65*sin(p.x*.095+p.y*.11))*exp(-pow((s-28.)/24.,2.));
 y-=2.3*exp(-pow(length(p-vec2(12,15))/3.6,4.));return y;}
vec4 beachRock(int i){if(i==0)return vec4(-8.,-.7,-12.,2.6);if(i==1)return vec4(5.,-1.1,-19.,3.2);return vec4(16.,-.4,-8.,1.8);}
float rockHeight(vec2 p){float y=-1e5;
{vec4 b=vec4(-8.0,-0.7,-12.0,2.6);float q=b.w*b.w-dot(p-b.xz,p-b.xz);if(q>0.)y=max(y,b.y+sqrt(q));}
{vec4 b=vec4(5.0,-1.1,-19.0,3.2);float q=b.w*b.w-dot(p-b.xz,p-b.xz);if(q>0.)y=max(y,b.y+sqrt(q));}
{vec4 b=vec4(16.0,-0.4,-8.0,1.8);float q=b.w*b.w-dot(p-b.xz,p-b.xz);if(q>0.)y=max(y,b.y+sqrt(q));}
return y;}
float solidHeight(vec2 p){return max(beachBed(p),rockHeight(p));}
float rockSDF(vec3 p){float d=1e5;
d=min(d,length(p-vec3(-8.0,-0.7,-12.0))-2.6);
d=min(d,length(p-vec3(5.0,-1.1,-19.0))-3.2);
d=min(d,length(p-vec3(16.0,-0.4,-8.0))-1.8);
return d;}
${BEACH_WIND_GLSL}
`;
