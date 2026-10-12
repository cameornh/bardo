export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// OrbitControls can change the final floating-point bits of an otherwise
// stationary view. Subpixel numerical noise must not invalidate static caches.
export const sameViewMatrix=(a,b)=>a.elements.every((value,i)=>Math.abs(value-b.elements[i])<1e-6);

export class MotionDetail {
  constructor(){this.speed=0;this.factor=1;this.early=1;this.broad=1;}
  update(pixelSpeed,dt,enabled=true){
    dt=clamp(dt,0,.1);
    // No dwell timer: attack while moving, recover continuously as speed falls.
    const target=enabled?Math.max(0,pixelSpeed):0;
    this.speed+=(target-this.speed)*(1-Math.exp(-dt/(target>this.speed?.012:.18)));
    // Each additional 160 render pixels/second adds one unit of coarsening.
    // Keep a linear speed response; smoothing only controls temporal changes.
    const desired=enabled?1+this.speed/160:1;
    // A small fast shoulder starts coarsening early. Most of the change follows
    // a broader ramp, reducing the steepest slope without a wait/dwell timer.
    // Both paths converge to the same speed-proportional footprint.
    this.early+=(desired-this.early)*(1-Math.exp(-dt/(desired>this.early?.02:.5)));
    this.broad+=(desired-this.broad)*(1-Math.exp(-dt/(desired>this.broad?.32:.5)));
    this.factor=.15*this.early+.85*this.broad;
    return this.factor;
  }
}

// Continuous adjacent-level blend, selected by projected standard deviation.
// Counting both levels conservatively keeps transitions inside the budget.
export function levelChoice(levels,projectedScale,pixelTarget){
  if(levels.length===1)return {a:0,b:0,t:0,count:levels[0].count};
  for(let i=0;i<levels.length-1;i++){
    const lo=levels[i].sigma*projectedScale,hi=levels[i+1].sigma*projectedScale;
    if(pixelTarget<hi){
      const t=clamp(Math.log(Math.max(pixelTarget,lo)/lo)/Math.log(Math.max(hi/lo,1.001)),0,1);
      return {a:i,b:i+1,t:t*t*(3-2*t),count:levels[i].count+levels[i+1].count};
    }
  }
  const a=levels.length-1;return {a,b:a,t:0,count:levels[a].count};
}
export function allocateBudget(items,pixelTarget,budget){
  const choose=target=>items.map(item=>levelChoice(item.levels,item.scale,target));
  const cost=choices=>choices.reduce((sum,c)=>sum+c.count,0);
  let target=pixelTarget,choices=choose(target);
  if(cost(choices)>budget){
    let lo=target,hi=target;
    while(cost(choose(hi))>budget&&hi<1e6)hi*=2;
    for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(cost(choose(mid))>budget)lo=mid;else hi=mid;}
    target=hi;choices=choose(target);
  }
  return {target,choices,cost:cost(choices)};
}

export function projectedMotion(previous,current,dt,focalPixels,focusDistance){
  if(!previous||dt<=0)return 0;
  const translation=Math.hypot(...current.position.map((v,i)=>v-previous.position[i]));
  const dot=Math.abs(current.quaternion.reduce((s,v,i)=>s+v*previous.quaternion[i],0));
  const angle=2*Math.acos(clamp(dot,-1,1));
  return focalPixels*(angle+translation/Math.max(focusDistance,1))/Math.max(dt,1/240);
}
