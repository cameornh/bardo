import * as THREE from 'three';
import {LabWaterField, LAB_FIELD_GLSL, fieldLayout} from './water-lab-field.js';
import {reconstructionKernel as parcelKernel} from './reconstruction.js';
import {LAB_GEOMETRY_GLSL, rotate, vesselDistance, wallVelocity, normalAt} from './water-lab-model.js';

export const DETAIL_FLOW_GLSL = LAB_FIELD_GLSL.replaceAll('uLabField','uFlowTexture').replaceAll('uField','uFlow')
  .replaceAll('parcelSample','detailFlowSample').replaceAll('fieldSlice','detailFlowSlice').replaceAll('PARCEL_ISO','DETAIL_FLOW_ISO');

// Coarser than the optical atlas. Channels hold density and density-weighted
// velocity, so surface tracers follow the liquid instead of ambient air.
export class DetailFlowField {
  constructor(renderer) {
    this.field = new LabWaterField(renderer,{ratio:.75});this.u={};
    for(const [name,uniform] of Object.entries(this.field.u)) this.u[name.replace('uLabField','uFlowTexture').replace('uField','uFlow')]=uniform;
  }
  update(lab,cpu=false) {
    const s=lab.spacing;this.spacing=s;this.layout=fieldLayout(s,.75,lab.fieldBounds);
    this.items=Array.from({length:lab.count},(_,i)=>{
      const o=i*4;return {kind:'water',position:Array.from(lab.positions.subarray(o,o+3)),
        radius:s*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]||0)-5)/20))),volume:s**3,
        dye:lab.velocities[o],tannin:lab.velocities[o+1],sediment:lab.velocities[o+2]};
    });
    if(!cpu){this.field.update(this.items,s,lab.fieldBounds);return;}
    // Lazy lattice samples reproduce GPU trilinear interpolation without
    // constructing a dense atlas on the CPU reference path.
    this.bins=new Map();this.nodes=new Map();this.cellSize=3*s;
    for(const p of this.items){Object.assign(p,parcelKernel(p));const key=p.position.map(v=>Math.floor(v/this.cellSize)).join(',');
      if(!this.bins.has(key))this.bins.set(key,[]);this.bins.get(key).push(p);}
  }
  sample(p) {
    const {dx,dimensions,min}=this.layout,q=p.map((v,k)=>(v-min[k])/dx);
    if(q.some((v,k)=>v<0||v>dimensions[k]-1))return [0,0,0,0];
    const base=q.map(Math.floor),fraction=q.map((v,k)=>v-base[k]),sum=[0,0,0,0];
    for(let corner=0;corner<8;corner++){
      const index=base.map((v,k)=>v+((corner>>k)&1)),key=index.join(',');let value=this.nodes.get(key);
      if(!value){
        const point=index.map((v,k)=>min[k]+v*dx),cell=point.map(v=>Math.floor(v/this.cellSize));value=[0,0,0,0];
        for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const item of this.bins.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[]){
          const d=point.map((v,k)=>(v-item.position[k])/item.sigma);if(d.reduce((a,v)=>a+v*v,0)>9)continue;
          const rho=item.amplitude*Math.exp(-.5*d.reduce((s,v)=>s+v*v,0));
          [1,item.dye,item.tannin,item.sediment].forEach((v,k)=>value[k]+=rho*v);
        }
        this.nodes.set(key,value);
      }
      const weight=fraction.reduce((w,f,k)=>w*(((corner>>k)&1)?f:1-f),1);value.forEach((v,k)=>sum[k]+=v*weight);
    }
    return sum;
  }
  dispose(){this.field.dispose();}
}

