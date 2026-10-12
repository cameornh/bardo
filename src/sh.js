// Real orthonormal spherical harmonics, in the common 3DGS ordering.
// Coefficients below are projected from a procedural environment, not learned
// from photographs. Direct moving lights remain a separate, relightable term.
export function shBasis([x,y,z]) {
  return [
    .28209479177387814,
    -.4886025119029199*y, .4886025119029199*z, -.4886025119029199*x,
    1.0925484305920792*x*y, -1.0925484305920792*y*z,
    .31539156525252005*(2*z*z-x*x-y*y), -1.0925484305920792*x*z,
    .5462742152960396*(x*x-y*y),
    -.5900435899266435*y*(3*x*x-y*y), 2.890611442640554*x*y*z,
    -.4570457994644658*y*(4*z*z-x*x-y*y),
    .3731763325901154*z*(2*z*z-3*x*x-3*y*y),
    -.4570457994644658*x*(4*z*z-x*x-y*y),
    1.445305721320277*z*(x*x-y*y), -.5900435899266435*x*(x*x-3*y*y),
  ];
}

const directions=Array.from({length:64},(_,i)=>{
  const y=1-2*(i+.5)/64, r=Math.sqrt(1-y*y), a=i*2.399963229728653;
  const direction=[Math.cos(a)*r,y,Math.sin(a)*r];
  return {direction,basis:shBasis(direction)};
});
export function projectSH(radiance) {
  const coefficients=new Float32Array(48);
  for(const {direction,basis} of directions) {
    const rgb=radiance(direction);
    for(let k=0;k<16;k++)for(let c=0;c<3;c++)coefficients[k*3+c]+=rgb[c]*basis[k]*(4*Math.PI/64);
  }
  return coefficients;
}
export function evaluateSH(coefficients,direction,degree=3) {
  const basis=shBasis(direction), rgb=[0,0,0];
  for(let k=0;k<(degree+1)**2;k++)for(let c=0;c<3;c++)rgb[c]+=coefficients[k*3+c]*basis[k];
  return rgb;
}
function sky(d) {
  const t=Math.min(1,Math.max(0,(d[1]+.05)/.85));
  const panel=Math.max(0,(-.4*d[0]+.5*d[1]+d[2])/Math.sqrt(1.41))**16;
  return [.76*(1-t)+.37*t+.8*panel,.78*(1-t)+.49*t+.75*panel,.73*(1-t)+.55*t+.65*panel];
}
const cache=new Map();
export function materialSH(normal,material) {
  const key=normal.map(v=>Math.round(v*12)).join(',')+':'+[...material.color,material.roughness,material.metal,material.scatter].join(',');
  if(cache.has(key))return cache.get(key);
  const q=normal.map(v=>Math.round(v*12)/12), len=Math.hypot(...q)||1, n=q.map(v=>v/len);
  const result=projectSH(v=>{
    const nv=Math.abs(n.reduce((s,x,i)=>s+x*v[i],0));
    const dot=n.reduce((s,x,i)=>s+x*v[i],0);
    const reflected=n.map((x,i)=>2*dot*x-v[i]), environment=sky(reflected);
    return material.color.map((base,c)=>{
      const f0=.04*(1-material.metal)+base*material.metal;
      const fresnel=f0+(1-f0)*(1-nv)**5;
      const env=environment[c]*(1-material.roughness**2)+.65*material.roughness**2;
      return base*(1-material.metal)*(.23+.12*Math.max(n[1],0))
        +env*fresnel*(1-material.roughness*.55);
    });
  });
  // Bounded memoization. Previously returned coefficient arrays remain valid.
  if(cache.size>4096)cache.clear();
  cache.set(key,result);return result;
}
