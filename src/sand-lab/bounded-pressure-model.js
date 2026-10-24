// Fixed work limits shared by the isolated GPU backend and its CPU reference.
export const PRESSURE_LIMITS=Object.freeze({particles:32768,neighbors:128,perDraw:2048,iterations:3,validationParticles:256,stepMs:80});

export function pressureInputError(positions,neighbors,spacing,iterations=3,checkNeighbors=true){
 const n=positions.length/4;
 if(!Number.isInteger(n)||n<1||n>PRESSURE_LIMITS.particles)return 'Particle count is outside the bounded pressure budget.';
 if(!(Number.isFinite(spacing)&&spacing>=1e-4&&spacing<=100))return 'Invalid pressure spacing.';
 if(!Number.isInteger(iterations)||iterations<1||iterations>PRESSURE_LIMITS.iterations)return 'Iteration count exceeds the pressure budget.';
 if(neighbors.length!==n*PRESSURE_LIMITS.neighbors)return 'Incomplete pressure neighbor list.';
 for(const x of positions)if(!Number.isFinite(x)||Math.abs(x)>1e5)return 'Invalid pressure position.';
 if(!checkNeighbors)return null;
 for(let i=0;i<n;i++){
  let ended=false;
  for(let a=0;a<128;a++){
   const j=neighbors[i*128+a];
   if(j===-1){ended=true;continue;}
   if(ended||!Number.isInteger(j)||j<0||j>=n||j===i)return 'Invalid pressure neighbor index.';
  }
 }
 return null;
}

export function pressureDrawRanges(count){
 const rows=Math.ceil(count/64),rowsPerDraw=PRESSURE_LIMITS.perDraw/64,result=[];
 for(let y=0;y<rows;y+=rowsPerDraw)result.push({y,height:Math.min(rowsPerDraw,rows-y)});
 return result;
}

// Independent scalar CPU reference for the two GPU passes. The wall texture
// holds gradient.xyz and density.w, never object shapes or geometry programs.
export function pressureStepReference(positions,neighbors,wall,spacing){
 const n=positions.length/4,h=spacing*2,h2=h*h,volume=spacing**3,
  w=315/(64*Math.PI*h**3),g=-45/(Math.PI*h**6),ref=w*(1-.3*.3)**3;
 const lambda=new Float32Array(n),next=positions.slice();
 for(let i=0;i<n;i++){
  const o=i*4;let rho=volume*w+wall[o+3],sum=0,gx=wall[o],gy=wall[o+1],gz=wall[o+2];
  for(let a=0;a<128;a++){
   const j=neighbors[i*128+a];if(j<0)break;const k=j*4,
    x=positions[o]-positions[k],y=positions[o+1]-positions[k+1],z=positions[o+2]-positions[k+2],r2=x*x+y*y+z*z;
   if(r2>=h2)continue;const r=Math.sqrt(r2),q=1-r2/h2;rho+=volume*w*q*q*q;
   if(r<1e-6)continue;const f=volume*g*(h-r)**2/r,xg=x*f,yg=y*f,zg=z*f;
   gx+=xg;gy+=yg;gz+=zg;sum+=xg*xg+yg*yg+zg*zg;
  }
  lambda[i]=-Math.max(0,rho-1)/(sum+gx*gx+gy*gy+gz*gz+.04/h2);
 }
 for(let i=0;i<n;i++){
  const o=i*4;if(positions[o+3]>.5)continue;
  let dx=lambda[i]*wall[o],dy=lambda[i]*wall[o+1],dz=lambda[i]*wall[o+2];
  for(let a=0;a<128;a++){
   const j=neighbors[i*128+a];if(j<0)break;const k=j*4,
    x=positions[o]-positions[k],y=positions[o+1]-positions[k+1],z=positions[o+2]-positions[k+2],r2=x*x+y*y+z*z;
   if(r2<1e-12||r2>=h2)continue;const r=Math.sqrt(r2),q=1-r2/h2,ratio=w*q*q*q/ref,ratio2=ratio*ratio,
    f=(lambda[i]+lambda[j]-.00015*ratio2*ratio2)*volume*g*(h-r)**2/r;
   dx+=f*x;dy+=f*y;dz+=f*z;
  }
  const limit=Math.min(1,spacing*.2/(Math.hypot(dx,dy,dz)||1));
  next[o]+=dx*limit;next[o+1]+=dy*limit;next[o+2]+=dz*limit;
 }
 return next;
}

export function pressureComparison(actual,expected,original,spacing){
 let error=0,heldError=0,finite=actual.length===expected.length;
 for(let i=0;i<expected.length;i++){
  finite&&=Number.isFinite(actual[i]);error=Math.max(error,Math.abs(actual[i]-expected[i]));
  if(original[i-i%4+3]>.5||i%4===3)heldError=Math.max(heldError,Math.abs(actual[i]-original[i]));
 }
 return {pass:finite&&error<=spacing*.002&&heldError===0,error,heldError,tolerance:spacing*.002,finite};
}

