// Scene dispatch only. Historical test implementations stay byte-for-byte frozen.
const params=new URLSearchParams(location.search);
if(!params.has('scene')||params.get('scene')==='sand-lab'){
 if(params.get('profile')==='safe')import('./sand-lab/main.js');
 else import('./rtx-sand-lab/main.js');
}
else{
 document.getElementById('test-scene').addEventListener('change',event=>{if(event.target.value==='sand-lab'){event.stopImmediatePropagation();location.assign('?scene=sand-lab');}},true);
 import('./main.js');
}
