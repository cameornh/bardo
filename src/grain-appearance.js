// Optical shapes only. Physical parcel radii, masses, and contacts are unchanged.
export function gravelFrame(seed){
 const a=seed*6.283185307,b=(seed-.5)*1.8,c=Math.cos(a),s=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
 return [[c,0,s],[-s*sb,cb,c*sb],[-s*cb,-sb,c*cb]];
}
export function gravelScale(seed,radius){return [radius*(.97+.23*seed),radius*(.93+.10*seed),radius*(1.08-.16*seed)];}
export function grainCovariance(kind,radius,seed){
 if(kind){const sigma=radius*(kind===1?1.35:1.65),v=sigma*sigma;return [v,0,0,v,0,v];}
 const axes=gravelFrame(seed),scales=gravelScale(seed,radius),c=[0,0,0,0,0,0],indices=[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]];
 for(let k=0;k<3;k++)for(let j=0;j<6;j++){const [x,y]=indices[j];c[j]+=axes[k][x]*axes[k][y]*(scales[k]*.72)**2;}
 return c;
}
export const GRAVEL_FRAME_GLSL=`
mat3 gravelFrame(float seed){float a=seed*6.283185307,b=(seed-.5)*1.8,c=cos(a),s=sin(a),cb=cos(b),sb=sin(b);return mat3(vec3(c,0,s),vec3(-s*sb,cb,c*sb),vec3(-s*cb,-sb,c*cb));}
vec3 gravelScale(float seed,float radius){return radius*vec3(.97+.23*seed,.93+.10*seed,1.08-.16*seed);}
`;
