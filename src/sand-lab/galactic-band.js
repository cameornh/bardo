// A fixed great circle through the celestial sphere. Texture varies along
// the band, never by shifting its latitude / centre line.
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const GALACTIC_POLE=unit([.198076,.455984,.867666]);
const raw=[.974,0,-.223],projection=dot(raw,GALACTIC_POLE);
export const GALACTIC_AXIS=unit(raw.map((v,i)=>v-projection*GALACTIC_POLE[i]));
export const GALACTIC_SIDE=[
 GALACTIC_POLE[1]*GALACTIC_AXIS[2]-GALACTIC_POLE[2]*GALACTIC_AXIS[1],
 GALACTIC_POLE[2]*GALACTIC_AXIS[0]-GALACTIC_POLE[0]*GALACTIC_AXIS[2],
 GALACTIC_POLE[0]*GALACTIC_AXIS[1]-GALACTIC_POLE[1]*GALACTIC_AXIS[0],
];
export function straightGalacticBand(direction){
 const latitude=dot(direction,GALACTIC_POLE),longitude=Math.atan2(dot(direction,GALACTIC_SIDE),dot(direction,GALACTIC_AXIS));
 const texture=.82+.12*Math.sin(longitude*13)+.06*Math.sin(longitude*31);
 const rift=1-.5*Math.exp(-latitude*latitude/.0005),bulge=Math.exp((Math.cos(longitude+.75)-1)*5);
 return Math.exp(-latitude*latitude/.014)*texture*rift*(1+1.8*bulge);
}
export const GALACTIC_BAND_GLSL=`
float straightGalacticBand(vec3 direction){
 float latitude=dot(direction,vec3(${GALACTIC_POLE.join(',')})),longitude=atan(dot(direction,vec3(${GALACTIC_SIDE.join(',')})),dot(direction,vec3(${GALACTIC_AXIS.join(',')})));
 float grain=.82+.12*sin(longitude*13.)+.06*sin(longitude*31.),rift=1.-.5*exp(-latitude*latitude/.0005),bulge=exp((cos(longitude+.75)-1.)*5.);
 return exp(-latitude*latitude/.014)*grain*rift*(1.+1.8*bulge);
}
`;
