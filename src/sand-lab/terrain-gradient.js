// Differentiate the cubic surface itself. Finite differences of interpolated
// absolute heights amplify rounding into highlights on nearly level terrain.
const weights=t=>[(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];
const derivatives=t=>[-.5*(1-t)**2,1.5*t*t-2*t,-1.5*t*t+t+.5,.5*t*t];
export function terrainGradient(data,n,x,z,stride=1){
 const q=[(x+5.5)/11*(n-1),(z+4.9)/9.8*(n-1)],c=q.map(v=>Math.max(0,Math.min(n-1,v))),base=c.map(Math.floor),f=c.map((v,k)=>v-base[k]);
 const at=(i,j)=>data[(Math.max(0,Math.min(n-1,j))*n+Math.max(0,Math.min(n-1,i)))*stride];
 const wx=weights(f[0]),wz=weights(f[1]),dx=derivatives(f[0]),dz=derivatives(f[1]),anchor=at(...base),out=[0,0];
 for(let j=0;j<4;j++)for(let i=0;i<4;i++){const h=at(base[0]+i-1,base[1]+j-1)-anchor;out[0]+=h*dx[i]*wz[j];out[1]+=h*wx[i]*dz[j];}
 return out.map((v,k)=>q[k]<0||q[k]>n-1?0:v*(n-1)/[11,9.8][k]);
}
export const TERRAIN_GRADIENT_GLSL=`
vec2 sandHeightGradient(vec2 p){
 float size=float(textureSize(uSand,0).x),last=size-1.;vec2 q=(p+vec2(5.5,4.9))/vec2(11.,9.8)*last,c=clamp(q,0.,last),f=fract(c),base=floor(c),a=1.-f;
 vec2 w0=a*a*a/6.,w1=(3.*f*f*f-6.*f*f+4.)/6.,w2=(-3.*f*f*f+3.*f*f+3.*f+1.)/6.,w3=f*f*f/6.;
 vec2 g0=w0+w1,g1=w2+w3,h0=(base-1.+w1/g0+.5)/size,h1=(base+1.+w3/g1+.5)/size;
 // Negative and positive derivative lobes each have magnitude g. Hardware
 // interpolation combines each pair, giving the exact cubic slope in 8 reads.
 vec2 g=.5+f-f*f,d0=(base-1.+(2.*f-1.5*f*f)/g+.5)/size,d1=(base+1.+.5*f*f/g+.5)/size;
 vec2 gradient=g*vec2(
  g0.y*(texture(uSand,vec2(d1.x,h0.y)).r-texture(uSand,vec2(d0.x,h0.y)).r)+g1.y*(texture(uSand,vec2(d1.x,h1.y)).r-texture(uSand,vec2(d0.x,h1.y)).r),
  g0.x*(texture(uSand,vec2(h0.x,d1.y)).r-texture(uSand,vec2(h0.x,d0.y)).r)+g1.x*(texture(uSand,vec2(h1.x,d1.y)).r-texture(uSand,vec2(h1.x,d0.y)).r));
 gradient*=last/vec2(11.,9.8);if(q.x<0.||q.x>last)gradient.x=0.;if(q.y<0.||q.y>last)gradient.y=0.;return gradient;
}
`;
