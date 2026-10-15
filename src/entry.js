// Scene dispatch only. Historical test implementations stay byte-for-byte frozen.
if(new URLSearchParams(location.search).get('scene')==='sand-lab')import('./sand-lab/main.js');
else{
 document.getElementById('test-scene').addEventListener('change',event=>{if(event.target.value==='sand-lab'){event.stopImmediatePropagation();location.assign('?scene=sand-lab');}},true);
 import('./main.js');
}
