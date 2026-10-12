import { RAY_EPS, RECEIVER_SIZE, add, mul, norm, cross, dot, pointAt, mediumAt, absorption, nearestBoundary, interfaceEvent } from './light-transport.js';

function radicalInverse(n,base){let f=1/base,r=0;while(n){r+=f*(n%base);n=Math.floor(n/base);f/=base;}return r;}
function random(index,dimension){let x=(Math.imul(index+1,747796405)+Math.imul(dimension+1,2891336453))>>>0;x=Math.imul(x^(x>>>16),2246822519)>>>0;return ((x^(x>>>13))>>>0)/4294967296;}
export function emissionRay(scene,index,count){
 const light=scene.light,color=light.color,channel=color==='red'?0:color==='green'?1:color==='blue'?2:index%3;
 const d=light.direction,u=norm(cross(Math.abs(d[1])>.9?[0,0,1]:[0,1,0],d)),v=cross(d,u);
 const n=color==='red'||color==='green'||color==='blue'?index:Math.floor(index/3),angle=n*2.399963229728653;
 const radius=light.source==='broad'?light.aperture:.045;
 const fraction=(n+.5)/(color==='red'||color==='green'||color==='blue'?count:Math.ceil(count/3));
 const r=radius*Math.sqrt(fraction),offset=light.source==='rgb'?(channel-1)*.52:0;
 const origin=add(light.origin,add(mul(u,r*Math.cos(angle)+offset),mul(v,r*Math.sin(angle)*(light.source==='broad'?(light.aspect||1):1))));
 const a=2*Math.PI*radicalInverse(n+1,2),spread=Math.tan(light.spread)*Math.sqrt(radicalInverse(n+1,3));
 return {origin,direction:norm(add(d,add(mul(u,spread*Math.cos(a)),mul(v,spread*Math.sin(a))))),channel,power:light.power/count};
}
function deposit(map,size,hit,channel,power){
 const uv=hit.receiver===0?[(hit.point[0]+6)/12,(hit.point[2]+6)/12]:[(hit.point[0]+6)/12,hit.point[1]/6];
 const px=uv[0]*size-.5,py=uv[1]*size-.5,x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y,area=RECEIVER_SIZE*(hit.receiver===0?12:6)/(size*size);
 let weights=0;const taps=[];
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){const sx=x+i,sy=y+j;if(sx<0||sy<0||sx>=size||sy>=size)continue;const w=(i?fx:1-fx)*(j?fy:1-fy);taps.push([(sx+size*(sy+hit.receiver*size))*4+channel,w]);weights+=w;}
 for(const [o,w] of taps)map[o]+=power/area*w/weights;
}
function filterPhotonFlux(input,size,radius){
 let data=input;
 // Conservative scatter-form Gaussian convolution: every source texel keeps
 // unit total kernel weight, including receiver borders. No pattern is added.
 for(let axis=0;axis<2;axis++){
  const out=new Float32Array(data.length);
  for(let receiver=0;receiver<2;receiver++){
   const sigma=Math.max(.35,radius*size/(axis===0||receiver===0?12:6)),support=Math.ceil(3*sigma),kernel=Array.from({length:support*2+1},(_,i)=>Math.exp(-.5*((i-support)/sigma)**2));
   const sums=Array.from({length:size},(_,p)=>{let sum=0;for(let j=-support;j<=support;j++)if(p+j>=0&&p+j<size)sum+=kernel[j+support];return sum;});
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const o=(x+size*(y+receiver*size))*4,p=axis===0?x:y;
    if(data[o]+data[o+1]+data[o+2]===0)continue;
    for(let j=-support;j<=support;j++){if(p+j<0||p+j>=size)continue;const target=o+j*(axis===0?4:size*4),w=kernel[j+support]/sums[p];for(let c=0;c<3;c++)out[target+c]+=data[o+c]*w;}
   }
  }
  data=out;
 }
 return data;
}
export function tracePhotons(scene,{count=scene.config.photons,size=256,maxDepth=28,gather=scene.config.gather,paths=36}={}){
 const start=performance.now(),direct=new Float32Array(size*size*2*4),caustic=new Float32Array(direct.length),segments=[];
 const ledger={emitted:0,receiver:0,direct:0,caustic:0,absorbed:0,escaped:0,truncated:0,interfaces:0,tir:0},pathStride=Math.max(1,Math.floor(count/paths));
 for(let i=0;i<count;i++){
  const emission=emissionRay(scene,i,count),channel=emission.channel;let o=emission.origin,d=emission.direction,power=emission.power,changed=false;
  ledger.emitted+=power;const record=i%pathStride===0&&segments.length<2000;
  for(let depth=0;depth<maxDepth;depth++){
   const hit=nearestBoundary(scene,o,d),medium=mediumAt(scene,o);
   if(!hit){ledger.escaped+=power;if(record)segments.push({a:o,b:pointAt(o,d,7),channel,power:power/emission.power});power=0;break;}
   const transmission=Math.exp(-absorption(medium,channel)*hit.t);ledger.absorbed+=power*(1-transmission);power*=transmission;
   if(record)segments.push({a:o,b:hit.point,channel,power:power/emission.power});
   if(hit.receiver!==undefined){deposit(changed?caustic:direct,size,hit,channel,power);ledger.receiver+=power;ledger[changed?'caustic':'direct']+=power;power=0;break;}
   if(!hit.mirror&&hit.before===hit.after){o=pointAt(hit.point,d,RAY_EPS*3);continue;}
   const event=interfaceEvent(hit,d,channel,scene.config.dispersion);ledger.interfaces++;
   if(hit.mirror){ledger.absorbed+=power*(1-event.reflectance);power*=event.reflectance;d=event.reflected;}
   else if(!event.transmitted||random(scene.light.color==='white'?Math.floor(i/3):i,depth)<event.reflectance){d=event.reflected;if(!event.transmitted)ledger.tir++;}
   else d=event.transmitted;
   changed=true;o=pointAt(hit.point,d,RAY_EPS*3);
  }
  ledger.truncated+=power;
 }
 const maps={direct:filterPhotonFlux(direct,size,gather),caustic:filterPhotonFlux(caustic,size,gather)};
 return {...maps,segments,size,ledger,count,ms:performance.now()-start};
}
export function integratedFlux(map,size){let sum=0;for(let r=0;r<2;r++){const area=12*(r===0?12:6)/(size*size);for(let i=r*size*size*4;i<(r+1)*size*size*4;i+=4)sum+=(map[i]+map[i+1]+map[i+2])*area;}return sum;}
