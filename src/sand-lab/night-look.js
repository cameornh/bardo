// Live look, with fixed HDR gains. The scene's actual autoexposure scales stars
// and the galactic band together with everything else; no inverse compensation.
export const NIGHT_LOOK={starGain:2,galaxyGain:5,moonDiscGain:.5,moonScatter:.08,moonSceneGain:6,nightBrightness:2};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function nightSkyVisibility(sunElevation,average){
 return (1-smooth(-.18,-.04,sunElevation))*(1-smooth(.0005,.01,average));
}
export function starVisibility(exposure,magnitude){
 const adapted=smooth(2,6,Math.log10(Math.max(1,exposure))),faint=smooth(1,5,magnitude);
 return 1+(adapted-1)*faint;
}
export const NIGHT_LOOK_GLSL=`
float nightSkyVisibility(float sunElevation,float average){return (1.-smoothstep(-.18,-.04,sunElevation))*(1.-smoothstep(.0005,.01,average));}
float starVisibility(float exposure,float magnitude){return mix(1.,smoothstep(2.,6.,log(max(1.,exposure))/log(10.)),smoothstep(1.,5.,magnitude));}
`;
