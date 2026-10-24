// Rendering only: solver parcels, forces, mass and timesteps never depend on
// the camera. Fine kernels are retained at every exposed liquid boundary.
export const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function stableDrawingSize(width,height,adaptive=true,fixedScale){
 // Keep the old loaded-scene pixel budget, without motion-driven reallocations.
 const scale=fixedScale??(adaptive?.5:1);
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),scale};
}
export function distanceDetail(distance,spacing,pixelsPerUnit,motion=1){
 const footprint=spacing*pixelsPerUnit/Math.max(spacing,distance);
 const far=1-smooth(4,36,footprint);
 return 1+far*3+Math.min(1,Math.max(0,motion-1)*.12)*(.15+.85*far);
}
// Bounded double-precision reference for the shader's interpolated entry/exit
// search. Useful for camera sweeps without constructing a graphics context.
export function traceDensityInterval(density,origin,direction,{spacing,focal=320,motion=1,limit=30}={}){
 const at=t=>origin.map((v,k)=>v+direction[k]*t),iso=.18;
 let t=0,last=0,entry=null,samples=0;
 const refine=(lo,hi,enter)=>{for(let i=0;i<9;i++){const mid=(lo+hi)/2;if((density(at(mid))>=iso)===enter)hi=mid;else lo=mid;samples++;}return (lo+hi)/2;};
 if(density(origin)>=iso)entry=0;
 for(let i=0;i<512&&t<=limit;i++){
  const inside=density(at(t))>=iso;samples++;
  if(entry===null&&inside)entry=refine(last,t,true);
  else if(entry!==null&&!inside)return {entry,exit:refine(last,t,false),samples};
  last=t;t+=spacing*(entry===null?.28:.35)*distanceDetail(t,spacing,focal,motion);
 }
 return {entry,exit:null,samples};
}
// World-space, moment-matched mixture. Linear mixture weights conserve volume,
// centre of mass and chemical mass throughout the transition. Only quiet,
// surrounded cells participate; spray, banks and thin sheets stay full detail.
const address=(x,y,z)=>(x+512)+(y+512)*1024+(z+512)*1048576;
const offsets=[];for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)if(x||y||z)offsets.push(x+y*1024+z*1048576);
export class InteriorWaterCompression {
 constructor(){this.groups=new Map();}
 update(items,lab,dt=1/15){
  const s=lab.spacing,key=`${lab.generation}/${s}`;
  if(this.key!==key){this.key=key;this.groups.clear();}
  for(const g of this.groups.values()){g.items.length=0;g.volume=g.x=g.y=g.z=g.dye=g.tannin=g.sediment=g.moment=g.speed2=g.work=0;}
  let unchangedWork=0;const result=[],groups=this.groups,cellSize=s*2,scale2=lab.spec.scale**2,velocity=lab.velocities;
  for(const p of items){
   if(p.boundaryImage||p.flatten||p.sourceIndex===undefined){result.push(p);unchangedWork+=Math.max(.018,p.radius*.95)**3*(p.flatten||1);continue;}
   const [x,y,z]=p.position,cx=Math.floor(x/cellSize),cy=Math.floor(y/cellSize),cz=Math.floor(z/cellSize);
   // Retain the exact kernel outside the bounded numeric indexing domain.
   if(Math.max(Math.abs(cx),Math.abs(cy),Math.abs(cz))>510){result.push(p);unchangedWork+=Math.max(.018,p.radius*.95)**3*(p.flatten||1);continue;}
   const key=address(cx,cy,cz);let g=groups.get(key);
   if(!g){g={items:[],residual:[],coarse:{kind:'water',position:[0,0,0],wet:0},phase:0,eligible:false,volume:0,x:0,y:0,z:0,dye:0,tannin:0,sediment:0,moment:0,speed2:0,work:0};groups.set(key,g);}
   const volume=p.volume,sigma=Math.max(.018,p.radius*.95),o=p.sourceIndex*4;
   g.items.push(p);g.volume+=volume;g.x+=x*volume;g.y+=y*volume;g.z+=z*volume;
   g.dye+=(p.dye||0)*volume;g.tannin+=(p.tannin||0)*volume;g.sediment+=(p.sediment||0)*volume;
   g.moment+=volume*(sigma*sigma+(x*x+y*y+z*z)/3);g.work+=sigma**3;
   g.speed2+=(velocity[o]**2+velocity[o+1]**2+velocity[o+2]**2)*scale2*volume;
  }
  let merged=0,voxelWork=unchangedWork,referenceWork=unchangedWork;
  for(const [key,g] of groups){
   if(!g.items.length){groups.delete(key);continue;}
   let surrounded=g.items.length>=4;for(const offset of offsets){if(!surrounded)break;if((groups.get(key+offset)?.items.length||0)<4)surrounded=false;}
   const x=g.x/g.volume,y=g.y/g.volume,z=g.z/g.volume,dye=g.dye/g.volume,tannin=g.tannin/g.volume,sediment=g.sediment/g.volume;
   let chemError=0;for(const p of g.items)chemError=Math.max(chemError,Math.abs((p.dye||0)-dye),Math.abs((p.tannin||0)-tannin),Math.abs((p.sediment||0)-sediment));
   // Eligibility has hysteresis, but the actual density transition is smooth.
   // A fractional quietness target kept BOTH representations alive forever.
   const speed=Math.sqrt(g.speed2/g.volume);
   g.eligible=surrounded&&speed<(g.eligible?1.05:.55)&&chemError<(g.eligible?.04:.015);
   const target=g.eligible?1:0;
   g.phase+=Math.max(-dt/.4,Math.min(dt/.9,target-g.phase));const blend=smooth(0,1,g.phase);referenceWork+=g.work;
   if(blend<1){for(let i=0;i<g.items.length;i++){const p=g.items[i];if(!blend)result.push(p);else{const q=g.residual[i]??={};Object.assign(q,p);q.volume=p.volume*(1-blend);result.push(q);}}voxelWork+=g.work;}
   if(blend>0){const sigma=Math.sqrt(Math.max(1e-12,g.moment/g.volume-(x*x+y*y+z*z)/3)),q=g.coarse;q.position[0]=x;q.position[1]=y;q.position[2]=z;Object.assign(q,{radius:sigma/.95,volume:g.volume*blend,dye,tannin,sediment});result.push(q);voxelWork+=sigma**3;merged++;}
  }
  this.stats={sourceKernels:items.length,kernels:result.length,mergedCells:merged,estimatedVoxelWork:voxelWork/Math.max(1e-20,referenceWork),backend:'CPU grouping / GPU Gaussian reconstruction; CPU field fallback'};
  return result;
 }
}

