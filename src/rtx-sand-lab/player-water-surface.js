// Use a low free-surface isovalue, not the almost-full-density threshold used
// for body drag. With metre-wide water samples that threshold sits underwater.
// This query concerns the physical player only, never camera/visual LOD.
export function playerWaterSurface(lab,eye,height=1.65){
 const scale=lab.spec.scale,s=lab.spacing,p=eye.map(v=>v/scale),bottom=p[1]-height/scale;
 // Match the canonical Gaussian reconstruction at the player, independent
 // of camera LOD. The SPH density used by drag has a different surface height.
 const column=[];if(lab.positions)for(let i=0;i<lab.positions.length/4;i++){
  const o=i*4,dx=p[0]-lab.positions[o],dz=p[2]-lab.positions[o+2],sigma=s*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]||0)-5)/20)))*.95;
  const r2=(dx*dx+dz*dz)/(sigma*sigma);if(r2<9)column.push([lab.positions[o+1],sigma,r2,s**3/((2*Math.PI)**1.5*sigma**3)]);
 }
 const density=y=>lab.positions?column.reduce((sum,[cy,sigma,r2,amplitude])=>{const q=r2+((y-cy)/sigma)**2;return sum+(q<9?amplitude*Math.exp(-q*.5):0);},0):lab.waterAt([p[0],y,p[2]]).density;
 let lo=bottom,inside=density(lo)>=.18;
 if(!inside){lo=p[1];inside=density(lo)>=.18;}
 if(!inside)return null;
 for(let k=1;k<=16;k++){
  const hi=lo+s*.25;
  if(density(hi)<.18){let a=lo,b=hi;for(let j=0;j<7;j++){const m=(a+b)*.5;if(density(m)>=.18)a=m;else b=m;}return (a+b)*.5*scale;}
  lo=hi;
 }
 // Deep water: retain upward swimming, without claiming a remote surface.
 return eye[1]+height;
}
