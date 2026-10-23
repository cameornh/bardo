// Match each pass's existing fragment discard, rather than increasing its
// cutoff. The omitted rectangle strips contain no surviving fragments.
export function gaussianSupport(alpha,cutoff){return alpha<=cutoff?0:Math.min(3,Math.sqrt(2*Math.log(alpha/cutoff)));}
// Reject in 3D before applying the local perspective Jacobian. Near z=0,
// a distant lateral particle's linearized ellipse can span the whole screen
// even though its finite Gaussian support never intersects the viewing cone.
// The sphere encloses all covariance axes; two pixels retain reconstruction
// at image edges. Plane tests are conservative, including at frustum corners.
export function gaussianIntersectsView(center,radius,focal,resolution){
 const z=-center[2];if(z+radius<=0)return false;
 return [0,1].every(k=>{const edge=1+4/resolution[k];return Math.abs(center[k])*focal[k]-z*edge<=radius*Math.hypot(focal[k],edge);});
}
export const GAUSSIAN_BOUNDS_GLSL=`
uniform bool uTightGaussians;
float gaussianSupport(float alpha,float cutoff){return !uTightGaussians?3.:alpha<=cutoff?0.:min(3.,sqrt(2.*log(alpha/cutoff)));}
bool gaussianIntersectsView(vec3 center,float radius,vec2 focal,vec2 resolution){
 float z=-center.z;if(z+radius<=0.)return false;
 vec2 edge=vec2(1.)+4./resolution;
 return all(lessThanEqual(abs(center.xy)*focal-z*edge,radius*sqrt(focal*focal+edge*edge)));
}
`;
