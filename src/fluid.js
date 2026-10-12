import { WATER_MATERIAL } from './water-material.js';
import { Terrain } from './terrain.js';

export const WATER_DENSITY=WATER_MATERIAL.density;
export const FLUID_STEP=1/30;
export function createFluidTerrain(){const terrain=new Terrain();terrain.edit([0,0,0],3,'subtract');return terrain;}

// A bounded CPU position-based fluid experiment. Simulation resolution is fixed;
// render LOD cannot add/remove fluid mass or change the pressure solve.
export class Fluid {
  constructor(terrain,{spacing=.45,capacity=1600,iterations=2}={}){
    this.terrain=terrain;this.spacing=spacing;this.h=spacing*2;this.radius=spacing*.28;this.capacity=capacity;this.iterations=iterations;
    this.viscosity=.04;this.enabled=true;this.time=0;this.simMs=0;this.totalMs=0;this.contacts=0;this.maxCompression=0;this.steps=0;
    for(const key of ['positions','velocities','previous','predicted','correction','gradient','normals','velocityDelta'])this[key]=new Float32Array(capacity*3);
    for(const key of ['density','lambda','denominator','temperature','heatDelta','foam','agitation'])this[key]=new Float32Array(capacity);
    this.head=new Int32Array(32**3);this.next=new Int32Array(capacity);
    this.pairCapacity=capacity*64;this.pairs=new Int32Array(this.pairCapacity*2);this.kernels=new Float32Array(this.pairCapacity*4);
    this.poly=315/(64*Math.PI*this.h**9);this.spiky=-45/(Math.PI*this.h**6);this.h2=this.h*this.h;
    let sum=0;for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const r2=(x*x+y*y+z*z)*spacing*spacing;if(r2<this.h2)sum+=this.poly*(this.h2-r2)**3;}
    this.volume=1/sum;this.mass=WATER_DENSITY*this.volume;this.reset();
  }
  reset(preset='pool'){
    this.count=0;this.velocities.fill(0);this.normals.fill(0);this.temperature.fill(20);this.foam.fill(0);this.time=0;this.steps=0;this.contacts=0;this.maxCompression=0;
    // Equal-volume particles, clipped against the same field used by terrain.
    const s=this.spacing;
    for(let y=-2.7;y<(preset==='dam'?.25:-.7);y+=s)for(let z=-2.8;z<2.8;z+=s)for(let x=-2.8;x<(preset==='dam'?-.3:2.8);x+=s){
      if(this.count>=this.capacity)break;
      if(this.terrain.distance([x,y,z])<this.radius+.025)continue;
      this.positions.set([x,y,z],this.count*3);this.normals[this.count*3+1]=1;this.count++;
    }
    this.initialMass=this.count*this.mass;this.revision=(this.revision||0)+1;this.density.fill(1);
  }
  buildPairs(){
    this.head.fill(-1);const p=this.predicted,h=this.h;
    const cell=v=>Math.max(0,Math.min(31,Math.floor((v+6)/h)));
    for(let i=0;i<this.count;i++){const o=i*3,key=(cell(p[o+2])*32+cell(p[o+1]))*32+cell(p[o]);this.next[i]=this.head[key];this.head[key]=i;}
    this.pairCount=0;
    for(let i=0;i<this.count;i++){
      const o=i*3,cx=cell(p[o]),cy=cell(p[o+1]),cz=cell(p[o+2]);
      for(let z=Math.max(0,cz-1);z<=Math.min(31,cz+1);z++)for(let y=Math.max(0,cy-1);y<=Math.min(31,cy+1);y++)for(let x=Math.max(0,cx-1);x<=Math.min(31,cx+1);x++){
        for(let j=this.head[(z*32+y)*32+x];j>=0;j=this.next[j]){
          if(j<=i)continue;const b=j*3,dx=p[o]-p[b],dy=p[o+1]-p[b+1],dz=p[o+2]-p[b+2],r2=dx*dx+dy*dy+dz*dz;
          if(r2>=this.h2)continue;
          if(this.pairCount===this.pairCapacity){this.pairCapacity*=2;const pairs=new Int32Array(this.pairCapacity*2),kernels=new Float32Array(this.pairCapacity*4);pairs.set(this.pairs);kernels.set(this.kernels);this.pairs=pairs;this.kernels=kernels;}
          const k=this.pairCount++,r=Math.sqrt(r2),g=r>1e-7?this.volume*this.spiky*(h-r)**2/r:0;
          this.pairs[k*2]=i;this.pairs[k*2+1]=j;const q=k*4;this.kernels[q]=this.volume*this.poly*(this.h2-r2)**3;this.kernels[q+1]=g*dx;this.kernels[q+2]=g*dy;this.kernels[q+3]=g*dz;
        }
      }
    }
  }
  collide(probe,dt){
    const p=this.predicted,r=this.radius;let bodyX=0,bodyY=0,bodyZ=0;
    for(let i=0;i<this.count;i++){
      const o=i*3;let point=[p[o],p[o+1],p[o+2]],distance=this.terrain.distance(point);
      if(distance<r){
        const n=this.terrain.normal(point),e=.004,gradient=Math.max(.2,(this.terrain.distance(point.map((v,k)=>v+n[k]*e))-distance)/e);
        const push=Math.max(0,r-distance/gradient);for(let k=0;k<3;k++)p[o+k]+=n[k]*push;
      }
      // Explicit safety bounds: escaped splashes remain simulated, never deleted.
      p[o]=Math.max(-5,Math.min(5,p[o]));p[o+1]=Math.max(-4,Math.min(6,p[o+1]));p[o+2]=Math.max(-5,Math.min(5,p[o+2]));
      if(probe?.active){
        let dx=p[o]-probe.position.x,dy=p[o+1]-probe.position.y,dz=p[o+2]-probe.position.z;const length=Math.hypot(dx,dy,dz),separation=probe.radius+r;
        if(length<separation){
          if(length<1e-7){dx=0;dy=1;dz=0;}else{dx/=length;dy/=length;dz/=length;}
          const correction=(separation-length)*.8,fluidShare=probe.mass/(probe.mass+this.mass),bodyShare=1-fluidShare;
          p[o]+=dx*correction*fluidShare;p[o+1]+=dy*correction*fluidShare;p[o+2]+=dz*correction*fluidShare;
          const bx=-dx*correction*bodyShare,by=-dy*correction*bodyShare,bz=-dz*correction*bodyShare;
          probe.position.x+=bx;probe.position.y+=by;probe.position.z+=bz;bodyX+=bx;bodyY+=by;bodyZ+=bz;this.contacts++;
        }
      }
    }
    if(probe?.active){probe.velocity.x+=bodyX/dt;probe.velocity.y+=bodyY/dt;probe.velocity.z+=bodyZ/dt;probe.sync();}
  }
  step(dt,probe=null,gravity=9.81){
    if(!this.enabled||!this.count)return;
    const start=performance.now(),n=this.count,p=this.predicted,v=this.velocities;
    this.previous.set(this.positions.subarray(0,n*3));this.contacts=0;
    for(let i=0;i<n;i++){v[i*3+1]-=gravity*dt;for(let k=0;k<3;k++)p[i*3+k]=this.positions[i*3+k]+v[i*3+k]*dt;}
    this.collide(probe,dt);
    const self=this.volume*this.poly*this.h2**3;
    for(let iteration=0;iteration<this.iterations;iteration++){
      this.buildPairs();this.density.fill(self,0,n);this.gradient.fill(0,0,n*3);this.denominator.fill(0,0,n);
      for(let k=0;k<this.pairCount;k++){
        const i=this.pairs[k*2],j=this.pairs[k*2+1],o=k*4,w=this.kernels[o],gx=this.kernels[o+1],gy=this.kernels[o+2],gz=this.kernels[o+3],g2=gx*gx+gy*gy+gz*gz;
        this.density[i]+=w;this.density[j]+=w;this.denominator[i]+=g2;this.denominator[j]+=g2;
        this.gradient[i*3]+=gx;this.gradient[i*3+1]+=gy;this.gradient[i*3+2]+=gz;this.gradient[j*3]-=gx;this.gradient[j*3+1]-=gy;this.gradient[j*3+2]-=gz;
      }
      this.maxCompression=0;
      for(let i=0;i<n;i++){
        const o=i*3,g=this.gradient,error=Math.max(0,this.density[i]-1);this.maxCompression=Math.max(this.maxCompression,error);
        this.lambda[i]=-error/(this.denominator[i]+g[o]**2+g[o+1]**2+g[o+2]**2+.1);
      }
      this.correction.fill(0,0,n*3);
      for(let k=0;k<this.pairCount;k++){
        const i=this.pairs[k*2],j=this.pairs[k*2+1],o=k*4;
        const artificial=-.0003*this.h2*(this.kernels[o]/(self*.91**3))**4;
        const lambda=this.lambda[i]+this.lambda[j]+artificial;
        for(let axis=0;axis<3;axis++){const d=lambda*this.kernels[o+1+axis];this.correction[i*3+axis]+=d;this.correction[j*3+axis]-=d;}
      }
      let maximum=0;for(let i=0;i<n;i++)maximum=Math.max(maximum,Math.hypot(this.correction[i*3],this.correction[i*3+1],this.correction[i*3+2]));
      const scale=Math.min(1,this.h*.15/Math.max(maximum,1e-8));
      for(let i=0;i<n*3;i++)p[i]+=this.correction[i]*scale;
      this.collide(probe,dt);
    }
    for(let i=0;i<n*3;i++)v[i]=(p[i]-this.previous[i])/dt;
    // Pairwise XSPH-like dissipation and heat exchange preserve the respective
    // sums for equal masses. Temperature is passive: no boiling/expansion yet.
    this.velocityDelta.fill(0,0,n*3);this.heatDelta.fill(0,0,n);this.agitation.fill(0,0,n);
    for(let k=0;k<this.pairCount;k++){
      const i=this.pairs[k*2],j=this.pairs[k*2+1],w=this.kernels[k*4],weight=w/Math.max(1,this.density[i],this.density[j]);
      const relative=(v[j*3]-v[i*3])**2+(v[j*3+1]-v[i*3+1])**2+(v[j*3+2]-v[i*3+2])**2;
      this.agitation[i]+=relative*weight;this.agitation[j]+=relative*weight;
      const viscosity=Math.min(.2,this.viscosity*dt*60)*weight;
      for(let axis=0;axis<3;axis++){const change=viscosity*(v[j*3+axis]-v[i*3+axis]);this.velocityDelta[i*3+axis]+=change;this.velocityDelta[j*3+axis]-=change;}
      const heat=Math.min(.1,dt*.8)*weight*(this.temperature[j]-this.temperature[i]);this.heatDelta[i]+=heat;this.heatDelta[j]-=heat;
    }
    for(let i=0;i<n;i++){
      this.temperature[i]+=this.heatDelta[i];
      const surface=Math.max(0,Math.min(1,(1.02-this.density[i])*3));
      const entrainment=Math.max(0,Math.sqrt(this.agitation[i])-.35)*surface;
      this.foam[i]=Math.min(1,this.foam[i]*Math.exp(-dt/1.8)+entrainment*dt*2);
      for(let axis=0;axis<3;axis++){v[i*3+axis]+=this.velocityDelta[i*3+axis];this.positions[i*3+axis]=p[i*3+axis];}
      const o=i*3,length=Math.hypot(this.gradient[o],this.gradient[o+1],this.gradient[o+2]);
      if(length>.02){for(let axis=0;axis<3;axis++)this.normals[o+axis]=-this.gradient[o+axis]/length;}else this.normals.set([0,1,0],o);
    }
    this.time+=dt;this.steps++;this.revision++;this.simMs=performance.now()-start;this.totalMs+=this.simMs;
  }
  disturb(point,{heat=false}={}){
    let affected=0;
    for(let i=0;i<this.count;i++){
      const o=i*3,dx=this.positions[o]-point[0],dy=this.positions[o+1]-point[1],dz=this.positions[o+2]-point[2],d=Math.hypot(dx,dy,dz);
      if(d>1.2)continue;const w=(1-d/1.2)**2;
      if(heat)this.temperature[i]+=40*w;
      else{this.velocities[o]+=-dz*5*w;this.velocities[o+1]+=2.5*w;this.velocities[o+2]+=dx*5*w;}
      affected++;
    }
    return affected;
  }
  pick(origin,direction){
    let closest=Infinity,point=null;
    for(let i=0;i<this.count;i++){const o=i*3,dx=this.positions[o]-origin[0],dy=this.positions[o+1]-origin[1],dz=this.positions[o+2]-origin[2],t=dx*direction[0]+dy*direction[1]+dz*direction[2];if(t<0||t>=closest)continue;const distance=Math.hypot(dx-direction[0]*t,dy-direction[1]*t,dz-direction[2]*t);if(distance<this.spacing*.85){closest=t;point=Array.from(this.positions.subarray(o,o+3));}}
    return point;
  }
}