export function detailFluidState(kind,density){
  if(density>(kind===2?.22:.34))return 2;
  if(density>(kind===1?.065:.11))return 1;
  return kind===3?3:0;
}
export function projectDetailSurface(p,spacing,flow,target=.18,limit=.22) {
  const e=spacing*.4,rho=flow.sample(p)[0],gradient=[0,1,2].map(k=>{
    const a=p.slice(),b=p.slice();a[k]+=e;b[k]-=e;return (flow.sample(a)[0]-flow.sample(b)[0])/(2*e);
  }),g2=gradient.reduce((s,x)=>s+x*x,0);
  if(g2<1e-6)return p;
  const delta=gradient.map(x=>x*(target-rho)/g2),fraction=Math.min(1,spacing*limit/(Math.hypot(...delta)||1));
  return p.map((x,k)=>x+delta[k]*fraction);
}
export function detailFluidMotion(p,v,kind,dt,scale,spacing,flow,age=Infinity) {
  // Give newly shed spray time to leave its source kernel. Reclassifying it
  // inside the coarse kernel halo immediately would swallow every splash.
  if((kind===0||kind===3)&&age<.1)return {position:p,velocity:v,kind,wet:false};
  const sample=flow.sample(p);kind=detailFluidState(kind,sample[0]);
  if(kind===0||kind===3)return {position:p,velocity:v,kind,wet:false};
  const target=sample.slice(1).map(x=>x/Math.max(sample[0],1e-6));if(kind===2)target[1]+=.18/scale;
  const mix=1-Math.exp(-dt*(kind===2?9:18));v=v.map((x,k)=>x+(target[k]-x)*mix);p=p.map((x,k)=>x+v[k]*dt);
  if(kind===1)p=projectDetailSurface(p,spacing,flow);
  return {position:p,velocity:v,kind,wet:true};
}

export function detailContact(start,end,velocity,radius,lab,previousMotion=null) {
  const solid=p=>lab.solid(p,true,false),m=lab.motion;
  if(previousMotion&&m&&(['tank','glass','pane'].includes(lab.kind))){
    const local=rotate(start.map((v,k)=>v-previousMotion.position[k]),previousMotion.tilt,previousMotion.spin,true,previousMotion.pitch);
    // Sweep in the current vessel frame: a thin moving wall can cross a
    // marker even when both world-space endpoints lie outside the wall.
    start=rotate(local,m.tilt,m.spin,false,m.pitch).map((v,k)=>v+m.position[k]);
  }
  const delta=end.map((v,k)=>v-start[k]),distance=Math.hypot(...delta),direction=delta.map(v=>v/Math.max(distance,1e-9));
  let t=0,p=start.slice(),hit=false;
  for(let step=0;step<32;step++){
    p=start.map((v,k)=>v+direction[k]*t);const d=solid(p)-radius;
    if(d<.0002){hit=true;break;}if(t>=distance)break;
    t=Math.min(distance,t+Math.max(.0001,d*.8));
  }
  // At the fixed work limit retain the last safe point, never jump a wall.
  if(!hit)return {position:p,velocity};
  const n=normalAt(p,solid),d=solid(p);p=p.map((v,k)=>v+n[k]*Math.max(0,radius+Math.max(.001,radius*.25)-d));
  let wall=[0,0,0];
  if(m&&Math.abs(vesselDistance(p,lab.kind,m)-solid(p))<.02)wall=wallVelocity(p,m);
  for(const body of lab.balls||[])if(Math.abs(Math.hypot(...p.map((v,k)=>v-body.position[k]))-body.radius-solid(p))<.02)wall=body.velocity;
  const relative=velocity.map((v,k)=>v-wall[k]),normalSpeed=relative.reduce((s,v,k)=>s+v*n[k],0);
  velocity=relative.map((v,k)=>wall[k]+(v-Math.min(0,normalSpeed)*n[k])*.75);
  return {position:p,velocity};
}

