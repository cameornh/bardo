const clamp=x=>Math.max(0,Math.min(1,x));
// A capillary bond strengthens continuously as sand wets. Drying leaves a
// smaller plastic bond, not the old maximum wetness masquerading as moisture.
// Remember the fraction of the bond that formed, rather than requiring near
// total saturation for an otherwise fully bonded shape to survive drying.
export function sandAdhesion(wet,memory=0){
 const t=clamp(wet/.35),bond=t*t*(3-2*t),history=clamp(memory/.35),residual=.2*history*history*(3-2*history);
 return residual+(1-residual)*bond;
}
export const sandFriction=(wet,memory=0)=>.67+1.8*sandAdhesion(wet,memory);
