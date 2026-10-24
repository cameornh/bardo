// A bounded surface tracer, not bulk liquid: foam never adds mass or pressure
// to the water solver. The lattice is fixed in world space, independent of view.
export const SEA_FOAM_SIZE=96;
export const SEA_FOAM_MAX_COVERAGE=.85;
export const SEA_FOAM_WATER_LIFE=95;
export const SEA_FOAM_SAND_LIFE=210;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const organicFoam=load=>1-Math.exp(-Math.max(0,load));

// Breakers in shallow water replenish foam; ordinary surface motion does not.
// Converging currents select streaks/rafts within that shallow band. The low
// offshore source allows isolated breaking crests without carpeting the sea.
export function focusSeaFoamSources(surface,flow,n,scale,spacing){
 const dx=11/n,dz=9.8/n,shoreDepth=Math.max(2,spacing*scale*2.5);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const o=(z*n+x)*4;if(flow[o+3]<.5){surface[o+3]=0;continue;}
  const left=(z*n+Math.max(0,x-1))*4,right=(z*n+Math.min(n-1,x+1))*4,back=(Math.max(0,z-1)*n+x)*4,front=(Math.min(n-1,z+1)*n+x)*4;
  const convergence=Math.max(0,-((flow[right+3]>.5?flow[right]:0)-(flow[left+3]>.5?flow[left]:0))/(2*dx)-((flow[front+3]>.5?flow[front+1]:0)-(flow[back+3]>.5?flow[back+1]:0))/(2*dz));
  const depth=Math.max(0,(surface[o]-surface[o+1])*scale),shoal=Math.exp(-depth/shoreDepth),activity=surface[o+3];
  surface[o+3]=clamp(smooth(.06,.6,activity)*(.12+1.8*shoal)*(.4+.6*smooth(.015,.18,convergence)));
 }
}

// Surface channels: water height, sand height, organic activation, aeration.
// Flow channels: horizontal velocity x/z, vertical velocity, wet flag.
export class SeaFoamSurface {
 constructor(size=SEA_FOAM_SIZE){this.size=size;this.surface=new Float32Array(size*size*4);this.flow=new Float32Array(size*size*4);this.weights=new Float32Array(size*size);this.terrainRevision=-1;}
 update(lab){
  const n=this.size,s=lab.spacing,scale=lab.spec.scale,dx=11/n,dz=9.8/n,r=Math.max(s*.85,Math.hypot(dx,dz)*.55),r2=r*r,p=lab.positions,v=lab.velocities,a=this.surface,f=this.flow;
  f.fill(0);this.weights.fill(0);let totalOrganic=0;
  const terrainChanged=this.terrain!==lab.sand||this.terrainRevision!==lab.sand.revision;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const o=(z*n+x)*4;a[o]=-100;a[o+2]=a[o+3]=0;if(terrainChanged)a[o+1]=lab.terrainHeight((x+.5)*dx-5.5,(z+.5)*dz-4.9);}
  this.terrain=lab.sand;this.terrainRevision=lab.sand.revision;
  // Two bounded splats: find the upper liquid layer, then average only its
  // velocities/chemistry. Deep water cannot dilute the surface current.
  for(let pass=0;pass<2;pass++)for(let i=0;i<lab.count;i++){
   const o=i*4;if(p[o+3]||(lab.neighborCounts?.[i]??18)<5&&lab.steps>0)continue;
   const x0=Math.max(0,Math.ceil((p[o]-r+5.5)/dx-.5)),x1=Math.min(n-1,Math.floor((p[o]+r+5.5)/dx-.5)),z0=Math.max(0,Math.ceil((p[o+2]-r+4.9)/dz-.5)),z1=Math.min(n-1,Math.floor((p[o+2]+r+4.9)/dz-.5));
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const d2=((x+.5)*dx-5.5-p[o])**2+((z+.5)*dz-4.9-p[o+2])**2;if(d2>r2)continue;const k=z*n+x,b=k*4,top=p[o+1]+s*.32;
    if(pass===0){a[b]=Math.max(a[b],top);continue;}if(top<a[b]-s*.65)continue;
    const w=Math.max(.001,1-d2/r2);this.weights[k]+=w;f[b]+=v[o]*w;f[b+1]+=v[o+2]*w;f[b+2]+=v[o+1]*w;
    a[b+2]+=Math.max(0,(lab.tannins||0)+(lab.chem?.[o+1]||0))*w;
    a[b+3]+=clamp((lab.surfaceMetrics?.[o+3]||0)*.35+Math.max(lab.aerationActivity?.[i*2]||0,lab.aerationActivity?.[i*2+1]||0)*.25-.035)*w;
   }
  }
  for(let k=0;k<n*n;k++){const o=k*4,w=this.weights[k];if(w){for(let c=0;c<3;c++)f[o+c]/=w;a[o+2]=organicFoam(a[o+2]/w);a[o+3]/=w;}f[o+3]=w>0&&a[o]>a[o+1]+.025/scale?1:0;totalOrganic+=a[o+2];}
  // A rock crossing the free surface is an obstacle, never an emission site.
  for(const b of lab.balls||[]){const r=b.radius*1.1,x0=Math.max(0,Math.floor((b.position[0]-r+5.5)/dx)),x1=Math.min(n-1,Math.floor((b.position[0]+r+5.5)/dx)),z0=Math.max(0,Math.floor((b.position[2]-r+4.9)/dz)),z1=Math.min(n-1,Math.floor((b.position[2]+r+4.9)/dz));
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const o=(z*n+x)*4;if(((x+.5)*dx-5.5-b.position[0])**2+(a[o]-b.position[1])**2+((z+.5)*dz-4.9-b.position[2])**2<b.radius*b.radius){f[o+3]=0;a[o+3]=0;}}
  }
  focusSeaFoamSources(a,f,n,scale,s);this.organic=totalOrganic;return this;
 }
}

