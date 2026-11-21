import {defaultVariation} from './family.js';
import {reusableContents} from './assembly.js';

const ranges = [
  ['size','Size spread (±%)',90,100], ['twist','Rotation spread (±°)',180,1],
  ['width','Detail width spread (±%)',90,100], ['curl','Detail curl spread (±)',1,1]
];
export const assemblyControls = `
<fieldset id="studio-assembly" hidden><legend>Assemble from library</legend>
<label>Library source<select id="studio-source"></select></label>
<label>Insert<select id="studio-content"></select></label>
<label id="studio-mount-row">On surface<select id="studio-mount"><option value="fixed">Fixed joint</option><option value="ball">Ball joint</option><option value="hinge">Hinge</option><option value="spring">Spring</option><option value="free">Free placement</option></select></label>
<label>Variation seed<input id="studio-seed" type="number" min="0" max="4294967295" step="1" value="1"></label>
<div class="studio-row"><button id="studio-insert-pivot">Insert at selected pivot</button><button id="studio-insert-surface">Place on surface</button></div>
<small>Each insertion makes an editable copy. The seed advances after placement.</small></fieldset>
<details id="studio-variation" hidden><summary id="studio-variation-title">Variation on reuse</summary>
<label>Distribution<select id="studio-distribution"><option value="uniform">Uniform</option><option value="centered">Favor the center</option></select></label>
${ranges.map(([key,label,max])=>`<label>${label}<input type="number" id="studio-spread-${key}" min="0" max="${max}" step="${key==='curl'?.01:1}"></label>`).join('')}
<small>Saved with this asset. Size and rotation also apply to world placements. Detail width and curl vary on editable copies.</small></details>`;

export function bindAssemblyControls($,{library,asset,options,setVariation,insert,setTool,notice}) {
  $('seed').value=crypto.getRandomValues(new Uint32Array(1))[0];
  const family=()=>library().families?.find(f=>'family:'+f.id===$('source').value);
  const source=()=>library().assets.find(a=>a.id===$('source').value);
  function contentChanged(){
    const detail=$('content').value.startsWith('detail:')||$('content').value==='sampleDetail';
    $('insert-pivot').disabled=detail;
    $('mount-row').hidden=detail;
  }
  function syncContent(){
    const f=family();
    const entries=f?[{id:'whole',name:'Sample a whole member asset'}]:reusableContents(source());
    if(f&&f.members.some(m=>library().assets.find(a=>a.id===m.assetId)?.parts.some(p=>p.marks?.length)))
      entries.push({id:'sampleDetail',name:'Sample a member’s painted detail'});
    const selected=$('content').value;
    options('content',entries,entries.some(e=>e.id===selected)?selected:'whole');
    contentChanged();
  }
  function sync(editing) {
    $('assembly').hidden=$('variation').hidden=!editing;
    if (!editing) return;
    const assets=library().assets, old=$('source').value;
    const entries=[...assets,...(library().families||[]).map(f=>({id:'family:'+f.id,name:'Family · '+f.name}))];
    options('source',entries,entries.some(e=>e.id===old)?old:(assets.find(a=>a.id!==asset().id)||asset()).id);
    syncContent();
    $('variation-title').textContent='Variation on reuse · '+asset().name;
    const recipe=asset().variation || defaultVariation;
    $('distribution').value=recipe.distribution;
    for (const [key,,,unit] of ranges) $('spread-'+key).value=Number((recipe[key]*unit).toFixed(3));
  }
  function commitVariation(){
    const recipe={distribution:$('distribution').value};
    for (const [key,,,unit] of ranges) {
      const input=$('spread-'+key);
      if (!input.value || !input.reportValidity()) return sync(true);
      recipe[key]=Number(input.value)/unit;
    }
    setVariation(recipe);
  }
  function seed(){
    const input=$('seed');
    if (!input.value || !input.checkValidity()) throw Error('Use a whole seed between 0 and 4294967295.');
    return Number(input.value);
  }
  function advance(n){$('seed').value=(n+1)>>>0;}
  function place(hit){
    try {
      const n=seed();
      insert({sourceId:$('source').value,content:$('content').value,jointType:hit?$('mount').value:null,seed:n},hit);
      advance(n);
    } catch(e){notice(e.message);}
  }
  $('source').onchange=syncContent;
  $('content').onchange=contentChanged;
  $('insert-pivot').onclick=()=>place(null);
  $('insert-surface').onclick=()=>setTool('insert');
  for(const [key] of ranges) $('spread-'+key).onchange=commitVariation;
  $('distribution').onchange=commitVariation;
  return {sync,place,seed,advance};
}
