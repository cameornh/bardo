// Scene dispatch only. Historical test implementations stay byte-for-byte frozen.
import {loadScene} from './scene-startup.js';
const params=new URLSearchParams(location.search);
if(params.has('scene')&&params.get('scene')!=='sand-lab'){
 document.getElementById('test-scene').addEventListener('change',event=>{if(event.target.value==='sand-lab'){event.stopImmediatePropagation();location.assign('?scene=sand-lab');}},true);
}
loadScene(params,window.__bardoStartup,kind=>{
 if(kind==='rtx')return import('./rtx-sand-lab/main.js');
 if(kind==='safe')return import('./sand-lab/main.js');
 return import('./main.js');
});
