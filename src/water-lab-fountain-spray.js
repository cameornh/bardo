import {LabDetail, detailRadius} from './water-lab-detail.js';
import {fountainNozzles} from './water-lab-fountain.js';
import {hash, clamp} from './water-lab-model.js';
import {labAirVelocity} from './water-lab-air.js';
import {WATER_MATERIAL} from './water-material.js';

// An unresolved jet carries entrained air and a finite breakup history with
// its liquid parcels. Losing the last neighbor must not switch emission off.
// All exposed liquid can acquire breakup history, including impact-ejected
// fragments that never passed directly through a nozzle. No height/camera term: air-relative stress, deformation and loss of support
// develop the breakup. Gravity deceleration alone does not count as turbulence.
export function jetBreakupStep(state, {spacing, scale, speed, deformation, breakup, neighbors, previousNeighbors, exposure}, dt) {
  const h=spacing*scale, capillary=Math.sqrt(WATER_MATERIAL.surfaceTension/(WATER_MATERIAL.density*h));
  const weber=1.225*speed*speed*h/WATER_MATERIAL.surfaceTension;
  const airStress=clamp((Math.sqrt(weber)-3)/24,0,2);
  const strain=clamp((deformation-4*capillary)/(Math.sqrt(9.81*h)+.25)+breakup*.4,0,3);
  const separation=clamp((previousNeighbors-neighbors)/6,0,1);
  const load=state.load*Math.exp(-dt/4.5);
  const damage=clamp(state.damage*Math.exp(-dt/2.5)+(airStress*.55+strain)*exposure*dt+separation*exposure*.22,0,2);
  const detached=1-clamp(neighbors/12,0,1);
  const energy=exposure*(load*.55+damage*(.4+.6*detached)+strain*.2);
  const mist=clamp((damage-.3)/.9,0,1)*clamp((energy-.22)/.8,0,1);
  return {load,damage,energy,mist};
}

export class FountainDetail extends LabDetail {
  reset(){super.reset();this.jetStates=[];this.jetPrimed=false;this.jetSprayEmitted=0;this.jetMistEmitted=0;}
  launch(index,nozzle){this.jetStates[index]={load:nozzle.aeration,damage:0,neighbors:0,budget:hash(index+941),mistBudget:0};}
  prime(lab){
    // Recognize the seeded ballistic inlet samples, including samples near the
    // crest. Recirculated parcels are explicitly reset by launch() instead.
    const nozzles=fountainNozzles(lab.fountain,lab.spec.scale),g=9.81/lab.spec.scale;
    for(let i=0;i<lab.count;i++){
      const o=i*4;if(Math.hypot(...lab.velocities.subarray(o,o+3))<.01)continue;
      for(const n of nozzles){const t=(n.direction[1]*n.speed-lab.velocities[o+1])/g;if(t<-.01)continue;
        const d=Math.hypot(...n.point.map((v,k)=>v+n.direction[k]*n.speed*t-(k===1?g*t*t*.5:0)-lab.positions[o+k]));
        if(d<n.radius+lab.spacing){this.launch(i,n);this.jetStates[i].load*=Math.exp(-t/4.5);break;}
      }
    }
    this.jetPrimed=true;
  }
  emit(lab,dt){
    super.emit(lab,dt);
    if(!this.enabled||this.density<=0)return;
    if(!this.jetPrimed)this.prime(lab);
    const s=lab.spacing,scale=lab.spec.scale,volumeWeight=(s*scale/.42)**3,active=[];
    let total=0;
    for(let i=0;i<lab.count;i++){
      const o=i*4,state=this.jetStates[i]??={load:0,damage:0,neighbors:0,budget:hash(i+941),mistBudget:0};
      if(lab.positions[o+3]){state.budget=state.mistBudget=0;continue;}
      const p=Array.from(lab.positions.subarray(o,o+3)),v=Array.from(lab.velocities.subarray(o,o+3));
      const neighbors=lab.neighborCounts?.[i]??0,exposure=clamp((24-neighbors)/18,0,1);
      // Away from the small obstacle-air atlas use the same free-air model,
      // rather than its clamped top slice. No solid is present up there.
      const air=lab.wind||lab.jet?(lab.air?.grid?lab.air.sampleGrid(p):labAirVelocity(p,lab)):[0,0,0],speed=Math.hypot(...v.map((x,k)=>(x-air[k])*scale));
      const next=jetBreakupStep(state,{spacing:s,scale,speed,deformation:lab.aerationActivity?.[i*2]||0,breakup:lab.surfaceBreakup?.[i]||0,neighbors,previousNeighbors:state.neighbors,exposure},dt);
      Object.assign(state,next,{neighbors});
      if(next.energy<.002||lab.solid(p,true,false)<s*.2)continue;
      const rate=42*volumeWeight*next.energy;total+=rate;active.push({i,p,v,state,rate});
    }
    // Shared bounded supply at every resolution, with fair allocation across
    // the whole flight. No accumulated debt or first-emitter budget monopoly.
    const quota=Math.min(1,9000/Math.max(1,total))*this.density;
    for(const {i,p,v,state,rate} of active){
      state.budget+=dt*rate*quota;
      state.mistBudget+=this.mistEnabled?dt*rate*quota*.65*state.mist*this.mistDensity:0;
      const spray=Math.min(128,Math.floor(state.budget)),mist=this.mistEnabled?Math.min(64,Math.floor(state.mistBudget)):0;
      state.budget=Math.min(.999,state.budget-spray);state.mistBudget=this.mistEnabled?Math.min(.999,state.mistBudget-mist):0;
      for(let j=0;j<spray+mist&&this.pending<this.capacity;j++){
        const id=++this.sequence,isMist=j>=spray,z=hash(id+93)*2-1,a=hash(id+29)*Math.PI*2,r=Math.sqrt(1-z*z),n=[r*Math.cos(a),z,r*Math.sin(a)];
        // Fine surface shells follow each live parcel; the stochastic radial
        // spread avoids regular rings while retaining the jet's coherent form.
        const radius=s*(.44+hash(id+31)*.32),point=p.map((x,k)=>x+n[k]*radius);
        const spread=Math.min(2,Math.sqrt(state.damage)*1.1)/scale;
        const velocity=v.map((x,k)=>x*(isMist?.45:1)+n[k]*spread*(isMist?1.5:1));
        this.addMarker(point,velocity,isMist?3:0,detailRadius(s,scale,hash(id+73))*(isMist?1.8:1)/scale,isMist?5+hash(id+11)*4:.8+hash(id+11)*.8,isMist?.43:.55);
        if(isMist)this.jetMistEmitted++;else this.jetSprayEmitted++;
        lab.wetting?.trace(point,velocity,isMist?3:0);
      }
    }
  }
}
