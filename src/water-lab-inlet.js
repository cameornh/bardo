// A sampled continuous jet: coherent inlet layers at zero forcing. Turbulence
// changes the transverse velocity and small position perturbations, not gravity
// or the downstream foam rules. Keep the discharge consistent with the stencil.
export function pipeInlet(spacing,scale,flow,turbulence,sequence,time){
 const ring=Math.max(1,Math.floor(.255/(spacing*.9))),sites=[];
 for(let y=-ring;y<=ring;y++)for(let z=-ring;z<=ring;z++)if(Math.hypot(y,z)*spacing*.9<=.255)sites.push([y*spacing*.9,z*spacing*.9]);
 const [y,z]=sites[sequence%sites.length],t=turbulence,phase=time*11+sequence*2.39996;
 return {point:[-3.72,3.6+y+Math.sin(phase)*spacing*.08*t,z+Math.cos(phase*1.31)*spacing*.08*t],velocity:[2*flow/scale,(Math.sin(phase)*.95*t)/scale,(Math.cos(phase*1.31)*.95*t)/scale],rate:sites.length*2*flow/(scale*spacing*.95)};
}