export const DETAIL_ENVIRONMENT_GLSL = `
${LAB_GEOMETRY_GLSL}
${DETAIL_FLOW_GLSL}
uniform bool uDetailFlow,uDetailCollision;uniform float uDetailSpacing,uPreviousTilt,uPreviousSpin,uPreviousPitch,uWallTiltSpeed,uWallSpinSpeed,uWallPitchSpeed;
uniform vec3 uPreviousContainer,uWallVelocity;
int detailState(int kind,float density){if(density>(kind==2?.22:.34))return 2;if(density>(kind==1?.065:.11))return 1;return kind==3?3:0;}
vec3 previousLocal(vec3 p){p-=uPreviousContainer;p.yz=vec2(cos(uPreviousPitch)*p.y+sin(uPreviousPitch)*p.z,-sin(uPreviousPitch)*p.y+cos(uPreviousPitch)*p.z);float c=cos(uPreviousTilt),s=sin(uPreviousTilt),a=cos(uPreviousSpin),b=sin(uPreviousSpin);vec3 q=vec3(c*p.x+s*p.y,-s*p.x+c*p.y,p.z);return vec3(a*q.x-b*q.z,q.y,b*q.x+a*q.z);}
void detailContact(in vec3 start,inout vec3 end,inout vec3 velocity,float radius,bool moveStart){
  if(!uDetailCollision)return;
  if(moveStart&&(uStation==3||uStation==5||uStation==7))start=rotateLab(previousLocal(start),false)+uContainer;
  vec3 delta=end-start;float distance=length(delta),t=0.;vec3 direction=delta/max(distance,1e-9),p=start;bool hit=false;
  for(int step=0;step<32;step++){p=start+direction*t;float d=labPhysicalSolid(p)-radius;if(d<.0002){hit=true;break;}if(t>=distance)break;t=min(distance,t+max(.0001,d*.8));}
  end=p;if(!hit)return;vec3 n=labPhysicalNormal(p);float d=labPhysicalSolid(p);end+=n*max(0.,radius+max(.001,radius*.25)-d);vec3 wall=vec3(0);
  if(abs(vessel(end)-labPhysicalSolid(end))<.02){vec3 omega=vec3(uWallPitchSpeed,-sin(uPitch)*uWallTiltSpeed,cos(uPitch)*uWallTiltSpeed)+rotateLab(vec3(0,1,0),false)*uWallSpinSpeed;wall=uWallVelocity+cross(omega,end-uContainer);}
  for(int i=0;i<uBodyCount;i++){vec4 body=labBody(i);if(abs(length(end-body.xyz)-body.w-labPhysicalSolid(end))<.02)wall=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).xyz;}
  vec3 relative=velocity-wall;float vn=dot(relative,n);velocity=wall+(relative-min(0.,vn)*n)*.75;
}
void detailProject(inout vec3 p,float target,float limit){
  float e=uDetailSpacing*.4,rho=detailFlowSample(p).x;vec3 g=vec3(detailFlowSample(p+vec3(e,0,0)).x-detailFlowSample(p-vec3(e,0,0)).x,detailFlowSample(p+vec3(0,e,0)).x-detailFlowSample(p-vec3(0,e,0)).x,detailFlowSample(p+vec3(0,0,e)).x-detailFlowSample(p-vec3(0,0,e)).x)/(2.*e);float g2=dot(g,g);if(g2>1e-6){vec3 delta=g*(target-rho)/g2;p+=delta*min(1.,uDetailSpacing*limit/max(length(delta),1e-9));}
}
void detailWetMotion(inout vec3 p,inout vec3 v,inout float kind,float age,float dt,float scale,out bool wet){
  wet=false;if(!uDetailFlow||((kind<.5||kind>2.5)&&age<.1))return;vec4 f=detailFlowSample(p);kind=float(detailState(int(kind),f.x));if(kind<.5||kind>2.5)return;wet=true;
  vec3 target=f.yzw/max(f.x,1e-6);if(kind>1.5)target.y+=.18/scale;v+=(target-v)*(1.-exp(-dt*(kind>1.5?9.:18.)));p+=v*dt;
  if(kind<1.5)detailProject(p,.18,.22);
}
`;

export function emptyGeometryUniforms() {
  const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
  return {uPlayer:{value:new THREE.Vector4(0,0,0,0)},uPlayerHeight:{value:0},uRiverSlope:{value:.1},uTannins:{value:0},uLabBed:{value:zero},uBodies:{value:zero},uBodyCount:{value:0},uStation:{value:0},uContainer:{value:new THREE.Vector3(0,2,0)},uPitch:{value:0},uTilt:{value:0},uSpin:{value:0}};
}
