// No context creation or hot-reload retry until a deliberate button press.
const $=id=>document.getElementById(id);let runner,failure=false;
async function run(action){
 if(failure)return;for(const id of ['validate','benchmark','trajectory'])$(id).disabled=true;
 try{runner??=import('./bounded-pressure-runner.js');const result=await (await runner)[action]();$('result').textContent=JSON.stringify(result,null,2);failure=!result.pass;$('status').textContent=result.pass?'Check passed.':'Stopped. No retry or larger workload will run.';}
 catch(error){failure=true;$('status').textContent='Stopped before further graphics work.';$('result').textContent=error.stack||String(error);}
 if(!failure){$('benchmark').disabled=false;$('trajectory').disabled=false;}
}
$('validate').onclick=()=>run('validate');$('benchmark').onclick=()=>run('benchmark');

$('trajectory').onclick=()=>run('trajectory');
