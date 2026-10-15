// Volume-normalized anisotropic Gaussians near a solid boundary. The collision
// SDF still owns the occupied region; these parameters only reconstruct water.
export function reconstructionKernel(p){
 const sigma=Math.max(.018,p.radius*.95),ratio=p.flatten??1;
 return {sigma,ratio,normal:p.normal||[0,1,0],amplitude:p.volume/((2*Math.PI)**1.5*sigma**3*ratio)};
}
export function boundaryShape(clearance,sigma){
 const near=Math.max(0,Math.min(1,1-clearance/(sigma*2.4)));
 return {widen:1+.18*near,flatten:Math.max(.26,Math.min(1,clearance/(sigma*1.65)))};
}
export function reconstructionSample(p,point){
 const {sigma,ratio,normal,amplitude}=reconstructionKernel(p),q=point.map((v,k)=>(v-p.position[k])/sigma),along=q.reduce((a,v,k)=>a+v*normal[k],0);
 const r2=q.reduce((a,v)=>a+v*v,0)+along*along*(1/(ratio*ratio)-1);
 return r2>9?0:amplitude*Math.exp(-.5*r2);
}
