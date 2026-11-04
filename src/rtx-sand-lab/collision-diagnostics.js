export function installCollisionDiagnostics(lab,anchor){
 if(!anchor)return;
 const output=document.createElement('pre');output.id='rigid-diagnostics';anchor.after(output);
 const update=()=>{
  const r=lab.rigidContacts,c=r.terrainCache,s=r.stats,entries=[...c.entries.values()];
  output.textContent=`Objects: ${c.backend}\n${entries.filter(e=>e.mesh).length} cached meshes · ${entries.reduce((n,e)=>n+(e.mesh?.triangles.length||0),0)} collision triangles\n${lab.balls.filter(b=>r.sleeping(b)).length} sleeping · ${s.testedPairs||0} nearby pair tests / step\n${s.reusedContacts||0} reused contacts / step · ${c.stats.meshNormals+c.stats.meshNormalReuses} mesh normal queries`;
 };
 const timer=setInterval(update,700);update();
 window.addEventListener('pagehide',()=>{clearInterval(timer);lab.rigidContacts.dispose();},{once:true});
}
