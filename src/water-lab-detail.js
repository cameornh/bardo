import * as THREE from 'three';
import {DetailFlowField,DETAIL_ENVIRONMENT_GLSL,detailFluidMotion,projectDetailSurface,detailContact,emptyGeometryUniforms} from './water-lab-detail-environment.js';
import {WATER_MATERIAL} from './water-material.js';
import {QUAD_VERTEX} from './shaders.js';
import {BEACH_WIND_GLSL,windAt} from './beach-wind.js';
import {hash,clamp,NEIGHBORS} from './water-lab-model.js';

export const DETAIL_CAPACITY=131072;
// Emission represents an aerated physical volume, not one fixed quota per
// solver parcel. Refining the same volume must not multiply its foam supply.
export function detailEmissionWeight(spacing,scale,neighbors=18,activity=null){
  const h=spacing*scale,support=clamp((neighbors-2)/10,0,1);
  const weber=activity===null?Infinity:WATER_MATERIAL.density*h*activity*activity/WATER_MATERIAL.surfaceTension;
  return (h/.25)**3*support*support*clamp((weber-2)/18,0,1);
}
export function detailAirExposure(lab,i){
  const neighbors=lab.gpu?.neighbors;if(!neighbors)return 1;
  const s=lab.spacing,o=i*4,p=[0,1,2].map(k=>lab.positions[o+k]+lab.surfaceMetrics[o+k]*s*.8);
  const contribution=j=>{const q=j*4,r2=(p[0]-lab.positions[q])**2+(p[1]-lab.positions[q+1])**2+(p[2]-lab.positions[q+2])**2;
    return 315/(512*Math.PI)*Math.max(0,1-r2/(4*s*s))**3;};
  let density=contribution(i);
  for(let k=0;k<NEIGHBORS;k++){const j=neighbors[i*NEIGHBORS+k];if(j<0)break;density+=contribution(j);}
  const t=clamp((density-.22)/.28,0,1);return 1-t*t*(3-2*t);
}
// A Gaussian represents a small froth/mist cluster at unresolved large scales,
// and sub-mm bubbles in miniature fixtures. Radius normally stays below 8% of
// parcel spacing, with a microscopic floor and perspective coverage filtering.
export function detailRadius(spacing,scale,random){
  return Math.max(spacing*scale*.045,.0003)*(.35+1.4*random);
}
export function detailStep(position,velocity,kind,scale,dt,time,wind,turbulence,jet,radius,strength){
  const air=windAt(position[0]*scale,position[2]*scale,time,wind,0,turbulence),target=[air[0]/scale,0,air[1]/scale];
  if(jet){const q=position.map((v,k)=>v-jet.origin[k]),t=q.reduce((v,x,k)=>v+x*jet.direction[k],0),r2=q.reduce((v,x,k)=>v+(x-t*jet.direction[k])**2,0),w=t>0?Math.exp(-r2/(radius*radius))*Math.exp(-t/25):0;for(let k=0;k<3;k++)target[k]+=jet.direction[k]*strength/scale*w;}
  const drag=kind===2?3:kind===1?.45:1.1,mix=1-Math.exp(-drag*dt),v=velocity.map((v,k)=>v+(target[k]-v)*mix);
  v[1]+=(kind===2?.45:kind===1?-.12:-9.81)/scale*dt;
  return {position:position.map((p,k)=>p+v[k]*dt),velocity:v};
}
const simulation=`precision highp float;precision highp int;in vec2 vUv;
layout(location=0)out vec4 nextPosition;layout(location=1)out vec4 nextVelocity;layout(location=2)out vec4 nextInfo;
uniform highp sampler2D uDetailP,uDetailV,uDetailI,uSpawnP,uSpawnV,uSpawnI;
uniform int uSpawnStart,uSpawnCount,uCapacity;uniform float uDt,uScale,uTime,uWind,uTurbulence,uBrushRadius,uBrushStrength;
uniform vec3 uBrushOrigin,uBrushDirection;
${BEACH_WIND_GLSL}
${DETAIL_ENVIRONMENT_GLSL}
void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);int i=pixel.y*256+pixel.x,spawn=(i-uSpawnStart+uCapacity)%uCapacity;vec4 p=texelFetch(uDetailP,pixel,0),v=texelFetch(uDetailV,pixel,0),info=texelFetch(uDetailI,pixel,0);
if(spawn<uSpawnCount){ivec2 s=ivec2(spawn%256,spawn/256);p=texelFetch(uSpawnP,s,0);v=texelFetch(uSpawnV,s,0);info=texelFetch(uSpawnI,s,0);}
p.w+=uDt;if(p.w<v.w){vec3 start=p.xyz;bool born=spawn<uSpawnCount;if(born&&uDetailFlow&&info.y<1.5){detailProject(p.xyz,info.y<.5?.08:.18,.55);detailContact(start,p.xyz,v.xyz,max(.0005,info.x*2.),false);start=p.xyz;}bool wet;detailWetMotion(p.xyz,v.xyz,info.y,p.w,uDt,uScale,wet);if(!wet){vec2 air=beachWind(p.xz*uScale,uTime,uWind,0.,uTurbulence)/uScale;vec3 target=vec3(air.x,0,air.y),q=p.xyz-uBrushOrigin;float along=dot(q,uBrushDirection);if(along>0.)target+=uBrushDirection*uBrushStrength/uScale*exp(-dot(q-uBrushDirection*along,q-uBrushDirection*along)/(uBrushRadius*uBrushRadius))*exp(-along/25.);
float drag=info.y>1.5?3.:info.y>.5?.45:1.1;v.xyz+=(target-v.xyz)*(1.-exp(-drag*uDt));v.y+=(info.y>1.5?.45:info.y>.5?-.12:-9.81)/uScale*uDt;p.xyz+=v.xyz*uDt;}detailContact(start,p.xyz,v.xyz,max(.0005,info.x*2.),!born);info.w=uDetailCollision?labSolid(p.xyz):100.;}
nextPosition=p;nextVelocity=v;nextInfo=info;}`;
function texture(data){const t=new THREE.DataTexture(data,256,data.length/1024,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;}
function sourceNoise(position,normal,spacing,time,seed){
  // Smooth, bounded variation shared by each emitter's particles. Keep most
  // of it tangent to the surface so fine foam stays near its source interface.
  const drift=position.map((_,k)=>{
    const phase=(position[k]*.8+position[(k+1)%3]*.45+position[(k+2)%3]*.3)/spacing+time*.6,cell=Math.floor(phase),u=phase-cell,f=u*u*(3-2*u),key=seed*23+k*107;
    return (hash(key+cell*17)*(1-f)+hash(key+(cell+1)*17)*f-.5)*spacing*.24;
  });
  const along=drift.reduce((sum,v,k)=>sum+v*normal[k],0);
  return drift.map((v,k)=>v-normal[k]*along*.85);
}
export class LabDetail {
  constructor(renderer,capacity=DETAIL_CAPACITY){
    this.renderer=renderer;this.capacity=Math.ceil(capacity/256)*256;this.cpu=!renderer.extensions.has('EXT_color_buffer_float');this.enabled=true;this.density=1;
    this.flow=new DetailFlowField(renderer);this.geometryDefaults=emptyGeometryUniforms();
    this.u={...this.geometryDefaults,...this.flow.u,uDetailFlow:{value:false},uDetailCollision:{value:false},uDetailSpacing:{value:.25},uPreviousContainer:{value:new THREE.Vector3(0,2,0)},uPreviousTilt:{value:0},uPreviousSpin:{value:0},uWallVelocity:{value:new THREE.Vector3()},uWallTiltSpeed:{value:0},uWallSpinSpeed:{value:0},uDetailP:{value:null},uDetailV:{value:null},uDetailI:{value:null},uSpawnP:{value:null},uSpawnV:{value:null},uSpawnI:{value:null},uSpawnStart:{value:0},uSpawnCount:{value:0},uCapacity:{value:this.capacity},uDt:{value:0},uScale:{value:1},uTime:{value:0},uWind:{value:0},uTurbulence:{value:0},uBrushRadius:{value:1},uBrushStrength:{value:0},uBrushOrigin:{value:new THREE.Vector3()},uBrushDirection:{value:new THREE.Vector3(0,0,1)}};
    this.spawn=Array.from({length:3},()=>texture(new Float32Array(this.capacity*4)));
    this.fallback=Array.from({length:3},()=>texture(new Float32Array(this.capacity*4)));
    ['P','V','I'].forEach((k,i)=>this.u['uSpawn'+k].value=this.spawn[i]);
    this.expiry=new Float64Array(this.capacity);this.geometry=new THREE.PlaneGeometry(2,2);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:simulation,uniforms:this.u,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.reset();
  }
  reset(){this.previousMotion=null;this.cursor=0;this.pending=0;this.count=0;this.time=0;this.sequence=0;this.emitted=0;this.breakupEmitted=0;this.overwritten=0;this.expiry.fill(0);this.budget=new Float32Array(0);this.sprayBudget=new Float32Array(0);this.breakupHistory=new Float32Array(0);this.breakupBudget=new Float32Array(0);this.breakupNormals=new Float32Array(0);this.strength=new Float32Array(0);this.weights=new Float32Array(0);this.exposure=new Float32Array(0);this.sources=new Float32Array(0);for(const t of this.fallback){t.image.data.fill(0);t.needsUpdate=true;}this.clear=true;this.current=0;this.bind(this.fallback);}
  bind(textures){['P','V','I'].forEach((k,i)=>this.u['uDetail'+k].value=textures[i]);}
  emit(lab,dt){
    if(!this.enabled||this.density===0||!lab.surfaceMetrics)return;
    if(this.budget.length<lab.count){const b=new Float32Array(lab.count);b.set(this.budget);for(let i=this.budget.length;i<b.length;i++)b[i]=hash(i+35);this.budget=b;const sprayBudget=new Float32Array(lab.count);sprayBudget.set(this.sprayBudget);this.sprayBudget=sprayBudget;const strength=new Float32Array(lab.count);strength.set(this.strength);this.strength=strength;this.weights=new Float32Array(lab.count);this.exposure=new Float32Array(lab.count);const breaking=new Float32Array(lab.count);breaking.set(this.breakupHistory);this.breakupHistory=breaking;const breakingBudget=new Float32Array(lab.count);breakingBudget.set(this.breakupBudget);this.breakupBudget=breakingBudget;const normals=new Float32Array(lab.count*3);normals.set(this.breakupNormals);this.breakupNormals=normals;const history=new Float32Array(lab.count*3);history.fill(NaN);history.set(this.sources);this.sources=history;}
    const s=lab.spacing,scale=lab.spec.scale;
    let totalEnergy=0;
    for(let i=0;i<lab.count;i++){
      if(hash(i+235)>=.16&&!(lab.surfaceBreakup?.[i]>0)&&this.breakupHistory[i]<.00001){this.breakupHistory[i]=0;this.sources.fill(NaN,i*3,i*3+3);continue;}
      const o=i*4,history=i*3,point=[0,1,2].map(k=>lab.positions[o+k]+lab.surfaceMetrics[o+k]*s*.8),teleported=Number.isFinite(this.sources[history])&&Math.hypot(...point.map((v,k)=>v-this.sources[history+k]))>s*2;
      // A missing fluid neighbor can be a wall, not air. Do not seed foam
      // under the floor, inside a vessel wall or against a submerged body.
      if(lab.positions[o+3]||lab.solid&&lab.solid(point)<s*.08){this.strength[i]=0;this.sprayBudget[i]=0;this.breakupHistory[i]=0;this.breakupBudget[i]=0;this.sources.fill(NaN,history,history+3);continue;}
      if(teleported){this.strength[i]=0;this.sprayBudget[i]=0;this.breakupHistory[i]=0;this.breakupBudget[i]=0;this.sources.fill(NaN,history,history+3);}
      const signal=hash(i+235)<.16?Math.max(0,lab.surfaceMetrics[o+3]-.12):0,target=signal*signal,tau=target>this.strength[i]?.055:.18;
      this.strength[i]+=(target-this.strength[i])*(1-Math.exp(-dt/tau));
      const activity=lab.aerationActivity?Math.max(lab.aerationActivity[i*2],lab.aerationActivity[i*2+1]):null;
      const weight=detailEmissionWeight(s,scale,lab.neighborCounts?.[i]??18,activity),breaking=lab.surfaceBreakup?.[i]||0,exposure=this.strength[i]>.001||breaking>0||this.breakupHistory[i]>.00001?detailAirExposure(lab,i):0;
      this.weights[i]=weight*exposure;this.exposure[i]=exposure;
      // An unresolved breakup releases a finite burst. Remember its connected,
      // air-exposed state briefly after support is lost, instead of suppressing
      // the spray at exactly the moment the liquid separates. Every parcel can
      // seed this event; the .16 factor retains the sampled physical-volume rate.
      const event=breaking*breaking*weight*exposure*.16;
      this.breakupHistory[i]=Math.max(event,this.breakupHistory[i]*Math.exp(-dt/.12));
      if(event>0)this.breakupNormals.set(lab.surfaceMetrics.subarray(o,o+3),i*3);
      totalEnergy+=this.strength[i]*this.weights[i]+this.breakupHistory[i];
    }
    const rate=Math.min(1600,65000/Math.max(1,totalEnergy))*this.density;
    for(let i=0;i<lab.count;i++){
      const o=i*4,energy=Math.sqrt(this.strength[i]);if((energy<.035&&this.breakupHistory[i]<.00001)||lab.positions[o+3]){this.sources.fill(NaN,i*3,i*3+3);continue;}
      this.budget[i]+=dt*this.strength[i]*this.weights[i]*rate;
      // Let a small, intense patch use more of the existing global budget.
      // Discard throttled visual-marker debt so a spent impact cannot keep
      // emitting a backlog long after its activity has decayed.
      const baseCount=Math.min(2048,Math.floor(this.budget[i]));this.budget[i]=Math.min(.999,this.budget[i]-baseCount);
      // Persistent emitter patches trace the moving free surface. Small
      // markers retain coherent trajectories and accumulate into connected
      // strands without enlarging each marker.
      const r=hash(i+817),theta=hash(i+41)*Math.PI*2,z=hash(i+73)*2-1,xy=Math.sqrt(1-z*z),patch=[Math.cos(theta)*xy,z,Math.sin(theta)*xy],normal=Array.from(lab.surfaceMetrics.subarray(o,o+3));
      if(Math.hypot(...normal)<.1)for(let k=0;k<3;k++)normal[k]=this.breakupNormals[i*3+k];
      // Surface foam belongs on a reasonably upward-facing interface.
      // Falling sheets shed ballistic spray instead of floating foam trails.
      const vertical=lab.velocities[o+1]*scale,baseKind=normal[1]>.35&&vertical>-.7&&vertical<1.5?(r<.18&&energy>.8?2:1):0;
      // Keep the existing foam supply and append a modest ballistic fraction
      // at actively deforming/impacting exposed surfaces. Horizontal runback
      // can shed spray even though its normal still points upward.
      const activity=lab.aerationActivity?Math.max(lab.aerationActivity[i*2],lab.aerationActivity[i*2+1]):0;
      const activation=clamp((energy-.18)/1.1,0,1)*clamp(activity/Math.max(.1,Math.sqrt(9.81*s*scale)*.3),0,1);
      if(baseKind===1)this.sprayBudget[i]+=baseCount*.4*activation;
      this.breakupBudget[i]+=dt*this.breakupHistory[i]*rate;
      const detached=Math.floor(this.breakupBudget[i]);this.breakupBudget[i]-=detached;
      const extra=baseKind===1?Math.floor(this.sprayBudget[i]):0,count=Math.min(2048,baseCount+extra+detached);this.sprayBudget[i]-=extra;
      const tangent=patch.reduce((sum,v,k)=>sum+v*normal[k],0);for(let k=0;k<3;k++)patch[k]-=normal[k]*tangent;
      const source=normal.map((v,k)=>lab.positions[o+k]+patch[k]*s*.35+v*s*(baseKind===2?-.12:.8)),history=i*3;
      const drift=sourceNoise(source,normal,s,lab.time??this.time,i),noisy=source.map((v,k)=>v+drift[k]);
      if(!lab.solid||lab.solid(noisy)>0)for(let k=0;k<3;k++)source[k]=noisy[k];
      // Pump recycling teleports a parcel to the inlet. Never connect that
      // discontinuity with an artificial spray strand across the fixture.
      if(!Number.isFinite(this.sources[history])||Math.hypot(...source.map((v,k)=>v-this.sources[history+k]))>s*2)this.sources.set(source,history);
      for(let j=0;j<count&&this.pending<this.capacity;j++){
        const isBreakup=j>=baseCount+extra,kind=j<baseCount?baseKind:isBreakup&&this.exposure[i]<.25?2:0,id=++this.sequence,p=this.pending*4,along=(j+hash(id+61))/Math.max(1,count),spread=Math.min(2.5,Math.sqrt(Math.max(energy,lab.surfaceBreakup?.[i]||0))*.6)/scale,life=(kind===1?.55+hash(i+93)*.9:kind===2?.6+hash(i+93)*1.2:.3+hash(i+93))*(.92+.16*hash(id+91))*Math.min(1,Math.max(.18,Math.sqrt(s*scale/.25)));
        for(let k=0;k<3;k++){const jitter=hash(id*7+k+119)-.5;this.spawn[0].image.data[p+k]=this.sources[history+k]*(1-along)+source[k]*along+jitter*s*.10-(isBreakup&&kind===2&&baseKind!==2?normal[k]*s*.92:0);this.spawn[1].image.data[p+k]=lab.velocities[o+k]+(kind===0?(patch[k]*.25+normal[k])*spread:0)+jitter*.025/scale;}
        this.spawn[0].image.data[p+3]=0;this.spawn[1].image.data[p+3]=life;this.spawn[2].image.data.set([detailRadius(s,scale,hash(id+11))/scale,kind,.45+.4*hash(id+13),r],p);
        const slot=(this.cursor+this.pending)%this.capacity;if(this.expiry[slot]>this.time)this.overwritten++;this.expiry[slot]=this.time+life;
        this.pending++;this.emitted++;if(isBreakup)this.breakupEmitted++;
      }
      this.sources.set(source,history);
    }
  }
  advance(dt,lab,jet=lab.jet){
    if(!dt)return;
    const u=this.u;u.uDetailFlow.value=!!lab.count&&(this.count>0||this.pending>0);u.uDetailCollision.value=!!lab.u&&!!lab.solid;u.uDetailSpacing.value=lab.spacing||.25;
    if(u.uDetailFlow.value)this.flow.update(lab,this.cpu);
    if(lab.u)Object.assign(u,lab.u);
    if(lab.motion){const previous=this.previousMotion||lab.motion;u.uPreviousContainer.value.fromArray(previous.position);u.uPreviousTilt.value=previous.tilt;u.uPreviousSpin.value=previous.spin;u.uWallVelocity.value.fromArray(lab.motion.velocity);u.uWallTiltSpeed.value=lab.motion.tiltVelocity;u.uWallSpinSpeed.value=lab.motion.spinVelocity;}
    this.time+=dt;u.uSpawnStart.value=this.cursor;u.uSpawnCount.value=this.pending;u.uDt.value=dt;u.uScale.value=lab.spec.scale;u.uTime.value=lab.time;u.uWind.value=lab.wind;u.uTurbulence.value=lab.turbulence;u.uBrushRadius.value=lab.radius;u.uBrushStrength.value=jet?lab.windStrength:0;if(jet){u.uBrushOrigin.value.fromArray(jet.origin);u.uBrushDirection.value.fromArray(jet.direction);}
    for(const t of this.spawn){t.clearUpdateRanges();for(let row=0;row<this.pending;row+=256)t.addUpdateRange(row*4,Math.min(256,this.pending-row)*4);t.needsUpdate=this.pending>0;}
    if(this.cpu){
      const [p,v,info]=this.fallback.map(t=>t.image.data);
      for(let j=0;j<this.pending;j++){const o=(this.cursor+j)%this.capacity*4;for(let k=0;k<3;k++)this.fallback[k].image.data.set(this.spawn[k].image.data.subarray(j*4,j*4+4),o);}
      for(let i=0;i<this.capacity;i++){const o=i*4;p[o+3]+=dt;if(p[o+3]>=v[o+3])continue;let start=Array.from(p.subarray(o,o+3)),velocity=Array.from(v.subarray(o,o+3)),kind=info[o+1];const born=(i-this.cursor+this.capacity)%this.capacity<this.pending;
        if(born&&lab.count&&kind<1.5){let point=projectDetailSurface(start,lab.spacing,this.flow,kind<.5?.08:.18,.55);if(u.uDetailCollision.value){const contact=detailContact(start,point,velocity,Math.max(.0005,info[o]*2),lab);point=contact.position;velocity=contact.velocity;}start=point;}
        let step=lab.count?detailFluidMotion(start,velocity,kind,dt,lab.spec.scale,lab.spacing,this.flow,p[o+3]):{wet:false};
        if(lab.count)kind=step.kind;
        if(!step.wet)step=detailStep(start,velocity,kind,lab.spec.scale,dt,lab.time,lab.wind,lab.turbulence,jet,lab.radius,lab.windStrength);
        if(u.uDetailCollision.value)step=detailContact(start,step.position,step.velocity,Math.max(.0005,info[o]*2),lab,born?null:this.previousMotion);
        p.set(step.position,o);v.set(step.velocity,o);info[o+1]=kind;info[o+3]=u.uDetailCollision.value?lab.solid(step.position):100;}
      for(const t of this.fallback)t.needsUpdate=true;this.bind(this.fallback);
    }else{
      if(!this.targets)this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(256,this.capacity/256,{count:3,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
      if(this.clear){this.bind(this.fallback);this.clear=false;}
      const r=this.renderer,old=r.getRenderTarget(),target=this.targets[this.current];r.setRenderTarget(target);r.render(this.scene,this.camera);r.setRenderTarget(old);this.bind(target.textures);this.current=1-this.current;
    }
    if(lab.motion)this.previousMotion={position:lab.motion.position.slice(),tilt:lab.motion.tilt,spin:lab.motion.spin};
    this.cursor=(this.cursor+this.pending)%this.capacity;this.pending=0;this.count=0;for(const expiry of this.expiry)if(expiry>this.time)this.count++;
  }
  dispose(){this.flow.dispose();this.geometryDefaults.uLabBed.value.dispose();for(const t of [...this.spawn,...this.fallback,...(this.targets||[]),this.geometry,this.material])t.dispose();}
  static async verify(renderer){
    const gpu=new LabDetail(renderer,1024),cpu=new LabDetail(renderer,1024);cpu.cpu=true;
    const lab={spec:{scale:.2},time:0,wind:7,turbulence:.8,radius:1,windStrength:20,jet:{origin:[-2,1,0],direction:[1,0,0]}};
    for(const system of [gpu,cpu]){system.cursor=900;system.pending=769;for(let i=0;i<769;i++){system.spawn[0].image.data.set([(i%3)*.2,1,0,0],i*4);system.spawn[1].image.data.set([.3,2,0,2],i*4);system.spawn[2].image.data.set([.004,i%3,.4,0],i*4);}}
    try{for(let i=0;i<20;i++){lab.time+=.01;gpu.advance(.01,lab);cpu.advance(.01,lab);}let error=0;const target=gpu.targets[1-gpu.current];for(let k=0;k<3;k++){const data=new Float32Array(4096);renderer.readRenderTargetPixels(target,0,0,256,4,data,0,k);for(let i=0;i<4096;i++)error=Math.max(error,Math.abs(data[i]-cpu.fallback[k].image.data[i]));}return {error,pass:!gpu.cpu&&error<1e-4};}finally{gpu.dispose();cpu.dispose();}
  }
}
