// The light atlas is a projection, not a second ground material. Store the
// flux-weighted receiving height so one x/z texel cannot light unrelated sand
// above or below it. Linear filtering averages flux and its height moment.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function causticMoment(flux,height){return (height+32)*(flux[0]*.2126+flux[1]*.7152+flux[2]*.0722);}
export function causticReceiver(sample,height){const weight=sample[0]*.2126+sample[1]*.7152+sample[2]*.0722,receiver=sample[3]/Math.max(1e-12,weight)-32,match=1-smooth(.015,.08,Math.abs(height-receiver));return sample.slice(0,3).map(v=>v*match);}
export const CAUSTIC_RECEIVER_GLSL=`
vec3 causticReceiver(vec4 sampleValue,float height){
 float weight=dot(sampleValue.rgb,vec3(.2126,.7152,.0722)),receiver=sampleValue.a/max(1e-12,weight)-32.;
 return sampleValue.rgb*(1.-smoothstep(.015,.08,abs(height-receiver)));
}
`;