// Continuous distance/motion control, without reallocating the screen grid or
// switching between discrete distance bands. Derivatives stay zero at the ends.
export const DISTANCE_DETAIL_GLSL=`
uniform float uDetailMotion;uniform bool uDistanceDetail;
float waterDetailScale(float distance){
 if(!uDistanceDetail)return 1.;
 float focal=uResolution.y*uProjection[1][1]*.5;
 float footprint=uSpacing*focal/max(uSpacing,distance),far=1.-smoothstep(4.,36.,footprint);
 return 1.+far*3.+min(1.,max(0.,uDetailMotion-1.)*.12)*(.15+.85*far);
}
float waterTraceStep(float distance){return uSpacing*.28*waterDetailScale(distance);}
`;

export const WATER_SURFACE_SEARCH_GLSL=`float traceWater(vec3 o,vec3 d,float begin,float end,bool viewDependent){float t=begin,last=t;if(begin>end)return 1e4;for(int i=0;i<512;i++){float skip=fieldEmptyAdvance(o+d*t,d,PARCEL_ISO);if(skip>0.){float until=t+skip;int skipped=0;for(int j=0;j<32;j++){if(i+skipped>=512)break;last=t;t+=(viewDependent?waterTraceStep(t):uSpacing*.28);skipped++;if(t>=until||t>end)break;}i+=skipped-1;if(t>end)break;continue;}if(rho(o+d*t)>=PARCEL_ISO){float a=last,b=t;for(int j=0;j<9;j++){float m=(a+b)*.5;if(rho(o+d*m)<PARCEL_ISO)a=m;else b=m;}return (a+b)*.5;}last=t;t+=(viewDependent?waterTraceStep(t):uSpacing*.28);if(t>end)break;}return 1e4;}`;
export const WATER_COLUMN_GLSL=`vec4 waterColumn(vec3 p,vec3 direction,float depth){
 float path=0.,stepSize=uSpacing*.35*waterDetailScale(depth);vec3 sum=vec3(0);bool exited=false;
 vec4 previous=parcelSample(p);vec3 priorChemical=previous.yzw/max(previous.x,.0001);
 for(int i=0;i<100;i++){
  float next=path+stepSize;vec4 a=parcelSample(p+direction*next);if(a.x<PARCEL_ISO){exited=true;break;}
  vec3 chemical=a.yzw/max(a.x,.0001);sum+=(priorChemical+chemical)*(.5*stepSize);priorChemical=chemical;path=next;
 }
 // Refine once after the march, keeping the shader's large loops unnested.
 if(exited){
  float lo=path,hi=path+stepSize;for(int j=0;j<9;j++){float mid=(lo+hi)*.5;if(rho(p+direction*mid)>=PARCEL_ISO)lo=mid;else hi=mid;}
  float next=(lo+hi)*.5;vec4 a=parcelSample(p+direction*((path+next)*.5));sum+=a.yzw/max(a.x,.0001)*(next-path);path=next;
 }
 return vec4(sum/max(.00001,path),path);
}`;
