// Station 8 only. All lengths below are solver units; spec.scale converts to metres.
// The same inexpensive field is used for rendering, water, wind and rigid contacts.
export const FOUNTAIN_PRESET={name:'Ornate metal fountain',scale:2,spacing:.21,minSpacing:.14,eye:[11,8.2,14],target:[0,3,0]};
export const FOUNTAIN_BASINS=[{radius:4.55,bottom:.22},{radius:2.72,bottom:2.12},{radius:1.48,bottom:4.08}];
export const FOUNTAIN_MAX_HEAD=24;
export const FOUNTAIN_DEFAULTS={crown:1,arcs:1,lower:1,angle:32,aeration:.85,roughness:.13,patina:0,color:'#d4ac61'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=i=>{const x=Math.sin(i*91.173+18.17)*43758.54;return x-Math.floor(x);};
function box2(x,y,a,b){x=Math.abs(x)-a;y=Math.abs(y)-b;return Math.hypot(Math.max(x,0),Math.max(y,0))+Math.min(Math.max(x,y),0);}
function capsule(r,y,z,ax,ay,bx,by,radius){const x=r-ax,v=y-ay,dx=bx-ax,dy=by-ay,t=clamp((x*dx+v*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(x-t*dx,v-t*dy,z)-radius;}
export function fountainDistance(p){
 const [x,y,z]=p,r=Math.hypot(x,z),a=Math.atan2(z,x);let d=100;
 const bound=Math.max(r-4.7,-y,y-5.72);if(bound>1)return bound;
 for(const b of FOUNTAIN_BASINS){const R=b.radius,h=b.bottom,q=r/R,top=h+.28*q*q,thickness=.16+.45*Math.max(0,1-q*q);
  d=Math.min(d,Math.max(r-R,y-top,top-thickness-y)/1.25);
  // A low scalloped overflow lip; no artificial waterfall sheet is attached.
  const lip=h+.51+.055*Math.cos(a*12);
  d=Math.min(d,box2(r-(R-.10),y-(h+.28+lip)*.5,.10,(lip-h-.28)*.5),Math.hypot(r-R,y-(h+.32))-.075,Math.hypot(r-(R-.13),y-(h+.08))-.065);
 }
 // Fluted column, mouldings and a bud-shaped crown.
 const stem=.29+.11*Math.pow(Math.sin(y*2.4),2)+.025*Math.cos(a*16);
 d=Math.min(d,Math.max(r-stem,Math.abs(y-2.86)-2.68),box2(r,y-.24,.96,.22),box2(r,y-.60,.68,.15));
 for(const h of [.86,1.83,2.88,3.80,4.76,5.21])d=Math.min(d,Math.hypot(r-.44,y-h)-.10);
 d=Math.min(d,(Math.hypot(x/.48,(y-5.12)/.32,z/.48)-1)*.32,Math.max(r-.14,Math.abs(y-5.47)-.22));
 // Eight repeated volutes / leaf brackets in each storey; folded angular domain.
 const sector=2*Math.PI/8,theta=((a+sector*.5)%(sector)+sector)%sector-sector*.5,rad=r*Math.cos(theta),side=r*Math.sin(theta);
 if(Math.max(r-1.3,.8-y,y-3.95)<d)for(const h of [.95,2.94]){
  d=Math.min(d,capsule(rad,y-h,side,.40,0,.91,.48,.09),capsule(rad,y-h,side,.91,.48,.84,.81,.075));
  const ring=Math.abs(Math.hypot(rad-.90,y-h-.61)-.21);d=Math.min(d,Math.hypot(ring,side)-.06);
  d=Math.min(d,Math.max((Math.hypot((rad-.56)/.20,(y-h-.40)/.47,side/.075)-1)*.075,Math.abs(rad-.56)-.20,Math.abs(y-h-.40)-.47,Math.abs(side)-.075));
 }
 return d;
}
export const FOUNTAIN_GEOMETRY_GLSL=`
float fountainBox(vec2 p,vec2 b){vec2 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,q.y),0.);}
float fountainCapsule(vec3 p,vec2 a,vec2 b,float radius){vec2 q=p.xy-a,v=b-a;return length(vec3(q-v*clamp(dot(q,v)/dot(v,v),0.,1.),p.z))-radius;}
float fountainDistance(vec3 p){float r=length(p.xz),a=r>1e-7?atan(p.z,p.x):0.,d=100.,bound=max(r-4.7,max(-p.y,p.y-5.72));if(bound>1.)return bound;
 ${FOUNTAIN_BASINS.map(b=>`{float R=${b.radius.toFixed(4)},h=${b.bottom.toFixed(4)},q=r/R,top=h+.28*q*q,thickness=.16+.45*max(0.,1.-q*q),lip=h+.51+.055*cos(a*12.);d=min(d,max(r-R,max(p.y-top,top-thickness-p.y))/1.25);d=min(d,fountainBox(vec2(r-(R-.10),p.y-(h+.28+lip)*.5),vec2(.10,(lip-h-.28)*.5)));d=min(d,length(vec2(r-R,p.y-(h+.32)))-.075);d=min(d,length(vec2(r-(R-.13),p.y-(h+.08)))-.065);}`).join('\n')}
 float stem=.29+.11*pow(sin(p.y*2.4),2.)+.025*cos(a*16.);d=min(d,max(r-stem,abs(p.y-2.86)-2.68));d=min(d,fountainBox(vec2(r,p.y-.24),vec2(.96,.22)));d=min(d,fountainBox(vec2(r,p.y-.60),vec2(.68,.15)));
 ${[.86,1.83,2.88,3.80,4.76,5.21].map(h=>`d=min(d,length(vec2(r-.44,p.y-${h.toFixed(3)}))-.10);`).join('')}
 d=min(d,(length(p/vec3(.48,.32,.48)-vec3(0,5.12/.32,0))-1.)*.32);d=min(d,max(r-.14,abs(p.y-5.47)-.22));
 float theta=mod(a+.3926990817,.7853981634)-.3926990817,rad=r*cos(theta),side=r*sin(theta);
 if(max(r-1.3,max(.8-p.y,p.y-3.95))<d)for(int i=0;i<2;i++){float h=i==0?.95:2.94;vec3 q=vec3(rad,p.y-h,side);d=min(d,fountainCapsule(q,vec2(.40,0),vec2(.91,.48),.09));d=min(d,fountainCapsule(q,vec2(.91,.48),vec2(.84,.81),.075));float ring=abs(length(q.xy-vec2(.90,.61))-.21);d=min(d,length(vec2(ring,side))-.06);d=min(d,max((length((q-vec3(.56,.40,0))/vec3(.20,.47,.075))-1.)*.075,max(abs(rad-.56)-.20,max(abs(p.y-h-.40)-.47,abs(side)-.075))));}
 return d;}
`;
// Three independent pump groups. Jets are particle inlets, then wholly free water.
// Speed is derived from a bounded ballistic head, so changing physical scale
// changes SI speed and flight time without changing the fountain's proportions.
export function fountainNozzles(settings=FOUNTAIN_DEFAULTS,scale=2){
 const g=9.81/scale,nozzles=[],add=(point,direction,speed,radius,group,aeration)=>nozzles.push({point,direction,speed,radius,group,aeration});
 const crown=clamp(settings.crown,0,FOUNTAIN_MAX_HEAD),arcs=clamp(settings.arcs,0,FOUNTAIN_MAX_HEAD),lower=clamp(settings.lower,0,FOUNTAIN_MAX_HEAD),angle=clamp(settings.angle,10,70)*Math.PI/180;
 if(crown>0)add([0,5.88,0],[0,1,0],Math.sqrt(2*g*2.05)*Math.sqrt(crown),.24,'crown',settings.aeration);
 for(const [n,R,h,head,group,amount] of [[8,1.53,4.78,.14,'arcs',arcs],[12,2.79,2.87,.28,'lower',lower]])if(amount>0)for(let i=0;i<n;i++){
  const a=i*2*Math.PI/n+(group==='arcs'?Math.PI/8:0);add([R*Math.cos(a),h,R*Math.sin(a)],[Math.cos(a)*Math.cos(angle),Math.sin(angle),Math.sin(a)*Math.cos(angle)],Math.sqrt(2*g*head)*Math.sqrt(amount),.105,group,settings.aeration*.25);
 }
 return nozzles;
}
export function fountainInlet(nozzle,spacing,sequence,time,turbulence=0){
 const d=nozzle.direction,tangent=[d[2],0,-d[0]],len=Math.hypot(...tangent);if(len<.01)tangent.splice(0,3,1,0,0);else for(let k=0;k<3;k++)tangent[k]/=len;
 const bitangent=[d[1]*tangent[2]-d[2]*tangent[1],d[2]*tangent[0]-d[0]*tangent[2],d[0]*tangent[1]-d[1]*tangent[0]],sites=[];
 const s=spacing*.86,ring=Math.floor(nozzle.radius/s);for(let x=-ring;x<=ring;x++)for(let y=-ring;y<=ring;y++)if(Math.hypot(x,y)*s<=nozzle.radius)sites.push([x*s,y*s]);
 const [a,b]=sites[sequence%sites.length],phase=time*9+sequence*2.39996,noise=Math.min(2,turbulence)*nozzle.speed*.06;
 return {point:nozzle.point.map((v,k)=>v+tangent[k]*a+bitangent[k]*b),velocity:d.map((v,k)=>v*nozzle.speed+noise*(tangent[k]*Math.sin(phase)+bitangent[k]*Math.cos(phase*1.31))),rate:sites.length*nozzle.speed/(spacing*.9)};
}
export function seedFountain(spec=FOUNTAIN_PRESET){
 const s=spec.spacing,out=[],g=9.81/spec.scale,add=(p,v=[0,0,0])=>out.push({p,v,held:false,chem:[0,0,0,0]});
 for(const b of FOUNTAIN_BASINS)for(let y=b.bottom+s*.65;y<b.bottom+.53;y+=s)for(let z=-b.radius+s;z<b.radius;z+=s)for(let x=-b.radius+s;x<b.radius;x+=s){const p=[x,y,z];if(Math.hypot(x,z)<b.radius-.2&&fountainDistance(p)>s*.44)add(p);}
 // Prime live jets, not a draw-only curve: every seeded parcel joins the solver.
 for(const nozzle of fountainNozzles(spec.fountain||FOUNTAIN_DEFAULTS,spec.scale)){
  const rate=fountainInlet(nozzle,s,0,0).rate;
  for(let i=0;i<rate*2;i++){const t=i/rate,q=fountainInlet(nozzle,s,i,0),p=q.point.map((v,k)=>v+q.velocity[k]*t-(k===1?g*t*t*.5:0));if(p[1]<.7||Math.hypot(p[0],p[2])>4.5||fountainDistance(p)<s*.44)break;add(p,q.velocity.map((v,k)=>v-(k===1?g*t:0)));}
 }
 return out;
}
export function resetFountain(lab){lab.fountain??={...FOUNTAIN_DEFAULTS};lab.fountainPump=Object.create(null);lab.fountainCursor=0;lab.fountainRecycled=0;}
export function pumpFountain(lab,dt){
 const nozzles=fountainNozzles(lab.fountain,lab.spec.scale),s=lab.spacing;if(!nozzles.length){lab.fountainPump=Object.create(null);return;}
 // A bounded hash checks inlet clearance without a full water scan per nozzle.
 const bins=new Map(),key=(x,y,z)=>`${x},${y},${z}`,cell=p=>p.map(v=>Math.floor(v/s));
 for(let i=0;i<lab.count;i++){const o=i*4,c=cell([lab.positions[o],lab.positions[o+1],lab.positions[o+2]]),id=key(...c);if(!bins.has(id))bins.set(id,[]);bins.get(id).push(i);}
 const clear=p=>{const c=cell(p);for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const i of bins.get(key(c[0]+x,c[1]+y,c[2]+z))||[]){const o=i*4;if(Math.hypot(p[0]-lab.positions[o],p[1]-lab.positions[o+1],p[2]-lab.positions[o+2])<s*.75)return false;}return true;};
 for(let j=0;j<nozzles.length;j++){
  const nozzle=nozzles[j],id=nozzle.group+':'+nozzle.point.join(','),state=lab.fountainPump[id]??={budget:0,sequence:0};const inlet=fountainInlet(nozzle,s,state.sequence,lab.time,lab.turbulence);state.budget=Math.min(12,state.budget+dt*inlet.rate);
  while(state.budget>=1){const q=fountainInlet(nozzle,s,state.sequence,lab.time,lab.turbulence);if(!clear(q.point))break;let index=-1;
   for(let tries=0;tries<lab.count;tries++){const i=lab.fountainCursor++%lab.count,o=i*4;if(lab.positions[o+3]||lab.positions[o+1]>.98)continue;index=i;break;}
   if(index<0)break;const o=index*4;lab.positions.set(q.point,o);lab.velocities.set(q.velocity,o);lab.chem[o+3]=0;state.sequence++;state.budget--;lab.fountainRecycled++;lab.pumped+=s**3*lab.spec.scale**3;
   const c=cell(q.point),k=key(...c);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(index);
   // An aerating nozzle entrains air at its outlet. Markers carry no extra liquid
   // mass; shared surface-breakup emission still handles all downstream impacts.
   const count=Math.min(180,Math.floor(95*nozzle.aeration*lab.detail.density*(s/.21)**3));
   for(let i=0;i<count;i++){const seed=lab.fountainRecycled*197+i,angle=hash(seed)*Math.PI*2,r=nozzle.radius*Math.sqrt(hash(seed+7)),p=q.point.map((v,k)=>v+(k===0?Math.cos(angle)*r:k===2?Math.sin(angle)*r:hash(seed+9)*s*.8)),v=q.velocity.map((v,k)=>v+(hash(seed+k+13)-.5)*nozzle.speed*.08*nozzle.aeration);lab.detail.addMarker(p,v,0,s*(.026+.038*hash(seed+23)),.65+hash(seed+17)*.8,.48);}
  }
 }
}
