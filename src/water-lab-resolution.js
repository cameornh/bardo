// The requested physical spacing stays fixed while a fixture grows. A bounded
// parcel count and atlas cell size prevent cubic growth from exhausting memory.
export function resolutionPlan(spec, baseCount, multiplier=1, quality=1, budget=8192){
  const targetSpacing=Math.min(spec.spacing*spec.scale,.64)/quality;
  const requested=Math.max(1,spec.spacing*spec.scale*multiplier/targetSpacing);
  const ceiling=Math.max(1,Math.min(Math.cbrt(budget/baseCount)*.97,spec.spacing/.11));
  const factor=Math.min(requested,ceiling);
  return {factor,requested,targetSpacing,budget,limited:factor<requested-1e-6};
}

// Reseed the same occupied volume on a finer lattice. Changing resolution
// resets a fixture; subsequent transport still uses equal-volume parcels.
// A spatial index makes this initialization independent of the view/camera.
export function refineWater(base,spacing,factor){
  if(factor===1)return base;
  const step=spacing/factor,half=spacing*.5,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],bins=new Map();
  const key=(x,y,z)=>x+512+(y+512)*1024+(z+512)*1048576;
  for(const item of base){for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],item.p[k]-half);hi[k]=Math.max(hi[k],item.p[k]+half);}const c=item.p.map(v=>Math.floor(v/spacing)),id=key(...c);if(!bins.has(id))bins.set(id,[]);bins.get(id).push(item);}
  const size=hi.map((v,k)=>Math.ceil((v-lo[k])/step)),out=[];
  for(let z=0;z<size[2];z++)for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++){
    const p=[x,y,z].map((v,k)=>lo[k]+(v+.5)*step),c=p.map(v=>Math.floor(v/spacing));let nearest=null,best=Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const item of bins.get(key(c[0]+dx,c[1]+dy,c[2]+dz))||[]){
      const q=p.map((v,k)=>Math.abs(v-item.p[k]));
      if(q.some(v=>v>half+1e-8))continue;
      const d=q[0]*q[0]+q[1]*q[1]+q[2]*q[2];if(d<best){best=d;nearest=item;}
    }
    if(nearest)out.push({p,v:nearest.v.slice(),held:false,chem:[0,0,0,0]});
  }
  return out;
}
