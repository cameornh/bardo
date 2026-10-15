import {labAirVelocity} from './water-lab-air.js';
import {hash, clamp, rotate, vesselLocal, vesselDistance, normalAt} from './water-lab-model.js';

export const RAIN_PACKET_LIMIT=4096;
export function rainPacketRate(rate){return rate>0?Math.min(480,72+44*Math.log2(1+rate/5)):0;}

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
    this.releaseClock=0;this.releaseCursor=0;this.work={releaseCandidates:0};
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
    this.columns=new Map();this.columnTops=new Map();this.top=-Infinity;
    for(let i=0;i<positions.length/4;i++) {
      const o=i*4,key=`${Math.floor(positions[o]/spacing)},${Math.floor(positions[o+2]/spacing)}`;
      let column=this.columns.get(key);
      if(!column)this.columns.set(key,column=[]);
      column.push(i);const top=positions[o+1]+spacing*.42;this.top=Math.max(this.top,top);this.columnTops.set(key,Math.max(this.columnTops.get(key)??-Infinity,top));
    }
  }
  waterHit(a,b) {
    const lab=this.lab,s=lab.spacing,p=lab.positions,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
    if(dy>=0||Math.min(a[1],b[1])>this.top)return null;
    const x0=Math.floor((Math.min(a[0],b[0])-s)/s),x1=Math.floor((Math.max(a[0],b[0])+s)/s);
    const z0=Math.floor((Math.min(a[2],b[2])-s)/s),z1=Math.floor((Math.max(a[2],b[2])+s)/s);
    let best=null;
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)for(const i of (b[1]>this.columnTops.get(`${x},${z}`)?[]:this.columns.get(`${x},${z}`))||[]) {
      const o=i*4,t=(p[o+1]+s*.42-a[1])/dy;
      if(t<0||t>1||best&&t>=best.t)continue;
      const point=[a[0]+dx*t,a[1]+dy*t,a[2]+dz*t];
      if(Math.hypot(point[0]-p[o],point[2]-p[o+2])>s*.85)continue;
      best={t,point,normal:[0,1,0],particle:i};
    }
    return best;
  }
  solidHit(a,b,field=q=>this.lab.solid(q)) {
    const delta=b.map((v,k)=>v-a[k]),length=Math.hypot(...delta);
    if(length<1e-9)return null;
    const direction=delta.map(v=>v/length);
    let distance=0,previous=0;
    for(let i=0;i<96&&distance<=length;i++) {
      const point=a.map((v,k)=>v+direction[k]*distance),d=field(point);
      if(d<.003) {
        let lo=previous,hi=distance;
        for(let j=0;j<8;j++) {const mid=(lo+hi)*.5;if(field(a.map((v,k)=>v+direction[k]*mid))>.003)lo=mid;else hi=mid;}
        const p=a.map((v,k)=>v+direction[k]*hi);
        return {t:hi/length,point:p,normal:normalAt(p,field),particle:-1};
      }
      previous=distance;
      distance+=Math.max(.001,d*.65);
    }
    return null;
  }
  depositPoint(p) {
    const lab=this.lab;
    if(p.local)return rotate(p.local,lab.motion.tilt,lab.motion.spin,false,lab.motion.pitch).map((v,k)=>v+lab.motion.position[k]);
    // Wet reservoirs stay at the impact patch, not attached to a rising parcel.
    return p.point.slice();
  }
  depositNormal(p) {return p.localNormal?rotate(p.localNormal,this.lab.motion.tilt,this.lab.motion.spin,false,this.lab.motion.pitch):p.normal;}
  impact(drop,hit) {
    const lab=this.lab,s=lab.spacing;
    this.hits++;
    if(hit.particle>=0) {
      // Distribute a mass-weighted impulse, rather than draw a ripple texture.
      const targets=[];let sum=0;
      if(!this.columns)this.buildSurfaceIndex();
      const cx=Math.floor(hit.point[0]/s),cz=Math.floor(hit.point[2]/s);
      for(let z=-2;z<=2;z++)for(let x=-2;x<=2;x++)for(const i of this.columns.get(`${cx+x},${cz+z}`)||[]) {
        const o=i*4;if(lab.positions[o+3])continue;
        const dx=lab.positions[o]-hit.point[0],dy=lab.positions[o+1]-hit.point[1],dz=lab.positions[o+2]-hit.point[2];
        const d=Math.hypot(dx,dy,dz),w=Math.max(0,1-d/(s*2));
        if(w){const radial=Math.hypot(dx,dz)/s,crown=[dx/s,(radial-.65)*1.7,dz/s];targets.push({o,w,crown});sum+=w;}
      }
      if(sum){
        const mass=drop.volume/s**3,impulse=Math.min(mass,sum*.25),mean=[0,0,0];
        for(const t of targets)for(let k=0;k<3;k++)mean[k]+=t.crown[k]*t.w/sum;
        // Redistribute the impact into a central depression and an outward,
        // rising rim. Subtract the mean so the crown adds NO net momentum.
        const speed=Math.hypot(...drop.velocity),kick=Math.min(speed*.65,Math.sqrt(9.81*s/lab.spec.scale)*3);
        for(const {o,w,crown} of targets)for(let k=0;k<3;k++)lab.velocities[o+k]+=(drop.velocity[k]+kick*(crown[k]-mean[k]))*impulse*w/sum;
      }
    }
    const onVessel=hit.particle<0&&vesselDistance(hit.point,lab.kind,lab.motion)<.015;
    const q=onVessel?vesselLocal(hit.point,lab.motion):hit.point;
    const cell=onVessel?Math.max(.025,.018/lab.spec.scale):s*1.5,key=`${onVessel?'v':hit.particle>=0?'w':'g'}:${q.map(v=>Math.floor(v/cell)).join(',')}`;
    let p=this.deposits.get(key);
    if(!p) {
      p={age:0,slide:[0,0,0],volume:0,point:hit.point.slice(),normal:hit.normal.slice(),particle:hit.particle};
      if(onVessel){p.local=q;p.localNormal=rotate(hit.normal,lab.motion.tilt,lab.motion.spin,true,lab.motion.pitch);}
      if(hit.particle>=0)p.offset=hit.point.map((v,k)=>v-lab.positions[hit.particle*4+k]);
      this.deposits.set(key,p);
    }
    p.volume+=drop.volume;
    lab.detail?.impact(hit.point,hit.normal,drop.velocity,drop.volume,lab);
  }
  appendParcels(items) {
    if(!items.length)return;
    const lab=this.lab,old=lab.count,n=old+items.length;
    for(const name of ['positions','velocities','chem']) {const a=new Float32Array(n*4);a.set(lab[name]);lab[name]=a;}
    const counts=new Uint16Array(n);counts.set(lab.neighborCounts);lab.neighborCounts=counts;
    items.forEach((p,j)=>{lab.positions.set(p.position,(old+j)*4);lab.velocities.set(p.velocity,(old+j)*4);});
    this.transferred+=items.length*lab.spacing**3;this.columns=null;
  }
  // A bounded, separation-aware surface insertion. Existing AND newly queued
  // parcels occupy space; choose the lowest available local surface, rather
  // than repeatedly stacking parcels above the first impacted particle.
  releaseDeposits() {
    const lab=this.lab,s=lab.spacing,pv=s**3;
    this.work.releaseCandidates=0;
    if(this.depositVolume+1e-12<pv||lab.count>=lab.particleBudget)return;
    const items=[],bins=new Map(),columns=new Map(),reservoirs=new Map(),points=new Map();
    for(const p of this.deposits.values()){const point=this.depositPoint(p);points.set(p,point);const id=point.map(v=>Math.floor(v/(s*6))).join(',');if(!reservoirs.has(id))reservoirs.set(id,[]);reservoirs.get(id).push(p);}
    const nearby=point=>{const c=point.map(v=>Math.floor(v/(s*6))),out=[];for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)out.push(...(reservoirs.get([c[0]+x,c[1]+y,c[2]+z].join(','))||[]));return out;};
    const key=p=>p.map(v=>Math.floor(v/s)).join(',');
    const insert=p=>{const id=key(p);if(!bins.has(id))bins.set(id,[]);bins.get(id).push(p);const col=Math.floor(p[0]/s)+','+Math.floor(p[2]/s);columns.set(col,Math.max(columns.get(col)??-Infinity,p[1]));};
    for(let i=0;i<lab.count;i++)insert(Array.from(lab.positions.subarray(i*4,i*4+3)));
    const clear=p=>{const c=p.map(v=>Math.floor(v/s));for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const q of bins.get([c[0]+x,c[1]+y,c[2]+z].join(','))||[])if(Math.hypot(...p.map((v,k)=>v-q[k]))<s*.86)return false;return true;};
    const candidates=Array.from(this.deposits.values()),workLimit=Math.min(24,candidates.length);
    for(let attempt=0;attempt<workLimit&&items.length<12;attempt++) {
      const p=candidates[(this.releaseCursor+attempt)%candidates.length];this.work.releaseCandidates++;
      if(p.volume<1e-12)continue;
      const point=points.get(p),normal=this.depositNormal(p);
      if(p.local&&(p.age<.8||normal[1]<.65))continue;
      const group=[p];let volume=p.volume;
      // Most shallow rain patches do not yet contain a solver parcel. Sum
      // candidate volumes before any swept SDF queries or insertion searches.
      const close=volume<pv?nearby(point).filter(q=>q!==p&&q.volume>1e-12&&Boolean(q.local)===Boolean(p.local)&&(p.local||((q.particle>=0)===(p.particle>=0)))&&(!q.local||q.age>=.8)&&Math.hypot(...point.map((v,k)=>v-points.get(q)[k]))<=s*6):[];
      if(volume+close.reduce((a,q)=>a+q.volume,0)+1e-12<pv)continue;
      if(volume<pv)for(const q of close) {
        if(q===p||q.volume<1e-12||Boolean(q.local)!==Boolean(p.local)||(!p.local&&(q.particle>=0)!==(p.particle>=0)))continue;
        if(p.local&&q.age<.8)continue;
        const other=points.get(q);
        if(Math.hypot(...point.map((v,k)=>v-other[k]))>s*6||this.solidHit(point.map((v,k)=>v+normal[k]*.01),other.map((v,k)=>v+normal[k]*.01)))continue;
        group.push(q);volume+=q.volume;if(volume>=pv)break;
      }
      if(volume+1e-12<pv||lab.count+items.length>=lab.particleBudget)continue;
      let position=null,best=Infinity;
      for(let j=0;j<12;j++){
        const radius=s*Math.sqrt(j)*1.1,angle=j*2.39996323,q=[point[0]+Math.cos(angle)*radius,point[1]+normal[1]*s*.42,point[2]+Math.sin(angle)*radius];
        const cx=Math.floor(q[0]/s),cz=Math.floor(q[2]/s);let top=-Infinity;
        for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)top=Math.max(top,columns.get([cx+x,cz+z].join(','))??-Infinity);
        if(Number.isFinite(top))q[1]=Math.max(q[1],top+s*.9);
        const candidate=lab.collide(q);if(!clear(candidate)||Math.hypot(candidate[0]-q[0],candidate[2]-q[2])>s*.5)continue;
        if(this.solidHit(point.map((v,k)=>v+normal[k]*s*.45),candidate))continue;
        const score=candidate[1]+radius*.035;if(score<best){position=candidate;best=score;}
      }
      if(!position)continue;
      const velocity=p.particle>=0&&p.particle<lab.count?Array.from(lab.velocities.subarray(p.particle*4,p.particle*4+3)):[0,0,0];
      items.push({position,velocity});insert(position);
      const remaining=Math.max(0,1-pv/volume);for(const q of group)q.volume*=remaining;
    }
    this.releaseCursor=(this.releaseCursor+workLimit)%Math.max(1,candidates.length);
    for(const [key,p] of this.deposits)if(p.volume<1e-12)this.deposits.delete(key);
    this.appendParcels(items);
  }
  slideDeposits(dt){
    const lab=this.lab,scale=lab.spec.scale;
    for(const [key,p] of this.deposits){p.age=(p.age||0)+dt;if(!p.local)continue;
      const point=this.depositPoint(p),n=this.depositNormal(p),radius=Math.cbrt(p.volume*3/(4*Math.PI))*scale;
      // Contact-line pinning below the capillary length, followed by viscous
      // runoff. A large numerical parcel does not set a drop's adhesion size.
      const mobility=clamp((radius-.0027)/.012,0,1),speed=mobility*Math.min(.22,.012+radius)*Math.min(1,p.age/.8)/scale;
      const tangent=[n[0]*n[1],-1+n[1]*n[1],n[2]*n[1]],next=point.map((v,k)=>v+tangent[k]*speed*dt);
      const d=vesselDistance(next,lab.kind,lab.motion),newN=normalAt(next,q=>vesselDistance(q,lab.kind,lab.motion));
      if(d>.035||n[1]<-.25&&p.age>1.2&&mobility>.1){
        if(this.drops.length>=RAIN_PACKET_LIMIT)continue;this.drops.push({id:++this.sequence,position:point.map((v,k)=>v+n[k]*.018),velocity:[0,-.15/scale,0],volume:p.volume});this.deposits.delete(key);continue;
      }
      p.local=rotate(next.map((v,k)=>v-newN[k]*(d-.004)-lab.motion.position[k]),lab.motion.tilt,lab.motion.spin,true,lab.motion.pitch);
      p.localNormal=rotate(newN,lab.motion.tilt,lab.motion.spin,true,lab.motion.pitch);
    }
  }
  douse(){const count=Math.min(32,RAIN_PACKET_LIMIT-this.drops.length);if(count<=0)return;const lab=this.lab,pv=lab.spacing**3,volume=Math.min(pv*12,Math.max(0,(lab.particleBudget-lab.count)*pv-this.unresolvedVolume));if(!volume)return;
    for(let i=0;i<count;i++){const q=[(hash(i+this.sequence)-.5)*3,1.2+hash(i+6)*.4,(hash(i+13)-.5)*2],point=rotate(q,lab.motion.tilt,lab.motion.spin,false,lab.motion.pitch).map((v,k)=>v+lab.motion.position[k]),velocity=rotate([0,-2/lab.spec.scale,0],lab.motion.tilt,lab.motion.spin,false,lab.motion.pitch);this.drops.push({id:++this.sequence,position:point,velocity,volume:volume/count});}this.emitted+=volume;
  }
  fieldItems() {
    const items=[];
    for(const p of this.deposits.values()) {
      if(p.local)continue;
      const radius=Math.cbrt(p.volume)*.65,point=this.depositPoint(p),normal=this.depositNormal(p);
      // These small wet deposits use the same volume-normalized Gaussian field
      // as the fluid, keeping their water visible before parcel conversion.
      items.push({kind:'water',position:point.map((v,k)=>v+normal[k]*radius*.65),radius,volume:p.volume,wet:0,dye:0,tannin:0,sediment:0});
    }
    return items;
  }
  step(dt) {
    const started=performance.now(),lab=this.lab,scale=lab.spec.scale;
    if(this.enabled&&this.rate>0) {
      this.budget+=dt*rainPacketRate(this.rate);
      const available=Math.max(0,(lab.particleBudget-lab.count)*lab.spacing**3-this.unresolvedVolume-this.sourceVolume);
      this.capacityLimited=available<this.flux*dt;
      this.sourceVolume+=Math.min(available,this.flux*dt);
      const count=Math.min(Math.floor(this.budget),Math.max(0,RAIN_PACKET_LIMIT-this.drops.length));
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
        const air=lab.wind||lab.jet?labAirVelocity(p.position,lab):[0,0,0];for(let k=0;k<3;k++)p.velocity[k]+=(air[k]-p.velocity[k])*(1-Math.exp(-dt*.7))*(k===1?.08:1);
        const next=p.position.map((v,k)=>v+p.velocity[k]*dt),water=this.waterHit(p.position,next),solid=this.solidHit(p.position,next);
        lab.wetting?.hitLens(p.position,next);
        const hit=solid&&(!water||solid.t<water.t)?solid:water;
        if(hit)this.impact(p,hit);else{p.position=next;alive.push(p);}
      }
      this.drops=alive;
    }
    const impactsDone=performance.now();this.slideDeposits(dt);this.releaseClock+=dt;
    // Reservoir conversion is independent of frame rate and visual LOD. Keep
    // fractional mass between batches, rather than doing a full insertion
    // search for every droplet on every fluid step.
    if(this.releaseClock>=.04){this.releaseClock%=.04;this.releaseDeposits();}
    this.timings={fall:impactsDone-started,deposits:performance.now()-impactsDone};
  }
}
