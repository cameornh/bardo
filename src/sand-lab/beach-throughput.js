// Smooth error budget in screen pixels: no distance bands or camera-dependent
// fluid state. The nearby surface remains at the original sampling density.
export function distantWaterScale(distance,spacing,focal,motion=1){
 const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
 const footprint=spacing*focal/Math.max(spacing,distance),far=1-smooth((footprint-2)/46);
 return 1+far*7+Math.min(1,Math.max(0,motion-1)*.12)*(.15+.85*far);
}

// Three-sigma covariance support plus an atlas interpolation cell. Above this
// conservative bound the submerged pass can only discard every fragment.
export function waterSupportCeiling(items,dx){
 let top=-Infinity;
 for(const p of items){const sigma=Math.max(.018,p.radius*.95),ratio=p.flatten??1,ny=p.normal?.[1]??1;
  top=Math.max(top,p.position[1]+3*sigma*Math.sqrt(1+(ratio*ratio-1)*ny*ny));
 }
 return top+dx;
}
