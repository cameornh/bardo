// Optional authoring recipe. Samples are baked into an insertion, never advanced by the frame clock.
export const defaultVariation = Object.freeze({distribution:'uniform',size:0,twist:0,width:0,curl:0});

export function validateVariation(v) {
  if (v === undefined) return;
  if (!v || !['uniform','centered'].includes(v.distribution)) throw Error('Invalid variation distribution.');
  for (const [key,max] of [['size',.9],['twist',180],['width',.9],['curl',1]]) {
    if (!Number.isFinite(v[key]) || v[key]<0 || v[key]>max) throw Error('Invalid variation range for '+key+'.');
  }
}

export function randomSequence(seed) {
  let state=Number(seed)>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let bits=Math.imul(state^(state>>>15),state|1);
    bits^=bits+Math.imul(bits^(bits>>>7),bits|61);
    return ((bits^(bits>>>14))>>>0)/4294967296;
  };
}

export function pickFamilyMember(members,seed) {
  const total=members.reduce((sum,m)=>sum+m.weight,0);
  let pick=randomSequence((seed>>>0)^0x6a09e667)()*total;
  for (const m of members) {
    pick-=m.weight;
    if (pick<0) return m.assetId;
  }
  throw Error('The family needs an eligible member.');
}

export function familySampler(recipe=defaultVariation,seed=0) {
  validateVariation(recipe);
  const unit=randomSequence(seed);
  const signed=()=>recipe.distribution==='centered'?unit()+unit()-1:2*unit()-1;
  return {
    size:1+recipe.size*signed(), twist:recipe.twist*signed(),
    member:count=>Math.floor(unit()*count),
    varyMark(mark) {
      mark.width=Math.max(.04,Math.min(.9,mark.width*(1+recipe.width*signed())));
      mark.curl=Math.max(-1,Math.min(1,mark.curl+recipe.curl*signed()));
    }
  };
}
