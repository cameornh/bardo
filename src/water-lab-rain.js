import {hash, clamp, rotate, vesselLocal, vesselDistance, normalAt} from './water-lab-model.js';

export const RAIN_PACKET_LIMIT=4096;
export function rainPacketRate(rate){return rate>0?Math.min(1200,144+96*Math.sqrt(rate/5)):0;}

// Sub-grid precipitation packets carry real water volume. On contact their
// momentum enters the fluid; local wet deposits become ordinary solver parcels
// once there is enough volume. No rain water is recycled from the scene.
export class LabRain {
  constructor(lab) {
    this.lab=lab;
    this.settings=new Map();
    this.reset('pipe');
  }
  reset(kind) {
    this.kind=kind;
    this.drops=[];
    this.deposits=new Map();
    this.emitted=0;
    this.transferred=0;
    this.hits=0;
    this.sequence=0;
    this.budget=0;
    this.sourceVolume=0;
    this.capacityLimited=false;
  }
  get options() {
    if(!this.settings.has(this.kind))this.settings.set(this.kind,{enabled:false,rate:5});
    return this.settings.get(this.kind);
  }
  get enabled(){return this.options.enabled;}
  set enabled(value){this.options.enabled=Boolean(value);}
  get rate(){return this.options.rate;}
  set rate(value){this.options.rate=clamp(Number(value)||0,0,12000);}
  get airborneVolume(){return this.drops.reduce((sum,p)=>sum+p.volume,0);}
  get depositVolume(){let sum=0;for(const p of this.deposits.values())sum+=p.volume;return sum;}
  get unresolvedVolume(){return this.airborneVolume+this.depositVolume;}

