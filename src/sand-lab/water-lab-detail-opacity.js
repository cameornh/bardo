// Opacity fades over almost the entire lifetime; decay/contact rules still
// determine when a marker expires. Use the same curve for light extinction.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function detailOpacity(kind,age,life,opacity){
 if(life<=0||age>=life)return 0;
 return Math.abs(opacity)*smooth(0,.045,age)*(1-smooth(kind>2.5?.12:.04,1,age/life))*(kind>2.5?.7:kind>1.5?.5:kind<.5?.65:1);
}
export const DETAIL_OPACITY_GLSL=`
float detailOpacity(float kind,float age,float life,float opacity){
 if(life<=0.||age>=life)return 0.;
 return abs(opacity)*smoothstep(0.,.045,age)*(1.-smoothstep(kind>2.5?.12:.04,1.,age/life))*(kind>2.5?.7:kind>1.5?.5:kind<.5?.65:1.);
}`;
