import { fresnelDielectric } from './optics.js';

// Metres, geometric optics. Medium priority is list order, including explicit
// air cavities. Shared scene data feeds both the photon worker and GPU queries.
export const SHAPE={SPHERE:0,BOX:1,WATER:2,CONVEX:3,CONCAVE:4,MIRROR:5,PRISM:6};
export const MEDIUM={AIR:0,GLASS:1,WATER:2,MIRROR:3};
export const RAY_EPS=.00015;
export const RECEIVER_SIZE=12;
export const DEFAULT_LIGHT_TEST={experiment:'tank',source:'broad',color:'white',photons:32768,power:60,spread:.25,aim:0,wave:.09,phase:0,curvature:2.15,prismAngle:60,focal:5,shell:.024,waterHeight:1.45,dispersion:false,gather:.045};
export const add=(a,b)=>a.map((x,i)=>x+b[i]);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const mul=(a,s)=>a.map(x=>x*s);
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>mul(a,1/(Math.hypot(...a)||1));
export const pointAt=(o,d,t)=>o.map((x,i)=>x+d[i]*t);
export function rotateX(p,angle){const c=Math.cos(angle),s=Math.sin(angle);return [p[0],c*p[1]-s*p[2],s*p[1]+c*p[2]];}
export function localPoint(v,p){return rotateX(sub(p,v.center),-v.rotation);}
export function worldPoint(v,p){return add(rotateX(p,v.rotation),v.center);}
export function waveHeight(x,z,amplitude,phase){return amplitude*(.55*Math.sin(2.8*x+.8*z+phase)+.3*Math.sin(-1.5*x+3.6*z+phase*1.24)+.15*Math.cos(4.5*x-2.4*z-phase*.81));}
export function submergedVolume(radius,height){const h=Math.max(0,Math.min(2*radius,height));return Math.PI*h*h*(radius-h/3);}
export function floatingHeight(radius,shell,waterHeight,bottom=.13){
 const mass=2500*4*Math.PI/3*(radius**3-Math.max(0,radius-shell)**3),full=4*Math.PI/3*radius**3;
 if(mass>=1000*full)return {y:bottom+radius,mass,displaced:1000*submergedVolume(radius,waterHeight-bottom),floating:false};
 let lo=0,hi=2*radius;for(let i=0;i<48;i++){const h=(lo+hi)/2;if(1000*submergedVolume(radius,h)<mass)lo=h;else hi=h;}
 const equilibrium=waterHeight+radius-(lo+hi)/2,y=Math.max(bottom+radius,equilibrium);
 return {y,mass,displaced:1000*submergedVolume(radius,waterHeight+radius-y),floating:equilibrium>=bottom+radius};
}
export function makeLightScene(settings={}){
 const c={...DEFAULT_LIGHT_TEST,...settings},volumes=[],floats=[];
 const volume=(type,medium,center,size,rotation=0,params=[0,0,0,0])=>{const v={id:volumes.length,type,medium,center,size,rotation,params};volumes.push(v);return v;};
 let target=[0,1.8,0],towardLight=[0,1,0],aperture=1.5,aspect=1;
 if(c.experiment==='sphere')volume(SHAPE.SPHERE,MEDIUM.GLASS,[0,1.75,0],[.85,.85,.85]);
 if(c.experiment==='convex'||c.experiment==='concave'){
  const a=1.05,R=Math.max(1.25,c.curvature),edge=.035,half=R-Math.sqrt(R*R-a*a)+edge;
  volume(c.experiment==='convex'?SHAPE.CONVEX:SHAPE.CONCAVE,MEDIUM.GLASS,[0,2.3,0],[a,a,half],-Math.PI/2,[R,edge,0,0]);target=[0,2.3,0];aperture=1.25;
 }
 if(c.experiment==='prism'){
  const half=c.prismAngle*Math.PI/360;volume(SHAPE.PRISM,MEDIUM.GLASS,[0,2.1,0],[.9,.9,1.8*Math.tan(half)],0,[Math.sin(half),Math.cos(half),0,0]);target=[0,2.1,0];towardLight=[0,-Math.sin(Math.PI/18),Math.cos(Math.PI/18)];aperture=.6;aspect=.04;
 }
 if(c.experiment==='water'||c.experiment==='tank'){
  if(c.experiment==='tank'){
   volume(SHAPE.BOX,MEDIUM.GLASS,[0,1.12,0],[2.12,1.12,1.62]);
   volume(SHAPE.BOX,MEDIUM.AIR,[0,1.35,0],[2.02,1.22,1.52]); // open top
  }
  const bottom=c.experiment==='tank'?.13:0,height=c.waterHeight;
  volume(SHAPE.WATER,MEDIUM.WATER,[0,(height+bottom)/2,0],[c.experiment==='tank'?2.02:2.5,(height-bottom)/2,c.experiment==='tank'?1.52:2.5],0,[c.wave,c.phase,0,0]);
  if(c.experiment==='tank')for(const [x,z,r] of [[-.95,-.35,.43],[.08,.45,.37],[1.02,-.25,.48]]){
   const level=height+waveHeight(x,z,c.wave,c.phase),f=floatingHeight(r,c.shell,level,bottom),center=[x,f.y,z];floats.push({...f,radius:r,center,shell:c.shell});
   volume(SHAPE.SPHERE,MEDIUM.GLASS,center,[r,r,r]);const inner=Math.max(.03,r-c.shell);volume(SHAPE.SPHERE,MEDIUM.AIR,center,[inner,inner,inner]);
  }
  target=[0,height,0];aperture=c.experiment==='tank'?2.45:2.7;towardLight=norm([.16,1,.22]);
 }
 if(c.experiment==='flat-mirror'||c.experiment==='concave-mirror'){
  const angle=40*Math.PI/180;
  volume(SHAPE.MIRROR,MEDIUM.MIRROR,[0,3.2,0],[1.25,1.25,.5],angle,[c.experiment==='concave-mirror'?1/(4*c.focal):0,0,0,0]);
  target=[0,3.2,0];towardLight=rotateX([0,0,1],angle);aperture=1.4;
 }
 towardLight=rotateX(towardLight,c.aim*Math.PI/180);
 const distance=c.experiment.includes('mirror')?3:5;
 const light={origin:add(target,mul(towardLight,distance)),direction:mul(towardLight,-1),aperture,aspect,source:c.source,color:c.color,power:c.power,spread:c.spread*Math.PI/180};
 return {volumes,light,config:c,floats};
}
export function shapeDistance(v,q){
 const s=v.size,p=v.params;
 if(v.type===SHAPE.SPHERE)return Math.hypot(...q)-s[0];
 if(v.type===SHAPE.BOX){const d=q.map((x,i)=>Math.abs(x)-s[i]);return Math.hypot(...d.map(x=>Math.max(0,x)))+Math.min(Math.max(...d),0);}
 if(v.type===SHAPE.WATER)return Math.max(Math.abs(q[0])-s[0],Math.abs(q[2])-s[2],-s[1]-q[1],q[1]-s[1]-waveHeight(q[0],q[2],p[0],p[1]));
 if(v.type===SHAPE.PRISM)return Math.max(Math.abs(q[0])-s[0],-q[1]-s[1],p[0]*q[1]+p[1]*Math.abs(q[2])-p[0]*s[1]);
 const radial=Math.hypot(q[0],q[1]);
 if(v.type===SHAPE.MIRROR)return Math.abs(q[2]-p[0]*radial*radial);
 const R=p[0],shift=v.type===SHAPE.CONVEX?Math.sqrt(R*R-s[0]*s[0])-p[1]:R+p[1];
 const a=Math.hypot(q[0],q[1],q[2]-shift)-R,b=Math.hypot(q[0],q[1],q[2]+shift)-R;
 return v.type===SHAPE.CONVEX?Math.max(radial-s[0],a,b):Math.max(radial-s[0],Math.abs(q[2])-s[2],-a,-b);
}
export function mediumAt(scene,p){let medium=0;for(const v of scene.volumes)if(v.type!==SHAPE.MIRROR&&shapeDistance(v,localPoint(v,p))<0)medium=v.medium;return medium;}
export function materialIOR(medium,channel=1,dispersion=false){return medium===1?(dispersion?[1.513,1.52,1.535][channel]:1.52):medium===2?(dispersion?[1.331,1.334,1.34][channel]:1.333):1;}
export function absorption(medium,channel){return medium===1?[.018,.009,.005][channel]:medium===2?[.20,.055,.022][channel]:0;}
export function reflectDirection(d,n){return sub(d,mul(n,2*dot(d,n)));}
export function refractDirection(d,n,ni,nt){const ratio=ni/nt,c=-dot(d,n),k=1-ratio*ratio*(1-c*c);return k<0?null:norm(add(mul(d,ratio),mul(n,ratio*c-Math.sqrt(k))));}
function roots(a,b,c){if(Math.abs(a)<1e-12)return Math.abs(b)>1e-12?[-c/(2*b)]:[];const disc=b*b-a*c;if(disc<0)return [];const s=Math.sqrt(disc);return [(-b-s)/a,(-b+s)/a].sort((a,b)=>a-b);}
function boxInterval(o,d,size){let near=-Infinity,far=Infinity;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(Math.abs(o[k])>size[k])return null;continue;}const a=(-size[k]-o[k])/d[k],b=(size[k]-o[k])/d[k];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}return near<=far?[near,far]:null;}
export function nearestBoundary(scene,origin,direction,{receivers=true}={}){
 let best=null,limit=60;
 function offer(t,v){
  if(t<RAY_EPS||t>=limit||!Number.isFinite(t))return false;
  // A glass bottom may touch the diffuse receiver. Prefer the receiver for
  // coincident roots; roundoff must not randomly create a glass/air TIR gap.
  if(best?.receiver!==undefined&&t>=limit-.001&&Math.abs(shapeDistance(v,localPoint(v,best.point)))<.00001)return false;
  const point=pointAt(origin,direction,t),q=localPoint(v,point);
  if(v.type===SHAPE.MIRROR){if(Math.hypot(q[0],q[1])>v.size[0])return false;}
  else{
   if(Math.abs(shapeDistance(v,q))>.002)return false;
   const localD=rotateX(direction,-v.rotation);
   const before=shapeDistance(v,pointAt(q,localD,-RAY_EPS*2))<0,after=shapeDistance(v,pointAt(q,localD,RAY_EPS*2))<0;
   if(before===after)return false;
   // Reject candidate roots which belong to an inactive part of a CSG lens.
  }
  let n;
  if(v.type===SHAPE.MIRROR)n=norm([-2*v.params[0]*q[0],-2*v.params[0]*q[1],1]);
  else{const e=.0001;n=norm([0,1,2].map(k=>{const a=[...q],b=[...q];a[k]+=e;b[k]-=e;return shapeDistance(v,a)-shapeDistance(v,b);}));}
  n=rotateX(n,v.rotation);if(dot(n,direction)>0)n=mul(n,-1);
  best={t,point,normal:n,id:v.id,mirror:v.type===SHAPE.MIRROR};limit=t;return true;
 }
 if(receivers){
  if(direction[1]<-1e-8){const t=-origin[1]/direction[1],p=pointAt(origin,direction,t);if(t>RAY_EPS&&Math.abs(p[0])<6&&Math.abs(p[2])<6){best={t,point:p,normal:[0,1,0],id:100,receiver:0};limit=t;}}
  if(direction[2]<-1e-8){const t=(-5.8-origin[2])/direction[2],p=pointAt(origin,direction,t);if(t>RAY_EPS&&t<limit&&Math.abs(p[0])<6&&p[1]>=0&&p[1]<6){best={t,point:p,normal:[0,0,1],id:101,receiver:1};limit=t;}}
 }
 for(const v of scene.volumes){
  const o=localPoint(v,origin),d=rotateX(direction,-v.rotation),s=v.size;
  if(v.type===SHAPE.SPHERE){for(const t of roots(dot(d,d),dot(o,d),dot(o,o)-s[0]*s[0]))offer(t,v);}
  else if(v.type===SHAPE.BOX){const h=boxInterval(o,d,s);if(h)for(const t of h)offer(t,v);}
  else if(v.type===SHAPE.PRISM){
   for(const [n,k] of [[[1,0,0],s[0]],[[-1,0,0],s[0]],[[0,-1,0],s[1]],[[0,v.params[0],v.params[1]],v.params[0]*s[1]],[[0,v.params[0],-v.params[1]],v.params[0]*s[1]]]){const denominator=dot(n,d);if(Math.abs(denominator)>1e-10)offer((k-dot(n,o))/denominator,v);}
  }
  else if(v.type===SHAPE.WATER){
   const bounds=[s[0],s[1]+v.params[0],s[2]],h=boxInterval(o,d,bounds);if(!h)continue;
   let t=Math.max(RAY_EPS,h[0]);const end=Math.min(h[1]+.001,limit);
   for(let i=0;i<100&&t<=end;i++){
    const f=shapeDistance(v,pointAt(o,d,t));if(Math.abs(f)<.00008){if(offer(t,v))break;t+=RAY_EPS*6;}
    else t+=Math.max(RAY_EPS,Math.abs(f)/(1+4*v.params[0]));
   }
  }else if(v.type===SHAPE.MIRROR){const k=v.params[0];for(const t of roots(-k*(d[0]**2+d[1]**2),(d[2]-2*k*(o[0]*d[0]+o[1]*d[1]))/2,o[2]-k*(o[0]**2+o[1]**2)))offer(t,v);}
  else{
   const R=v.params[0],shift=v.type===SHAPE.CONVEX?Math.sqrt(R*R-s[0]*s[0])-v.params[1]:R+v.params[1];
   for(const z of [-shift,shift]){const q=[o[0],o[1],o[2]-z];for(const t of roots(dot(d,d),dot(q,d),dot(q,q)-R*R))offer(t,v);}
   for(const t of roots(d[0]**2+d[1]**2,o[0]*d[0]+o[1]*d[1],o[0]**2+o[1]**2-s[0]**2))offer(t,v);
   if(Math.abs(d[2])>1e-8)for(const z of [-s[2],s[2]])offer((z-o[2])/d[2],v);
  }
 }
 if(best&&best.id<100){best.before=mediumAt(scene,pointAt(best.point,direction,-RAY_EPS*2));best.after=mediumAt(scene,pointAt(best.point,direction,RAY_EPS*2));}
 return best;
}
export function interfaceEvent(hit,direction,channel,dispersion=false){
 if(hit.mirror)return {reflectance:.95,reflected:reflectDirection(direction,hit.normal),transmitted:null};
 const ni=materialIOR(hit.before,channel,dispersion),nt=materialIOR(hit.after,channel,dispersion);
 const reflectance=ni===nt?0:fresnelDielectric(Math.max(0,-dot(direction,hit.normal)),ni,nt);
 return {reflectance,reflected:reflectDirection(direction,hit.normal),transmitted:refractDirection(direction,hit.normal,ni,nt)};
}