  // All stations receive the same physical rainfall depth. mm/min intentionally
  // exposes accelerated test rainfall rather than quietly changing it by scene.
  get skyDepth(){return this.lab.kind==='river'?37:8.4;}
  get skyArea(){return 9.6*this.skyDepth;}
  get flux(){return this.rate/60000/this.lab.spec.scale*this.skyArea;}
  buildSurfaceIndex() {
    const {positions,spacing}=this.lab;
    this.columns=new Map();
    for(let i=0;i<positions.length/4;i++) {
      const o=i*4,key=`${Math.floor(positions[o]/spacing)},${Math.floor(positions[o+2]/spacing)}`;
      let column=this.columns.get(key);
      if(!column)this.columns.set(key,column=[]);
      column.push(i);
    }
  }
  waterHit(a,b) {
    const lab=this.lab,s=lab.spacing,p=lab.positions,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
    if(dy>=0)return null;
    const x0=Math.floor((Math.min(a[0],b[0])-s)/s),x1=Math.floor((Math.max(a[0],b[0])+s)/s);
    const z0=Math.floor((Math.min(a[2],b[2])-s)/s),z1=Math.floor((Math.max(a[2],b[2])+s)/s);
    let best=null;
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)for(const i of this.columns.get(`${x},${z}`)||[]) {
      const o=i*4,t=(p[o+1]+s*.42-a[1])/dy;
      if(t<0||t>1||best&&t>=best.t)continue;
      const point=[a[0]+dx*t,a[1]+dy*t,a[2]+dz*t];
      if(Math.hypot(point[0]-p[o],point[2]-p[o+2])>s*.85)continue;
      best={t,point,normal:[0,1,0],particle:i};
    }
    return best;
  }
  solidHit(a,b) {
    const delta=b.map((v,k)=>v-a[k]),length=Math.hypot(...delta);
    if(length<1e-9)return null;
    const direction=delta.map(v=>v/length);
    let distance=0,previous=0;
    for(let i=0;i<96&&distance<=length;i++) {
      const point=a.map((v,k)=>v+direction[k]*distance),d=this.lab.solid(point);
      if(d<.003) {
        let lo=previous,hi=distance;
        for(let j=0;j<8;j++) {const mid=(lo+hi)*.5;if(this.lab.solid(a.map((v,k)=>v+direction[k]*mid))>.003)lo=mid;else hi=mid;}
        const p=a.map((v,k)=>v+direction[k]*hi);
        return {t:hi/length,point:p,normal:normalAt(p,q=>this.lab.solid(q)),particle:-1};
      }
      previous=distance;
      distance+=Math.max(.001,Math.min(.15,d*.65));
    }
    return null;
  }
  depositPoint(p) {
    const lab=this.lab;
    if(p.local)return rotate(p.local,lab.motion.tilt,lab.motion.spin).map((v,k)=>v+lab.motion.position[k]);
    if(p.particle>=0) return p.offset.map((v,k)=>v+lab.positions[p.particle*4+k]);
    return p.point.slice();
  }
  depositNormal(p) {return p.localNormal?rotate(p.localNormal,this.lab.motion.tilt,this.lab.motion.spin):p.normal;}
  impact(drop,hit) {
    const lab=this.lab,s=lab.spacing;
    this.hits++;
    if(hit.particle>=0) {
      // Distribute a mass-weighted impulse, rather than draw a ripple texture.
      const targets=[];let sum=0;
      for(let i=0;i<lab.count;i++) {
        const o=i*4;if(lab.positions[o+3])continue;
        const d=Math.hypot(lab.positions[o]-hit.point[0],lab.positions[o+1]-hit.point[1],lab.positions[o+2]-hit.point[2]);
        const w=Math.max(0,1-d/(s*2));if(w){targets.push([o,w]);sum+=w;}
      }
      if(sum)for(const [o,w] of targets)for(let k=0;k<3;k++)lab.velocities[o+k]+=drop.velocity[k]*drop.volume/(s**3)*w/sum;
    }
    const onVessel=hit.particle<0&&vesselDistance(hit.point,lab.kind,lab.motion)<.015;
    const q=onVessel?vesselLocal(hit.point,lab.motion):hit.point;
    const cell=s*3,key=`${onVessel?'v':hit.particle>=0?'w':'g'}:${q.map(v=>Math.floor(v/cell)).join(',')}`;
    let p=this.deposits.get(key);
    if(!p) {
      p={volume:0,point:hit.point.slice(),normal:hit.normal.slice(),particle:hit.particle};
      if(onVessel){p.local=q;p.localNormal=rotate(hit.normal,lab.motion.tilt,lab.motion.spin,true);}
      if(hit.particle>=0)p.offset=hit.point.map((v,k)=>v-lab.positions[hit.particle*4+k]);
      this.deposits.set(key,p);
    }
    p.volume+=drop.volume;
  }
  appendParcels(items) {
    if(!items.length)return;
    const lab=this.lab,old=lab.count,n=old+items.length;
    for(const name of ['positions','velocities','chem']) {const a=new Float32Array(n*4);a.set(lab[name]);lab[name]=a;}
    const counts=new Uint16Array(n);counts.set(lab.neighborCounts);lab.neighborCounts=counts;
    items.forEach((p,j)=>{lab.positions.set(p.position,(old+j)*4);lab.velocities.set(p.velocity,(old+j)*4);});
    this.transferred+=items.length*lab.spacing**3;
  }
  releaseDeposits() {
    const lab=this.lab,pv=lab.spacing**3,items=[];
    for(const p of this.deposits.values()) {
      if(p.volume<1e-12)continue;
      const point=this.depositPoint(p),normal=this.depositNormal(p);
      // Wet impacts share a local reservoir through open liquid. This lets
      // many tiny impacts raise the resolved level promptly, rather than wait
      // for an entire coarse parcel to land on each individual patch.
      const group=[p];let volume=p.volume;
      if(p.particle>=0&&volume<pv)for(const q of this.deposits.values()) {
        if(q===p||q.particle<0||q.volume<1e-12)continue;
        const other=this.depositPoint(q);
        if(Math.hypot(...point.map((v,k)=>v-other[k]))>lab.spacing*4)continue;
        if(this.solidHit(point,other))continue;
        group.push(q);volume+=q.volume;
      }
      if(volume+1e-12>=pv && lab.count+items.length<lab.particleBudget) {
        const position=lab.collide(point.map((v,k)=>v+normal[k]*lab.spacing*.42));
        const velocity=p.particle>=0?Array.from(lab.velocities.subarray(p.particle*4,p.particle*4+3)):[0,0,0];
        items.push({position,velocity});
        const remaining=Math.max(0,1-pv/volume);
        for(const q of group)q.volume*=remaining;
      }
    }
    for(const [key,p] of this.deposits)if(p.volume<1e-12)this.deposits.delete(key);
    this.appendParcels(items);
  }
  fieldItems() {
    const items=[];
    for(const p of this.deposits.values()) {
      const radius=Math.cbrt(p.volume)*.65,point=this.depositPoint(p),normal=this.depositNormal(p);
      // These small wet deposits use the same volume-normalized Gaussian field
      // as the fluid, keeping their water visible before parcel conversion.
      items.push({kind:'water',position:point.map((v,k)=>v+normal[k]*radius*.65),radius,volume:p.volume,wet:0,dye:0,tannin:0,sediment:0});
    }
    return items;
  }
  step(dt) {
    const lab=this.lab,scale=lab.spec.scale;
    if(this.enabled&&this.rate>0) {
      this.budget+=dt*rainPacketRate(this.rate);
      const available=Math.max(0,(lab.particleBudget-lab.count)*lab.spacing**3-this.unresolvedVolume-this.sourceVolume);
      this.capacityLimited=available<this.flux*dt;
      this.sourceVolume+=Math.min(available,this.flux*dt);
      const count=Math.min(Math.floor(this.budget),RAIN_PACKET_LIMIT-this.drops.length);
      if(count&&this.sourceVolume>0) {
        const volume=this.sourceVolume/count;this.sourceVolume=0;this.budget-=count;
        for(let i=0;i<count;i++) {
          const seq=++this.sequence;
          // Stable independent sky samples avoid diagonal curtains when the
          // falling packets become visible. Openings collect by sky area.
          const x=(hash(seq*2)-.5)*9.6,z=(hash(seq*2+1)-.5)*this.skyDepth;
          this.drops.push({id:seq,position:[x,(lab.kind==='river'?11.5:8.35)+hash(seq)*.15,z],velocity:[0,-8/scale,0],volume});
          this.emitted+=volume;
        }
      }
    }
    this.budget=Math.min(this.budget,1);
    if(this.drops.length) {
      this.buildSurfaceIndex();
      const alive=[];
      for(const p of this.drops) {
        // Gravity / terminal fall plus the same ambient wind and cursor jet.
        p.velocity[1]=Math.max(-9/scale,p.velocity[1]-9.81/scale*dt);
        p.velocity[0]+=(lab.wind*.06/scale-p.velocity[0])*(1-Math.exp(-dt*.7));
        if(lab.jet) {
          const q=p.position.map((v,k)=>v-lab.jet.origin[k]),t=q.reduce((sum,v,k)=>sum+v*lab.jet.direction[k],0);
          const r=Math.hypot(...q.map((v,k)=>v-t*lab.jet.direction[k]));
          const w=t>0?Math.exp(-r*r/lab.radius**2)*Math.exp(-t/25):0;
          for(let k=0;k<3;k++)p.velocity[k]+=lab.jet.direction[k]*lab.windStrength/scale*w*dt;
        }
        const next=p.position.map((v,k)=>v+p.velocity[k]*dt),water=this.waterHit(p.position,next),solid=this.solidHit(p.position,next);
        const hit=solid&&(!water||solid.t<water.t)?solid:water;
        if(hit)this.impact(p,hit);else{p.position=next;alive.push(p);}
      }
      this.drops=alive;
    }
    this.releaseDeposits();
  }
}
