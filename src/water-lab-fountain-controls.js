import {FOUNTAIN_DEFAULTS} from './water-lab-fountain.js';
const $=id=>document.getElementById(id);
export function setupFountainControls(lab,camera,controls,home){
 lab.fountain??={...FOUNTAIN_DEFAULTS};
 for(const key of Object.keys(FOUNTAIN_DEFAULTS)){
  const el=$('wl-fountain-'+key);
  el.oninput=()=>{lab.fountain[key]=key==='color'?el.value:Number(el.value);if(key!=='color')$('wl-fountain-'+key+'-value').value=key==='angle'?el.value+'°':Number(el.value).toFixed(2);lab.revision++;};
 }
 $('wl-fountain-view').onclick=home;
 $('wl-fountain-close').onclick=()=>{camera.position.set(5.1,4.1,6.2);controls.target.set(0,3,0);controls.update();};
 $('wl-fountain-stop').onclick=()=>{for(const k of ['crown','arcs','lower'])lab.fountain[k]=0;syncFountainControls(lab);};
}
export function syncFountainControls(lab){
 $('wl-fountain-controls').hidden=lab.kind!=='fountain';
 for(const [key,value] of Object.entries(lab.fountain||FOUNTAIN_DEFAULTS)){$('wl-fountain-'+key).value=value;$('wl-fountain-'+key).oninput?.();}
}
