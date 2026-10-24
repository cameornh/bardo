import {bodyMass} from './rigid-contacts.js';
import {rotate} from './water-lab-model.js';

// One coupled, implicit solve for translation AND rotation. Drag measures the
// velocity of each wetted contact (v + omega cross r), not just the centre.
// The positive resistance matrix cannot add energy in stationary water,
// even for light glass or a large timestep. Flow can still apply real torque.
export function bodyInertia(b){
 const mr2=bodyMass(b)*b.radius**2,axes=[[1,0,0],[0,1,0],[0,0,1]].map(a=>rotate(a,b.tilt,b.spin,false,b.pitch));
 const moments=b.shape==='cup'?[.69,.78,.69]:[.4,.4,.4];
 return Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>axes.reduce((sum,a,k)=>sum+a[i]*a[j]*moments[k]*mr2,0)));
}
function positiveSolve(a,b){
 const n=b.length,L=Array.from({length:n},()=>new Float64Array(n)),y=new Float64Array(n),x=new Float64Array(n);
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let v=a[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(Number.MIN_VALUE,v)):v/L[j][j];}
 for(let i=0;i<n;i++){let v=b[i];for(let j=0;j<i;j++)v-=L[i][j]*y[j];y[i]=v/L[i][i];}
 for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=L[j][i]*x[j];x[i]=v/L[i][i];}return x;
}
export function applyBodyWaterDrag(b,samples,dt){
 if(b.held||b.fixed||dt<=0||!samples.some(s=>s.w>0))return;
 const mass=bodyMass(b),inertia=bodyInertia(b),v=[...b.velocity,...b.omega],a=Array.from({length:6},()=>new Float64Array(6)),rhs=new Float64Array(6);
 for(let i=0;i<3;i++){a[i][i]=mass;for(let j=0;j<3;j++)a[i+3][j+3]=inertia[i][j];}
 for(let i=0;i<6;i++)for(let j=0;j<6;j++)rhs[i]+=a[i][j]*v[j];
 for(const {p,sample,w} of samples){
  const [x,y,z]=p.map((v,k)=>v-b.position[k]),J=[[1,0,0,0,z,-y],[0,1,0,-z,0,x],[0,0,1,y,-x,0]],weight=dt*mass*2/Math.max(.01,b.ratio)*w/samples.length;
  for(let k=0;k<3;k++)for(let i=0;i<6;i++){rhs[i]+=weight*J[k][i]*sample.velocity[k];for(let j=0;j<6;j++)a[i][j]+=weight*J[k][i]*J[k][j];}
 }
 const next=positiveSolve(a,rhs);for(let k=0;k<3;k++){b.velocity[k]=next[k];b.omega[k]=next[k+3];}
}
