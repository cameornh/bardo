export const LIVE_WIND_BRUSH={initial:2400,max:9000,step:10};

// Continue responding above the old 170 m/s erosion plateau. A smooth bound
// keeps extreme brush speeds finite, with bounded per-surface transfers and
// the existing packet limits. Ambient air and underwater currents use the reference.
export function windBrushErosion(excess,scale){
 const speed=Math.max(0,excess),effective=speed<=170?speed:170+1830*(-Math.expm1(-(speed-170)/1830));
 const boost=1+4*(-Math.expm1(-Math.max(0,speed-170)/1000));
 return {rate:.00035*effective**1.5/scale,bedFraction:.02*boost,parcelFraction:.08*boost};
}
