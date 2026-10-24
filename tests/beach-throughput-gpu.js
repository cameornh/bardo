// Opening or hot-reloading this page never creates a graphics context.
// A failed check stays stopped until the user deliberately returns later.
let runner,failure=false;
async function start(action){
 if(failure)return;const button=document.getElementById(action==='run'?'run':'preview');button.disabled=true;
 try{runner??=import('./beach-throughput-runner.js');await (await runner)[action]();}
 catch(error){failure=true;document.getElementById('result').textContent=error.stack||String(error);for(const id of ['run','preview','work','fast'])document.getElementById(id).disabled=true;}
 finally{if(!failure)button.disabled=false;}
}
document.getElementById('run').onclick=()=>start('run');
document.getElementById('preview').onclick=()=>start('preview');

if(new URLSearchParams(location.search).has('report')){
 for(const id of ['run','preview','work','fast'])document.getElementById(id).disabled=true;
 document.getElementById('status').textContent='Saved CPU results only. Graphics checks remain stopped.';
}
fetch('./results/beach-throughput-2026-10-24/cpu.json').then(r=>r.json()).then(report=>{
 const rows=report.scenarios.map(s=>`${s.scene.padEnd(12)} ${s.previous.meanMs.toFixed(1).padStart(6)} → ${s.current.meanMs.toFixed(1).padStart(5)} ms    ${s.speedup.toFixed(2)}× faster`);
 document.getElementById('saved').textContent='Water constraint timings — CPU only\nPrevious compiled solver → new shortcuts\n\n'+rows.join('\n')+'\n\n44 numerical/regression checks passed. Build passed.\nWhole-scene FPS/realtime comparison remains unverified:\nthe browser disabled WebGL during the preview check.';
}).catch(()=>{});
