// Saved authoring data only. Runtime poses/velocities are never written to this data.
export const jointDefaults = () => ({parentId:'ground',type:'ball',anchor:[0,0,0],axis:[0,0,1],looseness:8,stiffness:200,damping:8,extensionStiffness:2000,breakForce:50000});
export const bodyDefaults = () => ({fixed:false});
export function liquidity(m){return m.liquidity ?? (['liquid','gas'].includes(m.phase)?1:0);}
export function retention(m){
 const flowing=liquidity(m),strength=m.phase==='granular'?m.cohesion:Math.max(m.tensileStrength,m.cohesion);
 return (1-flowing)**2 * m.youngModulus/(m.youngModulus+10000) * strength/(strength+100);
}
export function partRetention(p,materials){const solids=p.stamps.filter(s=>s.mode==='add').map(s=>materials.find(m=>m.id===s.materialId)).filter(Boolean);return solids.length?Math.min(...solids.map(retention)):0;}
export function sampleForces(keys,time,duration){
 if(!keys?.length)return {force:[0,0,0],torque:[0,0,0]};
 const sorted=[...keys].sort((a,b)=>a.time-b.time),t=((time%duration)+duration)%duration;
 let a=sorted.at(-1),b=sorted[0],ta=a.time-duration,tb=b.time;
 for(let i=0;i<sorted.length;i++)if(t>=sorted[i].time){a=sorted[i];ta=a.time;b=sorted[i+1]||sorted[0];tb=sorted[i+1]?.time??duration+b.time;}
 const u=tb>ta?Math.max(0,Math.min(1,(t-ta)/(tb-ta))):0;
 return Object.fromEntries(['force','torque'].map(k=>[k,a[k].map((v,i)=>v+(b[k][i]-v)*u)]));
}
export function recordForceKey(p,time,force,torque){p.forceKeys??=[];const key={time:Math.round(time*100)/100,force:[...force],torque:[...torque]},i=p.forceKeys.findIndex(k=>Math.abs(k.time-key.time)<.005);if(i>=0)p.forceKeys[i]=key;else{if(p.forceKeys.length>=120)throw Error('Force key limit reached');p.forceKeys.push(key);}p.forceKeys.sort((a,b)=>a.time-b.time);}
export function validatePhysics(asset){
 const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 const vec=(x,limit)=>Array.isArray(x)&&x.length===3&&x.every(v=>finite(v,-limit,limit));
 for(const p of asset.parts){
  if(p.physics&&(typeof p.physics.fixed!=='boolean'))throw Error('Library: invalid body settings');
  const j=p.joint;
  if(j){if(j.breakForce!==undefined&&!finite(j.breakForce,1,1e9))throw Error('Library: invalid joint breaking force');if(!['ball','hinge','spring','fixed'].includes(j.type)||j.parentId===p.id||!(j.parentId==='ground'||asset.parts.some(q=>q.id===j.parentId))||!vec(j.anchor,10000)||!vec(j.axis,1)||Math.hypot(...j.axis)<.1||!finite(j.looseness,0,180)||!finite(j.stiffness,0,100000)||!finite(j.damping,0,10000)||!finite(j.extensionStiffness,1,1000000))throw Error('Library: invalid joint');}
  if(p.forceKeys){if(!Array.isArray(p.forceKeys)||p.forceKeys.length>120)throw Error('Library: force key budget');const times=new Set();for(const k of p.forceKeys){if(!finite(k.time,0,asset.duration)||!vec(k.force,100000)||!vec(k.torque,100000)||times.has(k.time))throw Error('Library: invalid force key');times.add(k.time);}}
 }
 // Cyclic articulation graphs can over-constrain the solver. Reject before creating any bodies.
 for(const p of asset.parts){const seen=new Set([p.id]);let q=p;while(q.joint&&q.joint.parentId!=='ground'){q=asset.parts.find(x=>x.id===q.joint.parentId);if(seen.has(q.id))throw Error('Library: joint cycle');seen.add(q.id);}}
}
