import { beachBed,rockHeight } from './beach-model.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export const cubicWeights=f=>[(1-f)**3/6,(3*f**3-6*f*f+4)/6,(-3*f**3+3*f*f+3*f+1)/6,f**3/6];
// Sample the same continuous field used for rendering. Dry cells contribute no
// free-surface elevation: their bed heights must never become a water cap.
export function sampleBeach(sim,x,z,normal=true){const {n,dx,origin,bed,aux,flow}=sim,qx=(x-origin[0])/dx-.5,qz=(z-origin[1])/dx-.5,ix=Math.floor(qx),iz=Math.floor(qz),wx=cubicWeights(qx-ix),wz=cubicWeights(qz-iz),edge=Math.min(qx+.5,qz+.5,n-qx-.5,n-qz-.5),weight=smooth(2,14,edge),far=sim.sampleOcean(x,z);let depth=0,hydraulic=0,soil=0,wet=0,foam=0,eta=0,confidence=0,u=0,v=0;
 if(weight>0)for(let j=0;j<4;j++)for(let i=0;i<4;i++){const id=clamp(iz+j-1,0,n-1)*n+clamp(ix+i-1,0,n-1),k=id*4,w=wx[i]*wz[j],h=flow[k],presence=smooth(.001,.015,h),g=bed[id]+(sim.solidOffset?.[id]||0)+aux[k+3];hydraulic+=(sim.solidOffset?.[id]||0)*w;depth+=h*w;soil+=(sim.bedData[k+1]+aux[k+3])*w;wet+=aux[k]*w;foam+=flow[k+3]*w;eta+=(g+h)*presence*w;confidence+=presence*w;u+=flow[k+1]/Math.max(h,.002)*presence*w;v+=flow[k+2]/Math.max(h,.002)*presence*w;}
 const ground=Math.max(beachBed(x,z)+soil*weight,rockHeight(x,z))+hydraulic*weight,localEta=confidence>.0001?eta/confidence:far.eta,level=far.eta*(1-weight)+localEta*weight,h=Math.max(0,level-ground)*(1-weight+weight*smooth(.02,.15,confidence)*smooth(.002,.012,depth)),result={soil:beachBed(x,z)+soil*weight,bed:ground,h,surface:h>1e-6?level:ground,u:far.u*(1-weight)+u/Math.max(confidence,.0001)*weight,v:far.v*(1-weight)+v/Math.max(confidence,.0001)*weight,wet:wet*weight+(h>.02?1:0)*(1-weight),foam:foam*weight};
 if(normal){const e=.15;result.dx=(sampleBeach(sim,x+e,z,false).bed-sampleBeach(sim,x-e,z,false).bed)/(2*e);result.dz=(sampleBeach(sim,x,z+e,false).bed-sampleBeach(sim,x,z-e,false).bed)/(2*e);}return result;
}
