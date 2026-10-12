// Closest point in a blade Gaussian's covariance metric. Used to reject pixels
// outside the real 3D blade when its near-plane projected quad is very large.
export function grassRay(ray,origin,axis,sigma,width){
 const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),w=1/(width*width),s=1/(sigma*sigma)-w;
 const metric=v=>v.map((x,i)=>x*w+axis[i]*dot(axis,v)*s);
 const depth=-dot(ray,metric(origin))/dot(ray,metric(ray)),q=origin.map((x,i)=>x+ray[i]*depth);
 return {depth,density:Math.exp(-.5*Math.max(0,dot(q,metric(q))))};
}
export const GRASS_RAY_GLSL=`
vec2 grassRay(vec3 ray,vec3 origin,vec3 axis,float sigma,float width){
 float width2=max(width*width,.00001);mat3 inverseCov=mat3(1./width2)+outerProduct(axis,axis)*(1./(sigma*sigma)-1./width2);
 float depth=-dot(ray,inverseCov*origin)/max(dot(ray,inverseCov*ray),.0001);vec3 closest=origin+ray*depth;
 return vec2(depth,exp(-.5*max(dot(closest,inverseCov*closest),0.)));
}`;
