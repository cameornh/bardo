// Match each pass's existing fragment discard, rather than increasing its
// cutoff. The omitted rectangle strips contain no surviving fragments.
export function gaussianSupport(alpha,cutoff){return alpha<=cutoff?0:Math.min(3,Math.sqrt(2*Math.log(alpha/cutoff)));}
export const GAUSSIAN_BOUNDS_GLSL=`
uniform bool uTightGaussians;
float gaussianSupport(float alpha,float cutoff){return !uTightGaussians?3.:alpha<=cutoff?0.:min(3.,sqrt(2.*log(alpha/cutoff)));}
`;
