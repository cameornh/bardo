// Art direction for the shared live beach, separate from radiometric snapshot
// defaults. Moonlit surfaces and visibility of faint celestial objects need
// independent responses; a tiny moon disc must not erase the whole star field.
export const NIGHT_LOOK={skyExposure:3e6,starGain:2,galaxyGain:5,moonScatter:.08,moonSceneGain:6,nightBrightness:2};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function nightSkyVisibility(sunElevation,average){
 return (1-smooth(-.18,-.04,sunElevation))*(1-smooth(.0005,.01,average));
}
export function nightSkyExposure(exposure,average,sunElevation){
 return exposure+(Math.max(exposure,NIGHT_LOOK.skyExposure)-exposure)*nightSkyVisibility(sunElevation,average);
}
export const NIGHT_LOOK_GLSL=`
float nightSkyVisibility(float sunElevation,float average){return (1.-smoothstep(-.18,-.04,sunElevation))*(1.-smoothstep(.0005,.01,average));}
float nightSkyExposure(float exposure,float average,float sunElevation){return mix(exposure,max(exposure,${NIGHT_LOOK.skyExposure.toFixed(1)}),nightSkyVisibility(sunElevation,average));}
`;
