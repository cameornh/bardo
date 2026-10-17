// Volume-normalized anisotropic Gaussians near a solid boundary. The collision
// SDF still owns the occupied region; these parameters only reconstruct water.
export function reconstructionKernel(p){
 const sigma=Math.max(.018,p.radius*.95),ratio=p.flatten??1;
 return {sigma,ratio,normal:p.normal||[0,1,0],amplitude:p.volume/((2*Math.PI)**1.5*sigma**3*ratio)};
}
export function boundaryShape(clearance,sigma){
 // Compress toward the boundary by spreading the same kernel volume along
 // it. Keeping the covariance determinant fixed avoids a dense raised bead.
 const compression=Math.max(.35,Math.min(1,clearance/(sigma*1.65)));
 return {widen:1/Math.sqrt(compression),flatten:compression**1.5};
}
// Complete the kernel support lost inside a sloping solid with an image
// Gaussian at the same elevation. Flattening the real kernel instead bends
// a level free surface down along the bank and creates an artificial trough.
// These image samples only reconstruct the boundary: no fluid mass, momentum
// or simulation particles are added. The solid still clips the visible water.
export function shoreImage(p,height){
 const [x,y,z]=p.position,e=.015,h=height(x,z),gap=y-h,sigma=reconstructionKernel(p).sigma;
 if(gap<0||gap>sigma*3)return null;
 const gx=(height(x+e,z)-height(x-e,z))/(2*e),gz=(height(x,z+e)-height(x,z-e))/(2*e),slope=Math.hypot(gx,gz);
 if(slope<.08)return null;
 const distance=gap/slope;
 if(distance>sigma*3)return null;
 return {...p,position:[x+2*distance*gx/slope,y,z+2*distance*gz/slope],boundaryImage:true};
}
export function reconstructionSample(p,point){
 const {sigma,ratio,normal,amplitude}=reconstructionKernel(p),q=point.map((v,k)=>(v-p.position[k])/sigma),along=q.reduce((a,v,k)=>a+v*normal[k],0);
 const r2=q.reduce((a,v)=>a+v*v,0)+along*along*(1/(ratio*ratio)-1);
 return r2>9?0:amplitude*Math.exp(-.5*r2);
}
