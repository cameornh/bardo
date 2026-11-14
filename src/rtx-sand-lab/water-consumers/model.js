// One conservative horizontal index for visual water consumers. Exact physics
// keeps its current arrays and 3-D neighborhoods; no camera enters this index.
export const WATER_LIMIT=32768, COLUMN_LIMIT=65536, SAMPLE_BUDGET=8000000;
export function waterColumns(lab,seaSize=96,rainSize=128){
 const r=Math.max(lab.spacing*.85,Math.hypot(11/seaSize,9.8/seaSize)*.55),nx=Math.ceil(11/r),nz=Math.ceil(9.8/r),n=lab.count;
 if(!(lab.spacing>0)||!Number.isFinite(r)||!Number.isInteger(n)||n<0||n>WATER_LIMIT||lab.positions.length<n*4||nx*nz>COLUMN_LIMIT||!(r>0))return null;
 const heads=new Int32Array(nx*nz).fill(-1),next=new Int32Array(n),counts=new Uint32Array(nx*nz);let maximum=0;
 // Reverse insertion preserves ascending particle IDs within each column.
 for(let i=n-1;i>=0;i--){const o=i*4;if(!Number.isFinite(lab.positions[o]+lab.positions[o+1]+lab.positions[o+2]))return null;const x=Math.max(0,Math.min(nx-1,Math.floor((lab.positions[o]+5.5)/r))),z=Math.max(0,Math.min(nz-1,Math.floor((lab.positions[o+2]+4.9)/r))),b=z*nx+x;next[i]=heads[b];heads[b]=i;maximum=Math.max(maximum,++counts[b]);}
 if(maximum>64||maximum*9*(2*seaSize**2+rainSize**2)>SAMPLE_BUDGET)return null;
 return {r,nx,nz,heads,next,maximum};
}
export function waterConfig(lab,index,size,bodyCount=0){return new Float32Array([lab.count,lab.spacing,lab.spec.scale,lab.steps||0,index.nx,index.nz,index.r,size,lab.tannins||0,bodyCount,lab.neighborCounts?.length||0,0]);}
