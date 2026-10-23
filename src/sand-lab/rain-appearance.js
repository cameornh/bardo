// Camera-independent visual rain. These samples never carry solver mass.
export const RAIN_VISUAL_LIMIT=196608;
export const wrapRain=(x,half)=>((x+half)%(2*half)+2*half)%(2*half)-half;
export function rainVisualCount(rate,scale=1,resolution=1){return rate>0?Math.min(RAIN_VISUAL_LIMIT,Math.ceil(2048*(rate/5)**.6*Math.max(.1,scale)**.3*Math.sqrt(resolution))):0;}
export function rainDropRadius(scale,random){return (.00065+.00008*random)/scale;}
export function rainHash(i){let x=i>>>0;x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;}
export function rainVisualPoint(id,time,velocity,half=[5.5,4.9],top=8.5,bottom=-.8){
 const duration=(top-bottom)/Math.max(.01,-velocity[1]),age=((time+rainHash(id*3+2)*duration)%duration+duration)%duration;
 return [wrapRain((rainHash(id*3)-.5)*2*half[0]+velocity[0]*age,half[0]),top+velocity[1]*age,wrapRain((rainHash(id*3+1)-.5)*2*half[1]+velocity[2]*age,half[1])];
}
export const RAIN_SAMPLE_GLSL=`
float rainHash(uint x){x=(x^(x>>16u))*0x7feb352du;x=(x^(x>>15u))*0x846ca68bu;return float(x^(x>>16u))/4294967296.;}
vec3 rainVisualPoint(uint id,float time,vec3 velocity,vec2 halfSize,float top,float bottom){
 float duration=(top-bottom)/max(.01,-velocity.y),age=mod(time+rainHash(id*3u+2u)*duration,duration);
 vec3 p=vec3((rainHash(id*3u)-.5)*2.*halfSize.x,top,(rainHash(id*3u+1u)-.5)*2.*halfSize.y)+velocity*age;
 p.xz=mod(p.xz+halfSize,2.*halfSize)-halfSize;return p;
}`;
// Split a physical packet's motion at each seam. Collision tests must not
// sweep through the middle of the world when the rain wraps at an edge.
export function rainSegments(from,to,half=[5.5,4.9]){
 let a=[wrapRain(from[0],half[0]),from[1],wrapRain(from[2],half[1])],delta=to.map((v,k)=>v-from[k]);const segments=[];
 for(let step=0;step<128;step++){
  let t=1;for(const [k,h] of [[0,half[0]],[2,half[1]]])if(delta[k])t=Math.min(t,Math.max(0,((delta[k]>0?h:-h)-a[k])/delta[k]));
  const b=a.map((v,k)=>v+delta[k]*t);segments.push([a,b]);if(t>=1)return segments;
  a=b.slice();for(const [k,h] of [[0,half[0]],[2,half[1]]])if(Math.abs(Math.abs(a[k])-h)<1e-9)a[k]=delta[k]>0?-h:h;
  delta=delta.map(v=>v*(1-t));
 }
 throw new Error('Rain displacement crosses too many periodic seams');
}
