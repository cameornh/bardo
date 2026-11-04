// Actual sphere tracing with an adjustable finite iteration budget. No edge
// mask, predicted miss, dilation, noise, or image-space distortion is applied.
export function edgeRayBudget(strength){
 return Math.round(256*Math.pow(1/16,Math.max(0,Math.min(2,strength))/2));
}

export const EDGE_TRACE_GLSL=`
uniform int uEdgeRayBudget;
float traceEdgeOpaque(vec3 o,vec3 d){
 vec2 interval=uSandCount>0?sandRayInterval(o,d):vec2(1e4,-1.);
 float t=.00001,last=t;
 for(int i=0;i<256;i++){
  if(i>=uEdgeRayBudget)break;
  vec3 p=o+d*t;
  // One union query: steps spent skimming a front object really consume the
  // budget available to reach a different surface behind it.
  float h=opaque(p);
  if(h<.00003){
   if(h<0.){float lo=last,hi=t;for(int j=0;j<12;j++){float m=(lo+hi)*.5;if(opaque(o+d*m)>0.)lo=m;else hi=m;}t=(lo+hi)*.5;}
   return t;
  }
  float advance=max(.00001,h*.7);
  // Preserve conservative terrain bin crossings, including carved parcels.
  if(interval.y>=interval.x&&t<interval.y){
   if(t<interval.x)advance=min(advance,max(.00001,interval.x-t+.000001));
   else advance=min(advance,sandCellExit(p,d));
  }
  last=t;t+=advance;if(t>75.)break;
 }
 return 1e4;
}
`;

export function installEdgeMirage(draw){
 draw.u.uEdgeRayBudget={value:edgeRayBudget(1)};
 const material=draw.backgroundScene.children[0].material,source=material.fragmentShader;
 const entry='void main(){vec3 ray=rayAt(vUv);float t=traceOpaque(uEye,ray);';
 if(source.split(entry).length!==2)throw Error('Missing or ambiguous primary edge tracing hook');
 material.fragmentShader=source.replace(entry,EDGE_TRACE_GLSL+'\nvoid main(){vec3 ray=rayAt(vUv);float t=uEdgeRayBudget==0?traceOpaque(uEye,ray):traceEdgeOpaque(uEye,ray);');
 material.needsUpdate=true;
 let strength=1;
 return {get strength(){return strength;},set strength(v){strength=Number.isFinite(v)?Math.max(0,Math.min(2,v)):0;draw.u.uEdgeRayBudget.value=strength>0?edgeRayBudget(strength):0;draw.drawKey=null;}};
}

// Double precision reference for the small GPU preview. A miss is reported
// only on actual range exit or iteration exhaustion, never predicted.
export function traceBudgeted(distance,origin,direction,{epsilon=.0003,limit=10,iterations=256}={}){
 let t=.00001;
 for(let i=0;i<iterations;i++){
  const h=distance(origin.map((v,k)=>v+direction[k]*t));
  if(h<epsilon)return {hit:true,t,samples:i+1,exhausted:false};
  t+=Math.max(.00001,h*.7);
  if(t>limit)return {hit:false,t,samples:i+1,exhausted:false};
 }
 return {hit:false,t,samples:iterations,exhausted:true};
}