// Conservative donor-cell transport. A cell exports at most 45% of its foam
// per step, and receivers gather the same flux. Land keeps stranded foam;
// incoming water lifts it again. Fixed storage and a local coverage ceiling
// provide a hard upper bound, even during an indefinitely running storm.
export function stepSeaFoam(state,surface,flow,n,dt,out=new Float32Array(state.length)){
 const dx=11/n,dz=9.8/n;
 const flux=(k,axis,sign)=>{
  const o=k*4;if(flow[o+3]<.5)return 0;
  const vx=flow[o],vz=flow[o+1],lim=Math.min(1,.45/Math.max(1e-9,dt*(Math.abs(vx)/dx+Math.abs(vz)/dz)));
  return state[o]*Math.max(0,sign*flow[o+axis])*dt/(axis===0?dx:dz)*lim;
 };
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const k=z*n+x,o=k*4,wet=flow[o+3]>.5;let floating=state[o],land=state[o+1];
  if(x>0)floating+=flux(k-1,0,1)-flux(k,0,-1);if(x<n-1)floating+=flux(k+1,0,-1)-flux(k,0,1);
  if(z>0)floating+=flux(k-n,1,1)-flux(k,1,-1);if(z<n-1)floating+=flux(k+n,1,-1)-flux(k,1,1);
  if(wet){const lift=land*(1-Math.exp(-dt*2.5));floating+=lift;land-=lift;}else{land+=floating;floating=0;}
  floating*=Math.exp(-dt/SEA_FOAM_WATER_LIFE);land*=Math.exp(-dt/SEA_FOAM_SAND_LIFE);
  const source=wet?surface[o+2]*surface[o+3]*.12*dt:0;
  floating+=source*Math.max(0,1-(floating+land)/SEA_FOAM_MAX_COVERAGE);
  const limit=Math.min(1,SEA_FOAM_MAX_COVERAGE/Math.max(1e-9,floating+land));out[o]=Math.max(0,floating*limit);out[o+1]=Math.max(0,land*limit);out[o+2]=out[o+3]=0;
 }
 return out;
}

export const SEA_FOAM_STEP_GLSL=`
uniform sampler2D uSeaState,uSeaSurface,uSeaFlow;uniform int uSeaSize;uniform float uSeaDt;
vec4 field(ivec2 p){return texelFetch(uSeaFlow,p,0);}
float flux(ivec2 p,int axis,float sign){vec4 f=field(p);if(f.w<.5)return 0.;vec2 cell=vec2(11.,9.8)/float(uSeaSize);float limit=min(1.,.45/max(1e-9,uSeaDt*dot(abs(f.xy),1./cell)));return texelFetch(uSeaState,p,0).r*max(0.,sign*f[axis])*uSeaDt/cell[axis]*limit;}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec2 foam=texelFetch(uSeaState,p,0).rg;bool wet=field(p).w>.5;
 if(p.x>0)foam.x+=flux(p-ivec2(1,0),0,1.)-flux(p,0,-1.);if(p.x<uSeaSize-1)foam.x+=flux(p+ivec2(1,0),0,-1.)-flux(p,0,1.);
 if(p.y>0)foam.x+=flux(p-ivec2(0,1),1,1.)-flux(p,1,-1.);if(p.y<uSeaSize-1)foam.x+=flux(p+ivec2(0,1),1,-1.)-flux(p,1,1.);
 if(wet){float lift=foam.y*(1.-exp(-uSeaDt*2.5));foam+=vec2(lift,-lift);}else{foam.y+=foam.x;foam.x=0.;}
 foam*=exp(-uSeaDt/vec2(${SEA_FOAM_WATER_LIFE}.,${SEA_FOAM_SAND_LIFE}.));vec4 s=texelFetch(uSeaSurface,p,0);float source=wet?s.z*s.w*.12*uSeaDt:0.;foam.x+=source*max(0.,1.-(foam.x+foam.y)/${SEA_FOAM_MAX_COVERAGE});
 foam*=min(1.,${SEA_FOAM_MAX_COVERAGE}/max(1e-9,foam.x+foam.y));outColor=vec4(max(foam,vec2(0)),0,0);
}`;
